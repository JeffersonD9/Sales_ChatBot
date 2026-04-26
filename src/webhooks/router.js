/**
 * webhooks/router.js — Endpoints de Meta WhatsApp Cloud API
 *
 * GET  /webhook/:slug — Verificación del webhook (handshake con Meta)
 * POST /webhook/:slug — Mensajes entrantes
 *
 * Cambios vs. el original:
 *   - URL con :slug para identificar al tenant
 *   - HMAC-SHA256 verification en el POST
 *   - Responde 200 INMEDIATO, procesa en background (setImmediate)
 *   - Verificación carga el verify_token del tenant específico
 */

const express                 = require('express');
const { verifyMetaSignature } = require('./verifier');
const { dispatch }            = require('./dispatcher');
const tenantLoader            = require('../tenants/loader');
const { logger }              = require('../utils/logger');

const router = express.Router({ mergeParams: true });

// ── GET /webhook/:slug — Verificación inicial (handshake Meta) ────────────
router.get('/:slug', async (req, res) => {
  const { slug }    = req.params;
  const mode        = req.query['hub.mode'];
  const token       = req.query['hub.verify_token'];
  const challenge   = req.query['hub.challenge'];

  if (mode !== 'subscribe') {
    return res.sendStatus(400);
  }

  // Cargar tenant para verificar su verify_token específico
  const tenant = await tenantLoader.get(slug);
  if (!tenant) {
    logger.warn({ tenantSlug: slug }, '[Webhook] Verificación fallida — tenant no encontrado');
    return res.sendStatus(404);
  }

  if (token === tenant.verify_token) {
    logger.info({ tenantSlug: slug }, '[Webhook] Verificación exitosa');
    return res.status(200).send(challenge);
  }

  logger.warn({ tenantSlug: slug }, '[Webhook] Token incorrecto — verificación rechazada');
  res.sendStatus(403);
});

// ── POST /webhook/:slug — Mensajes entrantes ──────────────────────────────
router.post('/:slug', (req, res) => {
  const { slug } = req.params;

  // 1. Responder 200 INMEDIATO — Meta espera respuesta en < 5 segundos
  res.sendStatus(200);

  // 2. Verificar firma HMAC (en producción)
  const appSecret = process.env.META_APP_SECRET;
  if (appSecret && !verifyMetaSignature(req, appSecret)) {
    logger.warn({ tenantSlug: slug }, '[Webhook] Firma HMAC inv\u00e1lida — mensaje descartado');
    return; // ya respondimos 200, solo no procesamos
  }

  // 3. Procesar en background (no bloquea el 200)
  setImmediate(() => dispatch(slug, req.body));
});

module.exports = router;
