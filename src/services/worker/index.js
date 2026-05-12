import dotenv from 'dotenv';
import envModule from '../../utils/validateEnv.js';
import loggerModule from '../../utils/logger.js';
import dbModule from '../../db.js';
import redisModule from '../../redis.js';
import tenantConnectionModule from '../../platform/database/connectionManager.js';
import flowEngineModule from '../../core/flow-engine/engine.js';
import billingModule from '../../platform/billing/billingService.js';
import { startScheduler } from './schedules/premiumScheduler.js';
import stateManager from '../../core/state/manager.js';
import tenantLoader from '../../platform/tenancy/loader.js';

dotenv.config();

const { validateEnv } = envModule;
const { logger } = loggerModule;
const { closePool } = dbModule;
const { closeRedis } = redisModule;
const { closeTenantPools } = tenantConnectionModule;
const { checkReactivations } = flowEngineModule;
const { checkBillingCycle } = billingModule;
const { getActiveSessions, saveState } = stateManager;

validateEnv();

const timers = new Set();

function msUntilHour(hour) {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function trackTimer(timer) {
  timers.add(timer);
  return timer;
}

function scheduleBillingCheck() {
  const timer = setTimeout(async function runBillingCheck() {
    try {
      await checkBillingCycle();
    } catch (err) {
      logger.error({ err: err.message, service: 'worker' }, '[Worker] Error en billing check');
    }

    trackTimer(setTimeout(runBillingCheck, 24 * 60 * 60 * 1000));
  }, msUntilHour(8));

  trackTimer(timer);
}

function scheduleReactivations() {
  const timer = setInterval(async () => {
    const slugs = tenantLoader.cachedSlugs();

    for (const slug of slugs) {
      const tenant = await tenantLoader.get(slug);
      if (!tenant) continue;

      const count = await checkReactivations(tenant, getActiveSessions, saveState);
      if (count > 0) {
        logger.info({ tenantSlug: slug, count, service: 'worker' }, '[Worker] Reactivaciones enviadas');
      }
    }
  }, 60 * 60 * 1000);

  trackTimer(timer);
}

async function startWorker() {
  const { registerWhatsAppInboundProcessor } = await import('../../queues/processors/whatsappInboundProcessor.js');
  registerWhatsAppInboundProcessor();
  scheduleBillingCheck();
  startScheduler();
  scheduleReactivations();

  logger.info({ service: 'worker' }, '[Worker] Servicio iniciado');
}

async function shutdown(signal) {
  logger.info({ signal, service: 'worker' }, '[Worker] Apagando servicio...');

  for (const timer of timers) {
    clearTimeout(timer);
    clearInterval(timer);
  }

  const { closeBullMQ } = await import('../../queues/bullmqQueue.js');
  await Promise.allSettled([closeBullMQ(), closeTenantPools(), closePool(), closeRedis()]);
  logger.info({ service: 'worker' }, '[Worker] Conexiones cerradas');
  process.exit(0);
}

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  startWorker().catch((err) => {
    logger.error({ err: err.message, service: 'worker' }, '[Worker] Error iniciando servicio');
    process.exit(1);
  });
}

export { startWorker, shutdown };
