'use strict';

const { createHmac, timingSafeEqual } = require('crypto');
const { logger } = require('../utils/logger');

function rawBodyCapture(req, res, next) {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
}

function verifyMetaSignature(req, appSecret) {
  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    logger.warn({ path: req.path }, '[Verifier] Firma HMAC ausente - request rechazado');
    return false;
  }

  if (!req.rawBody) {
    logger.warn({ path: req.path }, '[Verifier] rawBody no disponible - montar rawBodyCapture antes de express.json()');
    return false;
  }

  const expected = 'sha256=' + createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex');

  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

module.exports = { rawBodyCapture, verifyMetaSignature };
