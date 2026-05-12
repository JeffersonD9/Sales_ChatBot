import dotenv from 'dotenv';
import envModule from '../../utils/validateEnv.js';
import loggerModule from '../../utils/logger.js';
import redisModule from '../../redis.js';

dotenv.config();

const { validateEnv } = envModule;
const { logger } = loggerModule;
const { closeRedis } = redisModule;

validateEnv();

async function startAIWorker() {
  const { isAIBullMQMode } = await import('../../queues/mode.js');

  if (isAIBullMQMode()) {
    const { registerAIRequestsProcessor } = await import('../../queues/processors/aiRequestsProcessor.js');
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
  const { closeBullMQ } = await import('../../queues/bullmqQueue.js');
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
