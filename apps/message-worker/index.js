import dotenv from 'dotenv';
import envModule from '@whatsapp-saas/config/validateEnv.js';
import loggerModule from '@whatsapp-saas/logger';
import platformData from '../../packages/platform-data/index.js';
import { createRequire } from 'module';
import { startScheduler } from './schedules/premiumScheduler.js';
import stateManager from './core/state/manager.js';

dotenv.config();

const require = createRequire(import.meta.url);
const { checkReactivations } = require('./core/reactivations.js');

const { validateEnv } = envModule;
const { logger } = loggerModule;
const { closePool } = platformData.db;
const { closeRedis } = platformData.redis;
const { closeTenantPools } = platformData.connectionManager;
const { checkBillingCycle } = platformData.billingService;
const { getActiveSessions, saveState } = stateManager;
const tenantLoader = platformData.tenantLoader;

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
  const { registerWhatsAppInboundProcessor } = await import('./processors/whatsappInboundProcessor.js');
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

  const { closeBullMQ } = await import('@whatsapp-saas/queues/bullmqQueue.js');
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
