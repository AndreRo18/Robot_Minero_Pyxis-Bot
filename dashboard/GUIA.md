# Guía paso a paso · Robot Minero Pyxis-Bot en Vercel

Esta guía te lleva desde cero hasta tener **la página comercial (landing con SEO)**, la **pantalla de inicio de sesión y registro**, el **dashboard de control** y la **API** funcionando en Internet, con el **ESP32** enviando datos reales.


---

## 0. Qué vas a construir (arquitectura)

```
 ┌──────────────┐  HTTPS POST /api/telemetry (1 s)    ┌───────────────────────────┐
 │   ESP32      │ ──────────────────────────────────▶ │  VERCEL                   │
 │ gases+LiDAR  │ ◀────────── comando pendiente ───── │  • Landing  (/)           │
 │ motores      │  GET /api/command (200 ms, manual)  │  • Dashboard (/dashboard) │
 └──────────────┘                                     │  • API serverless (/api)  │
                                                      └─────────────┬─────────────┘
 ┌──────────────┐  GET /api/telemetry (1 s)                         │
 │  Navegador   │ ◀──────────────────────────────────────────────── │
 │  (con sesión)│  POST /api/command (modo, mover, E-STOP)          ▼
 └──────────────┘ ─────────────────────────────────────▶  Upstash Redis (memoria
                                                          compartida: última lectura,
                                                          historial, alertas, comandos)
```

**¿Por qué Redis?** Las funciones de Vercel son *serverless*: cada petición puede ejecutarse en una máquina distinta y no guardan memoria entre llamadas. Redis es el "punto de encuentro" donde el robot deja sus datos y el dashboard deja las órdenes.

**Recorrido del usuario**
```
Landing (/) ──▶ /login  ──┬─ Iniciar sesión ──▶ /dashboard (privado)
                          ├─ Crear cuenta   ──▶ /dashboard (rol observador)
                          └─ Ver demo sin cuenta ──▶ /dashboard?demo=1 (datos simulados)
```

**Usuarios y roles**
| Rol | Puede ver datos | Controla el robot | Gestiona usuarios y ve solicitudes de demo |
|---|:-:|:-:|:-:|
| **Administrador** | ✔ | ✔ | ✔ |
| **Operador** | ✔ | ✔ | — |
| **Observador** (por defecto al registrarse) | ✔ | — | — |
| **Bloqueado** | — | — | — |

- **El primer usuario que se registra queda como administrador.** Regístrate tú primero apenas publiques.
- Contraseñas cifradas con *scrypt* (nunca se guardan en texto plano), mínimo 8 caracteres con letras y números.
- La sesión dura 7 días en una cookie *HttpOnly* firmada (JavaScript no puede leerla).
- Bloqueo temporal de 15 min tras 8 intentos fallidos de inicio de sesión.
- Cada cambio de modo o parada de emergencia queda registrado con el nombre de quien lo hizo.

**Protocolo de seguridad incorporado**
- El ESP32 se autentica con `ROBOT_API_KEY`; las personas, con su cuenta y su rol.
- Un comando de movimiento **caduca en 2 s** en el servidor y el ESP32 **se detiene solo** si no recibe comandos nuevos en 700 ms (failsafe).
- La **parada de emergencia** queda activa hasta que un operador la libere.
- En modo automático, el robot **se detiene si detecta gas peligroso**.

---

## 1. Requisitos

| Herramienta | Para qué | Dónde |
|---|---|---|
| Cuenta de **GitHub** | Guardar el código y conectarlo a Vercel | github.com |
| Cuenta de **Vercel** | Publicar la web y la API | vercel.com (entra con GitHub) |
| **Node.js 18+** | Probar en tu computador | nodejs.org (versión LTS) |
| **Git** o **GitHub Desktop** | Subir el código | git-scm.com / desktop.github.com |
| **Arduino IDE 2** | Programar el ESP32 | arduino.cc |

> ⚠️ **Plan de Vercel:** el plan gratuito *Hobby* es solo para uso personal no comercial. Como esta página promociona los servicios de una empresa, usa el plan **Pro** para producción (puedes desarrollar y probar en Hobby).

---

## 2. Estructura del proyecto

