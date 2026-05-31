import express from 'express';
import healthRouter from './routes/healthRouter.js';
import metricsRouter from '@whatsapp-saas/http-runtime/metrics.js';
import adminTenantsRouter from './routes/adminTenantsRouter.js';
import adminBillingRouter from './routes/adminBillingRouter.js';
import adminFlowDemoRouter from './routes/adminFlowDemoRouter.js';
import adminMediaRouter from './routes/adminMediaRouter.js';
import whatsappConfigRouter from './routes/whatsappConfigRouter.js';
import { requireAdminKey } from './middleware/adminAuth.js';
import { tenantApiCors } from '@whatsapp-saas/http-runtime/cors.js';
import { securityHeaders } from '@whatsapp-saas/http-runtime/security.js';
import platformData from '../../packages/platform-data/index.js';
import loggerModule from '@whatsapp-saas/logger';

const { isDbConnectionError } = platformData.db;
const { logger } = loggerModule;

const app = express();

app.disable('x-powered-by');
app.use(express.json());

// ── Public ────────────────────────────────────────────────────────────────────
app.use('/health', healthRouter);
app.use('/metrics', metricsRouter);

// ── Tenant API (JWT-authenticated, CORS) ─────────────────────────────────────
app.use('/api/whatsapp', tenantApiCors(), whatsappConfigRouter);

// ── Admin API (internal API key only) ────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(securityHeaders());
adminRouter.use(requireAdminKey);
adminRouter.use('/tenants', adminTenantsRouter);
adminRouter.use('/tenants', adminFlowDemoRouter);
adminRouter.use('/billing', adminBillingRouter);
adminRouter.use('/media', adminMediaRouter);
app.use('/api/admin', adminRouter);

// ── Fallback & error handlers ─────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, _req, res, _next) => {
  if (isDbConnectionError(err)) {
    logger.warn({ err: err.message }, '[API] Base de datos no disponible');
    return res.status(503).json({ error: 'Base de datos no disponible temporalmente' });
  }
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  logger.error({ err: err.message }, '[API] Error no manejado');
  return res.status(500).json({ error: 'Error interno del servidor' });
});

export default app;
