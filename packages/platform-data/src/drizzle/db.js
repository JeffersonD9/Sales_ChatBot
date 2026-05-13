'use strict';

const { drizzle } = require('drizzle-orm/node-postgres');
const { getPool } = require('../db');
const schema      = require('./platformSchema');

let _db = null;

function getDb() {
  if (_db) return _db;
  const pool = getPool();
  if (!pool) throw new Error('DB no disponible — verifica DEMO_MODE y DATABASE_URL');
  _db = drizzle(pool, { schema });
  return _db;
}

module.exports = { getDb };
