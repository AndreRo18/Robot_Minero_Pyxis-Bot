'use strict';
/** GET /api/health: diagnóstico. Nunca muestra valores secretos, solo si están configurados. */
const H = require('../lib/http');
const A = require('../lib/auth');
const store = require('../lib/store');

module.exports = H.endpoint(async (req, res) => {
  let redisOk = null;
  if (store.isRemote) {
    try { redisOk = (await store.cmd('PING')) === 'PONG'; } catch { redisOk = false; }
  }
  H.send(res, 200, {
    ok: true,
    storage: store.isRemote ? 'redis' : 'memory',
    redisOk,
    robotKey: Boolean(process.env.ROBOT_API_KEY),
    authSecret: Boolean(process.env.AUTH_SECRET),
    sessionsReady: A.secretoListo(),
    time: new Date().toISOString(),
  });
});
