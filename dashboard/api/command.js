'use strict';
/**
 * Órdenes al robot.
 *
 * POST /api/command   (sesión; operador/administrador salvo "hb" y "estop", que puede enviar cualquier usuario)
 *   {type:'hb'}                              latido: "hay un operador con el panel abierto"
 *   {type:'drive', lin, ang}                 conducción continua (m/s, rad/s). Caduca a los 2 s
 *   {type:'move', dir:'F|B|L|R|S', speed}    atajo por dirección
 *   {type:'mode', value:'manual|auto'}
 *   {type:'estop'}                           parada de emergencia (queda activa hasta 'reset')
 *   {type:'reset'}                           libera la parada de emergencia
 *   {type:'arm', v:[base, hombro, codo, muñeca]}  grados, -90..90 (acepta 3 sin muñeca)
 *   {type:'grip', v:0..100}                  0 cerrada, 100 abierta
 *
 * GET /api/command    (robot, X-Api-Key)  lo que la pasarela debe aplicar (ver lib/control.js)
 * GET /api/command    (sesión)            estado de control para el panel
 */
const H = require('../lib/http');
const A = require('../lib/auth');
const C = require('../lib/control');
const store = require('../lib/store');

async function ordenar(req, res) {
  if (!H.solicitudSegura(req)) return H.fail(res, 403, 'Solicitud no permitida');
  const user = await A.exigir(req, res);
  if (!user) return;
  const b = await H.readBody(req);
  const tipo = String(b.type || '');

  if (tipo === 'hb') {
    await store.cmd('SET', 'ctl:hb', String(Date.now()), 'EX', 30);
    return H.send(res, 200, { ok: true });
  }

  const st = await C.leer();

  if (tipo === 'estop') {      // detener siempre es seguro: lo puede pedir cualquier usuario con sesión
    st.estop = true; st.estopSeq++; st.estopBy = user.name;
    st.mode = 'manual'; st.modeSeq++;
    await Promise.all([C.guardar(st), store.cmd('DEL', 'ctl:cmd'), A.auditar(user.email, 'parada de emergencia')]);
    return H.send(res, 200, { ok: true, estop: true });
  }

  if (!user.canControl) {
    return H.fail(res, 403, 'Tu rol es observador: solo lectura. Pide al administrador el rol de operador');
  }

  if (tipo === 'reset') {
    if (st.estop) {
      st.estop = false; st.estopSeq++; st.estopBy = null;
      await Promise.all([C.guardar(st), A.auditar(user.email, 'parada de emergencia liberada')]);
    }
    return H.send(res, 200, { ok: true, estop: false });
  }

  if (st.estop) return H.fail(res, 423, 'Parada de emergencia activa. Libérala para volver a controlar el robot');

  switch (tipo) {
    case 'mode': {
      const v = String(b.value || '').toLowerCase();
      if (v !== 'manual' && !v.startsWith('auto')) return H.fail(res, 400, 'Modo no válido');
      const nuevo = v === 'manual' ? 'manual' : 'auto';
      if (nuevo === 'auto') {
        const ult = store.parse(await store.cmd('GET', 'tel:last'));
        if (ult && Date.now() - ult.ts < 15000 && ult.overall === 'danger') {
          return H.fail(res, 409, 'No se puede pasar a automático: hay una alerta de gas o temperatura');
        }
      }
      if (st.mode !== nuevo) {
        st.mode = nuevo; st.modeSeq++;
        await Promise.all([C.guardar(st), store.cmd('DEL', 'ctl:cmd'), A.auditar(user.email, 'cambio de modo', nuevo)]);
      }
      return H.send(res, 200, { ok: true, mode: nuevo });
    }
    case 'drive':
    case 'move': {
      if (st.mode !== 'manual') return H.fail(res, 409, 'El robot está en modo automático. Cambia a manual para conducir');
      let lin, ang;
      if (tipo === 'move') {
        const v = C.dirAVelocidad(b.dir, b.speed);
        if (!v) return H.fail(res, 400, 'Dirección no válida');
        ({ lin, ang } = v);
      } else {
        lin = Number(b.lin); ang = Number(b.ang);
        if (!Number.isFinite(lin) || !Number.isFinite(ang)) return H.fail(res, 400, 'Velocidades no válidas');
        lin = C.acotar(lin, -C.MAX_LIN, C.MAX_LIN); ang = C.acotar(ang, -C.MAX_ANG, C.MAX_ANG);
      }
      await store.cmd('SET', 'ctl:cmd', JSON.stringify({ lin, ang, ts: Date.now(), by: user.name }), 'EX', 3);
      return H.send(res, 200, { ok: true, lin, ang });
    }
    case 'arm': {
      if (st.mode !== 'manual') return H.fail(res, 409, 'El brazo solo se mueve en modo manual');
      if (!Array.isArray(b.v) || b.v.length < 3) return H.fail(res, 400, 'Se esperan 4 ángulos: base, hombro, codo y muñeca');
      const v = b.v.slice(0, 4).map((x) => Math.round(C.acotar(Number(x), -90, 90)));
      if (v.some((x) => !Number.isFinite(x))) return H.fail(res, 400, 'Ángulos no válidos');
      st.arm = v; st.armSeq++;
      await C.guardar(st);
      return H.send(res, 200, { ok: true, arm: v });
    }
    case 'grip': {
      if (st.mode !== 'manual') return H.fail(res, 409, 'La pinza solo se mueve en modo manual');
      const v = Number(b.v);
      if (!Number.isFinite(v)) return H.fail(res, 400, 'Valor no válido');
      st.grip = Math.round(C.acotar(v, 0, 100)); st.gripSeq++;
      await C.guardar(st);
      return H.send(res, 200, { ok: true, grip: st.grip });
    }
    default: return H.fail(res, 400, 'Tipo de orden desconocido');
  }
}

