'use strict';
/**
 * Almacén de datos.
 *  - En Vercel: Upstash Redis por REST (variables KV_REST_API_URL / KV_REST_API_TOKEN
 *    o UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
 *  - En tu PC (sin variables): memoria del proceso. Se borra al reiniciar el servidor local.
 *
 * Todo el código habla con comandos de Redis (GET, SET, LPUSH...), así que el comportamiento es el mismo
 * en los dos casos. Solo se usan comandos que el respaldo en memoria también implementa.
 */
const URL_ = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REMOTE = Boolean(URL_ && TOKEN);

// ---------- Respaldo en memoria ----------
const mem = globalThis.__rmMem || (globalThis.__rmMem = { data: new Map(), exp: new Map() });

function vivo(k) {
  const e = mem.exp.get(k);
  if (e && e <= Date.now()) { mem.data.delete(k); mem.exp.delete(k); return false; }
  return mem.data.has(k);
}

function rango(len, ini, fin) {
  ini = Number(ini); fin = Number(fin);
  if (ini < 0) ini = Math.max(0, len + ini);
  if (fin < 0) fin = len + fin;
  return [ini, Math.min(fin, len - 1)];
}

function memExec(args) {
  const c = String(args[0]).toUpperCase();
  const a = args.slice(1);
  switch (c) {
    case 'PING': return 'PONG';
    case 'GET': return vivo(a[0]) ? mem.data.get(a[0]) : null;
    case 'SET': {
      const [k, v, ...opt] = a;
      let nx = false, ex = 0;
      for (let i = 0; i < opt.length; i++) {
        const o = String(opt[i]).toUpperCase();
        if (o === 'NX') nx = true; else if (o === 'EX') ex = Number(opt[++i]);
      }
      if (nx && vivo(k)) return null;
      mem.data.set(k, String(v));
      if (ex) mem.exp.set(k, Date.now() + ex * 1000); else mem.exp.delete(k);
      return 'OK';
    }
    case 'DEL': {
      let n = 0;
      for (const k of a) if (vivo(k)) { mem.data.delete(k); mem.exp.delete(k); n++; }
      return n;
    }
    case 'INCR': {
      const v = (vivo(a[0]) ? Number(mem.data.get(a[0])) : 0) + 1;
      mem.data.set(a[0], String(v));
      return v;
    }
    case 'EXPIRE': {
      if (!vivo(a[0])) return 0;
      mem.exp.set(a[0], Date.now() + Number(a[1]) * 1000);
      return 1;
    }
    case 'TTL': {
      if (!vivo(a[0])) return -2;
      const e = mem.exp.get(a[0]);
      return e ? Math.max(0, Math.ceil((e - Date.now()) / 1000)) : -1;
    }
    case 'LPUSH': {
      const l = vivo(a[0]) ? mem.data.get(a[0]) : [];
      for (const v of a.slice(1)) l.unshift(String(v));
      mem.data.set(a[0], l);
      return l.length;
    }
    case 'LTRIM': {
      if (!vivo(a[0])) return 'OK';
      const l = mem.data.get(a[0]);
      const [i, f] = rango(l.length, a[1], a[2]);
      mem.data.set(a[0], l.slice(i, f + 1));
      return 'OK';
    }
    case 'LRANGE': {
      if (!vivo(a[0])) return [];
      const l = mem.data.get(a[0]);
      const [i, f] = rango(l.length, a[1], a[2]);
      return l.slice(i, f + 1);
    }
    case 'HSET': {
      const h = vivo(a[0]) ? mem.data.get(a[0]) : new Map();
      let n = 0;
      for (let i = 1; i < a.length; i += 2) { if (!h.has(String(a[i]))) n++; h.set(String(a[i]), String(a[i + 1])); }
      mem.data.set(a[0], h);
      return n;
    }
    case 'HSETNX': {
      const h = vivo(a[0]) ? mem.data.get(a[0]) : new Map();
      if (h.has(String(a[1]))) return 0;
      h.set(String(a[1]), String(a[2]));
      mem.data.set(a[0], h);
      return 1;
    }
    case 'HGET': return vivo(a[0]) && mem.data.get(a[0]).has(String(a[1])) ? mem.data.get(a[0]).get(String(a[1])) : null;
    case 'HGETALL': {
      if (!vivo(a[0])) return [];
      const out = [];
      for (const [k, v] of mem.data.get(a[0])) out.push(k, v);
      return out;
    }
    default: throw new Error('Comando no soportado en memoria: ' + c);
  }
}

// ---------- Redis remoto (Upstash REST) ----------
async function remoto(cmds, single) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(URL_ + (single ? '' : '/pipeline'), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(single ? cmds[0] : cmds),
      signal: ctl.signal,
    });
    const j = await r.json();
    if (!r.ok) throw new Error('Redis HTTP ' + r.status + ': ' + (j && j.error || ''));
    if (single) { if (j.error) throw new Error('Redis: ' + j.error); return [j.result]; }
    return j.map((x) => { if (x.error) throw new Error('Redis: ' + x.error); return x.result; });
  } finally { clearTimeout(t); }
}

/** Ejecuta varios comandos en UN solo viaje. Devuelve los resultados en orden. */
async function pipeline(cmds) {
  if (!cmds.length) return [];
  if (REMOTE) return remoto(cmds, false);
  return cmds.map(memExec);
}
/** Ejecuta un comando: cmd('SET', 'clave', 'valor', 'EX', 60) */
async function cmd(...args) {
  if (REMOTE) return (await remoto([args], true))[0];
  return memExec(args);
}

// ---------- Ayudas ----------
const parse = (s) => { if (s == null) return null; try { return JSON.parse(s); } catch { return null; } };
const getJSON = async (k) => parse(await cmd('GET', k));
const setJSON = (k, v, ex) => (ex ? cmd('SET', k, JSON.stringify(v), 'EX', ex) : cmd('SET', k, JSON.stringify(v)));
/** HGETALL devuelve [campo, valor, campo, valor...]: se convierte a objeto. */
function pares(arr) {
  const o = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
}

module.exports = { cmd, pipeline, getJSON, setJSON, parse, pares, isRemote: REMOTE };
