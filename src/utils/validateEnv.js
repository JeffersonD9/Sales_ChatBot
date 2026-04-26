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
        'APP_SECRET',    // llave pgcrypto (min 32 chars)
        'REDIS_URL',     // ej. redis://localhost:6379
        'JWT_SECRET',    // para verificar tokens de tenant
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
