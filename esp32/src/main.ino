/* ============================================================================
   TOPO M1 · Robot minero · Firmware ESP32 conectado al dashboard en Vercel
   ----------------------------------------------------------------------------
   - Núcleo 1 (loop): sensores de gas, LiDAR MS200, navegación y motores.
   - Núcleo 0 (tareaRed): envía telemetría a /api/telemetry cada 1 s y, en
     modo manual, consulta /api/command cada 200 ms para responder rápido.
   - Seguridad: parada de emergencia remota, auto-stop si no llegan comandos
     en modo manual (FAILSAFE_MS) y detención por gas peligroso.

   Librerías (Arduino IDE → Gestor de librerías):
     * ArduinoJson  (Benoit Blanchon) v7.x
   Placa: "ESP32 Dev Module" con el core esp32 de Espressif 3.x
   ============================================================================ */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ===================== 1. CONFIGURACIÓN (EDITA ESTO) =====================
const char* WIFI_SSID     = "TU_WIFI";
const char* WIFI_PASS     = "TU_CLAVE_WIFI";
const char* SERVER_URL    = "https://TU-PROYECTO.vercel.app";   // sin "/" final
const char* ROBOT_API_KEY = "la-misma-ROBOT_API_KEY-de-Vercel";

const uint32_t TELEMETRIA_MS = 1000;  // envío de datos
const uint32_t COMANDO_MS    = 200;   // consulta de comandos en modo manual
const uint32_t FAILSAFE_MS   = 700;   // sin comando nuevo → motores a 0
const bool     PARAR_SI_GAS_PELIGROSO = true;

// ===================== 2. PINES =====================
// Motores (driver tipo L298N / TB6612 / BTS7960 en modo 2 pines + PWM)
const int M_IZQ_IN1 = 26, M_IZQ_IN2 = 27, M_IZQ_PWM = 14;
const int M_DER_IN1 = 25, M_DER_IN2 = 33, M_DER_PWM = 32;
// LiDAR Oradar MS200 → UART2
const int LIDAR_RX = 16, LIDAR_TX = 17;
const long LIDAR_BAUD = 230400;
const float LIDAR_OFFSET_DEG = 0;  // ajusta si el "frente" del LiDAR no apunta al frente del robot
// Sensores analógicos (ADC1: 32-39 funcionan con Wi-Fi activo)
const int PIN_CO = 34, PIN_CH4 = 35, PIN_O2 = 36, PIN_H2S = 39;
const int PIN_BAT = 4;  // divisor resistivo de la batería (ver leerBateria)

// ===================== 3. ESTADO COMPARTIDO =====================
struct Telemetria {
  float co = 0, ch4 = 0, o2 = 20.9, h2s = 0, temp = NAN, hum = NAN, bat = 100;
  float speed = 0;
  char  estado[32] = "INICIANDO";
};
Telemetria tel;

const int SECTORES = 72;                 // 360° / 5°
uint16_t lidarCm[SECTORES];              // distancia mínima por sector (cm), 0 = sin dato
uint16_t lidarTmp[SECTORES];
SemaphoreHandle_t mtx;

volatile bool modoManual = false;
volatile bool estop = false;
volatile char cmdDir = 'S';
volatile int  cmdSpeed = 0;
volatile uint32_t cmdSeq = 0, ultimoCmdMs = 0;
volatile bool gasPeligro = false;

