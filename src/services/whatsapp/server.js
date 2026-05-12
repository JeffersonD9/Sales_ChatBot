import dotenv from 'dotenv';
import app from './app.js';
import envModule from '../../utils/validateEnv.js';
import loggerModule from '../../utils/logger.js';
import dbModule from '../../db.js';
import redisModule from '../../redis.js';
import tenantConnectionModule from '../../platform/database/connectionManager.js';

dotenv.config();

const { validateEnv } = envModule;
const { logger } = loggerModule;
const { closePool } = dbModule;
const { closeRedis } = redisModule;
const { closeTenantPools } = tenantConnectionModule;

const PORT = process.env.WHATSAPP_PORT || process.env.PORT || 3001;
let server;

export function startServer() {
  validateEnv();

  server = app.listen(PORT, () => {
    logger.info({
      service: 'whatsapp',
      port: PORT,
      health_url: `http://localhost:${PORT}/health`,
      webhook_url: `http://localhost:${PORT}/webhook/{slug}`,
    }, '[WhatsApp] Servicio iniciado');
  });

  return server;
}

export function shutdown(signal) {
  logger.info({ signal, service: 'whatsapp' }, '[WhatsApp] Apagando servicio...');
  if (!server) {
    process.exit(0);
  }

  server.close(async () => {
    const { closeBullMQ } = await import('../../queues/bullmqQueue.js');
    await Promise.allSettled([closeBullMQ(), closeTenantPools(), closePool(), closeRedis()]);
    logger.info({ service: 'whatsapp' }, '[WhatsApp] Conexiones cerradas');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  startServer();
}

export default app;
