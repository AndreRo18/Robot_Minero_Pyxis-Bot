# Robot minero: ESP32 + Jetson Orin Nano + Dashboard

```
Dashboard (PC base) --WiFi/Ubiquiti-- Bullet (USB) -- Jetson Orin Nano -- UART0 -- ESP32 -- motores, servos, sensores
                                                        |-- cámara RGB (USB)
                                                        |-- FLIR Lepton (SPI + I2C)
                                                        |-- LiDAR Oradar MS200
```


## 1. ESP32 (VS Code + PlatformIO)
1. Abre `esp32/` en VS Code con PlatformIO, luego Build y Upload.
2. Calibra `CO_PPM_POR_CUENTA`. Prueba los encoders empujando el robot hacia adelante: si la cuenta baja, cambia `ENC_SIGNO_IZQ` o `ENC_SIGNO_DER` a -1.
3. Teclas desde el monitor serie: W A S D, X para detener, M manual, U automático.

## 2. Jetson
```bash
sudo apt install ros-humble-rosbridge-suite ros-humble-web-video-server ros-humble-v4l2-camera python3-serial python3-opencv
pip3 install pylepton numpy
sudo usermod -aG dialout $USER                  # cierra sesión y vuelve a entrar
sudo /opt/nvidia/jetson-io/jetson-io.py         # activa SPI para la Lepton (/dev/spidev0.0)
```
Terminal 1: el launch del driver del LiDAR MS200 (debe publicar `/scan`).
Terminal 2:
```bash
source /opt/ros/humble/setup.bash
ros2 launch ~/robot-minero/jetson/robot_minero.launch.py
```
En el launch, `/dev/video0` es la cámara RGB. En `flir_lepton_node.py`, el parámetro `modelo` es 3 para Lepton 3.x y 2 para Lepton 2.x.

**Calibrar la odometría (necesario para el retorno):** empuja el robot 1 m en línea recta y mira `ros2 topic echo /robot_status`. Ajusta el parámetro `ticks_por_metro` del nodo hasta que `x` marque 1.0.

## 3. Dashboard
1. Abre `dashboard/index.html` con Live Server.
2. Cambia `HOST` por la IP de la Jetson en la red del Bullet, o abre `index.html?host=IP`.
3. `?host=` vacío activa el modo demo sin robot.

## Cómo sigue el diagrama de flujo
- **Señal de la estación base:** el dashboard manda un latido dos veces por segundo. Si no llega, la Jetson cuenta el tiempo de pérdida.
- **Menos de 5 s sin señal:** espera la reconexión. En manual, el ESP32 se detiene solo a los 500 ms por falta de órdenes.
- **Más de 5 s sin señal:** activa el retorno a base. La base es el punto donde estaba el robot al arrancar el nodo puente. Regresa siguiendo el camino que recorrió (odometría de encoders y rumbo del IMU), esquivando obstáculos con el LiDAR.
- **Llegada:** se detiene y queda en espera. Para retomar el control, el operador elige MANUAL o AUTOMÁTICO en el dashboard.
- **Parada de emergencia:** cancela el retorno y devuelve el control manual.
- **Manual:** teclado, botones o mando (joystick) del navegador, brazo y pinza.
- **Automático:** evasión de obstáculos y monitoreo continuo. El mapeo SLAM no está incluido.

## Protocolo Jetson → ESP32 (por UART0, líneas que empiezan con `#`)
| Comando | Efecto |
|---|---|
| `#MODE:AUTO` / `#MODE:MANUAL` | cambia de modo (AUTO se rechaza con alerta activa) |
| `#STOP` | para y pasa a manual |
| `#DRV:izq,der` | conducción manual, PWM -255..255, caduca a 500 ms |
| `#AUTO:izq,der` | conducción automática, caduca a 800 ms |
| `#ARM:base,hombro,codo,muneca` | ángulos -90..90 (la muñeca va en el servo de GPIO26; con 3 valores no se mueve) |
| `#GRIP:pct` | 0 cerrada .. 100 abierta |

El ESP32 responde con una línea JSON cada 100 ms (modo, alerta, temperatura, humedad, presión, CO, metano, oxígeno, batería, roll, pitch, rumbo, encoders, brazo y pinza).


