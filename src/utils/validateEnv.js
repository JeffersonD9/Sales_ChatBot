/**
 * validateEnv.js — Validación de variables de entorno al arranque
 *
 * Lanza un error con mensaje claro si falta alguna variable crítica.
 * Llamar antes de iniciar cualquier servidor o conexión.
 */

function validateEnv() {
  // En modo demo y en tests, la DB y secretos no son necesarios
  const isDemoOrTest = process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'test';

  const required = isDemoOrTest
    ? [] // demo/test: sin requisitos de infra
    : [
        'DATABASE_URL',
        'META_APP_SECRET',
        'ENCRYPTION_KEY',
        'ADMIN_API_KEY',
        // Módulo whatsapp-saas
        'APP_SECRET',           // llave pgcrypto (min 32 chars)
        'REDIS_URL',            // ej. redis://:password@redis:6379
        'REDIS_PASSWORD',       // password para Redis (min 16 chars)
        'JWT_SECRET',           // firma tokens de tenant /api/whatsapp/*
        // Panel de administración
        'PANEL_JWT_SECRET',     // firma access tokens del panel (min 64 chars)
        'PANEL_REFRESH_SECRET', // HMAC refresh tokens del panel (min 64 chars)
      ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `[validateEnv] Variables de entorno faltantes: ${missing.join(', ')}\n` +
      `Revisa tu archivo .env (ver .env.example)`
    );
  }
}

module.exports = { validateEnv };
