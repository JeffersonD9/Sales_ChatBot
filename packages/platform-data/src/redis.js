'use strict';

// Cliente Redis singleton — mismo patrón que db.js
const Redis      = require('ioredis');
const { logger } = require('@whatsapp-saas/logger');
const { getRedisConnectionOptions, getRedisUrl } = require('@whatsapp-saas/config/infra.js');

let client = null;

function getRedis() {
  if (client) return client;
  if (process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'test') return null;

  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;

  client = new Redis(redisUrl, getRedisConnectionOptions());

  client.on('connect', () => logger.info('[Redis] Conectado'));
  client.on('error',   (err) => logger.error({ err: err.message }, '[Redis] Error'));
  client.on('close',   () => logger.warn('[Redis] Conexión cerrada'));

  return client;
}

async function redisHealthCheck() {
  try {
    const redis = getRedis();
    if (!redis) return false;
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

async function closeRedis() {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
  }
}

module.exports = { getRedis, redisHealthCheck, closeRedis };
