/**
 * logger.js — Logger estructurado con Pino
 *
 * En desarrollo: salida human-readable (pino-pretty).
 * En producción: JSON estructurado, filtrable por tenantSlug y waFrom.
 *
 * Uso:
 *   const { logger } = require('./logger');
 *   logger.info({ tenantSlug, waFrom, step }, 'Flow step executed');
 *   logger.error({ tenantSlug, err: err.message }, 'Send failed');
 */

const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: 'whatsapp-saas',
    version: process.env.npm_package_version || '1.0.0',
  },
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
});

module.exports = { logger };
