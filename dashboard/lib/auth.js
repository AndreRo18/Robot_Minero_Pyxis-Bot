'use strict';
/**
 * Usuarios, contraseñas, sesiones y roles.
 *
 *  - Contraseñas: scrypt con sal aleatoria (nunca se guardan en texto plano).
 *  - Sesión: cookie HttpOnly firmada con HMAC-SHA256 (AUTH_SECRET), dura 7 días.
 *  - Cada petición vuelve a leer al usuario: si lo bloquean o le cambian el rol, se aplica de inmediato.
 *  - Roles: admin (todo) · operator (ve y controla) · observer (solo ve) · blocked (sin acceso).
 */
const crypto = require('crypto');
const { promisify } = require('util');
const store = require('./store');
const http = require('./http');

const scrypt = promisify(crypto.scrypt);
const ROLES = ['admin', 'operator', 'observer', 'blocked'];
const COOKIE = 'rm_session';
const DURACION_S = 7 * 24 * 3600;
const N = 16384, R = 8, P = 1;

// ---------- Contraseñas ----------
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(pw, guardado) {
  const t = String(guardado || '').split('$');
  if (t.length !== 6 || t[0] !== 'scrypt') return false;
  const esperado = Buffer.from(t[5], 'base64');
  const key = await scrypt(pw, Buffer.from(t[4], 'base64'), esperado.length, { N: +t[1], r: +t[2], p: +t[3], maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(key, esperado);
}
let dummy;   // para que "usuario inexistente" tarde lo mismo que "contraseña incorrecta"
const hashFalso = async () => dummy || (dummy = await hashPassword('no-existe-' + crypto.randomBytes(8).toString('hex')));

function validarPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (pw.length > 128) return 'La contraseña es demasiado larga';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'La contraseña debe combinar letras y números';
  return null;
}
const normalizarEmail = (e) => String(e || '').trim().toLowerCase();
const emailValido = (e) => e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const limpiar = (s, max) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

// ---------- Sesión ----------
function secreto() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  return http.EN_VERCEL ? '' : 'secreto-solo-para-desarrollo-local';
}
const secretoListo = () => Boolean(secreto());
const b64 = (b) => Buffer.from(b).toString('base64url');

function firmar(payload) {
  const cuerpo = b64(JSON.stringify(payload));
  const firma = crypto.createHmac('sha256', secreto()).update(cuerpo).digest('base64url');
  return cuerpo + '.' + firma;
}
function leerToken(token) {
  if (!token || !secretoListo()) return null;
  const [cuerpo, firma] = String(token).split('.');
  if (!cuerpo || !firma) return null;
  const esperada = crypto.createHmac('sha256', secreto()).update(cuerpo).digest('base64url');
  if (!http.iguales(firma, esperada)) return null;
  try {
    const p = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    return p && p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

function cookieSesion(req, user) {
  const token = firmar({ sub: user.email, sv: user.sv || 1, exp: Math.floor(Date.now() / 1000) + DURACION_S });
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACION_S}${http.esHttps(req) ? '; Secure' : ''}`;
}
const cookieBorrar = (req) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${http.esHttps(req) ? '; Secure' : ''}`;

// ---------- Usuarios ----------
async function buscarUsuario(email) {
  return store.parse(await store.cmd('HGET', 'users', email));
}
const puedeControlar = (rol) => rol === 'admin' || rol === 'operator';
const publico = (u) => ({
  email: u.email, name: u.name, company: u.company, role: u.role,
  canControl: puedeControlar(u.role), createdAt: u.createdAt, lastLogin: u.lastLogin || null,
});

/** Usuario de la petición (o null si no hay sesión válida). */
async function usuarioActual(req) {
  const p = leerToken(http.cookies(req)[COOKIE]);
  if (!p) return null;
  const u = await buscarUsuario(p.sub);
  if (!u || u.role === 'blocked' || (u.sv || 1) !== p.sv) return null;
  return publico(u);
}

/** Exige sesión (y opcionalmente un permiso). Si falla ya respondió y devuelve null. */
async function exigir(req, res, { control = false, admin = false } = {}) {
  const u = await usuarioActual(req);
  if (!u) { http.fail(res, 401, 'Inicia sesión para continuar'); return null; }
  if (admin && u.role !== 'admin') { http.fail(res, 403, 'Solo el administrador puede hacer esto'); return null; }
  if (control && !u.canControl) { http.fail(res, 403, 'Tu rol es observador: solo lectura. Pide al administrador el rol de operador'); return null; }
  return u;
}

/** Limitador: cuenta intentos en una ventana. Devuelve {ok, retryAfter}. */
async function contar(clave, max, ventanaS) {
  const [n] = await store.pipeline([['INCR', clave]]);
  if (n === 1) await store.cmd('EXPIRE', clave, ventanaS);
  if (n > max) {
    const ttl = await store.cmd('TTL', clave);
    return { ok: false, retryAfter: ttl > 0 ? ttl : ventanaS };
  }
  return { ok: true, n };
}

async function auditar(quien, accion, detalle) {
  await store.pipeline([
    ['LPUSH', 'audit', JSON.stringify({ t: Date.now(), quien, accion, detalle: detalle || '' })],
    ['LTRIM', 'audit', 0, 499],
  ]);
}

module.exports = {
  ROLES, hashPassword, verifyPassword, hashFalso, validarPassword, normalizarEmail, emailValido, limpiar,
  secretoListo, cookieSesion, cookieBorrar, buscarUsuario, publico, puedeControlar, usuarioActual, exigir, contar, auditar,
};
