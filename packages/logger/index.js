'use strict';

/**
 * Logger estructurado compartido por todos los servicios del monorepo.
 *
 * CommonJS intencional: hoy lo consumen boundaries ESM y CommonJS durante la
 * migracion progresiva.
 */

const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: process.env.SERVICE_NAME || 'whatsapp-saas',
    version: process.env.npm_package_version || '1.0.0',
  },
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
});

module.exports = { logger };