module.exports = H.endpoint(async (req, res) => {
  if (req.method === 'POST') return ordenar(req, res);
  if (req.method !== 'GET') return H.fail(res, 405, 'Método no permitido');
  if (H.esRobot(req)) return H.send(res, 200, Object.assign({ ok: true }, await C.paraRobot()));
  const u = await A.exigir(req, res);
  if (!u) return;
  const st = await C.leer();
  return H.send(res, 200, { ok: true, mode: st.mode, estop: st.estop, estopBy: st.estopBy });
});
'use strict';
/**
 * Órdenes al robot.
 *
 * POST /api/command   (sesión; operador/administrador salvo "hb" y "estop", que puede enviar cualquier usuario)
 *   {type:'hb'}                              latido: "hay un operador con el panel abierto"
 *   {type:'drive', lin, ang}                 conducción continua (m/s, rad/s). Caduca a los 2 s
 *   {type:'move', dir:'F|B|L|R|S', speed}    atajo por dirección
 *   {type:'mode', value:'manual|auto'}
 *   {type:'estop'}                           parada de emergencia (queda activa hasta 'reset')
 *   {type:'reset'}                           libera la parada de emergencia
 *   {type:'arm', v:[base, hombro, codo]}     grados, -90..90
 *   {type:'grip', v:0..100}                  0 cerrada, 100 abierta
 *
 * GET /api/command    (robot, X-Api-Key)  lo que la pasarela debe aplicar (ver lib/control.js)
 * GET /api/command    (sesión)            estado de control para el panel
 */
const H = require('../lib/http');
const A = require('../lib/auth');
const C = require('../lib/control');
const store = require('../lib/store');

