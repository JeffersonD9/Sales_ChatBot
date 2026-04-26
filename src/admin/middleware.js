/**
 * admin/middleware.js — Autenticación por API key para el panel de administración
 *
 * Simple y suficiente: una key estática, solo para uso propio.
 * Sin JWT hasta que haya un dashboard multi-usuario.
 */

const { logger } = require('../utils/logger');

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];

  if (!key || key !== process.env.ADMIN_API_KEY) {
    logger.warn({ ip: req.ip, path: req.path }, '[Admin] Intento de acceso no autorizado');
    return res.status(401).json({ error: 'API key inv\u00e1lida o ausente' });
  }
  next();
}

module.exports = { requireApiKey };
