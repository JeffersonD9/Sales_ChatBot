'use strict';

/**
 * app.js - Express composition root.
 */

const express = require('express');
const { rawBodyCapture } = require('./webhooks/verifier');
const webhookRouter = require('./webhooks/router');
const configRouter = require('./tenants/configRouter');
const demoRouter = require('./demo/router');
const metricsRouter = require('./metrics');
const { isDbConnectionError } = require('./db');
const { getServiceHealth } = require('./observability/health');
const { logger } = require('./utils/logger');
const { tenantApiCors } = require('./middleware/cors');
const { securityHeaders } = require('./middleware/security');

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
app.use('/api/whatsapp', tenantApiCors(), configRouter);
app.use('/demo', demoRouter);
app.use('/metrics', metricsRouter);

app.get('/health', securityHeaders(), async (_req, res) => {
  const { cachedSlugs } = require('./platform/tenancy/loader');
  const health = await getServiceHealth('app', {
    cached_tenants: cachedSlugs().length,
  });
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, _next) => {
  if (isDbConnectionError(err)) {
    logger.warn({ err: err.message, path: req.path }, '[App] Base de datos no disponible');
    return res.status(503).json({ error: 'Base de datos no disponible temporalmente' });
  }
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  logger.error({ err: err.message, path: req.path }, '[App] Error no manejado');
  return res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