```
robot-minero-web/
├── api/                    ← BACKEND (cada archivo = un endpoint)
│   ├── telemetry.js        POST robot → guarda datos | GET dashboard → lee datos
│   ├── command.js          POST operador → órdenes | GET robot → lee órdenes
│   ├── auth.js             registro, inicio y cierre de sesión
│   ├── users.js            gestión de usuarios y roles (admin)
│   ├── lead.js             formulario "Solicitar demo" de la landing
│   └── health.js           diagnóstico del servidor
├── lib/                    ← lógica compartida
│   ├── store.js            Redis (Upstash) con respaldo en memoria
│   ├── safety.js           UMBRALES DE GASES (edítalos aquí)
│   ├── auth.js             contraseñas, sesiones y roles
│   ├── control.js          estado de modo / E-STOP / comando
│   └── http.js             utilidades (CORS, claves, respuestas)
├── public/                 ← FRONTEND
│   ├── index.html          landing comercial con SEO
│   ├── login.html          iniciar sesión / crear cuenta
│   ├── dashboard.html      centro de control (privado)
│   ├── assets/             css, js, favicon, imagen para redes
│   ├── robots.txt  sitemap.xml  manifest.webmanifest  404.html
├── esp32/robot_minero_vercel/robot_minero_vercel.ino   ← FIRMWARE
├── tools/simulador-robot.mjs   simula el ESP32 para pruebas
├── dev-server.mjs          servidor local sin dependencias
├── vercel.json             cabeceras de seguridad, URLs limpias
└── .env.example            variables de entorno de ejemplo
```

---

## 3. Probar en tu computador (5 minutos)

1. Descomprime el ZIP y abre una terminal dentro de la carpeta `robot-minero-web`.
2. Arranca el servidor local:
   ```bash
   node dev-server.mjs
   ```
3. Abre **http://localhost:3000** (landing) → botón **Registrarse**. Crea tu cuenta: al ser la primera, quedas como **administrador** y entras al dashboard.
   - Para ver la demo sin cuenta: **http://localhost:3000/dashboard?demo=1**.
4. En **otra terminal**, simula el robot real:
   ```bash
   node tools/simulador-robot.mjs
   ```
   En pocos segundos el indicador cambia a **ROBOT EN LÍNEA**. Prueba: botón *Manual* → mantén `W` → el simulador muestra `cmd=F`. Pulsa *Parada de emergencia* → `estop=true`.

> En local no se necesitan claves ni Redis: los datos (incluidos los usuarios) viven en memoria y **se borran al reiniciar** el servidor local.

---

## 4. Subir el código a GitHub

**Opción A – terminal**
```bash
git init
git add .
git commit -m "Robot minero: landing, dashboard y API"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/robot-minero-web.git
git push -u origin main
```
(Antes crea el repositorio vacío en github.com → **New repository**, puede ser **privado**.)

**Opción B – GitHub Desktop:** *File → Add local repository* → *Publish repository*.

---

## 5. Publicar en Vercel

1. Entra a **vercel.com → Add New… → Project**.
2. Elige el repositorio `robot-minero-web` → **Import**.
3. Configuración:
   - **Framework Preset:** `Other`
   - **Build Command:** vacío · **Output Directory:** vacío (Vercel sirve `public/` y convierte `api/` en funciones automáticamente)
4. **Deploy**. En ~30 s tendrás una URL tipo `https://robot-minero-web.vercel.app`.

Desde ahora, **cada `git push` publica una versión nueva automáticamente**.

---

## 6. Conectar la base de datos (Upstash Redis)

1. En tu proyecto de Vercel → pestaña **Storage** → **Create Database** → **Upstash → Redis** (Marketplace).
2. Elige la **misma región de tus funciones de Vercel** (por defecto Vercel usa Washington D.C. `iad1`, que corresponde a `us-east-1`) → **Create**.
3. **Connect Project** → selecciona `robot-minero-web` y los entornos (Production, Preview, Development).
4. Vercel crea solas las variables `KV_REST_API_URL` / `KV_REST_API_TOKEN` (o `UPSTASH_REDIS_REST_URL` / `_TOKEN`). El código acepta ambos nombres.