async function ordenar(req, res) {
  if (!H.solicitudSegura(req)) return H.fail(res, 403, 'Solicitud no permitida');
  const user = await A.exigir(req, res);
  if (!user) return;
  const b = await H.readBody(req);
  const tipo = String(b.type || '');

  if (tipo === 'hb') {
    await store.cmd('SET', 'ctl:hb', String(Date.now()), 'EX', 30);
    return H.send(res, 200, { ok: true });
  }

  const st = await C.leer();

  if (tipo === 'estop') {      // detener siempre es seguro: lo puede pedir cualquier usuario con sesión
    st.estop = true; st.estopSeq++; st.estopBy = user.name;
    st.mode = 'manual'; st.modeSeq++;
    await Promise.all([C.guardar(st), store.cmd('DEL', 'ctl:cmd'), A.auditar(user.email, 'parada de emergencia')]);
    return H.send(res, 200, { ok: true, estop: true });
  }

  if (!user.canControl) {
    return H.fail(res, 403, 'Tu rol es observador: solo lectura. Pide al administrador el rol de operador');
  }

  if (tipo === 'reset') {
    if (st.estop) {
      st.estop = false; st.estopSeq++; st.estopBy = null;
      await Promise.all([C.guardar(st), A.auditar(user.email, 'parada de emergencia liberada')]);
    }
    return H.send(res, 200, { ok: true, estop: false });
  }

  if (st.estop) return H.fail(res, 423, 'Parada de emergencia activa. Libérala para volver a controlar el robot');

  switch (tipo) {
    case 'mode': {
      const v = String(b.value || '').toLowerCase();
      if (v !== 'manual' && !v.startsWith('auto')) return H.fail(res, 400, 'Modo no válido');
      const nuevo = v === 'manual' ? 'manual' : 'auto';
      if (nuevo === 'auto') {
        const ult = store.parse(await store.cmd('GET', 'tel:last'));
        if (ult && Date.now() - ult.ts < 15000 && ult.overall === 'danger') {
          return H.fail(res, 409, 'No se puede pasar a automático: hay una alerta de gas o temperatura');
        }
      }
      if (st.mode !== nuevo) {
        st.mode = nuevo; st.modeSeq++;
        await Promise.all([C.guardar(st), store.cmd('DEL', 'ctl:cmd'), A.auditar(user.email, 'cambio de modo', nuevo)]);
      }
      return H.send(res, 200, { ok: true, mode: nuevo });
    }
    case 'drive':
    case 'move': {
      if (st.mode !== 'manual') return H.fail(res, 409, 'El robot está en modo automático. Cambia a manual para conducir');
      let lin, ang;
      if (tipo === 'move') {
        const v = C.dirAVelocidad(b.dir, b.speed);
        if (!v) return H.fail(res, 400, 'Dirección no válida');
        ({ lin, ang } = v);
      } else {
        lin = Number(b.lin); ang = Number(b.ang);
        if (!Number.isFinite(lin) || !Number.isFinite(ang)) return H.fail(res, 400, 'Velocidades no válidas');
        lin = C.acotar(lin, -C.MAX_LIN, C.MAX_LIN); ang = C.acotar(ang, -C.MAX_ANG, C.MAX_ANG);
      }
      await store.cmd('SET', 'ctl:cmd', JSON.stringify({ lin, ang, ts: Date.now(), by: user.name }), 'EX', 3);
      return H.send(res, 200, { ok: true, lin, ang });
    }
    case 'arm': {
      if (st.mode !== 'manual') return H.fail(res, 409, 'El brazo solo se mueve en modo manual');
      if (!Array.isArray(b.v) || b.v.length < 3) return H.fail(res, 400, 'Se esperan 3 ángulos');
      const v = b.v.slice(0, 3).map((x) => Math.round(C.acotar(Number(x), -90, 90)));
      if (v.some((x) => !Number.isFinite(x))) return H.fail(res, 400, 'Ángulos no válidos');
      st.arm = v; st.armSeq++;
      await C.guardar(st);
      return H.send(res, 200, { ok: true, arm: v });
    }
    case 'grip': {
      if (st.mode !== 'manual') return H.fail(res, 409, 'La pinza solo se mueve en modo manual');
      const v = Number(b.v);
      if (!Number.isFinite(v)) return H.fail(res, 400, 'Valor no válido');
      st.grip = Math.round(C.acotar(v, 0, 100)); st.gripSeq++;
      await C.guardar(st);
      return H.send(res, 200, { ok: true, grip: st.grip });
    }
    default: return H.fail(res, 400, 'Tipo de orden desconocido');
  }
}

module.exports = H.endpoint(async (req, res) => {
  if (req.method === 'POST') return ordenar(req, res);
  if (req.method !== 'GET') return H.fail(res, 405, 'Método no permitido');
  if (H.esRobot(req)) return H.send(res, 200, Object.assign({ ok: true }, await C.paraRobot()));
  const u = await A.exigir(req, res);
  if (!u) return;
  const st = await C.leer();
  return H.send(res, 200, { ok: true, mode: st.mode, estop: st.estop, estopBy: st.estopBy });
});
