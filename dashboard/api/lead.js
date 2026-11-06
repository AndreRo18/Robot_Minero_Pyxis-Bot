'use strict';
/**
 * Formulario "Solicitar demo" de la landing.
 * POST /api/lead {name, email, company, sector, message, website}   (público; "website" es una trampa para bots)
 * GET  /api/lead                                                    (administrador) últimas solicitudes
 */
const H = require('../lib/http');
const A = require('../lib/auth');
const store = require('../lib/store');

const SECTORES = ['mineria', 'tuneles', 'petroleo-gas', 'industria', 'rescate', 'agroindustria', 'otro'];

module.exports = H.endpoint(async (req, res) => {
  if (req.method === 'GET') {
    const u = await A.exigir(req, res, { admin: true });
    if (!u) return;
    const leads = (await store.cmd('LRANGE', 'leads', 0, 99)).map(store.parse).filter(Boolean);
    return H.send(res, 200, { ok: true, leads });
  }
  if (req.method !== 'POST') return H.fail(res, 405, 'Método no permitido');
  if (!H.solicitudSegura(req)) return H.fail(res, 403, 'Solicitud no permitida');

  const b = await H.readBody(req);
  if (b.website) return H.send(res, 200, { ok: true });          // un bot llenó el campo oculto: se finge éxito

  const name = A.limpiar(b.name, 60);
  const email = A.normalizarEmail(b.email);
  const company = A.limpiar(b.company, 80);
  const message = A.limpiar(b.message, 1000);
  const sector = SECTORES.includes(b.sector) ? b.sector : 'otro';
  if (name.length < 2) return H.fail(res, 400, 'Escribe tu nombre');
  if (!A.emailValido(email)) return H.fail(res, 400, 'Escribe un correo válido');
  if (b.consent !== true) return H.fail(res, 400, 'Debes autorizar el tratamiento de tus datos para poder contactarte');

  const lim = await A.contar('rl:lead:' + H.ip(req), 5, 3600);
  if (!lim.ok) return H.fail(res, 429, 'Ya recibimos varias solicitudes desde tu red. Inténtalo más tarde', { retryAfter: lim.retryAfter });

  await store.pipeline([
    ['LPUSH', 'leads', JSON.stringify({ t: Date.now(), name, email, company, sector, message })],
    ['LTRIM', 'leads', 0, 499],
  ]);
  return H.send(res, 201, { ok: true });
});
