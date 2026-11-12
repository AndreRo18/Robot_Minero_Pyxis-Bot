# Traspaso de Pyxis-Bot a las cuentas de la empresa

Objetivo: que GitHub, Vercel, Neon, Auth0 y Resend queden a nombre de la empresa, sin perder datos ni dejar el servicio caído. Los cinco servicios permiten traspasar sin reinstalar nada. Tiempo estimado: 2 a 3 horas.

## Inventario actual

| Servicio | Qué hay | Cómo se traspasa |
|---|---|---|
| GitHub | Repositorio `AndreRo18/Robot_Minero_Pyxis-Bot` | Transferir a una organización |
| Vercel | Proyecto `robot_minero_pyxis-bot-dashboard` (Root Directory `plataforma`) | Transferir a un equipo (team) |
| Neon | Proyecto "Robot Minero" | Transferir a una organización |
| Auth0 | Tenant `dev-qk3egsfuac48s21x`, aplicación "Pyxis-Bot Dashboard" | Invitar a la empresa como administradora y retirarse |
| Resend | Clave de API personal | Cuenta nueva de la empresa con su dominio |

## Paso 0 · Preparación (empresa)
1. Crear un correo corporativo genérico para la plataforma, por ejemplo `plataforma@empresa.com`, con verificación en 2 pasos. No usar correos personales: si esa persona se va, la empresa pierde el acceso.
2. Comprar el dominio de la empresa. Hace falta para enviar correos a cualquier invitado y para una dirección web profesional.
3. Elegir una franja de baja actividad. Ningún paso apaga el servicio, pero conviene no tener robots operando.

## Paso 1 · GitHub
1. Con el correo corporativo: github.com → **+** → **New organization** (plan gratuito). Invitar a Andrea como *Owner* temporal.
2. En el repositorio: **Settings → General → Danger Zone → Transfer ownership** → elegir la organización → escribir el nombre del repositorio para confirmar.
3. GitHub redirige las direcciones antiguas. En la Jetson, actualizar el origen:
   `git remote set-url origin https://github.com/ORGANIZACION/Robot_Minero_Pyxis-Bot.git`
4. En la organización: exigir verificación en 2 pasos (**Settings → Authentication security**) y proteger la rama `main` (**Settings → Branches → Add rule**: requerir *pull request* antes de unir cambios).

## Paso 2 · Vercel
1. Con el correo corporativo: crear un **Team**. El uso comercial exige el plan **Pro**. Invitar a Andrea como miembro.
2. En el proyecto: **Settings → General → Transfer Project** → elegir el equipo de la empresa. Se trasladan despliegues, dominios y variables de entorno, sin tiempo fuera de servicio.
3. En el proyecto ya traspasado: **Settings → Git → Connect Git Repository** → instalar la app de Vercel en la organización de GitHub → conectar `ORGANIZACION/Robot_Minero_Pyxis-Bot`.
4. Confirmar **Settings → Build and Deployment → Root Directory = `plataforma`**.

## Paso 3 · Neon
1. Con el correo corporativo: crear una organización en console.neon.tech e invitar a Andrea.
2. En el proyecto "Robot Minero": **Settings → Transfer project** → elegir la organización de la empresa. La cadena de conexión no cambia, así que la aplicación sigue funcionando.
3. Por seguridad, al terminar: **Roles → neondb_owner → Reset password**, copiar la nueva cadena de conexión y actualizar `DATABASE_URL` en Vercel.

## Paso 4 · Auth0
Un tenant no se mueve entre cuentas: se traspasa cambiando sus administradores. Conviene conservar el mismo tenant; uno nuevo obligaría a todos los usuarios a registrarse otra vez.
1. En manage.auth0.com: **Settings → Tenant Members → Invite** → correo corporativo con rol **Admin**.
2. Cuando la empresa acepte, Andrea se retira desde la misma pantalla. Si el plan gratuito no deja agregar otro miembro, solicitar el cambio a soporte de Auth0 o subir de plan.
3. Rotar el secreto: **Applications → Pyxis-Bot Dashboard → Credentials → Rotate** y actualizar `AUTH0_CLIENT_SECRET` en Vercel.
4. Recomendado: **Branding → Universal Login** con el logo de la empresa, y claves propias de Google en **Authentication → Social**.

## Paso 5 · Dominio y correo (Resend)
1. Vercel → proyecto → **Settings → Domains → Add** → `www.empresa.com` y aplicar en el proveedor del dominio los registros DNS que indique Vercel.
2. Actualizar el dominio en el código y subir el cambio:
   `cd plataforma && node scripts/cambiar-dominio.mjs https://www.empresa.com`
3. Auth0 → aplicación → **URLs**: agregar `https://www.empresa.com/api/auth` (Callback) y `https://www.empresa.com/login` (Logout).
4. Resend con el correo corporativo: **Domains → Add Domain** → aplicar los registros DNS → verificar. Crear una **API Key** nueva.
5. En Vercel: `RESEND_API_KEY` (la nueva), `RESEND_FROM = Pyxis-Bot Robotics <invitaciones@empresa.com>`, `APP_URL = https://www.empresa.com`.
6. En cada Jetson: `CLOUD_URL=https://www.empresa.com`. Las claves `pyx_…` de los robots no cambian.

## Paso 6 · Secretos y accesos finales

| Variable en Vercel | Acción |
|---|---|
| `DATABASE_URL` | Nueva tras el cambio de contraseña en Neon (paso 3) |
| `AUTH0_CLIENT_SECRET` | Nueva tras la rotación (paso 4) |
| `AUTH_SECRET` | Generar otra: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Todos inician sesión de nuevo |
| `RESEND_API_KEY`, `RESEND_FROM`, `APP_URL` | Las de la empresa (paso 5) |
| `SUPERADMIN_EMAILS` | Correos corporativos del equipo Pyxis-Bot |
| `KV_*` | Borrar junto con la base Upstash `pyxis-bot-redis` (sin uso) |

Después de cambiarlas: **Deployments → Redeploy**. Luego:
- Revocar la clave de Resend personal y retirar a Andrea de los servicios donde ya no deba tener acceso (o dejarla como miembro sin rol de dueña).
- Guardar todas las credenciales en el gestor de contraseñas de la empresa.

## Paso 7 · Verificación final
- [ ] `https://www.empresa.com/api/health` muestra `dbOk`, `auth0` y `correo` en `true` y `problemas` vacío
- [ ] Inicio de sesión con Auth0 funciona y aparece la empresa en el panel
- [ ] Una invitación de prueba llega al correo con el enlace al dominio nuevo
- [ ] El robot aparece "en línea" con la nueva `CLOUD_URL`
- [ ] Un cambio en `main` se publica solo en Vercel desde el repositorio de la organización
- [ ] Ningún servicio queda con un correo personal como único dueño