**Costos a tener en cuenta:** el plan gratuito de Upstash incluye 500.000 comandos al mes. Con el robot enviando cada segundo y un dashboard abierto se consumen ~10 comandos/s (≈ 290.000 en un turno de 8 h). Para operación diaria usa *pay-as-you-go* o un plan *Fixed* de Upstash. Para ahorrar, sube `TELEMETRIA_MS` a 2000 en el ESP32 o `POLL_MS` a 2000 en `public/assets/dashboard.js`.

---

## 7. Crear las claves de seguridad

1. Genera dos claves aleatorias (ejecuta el comando dos veces):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Vercel → **Settings → Environment Variables** → agrega:

   | Nombre | Valor | Para qué |
   |---|---|---|
   | `ROBOT_API_KEY` | clave 1 | autentica al ESP32 |
   | `AUTH_SECRET` | clave 2 | firma las sesiones de los usuarios |

3. Ve a **Deployments → ⋯ → Redeploy** para que tomen efecto.
4. **Inmediatamente** entra a `https://TU-PROYECTO.vercel.app/login` → **Crear cuenta**. Esa primera cuenta será el **administrador**.

> 🔐 Sin `AUTH_SECRET` las sesiones usan un secreto de desarrollo conocido: **nunca publiques sin configurarla**. Si algún día la cambias, todos los usuarios deberán iniciar sesión de nuevo (sus cuentas no se pierden).

## 8. Verificar

Abre `https://TU-PROYECTO.vercel.app/api/health`. Debes ver:
```json
{ "ok": true, "storage": "redis", "robotKey": true, "authSecret": true }
```
- `storage: "memory"` → Redis no está conectado (repite el paso 6 y haz *Redeploy*).
- `robotKey/authSecret: false` → faltan las variables del paso 7.

Prueba la nube con el simulador desde tu PC:
```bash
URL=https://TU-PROYECTO.vercel.app KEY=TU_ROBOT_API_KEY node tools/simulador-robot.mjs
```
(En Windows PowerShell: `$env:URL="https://..."; $env:KEY="..."; node tools/simulador-robot.mjs`)

---

## 9. Programar el ESP32

1. **Arduino IDE → Preferencias → URLs adicionales:**
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. **Gestor de tarjetas:** instala *esp32 by Espressif* **versión 3.x**.
3. **Gestor de librerías:** instala **ArduinoJson** (Benoit Blanchon) v7.
4. Abre `esp32/robot_minero_vercel/robot_minero_vercel.ino` y edita la sección **1. CONFIGURACIÓN**:
   ```cpp
   const char* WIFI_SSID     = "TU_WIFI";
   const char* WIFI_PASS     = "TU_CLAVE_WIFI";
   const char* SERVER_URL    = "https://TU-PROYECTO.vercel.app";
   const char* ROBOT_API_KEY = "la-misma-ROBOT_API_KEY-de-Vercel";
   ```
5. Revisa la sección **2. PINES** según tu cableado (motores, LiDAR en UART2 pines 16/17, sensores en ADC1).
6. **Sección 5 – Sensores:** reemplaza `leerCO()`, `leerCH4()`, `leerO2()`, `leerH2S()` por **tus funciones calibradas** (las incluidas son marcadores). Unidades: CO y H₂S en **ppm**, CH₄ y O₂ en **%vol**.
7. **Sección 6 – LiDAR:** el parser lee la trama estándar de 47 bytes (cabecera `0x54 0x2C`). Si tu MS200 usa otra trama, pega tu función actual y llena `lidarTmp[]` en centímetros (72 sectores de 5°, sector 0 = frente, sentido horario).
8. Placa **ESP32 Dev Module** → **Subir**. Abre el Monitor Serie a 115200 baudios: verás `Conectando a Wi-Fi... OK`.
9. Abre el dashboard: en segundos aparece **ROBOT EN LÍNEA** con datos reales.

**Control manual local (sin Internet):** desde el Monitor Serie escribe `w a s d` para mover, `x` para parar y `m` para cambiar de modo.

---

## 10. Usar el dashboard

