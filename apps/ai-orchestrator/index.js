import dotenv from 'dotenv';
import envModule from '@whatsapp-saas/config/validateEnv.js';
import loggerModule from '@whatsapp-saas/logger';
import platformData from '../../packages/platform-data/index.js';

dotenv.config();

const { validateEnv } = envModule;
const { logger } = loggerModule;
const { closeRedis } = platformData.redis;

validateEnv();

async function startAIWorker() {
  const { isAIBullMQMode } = await import('@whatsapp-saas/queues/mode.js');

  if (isAIBullMQMode()) {
    const { registerAIRequestsProcessor } = await import('./processors/aiRequestsProcessor.js');
    registerAIRequestsProcessor();
  }
}

let heartbeat = null;

function startHeartbeat() {
  heartbeat = setInterval(() => {
    logger.debug({ service: 'ai-worker' }, '[AI Worker] Esperando cola ai.requests');
  }, 60 * 1000);

  logger.info({
    service: 'ai-worker',
    queue: 'ai.requests',
    mode: process.env.AI_QUEUE_MODE || 'direct',
  }, '[AI Worker] Boundary iniciado');
}

async function shutdown(signal) {
  logger.info({ signal, service: 'ai-worker' }, '[AI Worker] Apagando servicio...');
  if (heartbeat) clearInterval(heartbeat);
  const { closeBullMQ } = await import('@whatsapp-saas/queues/bullmqQueue.js');
  await Promise.allSettled([closeBullMQ(), closeRedis()]);
  logger.info({ service: 'ai-worker' }, '[AI Worker] Conexiones cerradas');
  process.exit(0);
}

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  startHeartbeat();
  startAIWorker().catch((err) => {
    logger.error({ err: err.message, service: 'ai-worker' }, '[AI Worker] Error iniciando servicio');
    process.exit(1);
  });
}

export { startAIWorker, shutdown };