// ============================================================================
//  4. MOTORES
// ============================================================================
void motor(int in1, int in2, int pwmPin, int v) {        // v: -255..255
  digitalWrite(in1, v > 0);
  digitalWrite(in2, v < 0);
  ledcWrite(pwmPin, abs(v));
}
void mover(char dir, int pct) {
  int v = map(constrain(pct, 0, 100), 0, 100, 0, 255);
  switch (dir) {
    case 'F': motor(M_IZQ_IN1, M_IZQ_IN2, M_IZQ_PWM,  v); motor(M_DER_IN1, M_DER_IN2, M_DER_PWM,  v); break;
    case 'B': motor(M_IZQ_IN1, M_IZQ_IN2, M_IZQ_PWM, -v); motor(M_DER_IN1, M_DER_IN2, M_DER_PWM, -v); break;
    case 'L': motor(M_IZQ_IN1, M_IZQ_IN2, M_IZQ_PWM, -v); motor(M_DER_IN1, M_DER_IN2, M_DER_PWM,  v); break;
    case 'R': motor(M_IZQ_IN1, M_IZQ_IN2, M_IZQ_PWM,  v); motor(M_DER_IN1, M_DER_IN2, M_DER_PWM, -v); break;
    default:  motor(M_IZQ_IN1, M_IZQ_IN2, M_IZQ_PWM,  0); motor(M_DER_IN1, M_DER_IN2, M_DER_PWM,  0); break;
  }
  tel.speed = (dir == 'S') ? 0 : 0.5f * pct / 100.0f;   // estimado; reemplaza con encoder si tienes
}

// ============================================================================
//  5. SENSORES DE GAS
//  ⚠️ PEGA AQUÍ TUS FUNCIONES CALIBRADAS. Las de abajo son solo marcadores
//  para que el sistema compile y transmita. Unidades esperadas por el dashboard:
//  CO ppm · CH4 %vol · O2 %vol · H2S ppm
// ============================================================================
float voltios(int pin) { return analogReadMilliVolts(pin) / 1000.0f; }
float leerCO()  { return voltios(PIN_CO)  * 100.0f; }   // TODO: tu curva de calibración
float leerCH4() { return voltios(PIN_CH4) * 1.0f;   }   // TODO
float leerO2()  { return 20.9f;                     }   // TODO
float leerH2S() { return voltios(PIN_H2S) * 10.0f;  }   // TODO
float leerBateria() {
  // Ejemplo: batería 2S (8.4 V) con divisor 100k/33k → ~2.08 V al ADC
  float v = voltios(PIN_BAT) * (133.0f / 33.0f);
  return constrain((v - 6.4f) / (8.4f - 6.4f) * 100.0f, 0, 100);
}

void leerSensores() {
  tel.co = leerCO(); tel.ch4 = leerCH4(); tel.o2 = leerO2(); tel.h2s = leerH2S();
  tel.bat = leerBateria();
  // Mismos umbrales que el servidor (lib/safety.js)
  gasPeligro = tel.co >= 50 || tel.ch4 >= 1.5 || tel.h2s >= 10 || tel.o2 <= 18 || tel.o2 >= 23.5;
}

// ============================================================================
//  6. LiDAR ORADAR MS200
//  Trama de 47 bytes: 0x54 0x2C | vel(2) | áng. inicio(2) | 12×(dist 2 + int 1)
//  | áng. fin(2) | timestamp(2) | CRC8. Si tu MS200 usa otra trama, reemplaza
//  esta función por la que ya tenías y llena lidarTmp[] en cm.
// ============================================================================
uint8_t crc8(const uint8_t* d, int n) {
  uint8_t c = 0;
  for (int i = 0; i < n; i++) {
    c ^= d[i];
    for (int b = 0; b < 8; b++) c = (c & 0x80) ? (c << 1) ^ 0x4D : (c << 1);
  }
  return c;
}

