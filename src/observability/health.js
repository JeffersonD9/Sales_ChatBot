'use strict';

const { platformHealthCheck } = require('../platform/database/platformDb');
const { getDefaultTenantAllocation } = require('../platform/database/connectionManager');
const { redisHealthCheck } = require('../redis');
const { isDemoOrTest, isRedisRequired } = require('../config/infra');

async function optionalTenantDbHealthCheck() {
  const allocation = getDefaultTenantAllocation();
  const configured = Boolean(allocation.databaseUrl);

  return {
    configured,
    allocation_id: allocation.allocationId,
    cluster_id: allocation.clusterId,
    strategy: allocation.strategy,
  };
}

async function getServiceHealth(service, extras = {}) {
  const demo = isDemoOrTest();
  const redisRequired = isRedisRequired();
  const [platformDbOk, redisOk, tenantDefault] = await Promise.all([
    platformHealthCheck(),
    redisHealthCheck(),
    optionalTenantDbHealthCheck(),
  ]);

  const platformReady = demo || platformDbOk;
  const redisReady = demo || !redisRequired || redisOk;
  const tenantReady = demo || tenantDefault.configured;
  const ready = platformReady && redisReady && tenantReady;

  return {
    service,
    status: ready ? 'ok' : 'degraded',
    demo_mode: process.env.DEMO_MODE === 'true',
    platform_db: demo ? 'demo' : (platformDbOk ? 'connected' : 'error'),
    tenant_default_db: demo ? 'demo' : (tenantDefault.configured ? 'configured' : 'missing'),
    tenant_default_allocation: tenantDefault,
    redis: demo ? 'demo' : (redisOk ? 'connected' : (redisRequired ? 'error' : 'not_required')),
    redis_required: redisRequired,
    queue_mode: process.env.QUEUE_MODE || 'direct',
    ai_queue_mode: process.env.AI_QUEUE_MODE || 'direct',
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

module.exports = { getServiceHealth };
