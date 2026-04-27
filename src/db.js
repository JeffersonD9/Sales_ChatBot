/**
 * db.js — Pool de conexiones PostgreSQL
 *
 * Singleton compartido por toda la app. En modo demo/test no conecta.
 */

const { Pool } = require('pg');
const { logger } = require('./utils/logger');

let pool = null;

function getPool() {
  if (pool) return pool;

  if (process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'test') {
    return null; // sin DB en demo/test
  }

  pool = new Pool({
    connectionString:        process.env.DATABASE_URL,
    max:                     20,
    idleTimeoutMillis:       30000,
    connectionTimeoutMillis: 2000,
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

module.exports = { query, healthCheck, getPool, closePool };
