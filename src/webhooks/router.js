'use strict';

/**
 * webhooks/router.js — Endpoints de Meta WhatsApp Cloud API
 *
 * GET  /webhook/:slug — Verificacion del webhook (handshake con Meta)
 * POST /webhook/:slug — Mensajes entrantes
 */

const express                 = require('express');
const { verifyMetaSignature } = require('./verifier');
const { dispatch }            = require('./dispatcher');
const tenantLoader            = require('../tenants/loader');
const { logger }              = require('../utils/logger');

const router = express.Router({ mergeParams: true });

// GET /webhook/:slug — Verificacion inicial (handshake Meta)
router.get('/:slug', async (req, res) => {
  const { slug }  = req.params;
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe') return res.sendStatus(400);

  const tenant = await tenantLoader.get(slug);
  if (!tenant) {
    logger.warn({ tenantSlug: slug }, '[Webhook] Verificacion fallida — tenant no encontrado');
    return res.sendStatus(404);
  }

  if (token === tenant.verify_token) {
    logger.info({ tenantSlug: slug }, '[Webhook] Verificacion exitosa');
    return res.status(200).send(challenge);
  }

  logger.warn({ tenantSlug: slug }, '[Webhook] Token incorrecto — verificacion rechazada');
  return res.sendStatus(403);
});

// POST /webhook/:slug — Mensajes entrantes
router.post('/:slug', (req, res) => {
  const { slug } = req.params;

  // 1. Verificar firma HMAC ANTES de responder — rechaza requests falsos con 401
  // La verificacion HMAC es CPU-only (< 1ms), no afecta el tiempo de respuesta a Meta
  const appSecret = process.env.META_APP_SECRET;
  if (appSecret && !verifyMetaSignature(req, appSecret)) {
    logger.warn({ tenantSlug: slug }, '[Webhook] Firma HMAC invalida — request rechazado');
    return res.sendStatus(401);
  }

  // 2. Responder 200 INMEDIATO — Meta espera respuesta en < 5 segundos
  res.sendStatus(200);

  // 3. Procesar en background
  setImmediate(() => dispatch(slug, req.body));
});

module.exports = router;
