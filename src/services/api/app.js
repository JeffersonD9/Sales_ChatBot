import express from 'express';
import configRouter from './routes/whatsappConfigRouter.js';
import metricsRouter from '../../observability/metrics.js';
import dbModule from '../../db.js';
import { getServiceHealth } from '../../observability/health.js';
import loggerModule from '../../utils/logger.js';
import { tenantApiCors } from '../../middleware/cors.js';
import { securityHeaders } from '../../middleware/security.js';
import tenantLoader from '../../platform/tenancy/loader.js';

const { isDbConnectionError } = dbModule;
const { logger } = loggerModule;
const { cachedSlugs } = tenantLoader;

const app = express();

app.disable('x-powered-by');
app.use(express.json());

app.use('/api/whatsapp', tenantApiCors(), configRouter);
app.use('/metrics', metricsRouter);

app.get('/health', securityHeaders(), async (_req, res) => {
  const health = await getServiceHealth('api', {
    cached_tenants: cachedSlugs().length,
  });

  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, _next) => {
  if (isDbConnectionError(err)) {
    logger.warn({ err: err.message, path: req.path }, '[API] Base de datos no disponible');
    return res.status(503).json({ error: 'Base de datos no disponible temporalmente' });
  }

  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }

  logger.error({ err: err.message, path: req.path }, '[API] Error no manejado');
  return res.status(500).json({ error: 'Error interno del servidor' });
});

export default app;
