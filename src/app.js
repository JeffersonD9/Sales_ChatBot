/**
 * app.js — Configuración de Express
 *
 * Responsabilidad única: montar middleware y routers.
 * Sin lógica de negocio, sin tareas periódicas (esas van en server.js).
 *
 * ORDEN CRÍTICO de middleware:
 *   1. rawBodyCapture ANTES de express.json() → necesario para HMAC-SHA256
 *   2. express.json() parsea el body
 *   3. Routers
 */

const express              = require('express');
const path                 = require('path');
const { rawBodyCapture }   = require('./webhooks/verifier');
const webhookRouter        = require('./webhooks/router');
const adminRouter          = require('./admin/router');
const configRouter         = require('./tenants/configRouter');
const demoRouter           = require('./demo/router');
const metricsRouter        = require('./metrics');
const panelRouter          = require('./panel/routes');
const { healthCheck, isDbConnectionError } = require('./db');
const { redisHealthCheck } = require('./redis');
const { logger }           = require('./utils/logger');

const app = express();

// ── 1. rawBody capture (ANTES de json parser) ─────────────────────────────
// Captura el body crudo como string para la verificación HMAC de Meta.
// Solo aplica a las rutas de webhook que lo necesitan.
app.use('/webhook', rawBodyCapture);

// ── 2. JSON parser ────────────────────────────────────────────────────────
// Para las rutas de webhook, el body ya fue capturado en rawBody.
// express.json() lo parsea a req.body para comodidad del router.
app.use((req, res, next) => {
  if (req.rawBody !== undefined) {
    // rawBodyCapture ya leyó el stream — parsear manualmente
    try {
      req.body = req.rawBody ? JSON.parse(req.rawBody) : {};
    } catch {
      req.body = {};
    }
    return next();
  }
  return express.json()(req, res, next);
});

// ── 3. Archivos estáticos ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'demo')));
app.use('/admin-ui', express.static(path.join(__dirname, '..', 'public', 'admin')));
// Panel UI: no-store para que el navegador nunca sirva desde caché tras logout
app.use('/panel-ui', express.static(path.join(__dirname, '..', 'public', 'panel'), {
  setHeaders(res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
  },
}));

// ── 4. Routers ────────────────────────────────────────────────────────────
app.use('/webhook',      webhookRouter);
app.use('/admin',        adminRouter);
app.use('/api/whatsapp', configRouter);
app.use('/demo',         demoRouter);
app.use('/metrics',      metricsRouter);
app.use('/panel',        panelRouter);

// ── 5. Health check público ───────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const [dbOk, redisOk] = await Promise.all([healthCheck(), redisHealthCheck()]);
  const { cachedSlugs } = require('./tenants/loader');
  res.json({
    status:          dbOk || process.env.DEMO_MODE === 'true' ? 'ok' : 'degraded',
    demo_mode:       process.env.DEMO_MODE === 'true',
    db:              process.env.DEMO_MODE === 'true' ? 'demo' : (dbOk ? 'connected' : 'error'),
    redis:           process.env.DEMO_MODE === 'true' ? 'demo' : (redisOk ? 'connected' : 'error'),
    cached_tenants:  cachedSlugs().length,
    uptime_seconds:  Math.round(process.uptime()),
    timestamp:       new Date().toISOString(),
  });
});

// ── 6. 404 handler ────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ── 7. Error handler global ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (isDbConnectionError(err)) {
    logger.warn({ err: err.message, path: req.path }, '[App] Base de datos no disponible');
    return res.status(503).json({ error: 'Base de datos no disponible temporalmente' });
  }
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  logger.error({ err: err.message, path: req.path }, '[App] Error no manejado');
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
