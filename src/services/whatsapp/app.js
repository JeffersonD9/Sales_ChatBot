import express from 'express';
import { rawBodyCapture } from './webhooks/verifier.js';
import webhookRouter from './webhooks/router.js';
import metricsRouter from '../../metrics.js';
import dbModule from '../../db.js';
import healthModule from '../../observability/health.js';
import loggerModule from '../../utils/logger.js';
import securityModule from '../../middleware/security.js';

const { isDbConnectionError } = dbModule;
const { getServiceHealth } = healthModule;
const { logger } = loggerModule;
const { securityHeaders } = securityModule;

const app = express();

app.disable('x-powered-by');
app.use('/webhook', rawBodyCapture);

app.use((req, res, next) => {
  if (req.rawBody !== undefined) {
    try {
      req.body = req.rawBody ? JSON.parse(req.rawBody) : {};
    } catch {
      req.body = {};
    }
    return next();
  }

  return express.json()(req, res, next);
});

app.use('/webhook', webhookRouter);
app.use('/metrics', metricsRouter);

app.get('/health', securityHeaders(), async (_req, res) => {
  const health = await getServiceHealth('whatsapp');
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, _next) => {
  if (isDbConnectionError(err)) {
    logger.warn({ err: err.message, path: req.path }, '[WhatsApp] Base de datos no disponible');
    return res.status(503).json({ error: 'Base de datos no disponible temporalmente' });
  }

  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }

  logger.error({ err: err.message, path: req.path }, '[WhatsApp] Error no manejado');
  return res.status(500).json({ error: 'Error interno del servidor' });
});

export default app;