| Acción | Cómo |
|---|---|
| Entrar | `/login` → **Iniciar sesión** (o **Crear cuenta**) |
| Dar permisos a un compañero | Él se registra → tú (admin) abres el panel **Usuarios y permisos** al final del dashboard y cambias su rol a *Operador* |
| Quitar acceso | Cambia su rol a *Bloqueado* (se aplica en su próxima acción) |
| Cambiar modo | Botones *Automático / Manual* o tecla **M** (operador/admin) |
| Conducir | Mantén **W A S D** o flechas, o los botones táctiles (se detiene al soltar) |
| Parar | **Espacio** |
| Emergencia | Botón rojo o tecla **E** (requiere confirmación para liberar) |
| Rango LiDAR | 2 m / 4 m / 8 m |
| Exportar datos | *Exportar historial CSV* (para reportes HSE) |
| Ver solicitudes comerciales | Panel al final del dashboard (solo admin) |
| Cerrar sesión | Menú con tu nombre (arriba a la derecha) → *Cerrar sesión* |

Indicadores: **MODO DEMO** (datos simulados) · **ESPERANDO ROBOT** (aún no llegan datos) · **ROBOT EN LÍNEA** · **SIN SEÑAL DEL ROBOT** (había datos y dejaron de llegar → revisa el robot). La etiqueta del panel *Control* muestra **HABILITADO** o **SOLO LECTURA** según tu rol.

**¿Olvidaste tu contraseña?** Por ahora el usuario debe pedirlo al administrador. Para recuperación automática por correo, el siguiente paso es conectar un servicio de envío de correos (por ejemplo Resend) y agregar un enlace de restablecimiento.

## 11. Posicionamiento orgánico (SEO) – lista de tareas

Lo que **ya está hecho** en el código:
- HTML semántico (`header`, `main`, `section`, `h1` único, `h2` por sección), idioma `es-CO`.
- `title` y `meta description` con las palabras clave: *robot minero, detección de gases en minas, metano, LiDAR, espacios confinados*.
- **Open Graph** + imagen 1200×630 para que se vea bien al compartir en WhatsApp, LinkedIn y Facebook.
- **Datos estructurados** (JSON-LD): `Organization`, `Product` y `FAQPage` (pueden aparecer como resultados enriquecidos en Google).
- `robots.txt` y `sitemap.xml`; el dashboard y la API están excluidos de la indexación.
- Carga rápida: sin frameworks pesados, caché de recursos, imágenes ligeras (mejora Core Web Vitals).

Lo que **debes hacer tú**:
1. **Reemplaza el dominio** `robot-minero.vercel.app` por el real en `public/index.html` (canonical, og:url, og:image, JSON-LD), `public/robots.txt` y `public/sitemap.xml`.
2. **Dominio propio** (recomendado, ej. `topo-robotics.co`): Vercel → *Settings → Domains → Add*, y sigue las instrucciones de DNS. Un dominio propio genera más confianza y mejor posicionamiento.
3. **Google Search Console** (search.google.com/search-console): agrega tu dominio, verifica por DNS y envía `https://tu-dominio/sitemap.xml`.
4. **Prueba de resultados enriquecidos:** search.google.com/test/rich-results con tu URL.
5. **Perfil de Empresa en Google** (Google Business Profile) con la misma dirección y nombre que en la web.
6. **Contenido continuo:** publica artículos que respondan búsquedas reales del sector, por ejemplo:
   - "Cómo medir metano en una mina subterránea"
   - "Niveles peligrosos de CO, H₂S y O₂: guía para supervisores"
   - "Inspección de espacios confinados con robots"
   Cada artículo debe enlazar a la landing y al formulario de demo.
7. **Enlaces y autoridad:** videos del robot en YouTube/LinkedIn con enlace a la web, participación en ferias mineras y directorios del sector.
8. **Mide:** Vercel → *Analytics* y *Speed Insights* (actívalos en el proyecto) y Lighthouse en Chrome (objetivo: >90 en SEO y rendimiento).

---

## 12. Personalizar marca y umbrales

- **Marca:** busca `TOPO` en `public/` y reemplázalo. Cambia colores en `:root` de `public/assets/landing.css` y `dashboard.css` (`--accent` es el ámbar de seguridad).
- **Umbrales de gases:** `lib/safety.js` (servidor) y la función `leerSensores()` del ESP32. Mantén ambos iguales.
  > Los valores incluidos son de referencia (ACGIH/OSHA y práctica minera). **Valídalos con el área HSE** y con el **Decreto 1886 de 2015** (Reglamento de seguridad en labores mineras subterráneas) antes de operar.

