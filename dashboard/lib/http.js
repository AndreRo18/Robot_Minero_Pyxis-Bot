'use strict';
/** Utilidades HTTP compartidas por todos los endpoints. */
const crypto = require('crypto');

const EN_VERCEL = Boolean(process.env.VERCEL);

function send(res, status, obj, extra) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (extra) for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}
const fail = (res, status, error, extra) => send(res, status, Object.assign({ ok: false, error }, extra || {}));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Lee el cuerpo JSON (Vercel ya lo entrega en req.body; en local se lee del flujo). */
async function readBody(req, limit = 32 * 1024) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body)); }
    catch { throw new HttpError(400, 'JSON inválido'); }
  }
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new HttpError(413, 'Cuerpo demasiado grande');
    chunks.push(c);
  }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'JSON inválido'); }
}

function consulta(req) {
  return Object.fromEntries(new URL(req.url, 'http://local').searchParams);
}

function cookies(req) {
  const out = {};
  for (const par of String(req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return out;
}

function ip(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers['x-real-ip'] || '') || (req.socket && req.socket.remoteAddress) || 'desconocida';
}

const esHttps = (req) => EN_VERCEL || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';

/** Defensa CSRF: el cuerpo debe ser JSON y, si el navegador envía Origin, debe ser el mismo sitio. */
function solicitudSegura(req) {
  if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) return false;
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return false; } catch { return false; }
  }
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && sfs === 'cross-site') return false;
  return true;
}

function iguales(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Clave del robot. En Vercel es obligatorio configurarla; en local se usa una clave de desarrollo. */
function claveRobot() {
  return process.env.ROBOT_API_KEY || (EN_VERCEL ? '' : 'dev-robot-key');
}
function esRobot(req) {
  const k = claveRobot();
  const dada = req.headers['x-api-key'];
  return Boolean(k && dada && iguales(dada, k));
}

/** Envuelve un endpoint: captura errores y los responde como JSON. */
function endpoint(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      if (e instanceof HttpError) return fail(res, e.status, e.message);
      console.error('[api]', req.url, e);
      return fail(res, 500, 'Error interno del servidor');
    }
  };
}

const num = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

module.exports = { send, fail, HttpError, readBody, consulta, cookies, ip, esHttps, solicitudSegura, iguales, claveRobot, esRobot, endpoint, num, EN_VERCEL };
