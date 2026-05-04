/**
 * admin/middleware.js — Autenticación por API key para el panel de administración
 *
 * Simple y suficiente: una key estática, solo para uso propio.
 * Sin JWT hasta que haya un dashboard multi-usuario.
 */

const { timingSafeEqual } = require('crypto');
const { logger }          = require('../utils/logger');

// Rate limit: máx 20 intentos por IP por ventana de 1 minuto
const attempts = new Map();

function requireApiKey(req, res, next) {
  const ip     = req.ip || 'unknown';
  const window = Math.floor(Date.now() / 60_000);
  const rKey   = `${ip}:${window}`;

  attempts.set(rKey, (attempts.get(rKey) || 0) + 1);

  // Limpiar ventanas anteriores
  for (const k of attempts.keys()) {
    if (!k.endsWith(`:${window}`)) attempts.delete(k);
  }

  if (attempts.get(rKey) > 20) {
    logger.warn({ ip, path: req.path }, '[Admin] Rate limit excedido');
    return res.status(429).json({ error: 'Demasiados intentos. Espera 1 minuto.' });
  }

  const key      = req.headers['x-api-key'];
  const expected = process.env.ADMIN_API_KEY || '';

  let valid = false;
  try {
    const keyBuf      = Buffer.from(key || '');
    const expectedBuf = Buffer.from(expected);
    valid = keyBuf.length === expectedBuf.length && timingSafeEqual(keyBuf, expectedBuf);
  } catch {
    valid = false;
  }

  if (!valid) {
    logger.warn({ ip, path: req.path }, '[Admin] Intento de acceso no autorizado');
    return res.status(401).json({ error: 'API key inválida o ausente' });
  }

  next();
}

module.exports = { requireApiKey };
