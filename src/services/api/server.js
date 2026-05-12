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

const PORT = process.env.API_PORT || process.env.PORT || 3000;
let server;

export function startServer() {
  validateEnv();

  server = app.listen(PORT, () => {
    logger.info({
      service: 'api',
      port: PORT,
      health_url: `http://localhost:${PORT}/health`,
    }, '[API] Servicio iniciado');
  });

  return server;
}

export function shutdown(signal) {
  logger.info({ signal, service: 'api' }, '[API] Apagando servicio...');
  if (!server) {
    process.exit(0);
  }

  server.close(async () => {
    await Promise.allSettled([closeTenantPools(), closePool(), closeRedis()]);
    logger.info({ service: 'api' }, '[API] Conexiones cerradas');
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