---

## 13. Recomendaciones de ingeniería para campo

1. **Atmósferas explosivas:** en minas con presencia de metano (grisú), cualquier equipo electrónico puede ser fuente de ignición. Para operar en zonas clasificadas, el robot necesita **envolvente y electrónica certificada** (protección Ex "d" a prueba de explosión o Ex "i" de seguridad intrínseca, bajo IECEx/ATEX). Mientras tanto, presenta el equipo como **prototipo para zonas no clasificadas** y pruebas controladas.
2. **Comunicación bajo tierra:** el Wi-Fi se pierde rápido en galerías. Opciones: repetidores/malla Wi-Fi en la galería, radio LoRa para telemetría de baja velocidad, o cable de fibra/ethernet con carrete. El modo automático sigue funcionando sin red y los datos se reanudan al recuperar señal.
3. **Latencia:** el control desde la nube tiene ~150–400 ms de retardo. Para conducción fina en campo, usa velocidades bajas o un control local (punto de acceso del propio ESP32).
4. **Calibración:** los sensores electroquímicos requieren calibración periódica con gas patrón; registra las fechas.
5. **HTTPS en el ESP32:** el firmware usa `setInsecure()` para simplificar (cifra pero no verifica el certificado del servidor). En producción carga el certificado raíz con `cli.setCACert(...)`.

---

## 14. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| Dashboard en ESPERANDO ROBOT | El robot no envía o la clave no coincide | Monitor Serie: busca `[HTTP] POST ... → 401` y revisa `ROBOT_API_KEY` |
| "Tu rol es observador" | Cuenta sin permiso de control | Un admin debe cambiar tu rol a *Operador* |
| Me devuelve siempre a /login | Sesión vencida o `AUTH_SECRET` cambió | Inicia sesión de nuevo |
| Se perdieron los usuarios | `storage: "memory"` (local o Redis sin conectar) | Conecta Upstash; en local es normal al reiniciar |
| "Demasiados intentos" | 8 contraseñas erradas | Espera 15 minutos |
| "El robot está en modo automático" | Se intentó mover en modo auto | Cambia a *Manual* |
| Datos aparecen y desaparecen | `storage: "memory"` en producción | Conecta Upstash (paso 6) y *Redeploy* |
| `HTTP -1` en el ESP32 | Sin Internet o URL mal escrita | Verifica Wi-Fi y que `SERVER_URL` no termine en `/` |
| El robot se detiene a ratos en manual | Failsafe por latencia | Sube `FAILSAFE_MS` a 1000 o mejora la señal |
| No compila `ledcAttach` | Core ESP32 2.x | Actualiza a core 3.x |

---

## 15. Referencia rápida de la API

| Método | Ruta | Requiere | Cuerpo / respuesta |
|---|---|---|---|
| POST | `/api/auth` | — | `{action:"register", name, company, email, password, terms:true}` · `{action:"login", email, password}` · `{action:"logout"}` |
| GET | `/api/auth` | sesión | usuario actual y `canControl` |
| GET / POST | `/api/users` | admin | lista · `{email, role}` cambia el rol |
| POST | `/api/telemetry` | `X-Api-Key` | `{co, ch4, o2, h2s, temp, hum, bat, speed, rssi, heading, mode, state, lidar:[cm…]}` → `{overall, mode, estop, cmd}` |
| GET | `/api/telemetry?history=300` | sesión | última lectura, historial, alertas, umbrales |
| GET | `/api/command` | `X-Api-Key` | `{seq, cmd, mode, estop}` |
| POST | `/api/command` | operador/admin | `{type:"move",dir:"F|B|L|R|S",speed}` · `{type:"mode",value}` · `{type:"estop"}` · `{type:"reset"}` |
| POST | `/api/lead` | — | `{name, email, company, sector, message}` |
| GET | `/api/lead` | admin | últimas solicitudes |
| GET | `/api/health` | — | estado del sistema |
