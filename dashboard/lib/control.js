'use strict';
/**
 * Estado de control del robot compartido entre el dashboard y la pasarela (Jetson).
 *
 *  ctl      {mode, modeSeq, estop, estopSeq, estopBy, arm, armSeq, grip, gripSeq}   estado persistente
 *  ctl:cmd  {lin, ang, ts, by}      última orden de conducción (caduca a los 3 s; la pasarela la ignora tras 2 s)
 *  ctl:hb   marca de tiempo del último latido de un operador con el panel abierto (señal de la estación base)
 *
 * Los contadores (modeSeq, estopSeq...) permiten a la pasarela detectar "esto cambió" sin repetir órdenes.
 */
const store = require('./store');

const VIDA_CMD_MS = 2000;
const MAX_LIN = 0.6;    // m/s
const MAX_ANG = 1.2;    // rad/s

const inicial = () => ({ mode: 'manual', modeSeq: 0, estop: false, estopSeq: 0, estopBy: null, arm: null, armSeq: 0, grip: null, gripSeq: 0 });

async function leer() {
  return Object.assign(inicial(), await store.getJSON('ctl'));
}
const guardar = (s) => store.setJSON('ctl', s);

const acotar = (v, min, max) => Math.max(min, Math.min(max, v));

/** Convierte una dirección simple (F, B, L, R, S) en velocidades lineal y angular. */
function dirAVelocidad(dir, velocidad) {
  const v = acotar(Number(velocidad) || 0.3, 0.05, MAX_LIN);
  switch (String(dir).toUpperCase()) {
    case 'F': return { lin: v, ang: 0 };
    case 'B': return { lin: -v, ang: 0 };
    case 'L': return { lin: 0, ang: acotar(v * 2, 0, MAX_ANG) };
    case 'R': return { lin: 0, ang: -acotar(v * 2, 0, MAX_ANG) };
    case 'S': return { lin: 0, ang: 0 };
    default: return null;
  }
}

/** Vista para la pasarela del robot: todo lo que debe aplicar, en un solo viaje. */
async function paraRobot() {
  const [s, c, hb] = await store.pipeline([['GET', 'ctl'], ['GET', 'ctl:cmd'], ['GET', 'ctl:hb']]);
  const st = Object.assign(inicial(), store.parse(s));
  const cmd = store.parse(c);
  const ahora = Date.now();
  const edad = cmd ? ahora - cmd.ts : null;
  const t = hb ? Number(hb) : null;
  return {
    serverTime: ahora,
    mode: st.mode, modeSeq: st.modeSeq,
    estop: st.estop, estopSeq: st.estopSeq,
    arm: { v: st.arm, seq: st.armSeq },
    grip: { v: st.grip, seq: st.gripSeq },
    cmd: cmd && edad < VIDA_CMD_MS && !st.estop && st.mode === 'manual' ? { lin: cmd.lin, ang: cmd.ang, age_ms: edad } : null,
    hbAge: t ? Math.round((ahora - t) / 100) / 10 : null,
  };
}

module.exports = { leer, guardar, acotar, dirAVelocidad, paraRobot, MAX_LIN, MAX_ANG, VIDA_CMD_MS };