# Robot minero: ESP32 + Jetson Orin Nano + Dashboard

```
Dashboard (PC base) --WiFi/Ubiquiti-- Bullet (USB) -- Jetson Orin Nano -- UART0 -- ESP32 -- motores, servos, sensores
                                                        |-- cámara RGB (USB)
                                                        |-- FLIR Lepton (SPI + I2C)
                                                        |-- LiDAR Oradar MS200
```


## 1. ESP32 (VS Code + PlatformIO)
1. Abre `esp32/` en VS Code con PlatformIO, luego Build y Upload.
2. Calibra `CO_PPM_POR_CUENTA`. Prueba los encoders empujando el robot hacia adelante: si la cuenta baja, cambia `ENC_SIGNO_IZQ` o `ENC_SIGNO_DER` a -1.
3. Teclas desde el monitor serie: W A S D, X para detener, M manual, U automático.

## 2. Jetson
```bash
sudo apt install ros-humble-rosbridge-suite ros-humble-web-video-server ros-humble-v4l2-camera python3-serial python3-opencv
pip3 install pylepton numpy
sudo usermod -aG dialout $USER                  # cierra sesión y vuelve a entrar
sudo /opt/nvidia/jetson-io/jetson-io.py         # activa SPI para la Lepton (/dev/spidev0.0)
```
Terminal 1: el launch del driver del LiDAR MS200 (debe publicar `/scan`).
Terminal 2:
```bash
source /opt/ros/humble/setup.bash
ros2 launch ~/robot-minero/jetson/robot_minero.launch.py
```
En el launch, `/dev/video0` es la cámara RGB. En `flir_lepton_node.py`, el parámetro `modelo` es 3 para Lepton 3.x y 2 para Lepton 2.x.

**Calibrar la odometría (necesario para el retorno):** empuja el robot 1 m en línea recta y mira `ros2 topic echo /robot_status`. Ajusta el parámetro `ticks_por_metro` del nodo hasta que `x` marque 1.0.

## 3. Dashboard
1. Abre `dashboard/index.html` con Live Server.
2. Cambia `HOST` por la IP de la Jetson en la red del Bullet, o abre `index.html?host=IP`.
3. `?host=` vacío activa el modo demo sin robot.

## Cómo sigue el diagrama de flujo
- **Señal de la estación base:** el dashboard manda un latido dos veces por segundo. Si no llega, la Jetson cuenta el tiempo de pérdida.
- **Menos de 5 s sin señal:** espera la reconexión. En manual, el ESP32 se detiene solo a los 500 ms por falta de órdenes.
- **Más de 5 s sin señal:** activa el retorno a base. La base es el punto donde estaba el robot al arrancar el nodo puente. Regresa siguiendo el camino que recorrió (odometría de encoders y rumbo del IMU), esquivando obstáculos con el LiDAR.
- **Llegada:** se detiene y queda en espera. Para retomar el control, el operador elige MANUAL o AUTOMÁTICO en el dashboard.
- **Parada de emergencia:** cancela el retorno y devuelve el control manual.
- **Manual:** teclado, botones o mando (joystick) del navegador, brazo y pinza.
- **Automático:** evasión de obstáculos y monitoreo continuo. El mapeo SLAM no está incluido.

## Protocolo Jetson → ESP32 (por UART0, líneas que empiezan con `#`)
| Comando | Efecto |
|---|---|
| `#MODE:AUTO` / `#MODE:MANUAL` | cambia de modo (AUTO se rechaza con alerta activa) |
| `#STOP` | para y pasa a manual |
| `#DRV:izq,der` | conducción manual, PWM -255..255, caduca a 500 ms |
| `#AUTO:izq,der` | conducción automática, caduca a 800 ms |
| `#ARM:base,hombro,codo` | ángulos -90..90 |
| `#GRIP:pct` | 0 cerrada .. 100 abierta |

El ESP32 responde con una línea JSON cada 100 ms (modo, alerta, temperatura, humedad, presión, CO, metano, oxígeno, batería, roll, pitch, rumbo, encoders, brazo y pinza).


