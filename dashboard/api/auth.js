'use strict';
/**
 * GET  /api/auth                        usuario de la sesión actual
 * POST /api/auth {action:'register', name, company, email, password, terms:true}
 * POST /api/auth {action:'login', email, password}
 * POST /api/auth {action:'logout'}
 *
 * El primer usuario registrado queda como administrador; los demás, como observadores.
 */
const A = require('../lib/auth');
const H = require('../lib/http');
const store = require('../lib/store');

const MAX_FALLOS = 8;            // intentos fallidos por correo+IP
const VENTANA_LOGIN_S = 15 * 60;

async function registrar(req, res, b) {
  const email = A.normalizarEmail(b.email);
  const name = A.limpiar(b.name, 60);
  const company = A.limpiar(b.company, 80);
  if (name.length < 2) return H.fail(res, 400, 'Escribe tu nombre');
  if (!A.emailValido(email)) return H.fail(res, 400, 'Escribe un correo válido');
  const errPw = A.validarPassword(b.password);
  if (errPw) return H.fail(res, 400, errPw);
  if (b.terms !== true) return H.fail(res, 400, 'Debes aceptar los términos y la política de privacidad');

  const lim = await A.contar('rl:reg:' + H.ip(req), 5, 3600);
  if (!lim.ok) return H.fail(res, 429, 'Demasiados registros desde esta red. Inténtalo más tarde', { retryAfter: lim.retryAfter });

  const esPrimero = (await store.cmd('SET', 'admin:reclamado', email, 'NX')) === 'OK';
  const user = {
    email, name, company, role: esPrimero ? 'admin' : 'observer',
    hash: await A.hashPassword(b.password), createdAt: Date.now(), lastLogin: Date.now(), sv: 1,
  };
  const creado = await store.cmd('HSETNX', 'users', email, JSON.stringify(user));
  if (creado !== 1) {
    if (esPrimero) await store.cmd('DEL', 'admin:reclamado');   // no se pudo crear: se libera la reclamación
    return H.fail(res, 409, 'Ese correo ya está registrado. Inicia sesión');
  }
  await A.auditar(email, 'registro', 'rol ' + user.role);
  return H.send(res, 201, { ok: true, user: A.publico(user), primerAdmin: esPrimero }, { 'Set-Cookie': A.cookieSesion(req, user) });
}

async function entrar(req, res, b) {
  const email = A.normalizarEmail(b.email);
  const password = typeof b.password === 'string' ? b.password : '';
  if (!A.emailValido(email) || !password) return H.fail(res, 400, 'Escribe tu correo y tu contraseña');

  const clave = `rl:login:${email}:${H.ip(req)}`;
  const previos = Number(await store.cmd('GET', clave)) || 0;
  if (previos >= MAX_FALLOS) {
    const ttl = await store.cmd('TTL', clave);
    return H.fail(res, 429, 'Demasiados intentos. Inténtalo de nuevo en unos minutos', { retryAfter: ttl > 0 ? ttl : VENTANA_LOGIN_S });
  }

  const user = await A.buscarUsuario(email);
  const ok = await A.verifyPassword(password, user ? user.hash : await A.hashFalso());
  if (!user || !ok) {
    const lim = await A.contar(clave, MAX_FALLOS, VENTANA_LOGIN_S);
    if (!lim.ok) return H.fail(res, 429, 'Demasiados intentos. Inténtalo de nuevo en unos minutos', { retryAfter: lim.retryAfter });
    return H.fail(res, 401, 'Correo o contraseña incorrectos');
  }
  if (user.role === 'blocked') return H.fail(res, 403, 'Tu cuenta está bloqueada. Contacta al administrador');

  await store.cmd('DEL', clave);
  user.lastLogin = Date.now();
  await store.cmd('HSET', 'users', email, JSON.stringify(user));
  return H.send(res, 200, { ok: true, user: A.publico(user) }, { 'Set-Cookie': A.cookieSesion(req, user) });
}

module.exports = H.endpoint(async (req, res) => {
  if (req.method === 'GET') {
    const u = await A.usuarioActual(req);
    if (!u) return H.fail(res, 401, 'No hay sesión');
    return H.send(res, 200, { ok: true, user: u, canControl: u.canControl });
  }
  if (req.method !== 'POST') return H.fail(res, 405, 'Método no permitido');
  if (!H.solicitudSegura(req)) return H.fail(res, 403, 'Solicitud no permitida');
  if (!A.secretoListo()) return H.fail(res, 503, 'El servidor no tiene configurada la variable AUTH_SECRET');

  const b = await H.readBody(req);
  switch (b.action) {
    case 'register': return registrar(req, res, b);
    case 'login': return entrar(req, res, b);
    case 'logout': return H.send(res, 200, { ok: true }, { 'Set-Cookie': A.cookieBorrar(req) });
    default: return H.fail(res, 400, 'Acción desconocida');
  }
});
