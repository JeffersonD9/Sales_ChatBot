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
  const invalid = [];

  function looksLikePlaceholder(value) {
    return /change_password|your_|replace_with|sk-your-|sk-ant-your|<.+>/i.test(String(value || ''));
  }

  function requireRealSecret(key, { min = 32, hexLength = null } = {}) {
    const value = process.env[key];
    if (!value) return;
    if (looksLikePlaceholder(value)) {
      invalid.push(`${key} no puede usar un valor de ejemplo`);
      return;
    }
    if (hexLength && !new RegExp(`^[a-f0-9]{${hexLength}}$`, 'i').test(value)) {
      invalid.push(`${key} debe ser hex de ${hexLength} caracteres`);
      return;
    }
    if (value.length < min) {
      invalid.push(`${key} debe tener al menos ${min} caracteres`);
    }
  }

  if (!isDemoOrTest() && process.env.NODE_ENV === 'production' && !process.env.PLATFORM_DATABASE_URL) {
    missing.push('PLATFORM_DATABASE_URL');
  } else if (!isDemoOrTest() && !getPlatformDatabaseUrl()) {
    missing.push('PLATFORM_DATABASE_URL or DATABASE_URL');
  }

  if (!isDemoOrTest() && process.env.NODE_ENV === 'production' && !process.env.TENANT_DATABASE_URL_DEFAULT) {
    missing.push('TENANT_DATABASE_URL_DEFAULT');
  } else if (!isDemoOrTest() && !getDefaultTenantDatabaseUrl()) {
    missing.push('TENANT_DATABASE_URL_DEFAULT or DATABASE_URL');
  }

  if (isRedisRequired() && !getRedisUrl()) {
    missing.push('REDIS_URL');
  }

  const aiEnabled = process.env.AI_ENABLED === 'true';
  const aiProvider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  if (!isDemoOrTest() && aiEnabled) {
    if (aiProvider === 'gemini' && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
      missing.push('GEMINI_API_KEY');
    } else if (aiProvider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
      missing.push('ANTHROPIC_API_KEY');
    } else if (!['gemini', 'anthropic'].includes(aiProvider)) {
      missing.push('AI_PROVIDER=gemini|anthropic');
    }
  }

  if (!isDemoOrTest() && process.env.NODE_ENV === 'production') {
    requireRealSecret('DB_PASSWORD', { min: 24 });
    requireRealSecret('REDIS_PASSWORD', { min: 24 });
    requireRealSecret('META_APP_SECRET', { min: 16 });
    requireRealSecret('ENCRYPTION_KEY', { hexLength: 64 });
    requireRealSecret('APP_SECRET', { min: 32 });
    requireRealSecret('ADMIN_API_KEY', { min: 32 });
    requireRealSecret('JWT_SECRET', { min: 32 });

    if (aiProvider === 'gemini') {
      requireRealSecret('GEMINI_API_KEY', { min: 16 });
    } else if (aiProvider === 'anthropic') {
      requireRealSecret('ANTHROPIC_API_KEY', { min: 16 });
    }
  }

  if (missing.length > 0 || invalid.length > 0) {
    throw new Error(
      `[validateEnv] Variables de entorno faltantes o invalidas: ${[...missing, ...invalid].join(', ')}\n` +
      'Revisa tu archivo .env (ver .env.example)'
    );
  }
}

module.exports = { validateEnv };
