/**
 * verifier.js — Verificación de firma HMAC-SHA256 de Meta
 *
 * Meta envía X-Hub-Signature-256 en cada POST al webhook.
 * Sin esta verificación, cualquiera que conozca la URL puede
 * inyectar mensajes falsos al bot.
 *
 * REQUISITO: Express debe capturar el rawBody ANTES de parsear JSON.
 * El middleware rawBodyCapture() debe montarse antes de express.json().
 */

import { createHmac, timingSafeEqual } from 'crypto';
import loggerModule from '../../../utils/logger.js';

const { logger } = loggerModule;

/**
 * Middleware Express que guarda req.rawBody antes de que json() lo consuma.
 * Montar en app.js ANTES de express.json().
 */
export function rawBodyCapture(req, res, next) {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
}

/**
 * Verifica la firma HMAC-SHA256 del webhook de Meta.
 *
 * @param {import('express').Request} req
 * @param {string} appSecret - META_APP_SECRET (secreto global de tu Meta App)
 * @returns {boolean}
 */
export function verifyMetaSignature(req, appSecret) {
  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    logger.warn({ path: req.path }, '[Verifier] Firma HMAC ausente — request rechazado');
    return false;
  }

  if (!req.rawBody) {
    logger.warn({ path: req.path }, '[Verifier] rawBody no disponible — montar rawBodyCapture antes de express.json()');
    return false;
  }

  const expected = 'sha256=' + createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex');

  try {
    // timingSafeEqual previene timing attacks
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    // Buffers de distinto tamaño → firma inválida
    return false;
  }
}
