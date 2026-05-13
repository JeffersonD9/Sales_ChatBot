import platformData from '@whatsapp-saas/platform-data';
import infraModule from '@whatsapp-saas/config/infra.js';

const { platformHealthCheck } = platformData.platformDb;
const { getDefaultTenantAllocation } = platformData.connectionManager;
const { redisHealthCheck } = platformData.redis;
const { isDemoOrTest, isRedisRequired } = infraModule;

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

export async function getServiceHealth(service, extras = {}) {
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