void actualizarLidar() {
  static uint8_t buf[47];
  static int idx = 0;
  static float anguloPrevio = 0;

  while (Serial2.available()) {
    uint8_t b = Serial2.read();
    if (idx == 0 && b != 0x54) continue;
    if (idx == 1 && b != 0x2C) { idx = 0; continue; }
    buf[idx++] = b;
    if (idx < 47) continue;
    idx = 0;
    if (crc8(buf, 46) != buf[46]) continue;

    float ini = (buf[4] | buf[5] << 8) / 100.0f;
    float fin = (buf[42] | buf[43] << 8) / 100.0f;
    float paso = fmodf(fin - ini + 360.0f, 360.0f) / 11.0f;

    // Vuelta completa → publicar el barrido
    if (ini < anguloPrevio) {
      xSemaphoreTake(mtx, portMAX_DELAY);
      memcpy(lidarCm, lidarTmp, sizeof(lidarCm));
      xSemaphoreGive(mtx);
      memset(lidarTmp, 0, sizeof(lidarTmp));
    }
    anguloPrevio = ini;

    for (int i = 0; i < 12; i++) {
      uint16_t mm = buf[6 + i * 3] | buf[7 + i * 3] << 8;
      uint8_t  intensidad = buf[8 + i * 3];
      if (mm < 30 || intensidad < 10) continue;               // ruido
      float a = fmodf(ini + paso * i + LIDAR_OFFSET_DEG + 360.0f, 360.0f);
      int s = ((int)(a / 5.0f)) % SECTORES;
      uint16_t cm = mm / 10;
      if (lidarTmp[s] == 0 || cm < lidarTmp[s]) lidarTmp[s] = cm;
    }
  }
}

// distancia mínima (cm) entre dos ángulos (en grados, sentido horario desde el frente)
uint16_t despeje(int desde, int hasta) {
  uint16_t m = 9999;
  xSemaphoreTake(mtx, portMAX_DELAY);
  for (int a = desde; a <= hasta; a += 5) {
    uint16_t d = lidarCm[((a + 360) % 360) / 5];
    if (d && d < m) m = d;
  }
  xSemaphoreGive(mtx);
  return m;
}

// ============================================================================
//  7. NAVEGACIÓN AUTOMÁTICA (reactiva, simple y segura)
// ============================================================================
void navegarAutomatico() {
  uint16_t frente = despeje(-20, 20);
  uint16_t izq    = despeje(-90, -30);
  uint16_t der    = despeje(30, 90);

  if (frente > 70) {
    mover('F', 55);  strcpy(tel.estado, "EXPLORANDO");
  } else if (frente < 30) {
    mover('B', 45);  strcpy(tel.estado, "RETROCEDIENDO");
  } else {
    mover(izq > der ? 'L' : 'R', 50);  strcpy(tel.estado, "EVITANDO OBSTACULO");
  }
}

// ============================================================================
//  8. RED (núcleo 0)
// ============================================================================
void aplicarControl(JsonDocument& j) {
  if (!j["mode"].isNull()) modoManual = (strcmp(j["mode"] | "auto", "manual") == 0);
  estop = j["estop"] | false;
  if (!j["cmd"].isNull()) {
    uint32_t seq = j["cmd"]["seq"] | 0;
    if (seq != cmdSeq) {                       // comando nuevo
      cmdSeq = seq;
      const char* d = j["cmd"]["dir"] | "S";
      cmdDir = d[0];
      cmdSpeed = j["cmd"]["speed"] | 0;
      ultimoCmdMs = millis();
    }
  }
}

