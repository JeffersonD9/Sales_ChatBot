/**
 * server.js — Entry point de la aplicación
 *
 * Responsabilidades:
 *   1. Validar variables de entorno
 *   2. Cargar Express app
 *   3. Arrancar tareas periódicas (reactivaciones)
 *   4. Escuchar en el puerto configurado
 *   5. Manejar señales de apagado (SIGTERM/SIGINT)
 */

require('dotenv').config();

const { validateEnv }        = require('./utils/validateEnv');
const { logger }             = require('./utils/logger');

// Validar antes de importar cualquier módulo que use env vars
validateEnv();

const app                    = require('./app');
const { closePool }          = require('./db');
const { closeRedis }         = require('./redis');
const { checkReactivations } = require('./core/flow-engine/engine');
const { getActiveSessions, saveState } = require('./core/state/manager');
const tenantLoader           = require('./tenants/loader');

const PORT = process.env.PORT || 3000;

// ── Tareas periódicas ─────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  // Reactivaciones cada hora — tenant-aware
  setInterval(async () => {
    const slugs = tenantLoader.cachedSlugs();
    for (const slug of slugs) {
      const tenant = await tenantLoader.get(slug);
      if (!tenant) continue;
      const count = await checkReactivations(tenant, getActiveSessions, saveState);
      if (count > 0) {
        logger.info({ tenantSlug: slug, count }, '[Server] Reactivaciones enviadas');
      }
    }
  }, 60 * 60 * 1000);
}

// ── Arranque ──────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  const demo = process.env.DEMO_MODE === 'true';
  logger.info({
    port: PORT,
    mode: demo ? 'DEMO' : 'PRODUCCIÓN',
    demo_url: `http://localhost:${PORT}/demo`,
    health_url: `http://localhost:${PORT}/health`,
    webhook_url: `http://localhost:${PORT}/webhook/{slug}`,
  }, `\uD83E\uDD16 WhatsApp SaaS arrancado`);
});

// ── Apagado graceful ──────────────────────────────────────────────────────
function shutdown(signal) {
  logger.info({ signal }, '[Server] Apagando servidor...');
  server.close(async () => {
    await Promise.allSettled([closePool(), closeRedis()]);
    logger.info('[Server] Conexiones cerradas. Adios!');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Exportar para tests de integración
module.exports = app;
