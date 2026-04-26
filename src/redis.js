'use strict';

// Cliente Redis singleton — mismo patrón que db.js
const Redis      = require('ioredis');
const { logger } = require('./utils/logger');

let client = null;

function getRedis() {
  if (client) return client;
  if (process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'test') return null;

  client = new Redis(process.env.REDIS_URL, {
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    enableOfflineQueue: false,
  });

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

module.exports = { getRedis, redisHealthCheck };
