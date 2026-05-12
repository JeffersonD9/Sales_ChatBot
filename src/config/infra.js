'use strict';

function isDemoOrTest() {
  return process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'test';
}

function getPlatformDatabaseUrl() {
  return process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL;
}

function getDefaultTenantDatabaseUrl() {
  return process.env.TENANT_DATABASE_URL_DEFAULT || process.env.DATABASE_URL;
}

function isBullMQEnabled() {
  return process.env.QUEUE_MODE === 'bullmq' || process.env.AI_QUEUE_MODE === 'bullmq';
}

function isRedisRequired() {
  if (isDemoOrTest()) return false;
  if (process.env.REDIS_REQUIRED === 'false') return false;
  return process.env.REDIS_REQUIRED === 'true'
    || process.env.NODE_ENV === 'production'
    || isBullMQEnabled();
}

function getRedisUrl() {
  return process.env.REDIS_URL;
}

function getRedisConnectionOptions() {
  const options = {
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    enableOfflineQueue: false,
  };

  if (process.env.REDIS_PASSWORD) {
    options.password = process.env.REDIS_PASSWORD;
  }

  if (process.env.REDIS_TLS === 'true' || (process.env.REDIS_URL || '').startsWith('rediss://')) {
    options.tls = {};
  }

  return options;
}

module.exports = {
  getDefaultTenantDatabaseUrl,
  getPlatformDatabaseUrl,
  getRedisConnectionOptions,
  getRedisUrl,
  isBullMQEnabled,
  isDemoOrTest,
  isRedisRequired,
};
