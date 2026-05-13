'use strict';

/**
 * Platform database boundary.
 *
 * This DB owns SaaS metadata: tenants, plans, subscriptions, routing and
 * database allocation records. During the transition it delegates to the
 * existing DATABASE_URL pool so the MVP keeps running unchanged.
 */

const { getPool, query, healthCheck, closePool } = require('../../db');
const { getDb } = require('../../drizzle/db');

function getPlatformPool() {
  return getPool();
}

function getPlatformDb() {
  return getDb();
}

async function queryPlatform(text, params) {
  return query(text, params);
}

module.exports = {
  getPlatformPool,
  getPlatformDb,
  queryPlatform,
  platformHealthCheck: healthCheck,
  closePlatformPool: closePool,
};
