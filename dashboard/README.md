# Pyxis-Bot · Sitio web + panel + API (Vercel + Auth0 + Neon)

Landing con SEO, inicio de sesión con Auth0, panel de control multiempresa y API. Única dependencia: `@neondatabase/serverless`.
Marca "TOPO Robotics" y dominio `www.example.com` son **provisionales** (ver "Personalizar").

## Estructura
- `public/` — sitio estático: `index.html` (landing), `login.html`, `dashboard.html` (protegido, noindex), `guias/`, `terminos`, `privacidad`, `404`, `robots.txt`, `sitemap.xml`, `manifest.webmanifest`, `assets/`.
- `api/` — funciones serverless: `auth` (Auth0), `users`, `robots`, `telemetry`, `command`, `lead`, `health`.
- `lib/` — `db.js` (Neon + esquema), `auth.js` (sesión y permisos por empresa), `control.js` (robots y órdenes), `safety.js` (umbrales), `http.js`.
- `tools/` — `test-api.mjs` + `pg-local.mjs` (pruebas), `simulador-robot.mjs`, `personalizar.mjs`.
- Jetson: `robot-minero/jetson/cloud_gateway.py` + cambios en `jetson_robot_bridge.py` y `robot_minero.launch.py`.

## Cómo funciona ahora (v2: Auth0 + Neon + varias empresas)
- **Inicio de sesión con Auth0** (pantalla universal de Auth0). Aquí no se guardan contraseñas.
- **Neon (Postgres)** es la única base de datos. Las tablas se crean solas al primer uso.
- **Multiempresa:** cada usuario pertenece a una empresa y solo ve/controla los robots, usuarios, alertas y bitácora de la suya.
  - El primero de una empresa entra con Auth0 → "Registra tu empresa" → queda como **administrador**.
  - El administrador **invita** por correo (operador/observador/admin). La persona entra con Auth0 usando ese correo **verificado** y queda dentro.
  - El administrador **registra cada robot** (Administración → Robots) y recibe su **clave una sola vez** → va en la Jetson (`CLOUD_KEY`).
  - Las solicitudes de demo de la landing solo las ve el equipo Pyxis-Bot (`SUPERADMIN_EMAILS`).

## Configurar (una vez)
1. **Neon:** Vercel → proyecto → *Storage* → *Create Database* → **Neon** → conectar al proyecto. Crea `DATABASE_URL`.
2. **Auth0:** auth0.com → *Applications* → *Create Application* → **Regular Web Application**. En *Settings*:
   - Allowed Callback URLs: `https://TU-DOMINIO/api/auth` (y `http://localhost:3000/api/auth` para pruebas)
   - Allowed Logout URLs: `https://TU-DOMINIO/login`
   - Copia Domain, Client ID y Client Secret.
   - Recomendado: *Authentication → Database* exigir verificación de correo (las invitaciones solo funcionan con correo verificado).
3. **Gmail (correos de invitación):** en https://myaccount.google.com/apppasswords crea una *contraseña de aplicación* (requiere verificación en 2 pasos) y agrega `GMAIL_USER` (tu Gmail) y `GMAIL_APP_PASSWORD` en Vercel. Sin ellas, las invitaciones se crean pero no se envía el correo.
4. **Vercel → Settings → Environment Variables:** `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH_SECRET`, `SUPERADMIN_EMAILS` (ver `.env.example`). Luego *Redeploy*.
5. Abre `/api/health`: debe decir `"dbOk": true, "auth0": true, "problemas": []`.
6. Entra en `/login`, registra tu empresa, registra el robot y copia la clave en la Jetson:
   `export CLOUD_URL=https://TU-DOMINIO CLOUD_KEY=pyx_...`

## Probar en local
```
npm install
DATABASE_URL=... AUTH0_DOMAIN=... AUTH0_CLIENT_ID=... AUTH0_CLIENT_SECRET=... node dev-server.mjs   # http://localhost:3000
node tools/simulador-robot.mjs http://localhost:3000 pyx_CLAVE_DEL_ROBOT                           # robot simulado
PGURL=postgres://usuario:clave@127.0.0.1/base_de_pruebas node tools/test-api.mjs                  # 48 pruebas (Postgres local + Auth0 simulado)
```

## Costos a vigilar
Cada robot hace ~5 consultas/s a Neon (telemetría 1 Hz + órdenes 4 Hz), así que el cómputo de Neon no se suspende mientras el robot está encendido. Las lecturas se guardan 7 días y las alertas 90.

## Modos del panel
| URL | Modo | Requiere |
|---|---|---|
| `/dashboard` | Nube | sesión |
| `/dashboard?demo=1` | Demo simulada | nada |
| `/dashboard?host=IP_JETSON` | Local (rosbridge, con video) | misma red |

Roles por empresa: **administrador** (usuarios, robots, bitácora), **operador** (envía órdenes), **observador** (solo lectura). La parada de emergencia la puede activar cualquiera con sesión; solo operador/admin la libera.

## Personalizar
`node tools/personalizar.mjs https://www.tudominio.com "Tu Marca" [SIGLA]` y reemplaza `public/assets/img/panel.jpg` / `og.png` si quieres. Revisa `terminos.html` y `privacidad.html` con un abogado (Ley 1581 de 2012).

## SEO incluido
HTML semántico, `es-CO`, title/description, canonical, Open Graph/Twitter, JSON-LD (Organization, WebSite, Product, FAQPage, Article), sitemap, robots (bloquea `/dashboard`, `/login`, `/api`), guía de contenido. Tras publicar: Search Console, enviar el sitemap y medir Core Web Vitals.

## Seguridad
Auth0 (contraseñas, MFA y bloqueo por intentos los gestiona Auth0), cookie HttpOnly firmada (12 h), `state` anti-falsificación en el login, defensa CSRF, claves de robot guardadas como SHA-256, aislamiento por empresa en cada consulta, CSP sin scripts en línea, bitácora, trampa anti-bots. Los umbrales de gases están duplicados en `lib/safety.js`, el firmware y el panel: mantenlos iguales.

## Límites honestos
- ROS 2, el ESP32 y la pasarela **no se probaron con hardware** (solo sintaxis y simulador).
- El video no viaja por la nube; solo en modo local.
- No está certificado para atmósferas explosivas (ATEX/IECEx).
