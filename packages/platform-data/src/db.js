/**
 * db.js — Pool de conexiones PostgreSQL
 *
 * Singleton compartido por toda la app. En modo demo/test no conecta.
 */

const { Pool } = require('pg');
const { logger } = require('@whatsapp-saas/logger');
const { getPlatformDatabaseUrl } = require('@whatsapp-saas/config/infra.js');

let pool = null;

function getPool() {
  if (pool) return pool;

  if (process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'test') {
    return null; // sin DB en demo/test
  }

  const connectionString = getPlatformDatabaseUrl();
  if (!connectionString) {
    throw new Error('Platform DB URL no configurada');
  }

  pool = new Pool({
    connectionString,
    max:                     parseInt(process.env.PLATFORM_DB_POOL_MAX || '20', 10),
    idleTimeoutMillis:       parseInt(process.env.PLATFORM_DB_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.PLATFORM_DB_CONNECTION_TIMEOUT_MS || '2000', 10),
    application_name:        process.env.PLATFORM_DB_APPLICATION_NAME || 'whatsapp-saas:platform',
  });

  pool.on('error', (err) => {
    logger.error({ err: err.message }, '[DB] Error inesperado en el pool');
  });

  return pool;
}

/**
 * Ejecuta una query SQL con parámetros.
 * @param {string} text  - Query SQL con $1, $2, ...
 * @param {any[]}  params
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const db = getPool();
  if (!db) throw new Error('DB no disponible en modo demo/test');
  return db.query(text, params);
}

/**
 * Verifica conectividad. Retorna true si la DB responde, false si no.
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  try {
    const db = getPool();
    if (!db) return false;
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Detecta errores de conectividad con la base de datos (no bugs de código).
 * Usado para devolver 503 en lugar de 500 cuando el pool está caído.
 */
function isDbConnectionError(err) {
  if (!err) return false;
  const connCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND',
                     '08006', '08001', '08004', '57P03', 'ECONNRESET'];
  return connCodes.includes(err.code)
    || /connect ECONNREFUSED|connection timeout|Connection terminated/i.test(err.message);
}

module.exports = { query, healthCheck, getPool, closePool, isDbConnectionError };
