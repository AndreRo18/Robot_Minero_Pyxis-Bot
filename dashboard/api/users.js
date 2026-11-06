'use strict';
/**
 * Gestión de usuarios (solo administrador).
 * GET  /api/users                          lista de usuarios y últimos eventos de auditoría
 * POST /api/users {email, role}            cambia el rol (admin | operator | observer | blocked)
 * POST /api/users {email, password}        restablece la contraseña (cierra sus sesiones abiertas)
 */
const A = require('../lib/auth');
const H = require('../lib/http');
const store = require('../lib/store');

module.exports = H.endpoint(async (req, res) => {
  const admin = await A.exigir(req, res, { admin: true });
  if (!admin) return;

  if (req.method === 'GET') {
    const [todos, audit] = await store.pipeline([['HGETALL', 'users'], ['LRANGE', 'audit', 0, 49]]);
    const users = Object.values(store.pares(todos)).map(store.parse).filter(Boolean)
      .map(A.publico).sort((a, b) => a.createdAt - b.createdAt);
    return H.send(res, 200, { ok: true, users, audit: audit.map(store.parse).filter(Boolean) });
  }

  if (req.method !== 'POST') return H.fail(res, 405, 'Método no permitido');
  if (!H.solicitudSegura(req)) return H.fail(res, 403, 'Solicitud no permitida');
  const b = await H.readBody(req);
  const email = A.normalizarEmail(b.email);
  const user = await A.buscarUsuario(email);
  if (!user) return H.fail(res, 404, 'Usuario no encontrado');

  if (b.password !== undefined) {
    const err = A.validarPassword(b.password);
    if (err) return H.fail(res, 400, err);
    user.hash = await A.hashPassword(b.password);
    user.sv = (user.sv || 1) + 1;                 // invalida sus sesiones actuales
    await store.cmd('HSET', 'users', email, JSON.stringify(user));
    await A.auditar(admin.email, 'contraseña restablecida', email);
    return H.send(res, 200, { ok: true });
  }

  if (!A.ROLES.includes(b.role)) return H.fail(res, 400, 'Rol no válido');
  if (user.role === 'admin' && b.role !== 'admin') {
    const todos = Object.values(store.pares(await store.cmd('HGETALL', 'users'))).map(store.parse).filter(Boolean);
    if (todos.filter((u) => u.role === 'admin').length <= 1) {
      return H.fail(res, 409, 'Debe quedar al menos un administrador');
    }
  }
  const antes = user.role;
  user.role = b.role;
  await store.cmd('HSET', 'users', email, JSON.stringify(user));
  await A.auditar(admin.email, 'cambio de rol', `${email}: ${antes} → ${b.role}`);
  return H.send(res, 200, { ok: true, user: A.publico(user) });
});
