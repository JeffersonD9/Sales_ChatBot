/**
 * admin/middleware.js — Autenticación y seguridad para /admin/*
 *
 * Protecciones en capas:
 *   1. ipWhitelist         — solo IPs autorizadas (si ADMIN_WHITELIST_IPS está definido)
 *   2. securityHeaders     — headers HTTP (CSP, X-Frame-Options, etc.)
 *   3. requireApiKey       — verifica ADMIN_API_KEY con timing-safe equal
 *                            + backoff progresivo en intentos fallidos
 *
 * El rate limit básico (20 req/min) migró a progressiveBackoff, que escala
 * el bloqueo exponencialmente y persiste en Redis entre reinicios.
 */

const { timingSafeEqual } = require('crypto');
const { logger }          = require('../utils/logger');
const {
  progressiveBackoff,
  securityHeaders,
  ipWhitelist,
} = require('../middleware/security');

// Backoff: 5 intentos → bloqueo 2 min, luego 4, 8, 16... hasta 1 hora máximo
const adminBackoff = progressiveBackoff({
  prefix:       'admin-key',
  maxAttempts:  5,
  blockBaseSec: 120,
  maxBlockSec:  3600,
});

const adminHeaders  = securityHeaders({ csp: securityHeaders.API_CSP });
const adminWhitelist = ipWhitelist('ADMIN_WHITELIST_IPS');

/**
 * Verifica ADMIN_API_KEY. Registra intentos fallidos para backoff exponencial.
 * Llama clearFailures si la key es correcta (resetea el contador).
 */
async function requireApiKey(req, res, next) {
  const ip  = req.ip || req.socket?.remoteAddress || 'unknown';
  const key = req.headers['x-api-key'];
  const expected = process.env.ADMIN_API_KEY || '';

  let valid = false;
  try {
    const keyBuf      = Buffer.from(key || '');
    const expectedBuf = Buffer.from(expected);
    valid = keyBuf.length > 0
      && keyBuf.length === expectedBuf.length
      && timingSafeEqual(keyBuf, expectedBuf);
  } catch {
    valid = false;
  }

  if (!valid) {
    logger.warn({ ip, path: req.path, ua: req.headers['user-agent'] },
      '[Admin] Intento de acceso con API key inválida o ausente');
    // Registrar el fallo ANTES de responder para que el bloqueo aplique al próximo intento
    await adminBackoff.recordFailure(ip);
    return res.status(401).json({ error: 'API key inválida o ausente' });
  }

  // Autenticación exitosa → limpiar historial de fallos
  await adminBackoff.clearFailures(ip);
  next();
}

// Middleware stack exportado para montar en el router con router.use(...)
// Orden: whitelist → headers → backoff check → api key auth
const adminMiddleware = [
  adminWhitelist,
  adminHeaders,
  adminBackoff.middleware(),
  requireApiKey,
];

module.exports = { requireApiKey, adminMiddleware };
