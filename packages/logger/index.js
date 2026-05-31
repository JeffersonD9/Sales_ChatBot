'use strict';

/**
 * Logger estructurado compartido por todos los servicios del monorepo.
 *
 * CommonJS intencional: hoy lo consumen boundaries ESM y CommonJS durante la
 * migracion progresiva.
 */

const pino = require('pino');

// Redact por defensa: incluso si alguien hace logger.info({ tenant }) con un
// objeto completo, estos paths se enmascaran como "[Redacted]". Cubrir secretos
// que NO deben aparecer en logs: tokens Meta, verify_token, passwords, JWTs,
// claves de cifrado y headers de auth.
const REDACT_PATHS = [
  '*.wa_token',
  '*.wa_token_encrypted',
  '*.verify_token',
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.refresh_token',
  '*.access_token',
  '*.api_key',
  '*.apiKey',
  '*.encryption_key',
  '*.ENCRYPTION_KEY',
  '*.authorization',
  '*.Authorization',
  '*.cookie',
  '*.Cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
];

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: process.env.SERVICE_NAME || 'whatsapp-saas',
    version: process.env.npm_package_version || '1.0.0',
  },
  redact: {
    paths: REDACT_PATHS,
    censor: '[Redacted]',
    remove: false,
  },
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
});

module.exports = { logger };
