'use strict';
/**
 * POST /api/telemetry   (el robot / pasarela Jetson, cabecera X-Api-Key)
 *      {co, ch4, o2, h2s, temp, hum, pres, bat, bat_v, speed, rssi, heading, inc, mode, state, alert,
 *       x, y, points, arm:[b,h,c,m], grip, lidar:[cm × 72]}
 *      → {ok, overall, mode, estop}
 * GET  /api/telemetry?history=300   (sesión) última lectura, historial, alertas y umbrales
 */
const H = require('../lib/http');
const A = require('../lib/auth');
const S = require('../lib/safety');
const C = require('../lib/control');
const store = require('../lib/store');

const HIST_MAX = 3600;     // 1 hora a 1 lectura por segundo
const ESTADOS = ['NORMAL', 'RTH', 'ESPERA'];

function limpiarLectura(b) {
  const n = H.num;
  const modo = String(b.mode || '').toLowerCase();
  const r = {
    co: n(b.co, 0, 5000), ch4: n(b.ch4, 0, 100), o2: n(b.o2, 0, 100), h2s: n(b.h2s, 0, 1000),
    temp: n(b.temp, -40, 150), hum: n(b.hum, 0, 100), pres: n(b.pres, 300, 1200),
    bat: n(b.bat, 0, 100), bat_v: n(b.bat_v, 0, 80),
    speed: n(b.speed, -5, 5), rssi: n(b.rssi, -130, 0), heading: n(b.heading, 0, 360), inc: n(b.inc, 0, 180),
    x: n(b.x, -100000, 100000), y: n(b.y, -100000, 100000), grip: n(b.grip, 0, 100),
    points: n(b.points, 0, 100000),
    mode: modo.startsWith('auto') ? 'auto' : modo.startsWith('man') ? 'manual' : null,
    state: ESTADOS.includes(String(b.state).toUpperCase()) ? String(b.state).toUpperCase() : null,
    alert: b.alert ? 1 : 0,
  };
  if (Array.isArray(b.arm) && b.arm.length >= 3) {
    const a = b.arm.slice(0, 4).map((v) => n(v, -180, 180));
    if (a.every((v) => v !== null)) r.arm = a;
  }
  if (Array.isArray(b.lidar)) {
    r.lidar = b.lidar.slice(0, 72).map((v) => { const c = n(v, 0, 5000); return c === null ? 0 : Math.round(c); });
  }
  return r;
}

async function recibir(req, res) {
  const b = await H.readBody(req);
  const lect = limpiarLectura(b);
  const ev = S.evaluar(lect);
  const ahora = Date.now();

  const [previoRaw, ctl] = await store.pipeline([['GET', 'tel:last'], ['GET', 'ctl']]);
  const previo = store.parse(previoRaw);
  lect.ts = ahora;
  lect.levels = ev.niveles;
  lect.overall = ev.general;

  // Alertas: solo cuando un nivel empeora (no una por cada lectura)
  const cmds = [['SET', 'tel:last', JSON.stringify(lect)]];
  const nuevas = [];
  for (const [k, nv] of Object.entries(ev.niveles)) {
    const antes = previo && previo.levels ? previo.levels[k] || 0 : 0;
    if (nv > antes && nv >= 1) nuevas.push({ t: ahora, key: k, level: nv, value: lect[k] });
  }
  if (previo && lect.state && previo.state !== lect.state && lect.state !== 'NORMAL') {
    nuevas.push({ t: ahora, key: 'state', level: 1, value: lect.state });
  }
  const hist = { t: ahora };
  for (const k of ['co', 'ch4', 'o2', 'h2s', 'temp', 'hum', 'pres', 'bat', 'bat_v']) if (lect[k] !== null) hist[k] = lect[k];
  cmds.push(['LPUSH', 'tel:hist', JSON.stringify(hist)], ['LTRIM', 'tel:hist', 0, HIST_MAX - 1]);
  for (const a of nuevas) cmds.push(['LPUSH', 'alerts', JSON.stringify(a)]);
  if (nuevas.length) cmds.push(['LTRIM', 'alerts', 0, 199]);
  await store.pipeline(cmds);

  const st = Object.assign({ mode: 'manual', estop: false }, store.parse(ctl));
  return H.send(res, 200, { ok: true, overall: ev.general, mode: st.mode, estop: st.estop });
}

async function leer(req, res) {
  const u = await A.exigir(req, res);
  if (!u) return;
  const q = H.consulta(req);
  const n = Math.max(0, Math.min(HIST_MAX, parseInt(q.history, 10) || 0));
  const cmds = [['GET', 'tel:last'], ['LRANGE', 'alerts', 0, 29], ['GET', 'ctl']];
  if (n) cmds.push(['LRANGE', 'tel:hist', 0, n - 1]);
  const [last, alertas, ctl, hist] = await store.pipeline(cmds);
  const ultimo = store.parse(last);
  const edad = ultimo ? Math.round((Date.now() - ultimo.ts) / 100) / 10 : null;
  const st = Object.assign({ mode: 'manual', estop: false, estopBy: null }, store.parse(ctl));
  return H.send(res, 200, {
    ok: true,
    online: edad !== null && edad < 10,
    age: edad,
    last: ultimo,
    history: n ? hist.map(store.parse).filter(Boolean).reverse() : undefined,
    alerts: alertas.map(store.parse).filter(Boolean),
    thresholds: S.LIMITES,
    control: { mode: st.mode, estop: st.estop, estopBy: st.estopBy },
    serverTime: Date.now(),
  });
}

module.exports = H.endpoint(async (req, res) => {
  if (req.method === 'POST') {
    if (!H.esRobot(req)) return H.fail(res, 401, 'Clave del robot incorrecta o no configurada (ROBOT_API_KEY)');
    return recibir(req, res);
  }
  if (req.method === 'GET') return leer(req, res);
  return H.fail(res, 405, 'Método no permitido');
});