bool peticion(const char* metodo, const char* ruta, const String& cuerpo, JsonDocument& resp) {
  static WiFiClientSecure cli;
  static bool listo = false;
  if (!listo) { cli.setInsecure(); listo = true; }  // ver GUIA: certificado raíz en producción
  HTTPClient http;
  http.setReuse(true);
  http.setTimeout(3000);
  if (!http.begin(cli, String(SERVER_URL) + ruta)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Api-Key", ROBOT_API_KEY);
  int code = strcmp(metodo, "POST") == 0 ? http.POST(cuerpo) : http.GET();
  bool ok = false;
  if (code == 200) ok = !deserializeJson(resp, http.getStream());
  else Serial.printf("[HTTP] %s %s → %d\n", metodo, ruta, code);
  http.end();
  return ok;
}

void enviarTelemetria() {
  JsonDocument doc;
  doc["co"] = tel.co;   doc["ch4"] = tel.ch4; doc["o2"] = tel.o2; doc["h2s"] = tel.h2s;
  if (!isnan(tel.temp)) doc["temp"] = tel.temp;
  if (!isnan(tel.hum))  doc["hum"]  = tel.hum;
  doc["bat"] = tel.bat; doc["speed"] = tel.speed; doc["rssi"] = WiFi.RSSI();
  doc["mode"] = modoManual ? "manual" : "auto";
  doc["state"] = tel.estado;
  JsonArray arr = doc["lidar"].to<JsonArray>();
  xSemaphoreTake(mtx, portMAX_DELAY);
  for (int i = 0; i < SECTORES; i++) arr.add(lidarCm[i]);
  xSemaphoreGive(mtx);

  String cuerpo; serializeJson(doc, cuerpo);
  JsonDocument resp;
  if (peticion("POST", "/api/telemetry", cuerpo, resp)) aplicarControl(resp);
}

void tareaRed(void*) {
  uint32_t tTel = 0, tCmd = 0;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      WiFi.reconnect();
      vTaskDelay(pdMS_TO_TICKS(2000));
      continue;
    }
    uint32_t ahora = millis();
    if (ahora - tTel >= TELEMETRIA_MS) { tTel = ahora; enviarTelemetria(); }
    else if (modoManual && ahora - tCmd >= COMANDO_MS) {
      tCmd = ahora;
      JsonDocument resp;
      if (peticion("GET", "/api/command", "", resp)) aplicarControl(resp);
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// ============================================================================
//  9. SETUP / LOOP (núcleo 1)
// ============================================================================
void setup() {
  Serial.begin(115200);
  mtx = xSemaphoreCreateMutex();
  memset(lidarCm, 0, sizeof(lidarCm));
  memset(lidarTmp, 0, sizeof(lidarTmp));

  int pinesDir[] = {M_IZQ_IN1, M_IZQ_IN2, M_DER_IN1, M_DER_IN2};
  for (int p : pinesDir) pinMode(p, OUTPUT);
  ledcAttach(M_IZQ_PWM, 20000, 8);   // core 3.x: (pin, frecuencia, resolución)
  ledcAttach(M_DER_PWM, 20000, 8);
  mover('S', 0);

  analogReadResolution(12);
  Serial2.begin(LIDAR_BAUD, SERIAL_8N1, LIDAR_RX, LIDAR_TX);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);              // menor latencia
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Conectando a Wi-Fi");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(250); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK " + WiFi.localIP().toString() : " sin red (seguirá intentando)");

  xTaskCreatePinnedToCore(tareaRed, "red", 12288, nullptr, 1, nullptr, 0);
  Serial.println("TOPO M1 listo. Teclado serie: w a s d = mover, x = parar, m = modo");
}

void teclaSerie() {                  // modo manual local por teclado (USB)
  if (!Serial.available()) return;
  char c = tolower(Serial.read());
  if (c == 'm') modoManual = !modoManual;
  const char* m = "wsadx"; const char* d = "FBLRS";
  for (int i = 0; i < 5; i++) if (c == m[i]) { cmdDir = d[i]; cmdSpeed = 60; ultimoCmdMs = millis(); }
}

void loop() {
  static uint32_t tSens = 0;
  actualizarLidar();
  teclaSerie();
  if (millis() - tSens >= 200) { tSens = millis(); leerSensores(); }

  if (estop) {
    mover('S', 0); strcpy(tel.estado, "PARADA DE EMERGENCIA");
  } else if (PARAR_SI_GAS_PELIGROSO && gasPeligro && !modoManual) {
    mover('S', 0); strcpy(tel.estado, "DETENIDO POR GAS");
  } else if (modoManual) {
    bool vigente = millis() - ultimoCmdMs < FAILSAFE_MS;
    char d = vigente ? cmdDir : 'S';
    mover(d, cmdSpeed);
    strcpy(tel.estado, d == 'S' ? "MANUAL DETENIDO" : "MANUAL");
  } else {
    navegarAutomatico();
  }
  delay(5);
}
