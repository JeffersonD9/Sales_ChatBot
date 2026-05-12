import express from 'express';
import stateManagerModule from '../core/state/manager.js';
import tenantLoader from '../platform/tenancy/loader.js';
import redisModule from '../redis.js';
import loggerModule from '../utils/logger.js';

const { getActiveSessions } = stateManagerModule;
const { cachedSlugs } = tenantLoader;
const { getRedis } = redisModule;
const { logger } = loggerModule;

const router = express.Router();

function requireApiKey(req, res, next) {
  const configured = process.env.ADMIN_API_KEY;
  const provided = req.get('x-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!configured || provided !== configured) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  return next();
}

router.use(requireApiKey);

router.get('/', async (_req, res) => {
  try {
    const slugs = cachedSlugs();
    const lines = [];

    lines.push('# HELP whatsapp_saas_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE whatsapp_saas_uptime_seconds gauge');
    lines.push(`whatsapp_saas_uptime_seconds ${Math.round(process.uptime())}`);

    lines.push('# HELP whatsapp_saas_cached_tenants_total Tenants loaded in RAM cache');
    lines.push('# TYPE whatsapp_saas_cached_tenants_total gauge');
    lines.push(`whatsapp_saas_cached_tenants_total ${slugs.length}`);

    lines.push('# HELP whatsapp_saas_active_sessions_total Active conversation sessions in RAM');
    lines.push('# TYPE whatsapp_saas_active_sessions_total gauge');
    for (const slug of slugs) {
      lines.push(`whatsapp_saas_active_sessions_total{tenant="${slug}"} ${getActiveSessions(slug).length}`);
    }

    lines.push('# HELP whatsapp_saas_ai_calls_total AI calls this calendar month');
    lines.push('# TYPE whatsapp_saas_ai_calls_total gauge');
    try {
      const redis = getRedis();
      const month = new Date().toISOString().slice(0, 7);
      if (redis) {
        for (const slug of slugs) {
          const value = await redis.get(`ai_calls:${slug}:${month}`);
          lines.push(`whatsapp_saas_ai_calls_total{tenant="${slug}"} ${parseInt(value || '0', 10)}`);
        }
      }
    } catch {
      // Redis down: omit AI metrics without failing the endpoint.
    }

    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(`${lines.join('\n')}\n`);
  } catch (err) {
    logger.error({ err: err.message }, '[Metrics] Error generando metricas');
    res.status(500).send('# error generating metrics\n');
  }
});

export default router;
