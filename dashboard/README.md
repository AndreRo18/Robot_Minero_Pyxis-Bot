# TOPO · Sitio web + panel + API (Vercel)

Landing con SEO, registro/inicio de sesión, panel de control del robot minero y API sin dependencias npm.
Marca "TOPO Robotics" y dominio `www.example.com` son **provisionales** (ver "Personalizar").

## Estructura
- `public/` — sitio estático: `index.html` (landing), `login.html`, `dashboard.html` (protegido, noindex), `guias/`, `terminos`, `privacidad`, `404`, `robots.txt`, `sitemap.xml`, `manifest.webmanifest`, `assets/`.
- `api/` — funciones serverless: `auth`, `users`, `telemetry`, `command`, `lead`, `health`.
- `lib/` — almacenamiento (Upstash Redis o memoria), autenticación, seguridad (umbrales), control.
- `tools/` — `test-api.mjs` (85 pruebas), `simulador-robot.mjs`, `personalizar.mjs`.
- Jetson: `robot-minero/jetson/cloud_gateway.py` + cambios en `jetson_robot_bridge.py` y `robot_minero.launch.py`.

## Probar en local (sin cuentas ni servicios externos)
```
node dev-server.mjs                      # http://localhost:3000
node tools/simulador-robot.mjs           # robot simulado (otra terminal)
node tools/test-api.mjs                  # pruebas del backend
```
Registra la primera cuenta en `/login`: es la de **administrador**. Sin Redis los datos viven en memoria.

## Desplegar en Vercel
1. Crea una base **Upstash Redis** (desde Vercel › Storage) y copia `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` (o `KV_REST_API_URL/TOKEN`; ver `.env.example`).
2. Variables de entorno: `AUTH_SECRET` (cadena aleatoria ≥ 32 caracteres) y `ROBOT_API_KEY` (clave larga aleatoria). Sin ellas, en Vercel el inicio de sesión responde 503 y el robot es rechazado (a propósito).
3. `vercel --prod`. Comprueba `/api/health`.
4. Para uso comercial Vercel exige plan Pro; Upstash cobra por comandos (la telemetría a 1 Hz son ~86 400 lecturas/día).

## Conectar el robot
En la Jetson: `export CLOUD_URL=https://tu-proyecto.vercel.app CLOUD_KEY=<ROBOT_API_KEY>` y lanzar `robot_minero.launch.py`.
Telemetría 1 Hz → `/api/telemetry`; órdenes ~4 Hz ← `/api/command`. Sin latido del operador por 5 s el puente ya regresa solo a la base.

## Modos del panel
| URL | Modo | Requiere |
|---|---|---|
| `/dashboard` | Nube | sesión |
| `/dashboard?demo=1` | Demo simulada | nada |
| `/dashboard?host=IP_JETSON` | Local (rosbridge, con video) | misma red |

Roles: **administrador** (usuarios, solicitudes, bitácora), **operador** (envía órdenes), **observador** (solo lectura). La parada de emergencia la puede activar cualquiera con sesión; solo operador/admin la libera.

## Personalizar
`node tools/personalizar.mjs https://www.tudominio.com "Tu Marca" [SIGLA]` y reemplaza `public/assets/img/panel.jpg` / `og.png` si quieres. Revisa `terminos.html` y `privacidad.html` con un abogado (Ley 1581 de 2012).

## SEO incluido
HTML semántico, `es-CO`, title/description, canonical, Open Graph/Twitter, JSON-LD (Organization, WebSite, Product, FAQPage, Article), sitemap, robots (bloquea `/dashboard`, `/login`, `/api`), guía de contenido. Tras publicar: Search Console, enviar el sitemap y medir Core Web Vitals.

## Seguridad
scrypt, cookie HttpOnly firmada (7 días), defensa CSRF, límites de intentos y de solicitudes, CSP sin scripts en línea, bitácora, trampa anti-bots. Los umbrales de gases están duplicados en `lib/safety.js`, el firmware y el panel: mantenlos iguales.

## Límites honestos
- ROS 2, el ESP32 y la pasarela **no se probaron con hardware** (solo sintaxis y simulador).
- El video no viaja por la nube; solo en modo local.
- No está certificado para atmósferas explosivas (ATEX/IECEx).
