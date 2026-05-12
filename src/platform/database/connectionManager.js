'use strict';

/**
 * Tenant database connection manager.
 *
 * A tenant can live in a shared low/medium cluster or in a dedicated database.
 * This manager caches pools by allocation id instead of by tenant id, avoiding
 * an unbounded pool explosion when many small tenants share one cluster.
 */

const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const schema = require('../../drizzle/schema');
const { logger } = require('../../utils/logger');
const { getDefaultTenantDatabaseUrl } = require('../../config/infra');

const DEFAULT_ALLOCATION_ID = 'primary';
const DEFAULT_CLUSTER_ID = 'primary-shared';

const poolCache = new Map();

function _isDisabled() {
  return process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'test';
}

function getDefaultTenantAllocation() {
  return {
    allocationId: DEFAULT_ALLOCATION_ID,
    clusterId: DEFAULT_CLUSTER_ID,
    strategy: 'shared-low',
    databaseUrl: getDefaultTenantDatabaseUrl(),
    poolMax: parseInt(process.env.TENANT_DB_POOL_MAX || '10', 10),
    idleTimeoutMillis: parseInt(process.env.TENANT_DB_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.TENANT_DB_CONNECTION_TIMEOUT_MS || '2000', 10),
  };
}

function normalizeAllocation(allocation) {
  const fallback = getDefaultTenantAllocation();
  const merged = { ...fallback, ...(allocation || {}) };
  merged.allocationId = merged.allocationId || merged.clusterId || fallback.allocationId;
  merged.clusterId = merged.clusterId || merged.allocationId;
  merged.databaseUrl = merged.databaseUrl || fallback.databaseUrl;
  return merged;
}

function _cacheLimit() {
  return parseInt(process.env.TENANT_DB_POOL_CACHE_MAX || '20', 10);
}

async function _evictIfNeeded() {
  const limit = _cacheLimit();
  if (poolCache.size < limit) return;

  let oldestKey = null;
  let oldestUsedAt = Infinity;
  for (const [key, entry] of poolCache.entries()) {
    if (entry.lastUsedAt < oldestUsedAt) {
      oldestKey = key;
      oldestUsedAt = entry.lastUsedAt;
    }
  }

  if (!oldestKey) return;
  const oldest = poolCache.get(oldestKey);
  poolCache.delete(oldestKey);
  await oldest.pool.end().catch((err) => {
    logger.warn({ err: err.message, allocationId: oldestKey }, '[ConnectionManager] Error cerrando pool expulsado');
  });
}

async function getTenantPool(allocation) {
  if (_isDisabled()) return null;

  const normalized = normalizeAllocation(allocation);
  if (!normalized.databaseUrl) {
    throw new Error('Tenant DB allocation sin databaseUrl');
  }

  const key = normalized.allocationId;
  const cached = poolCache.get(key);
  if (cached) {
    cached.lastUsedAt = Date.now();
    return cached.pool;
  }

  await _evictIfNeeded();

  const pool = new Pool({
    connectionString: normalized.databaseUrl,
    max: normalized.poolMax,
    idleTimeoutMillis: normalized.idleTimeoutMillis,
    connectionTimeoutMillis: normalized.connectionTimeoutMillis,
    application_name: `whatsapp-saas:${normalized.clusterId}`,
  });

  pool.on('error', (err) => {
    logger.error(
      { err: err.message, allocationId: key, clusterId: normalized.clusterId },
      '[ConnectionManager] Error inesperado en pool tenant'
    );
  });

  poolCache.set(key, {
    pool,
    allocation: normalized,
    lastUsedAt: Date.now(),
  });

  logger.info(
    { allocationId: key, clusterId: normalized.clusterId, strategy: normalized.strategy },
    '[ConnectionManager] Pool tenant creado'
  );

  return pool;
}

async function getTenantDb(allocation) {
  const pool = await getTenantPool(allocation);
  if (!pool) throw new Error('Tenant DB no disponible en demo/test');
  return drizzle(pool, { schema });
}

async function closeTenantPools() {
  const entries = Array.from(poolCache.entries());
  poolCache.clear();
  await Promise.allSettled(entries.map(([, entry]) => entry.pool.end()));
}

function getPoolStats() {
  return Array.from(poolCache.entries()).map(([allocationId, entry]) => ({
    allocationId,
    clusterId: entry.allocation.clusterId,
    strategy: entry.allocation.strategy,
    totalCount: entry.pool.totalCount,
    idleCount: entry.pool.idleCount,
    waitingCount: entry.pool.waitingCount,
    lastUsedAt: entry.lastUsedAt,
  }));
}

module.exports = {
  getDefaultTenantAllocation,
  normalizeAllocation,
  getTenantPool,
  getTenantDb,
  closeTenantPools,
  getPoolStats,
};
