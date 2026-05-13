'use strict';

const {
  getDefaultTenantDatabaseUrl,
  getPlatformDatabaseUrl,
  getRedisUrl,
  isDemoOrTest,
  isRedisRequired,
} = require('./infra');

function validateEnv() {
  const required = isDemoOrTest()
    ? []
    : [
        'META_APP_SECRET',
        'ENCRYPTION_KEY',
        'ADMIN_API_KEY',
        'APP_SECRET',
        'JWT_SECRET',
      ];

  const missing = required.filter((key) => !process.env[key]);

  if (!isDemoOrTest() && !getPlatformDatabaseUrl()) {
    missing.push('PLATFORM_DATABASE_URL or DATABASE_URL');
  }

  if (!isDemoOrTest() && !getDefaultTenantDatabaseUrl()) {
    missing.push('TENANT_DATABASE_URL_DEFAULT or DATABASE_URL');
  }

  if (isRedisRequired() && !getRedisUrl()) {
    missing.push('REDIS_URL');
  }

  if (missing.length > 0) {
    throw new Error(
      `[validateEnv] Variables de entorno faltantes: ${missing.join(', ')}\n` +
      'Revisa tu archivo .env (ver .env.example)'
    );
  }
}

module.exports = { validateEnv };
