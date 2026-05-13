import express from 'express';
import { getServiceHealth } from '@whatsapp-saas/http-runtime/health.js';
import { securityHeaders } from '@whatsapp-saas/http-runtime/security.js';
import platformData from '../../../packages/platform-data/index.js';

const tenantLoader = platformData.tenantLoader;
const { cachedSlugs } = tenantLoader;

const router = express.Router();

router.get('/', securityHeaders(), async (_req, res) => {
  const health = await getServiceHealth('api', {
    cached_tenants: cachedSlugs().length,
  });
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

export default router;
