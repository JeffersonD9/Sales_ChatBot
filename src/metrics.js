'use strict';

/**
 * metrics.js — Endpoint /metrics en formato Prometheus text
 *
 * Métricas expuestas:
 *   whatsapp_saas_active_sessions_total   — sesiones en RAM L1 (por tenant)
 *   whatsapp_saas_ai_calls_total          — llamadas IA acumuladas este mes (por tenant)
 *   whatsapp_saas_uptime_seconds          — segundos desde que arrancó el proceso
 *   whatsapp_saas_cached_tenants_total    — tenants cargados en el loader L1
 *
 * Uso:
 *   app.use('/metrics', require('./metrics'));
 *
 * Scraping con Prometheus: apunta a http://host:3000/metrics
 */

const express                       = require('express');
const { getActiveSessions }         = require('./core/state/manager');
const { cachedSlugs }               = require('./tenants/loader');
const { getRedis }                  = require('./redis');
const { logger }                    = require('./utils/logger');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const slugs   = cachedSlugs();
    const lines   = [];

    // ── uptime ────────────────────────────────────────────────────────────
    lines.push('# HELP whatsapp_saas_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE whatsapp_saas_uptime_seconds gauge');
    lines.push(`whatsapp_saas_uptime_seconds ${Math.round(process.uptime())}`);

    // ── cached tenants ────────────────────────────────────────────────────
    lines.push('# HELP whatsapp_saas_cached_tenants_total Tenants loaded in RAM cache');
    lines.push('# TYPE whatsapp_saas_cached_tenants_total gauge');
    lines.push(`whatsapp_saas_cached_tenants_total ${slugs.length}`);

    // ── active sessions per tenant ────────────────────────────────────────
    lines.push('# HELP whatsapp_saas_active_sessions_total Active conversation sessions in RAM');
    lines.push('# TYPE whatsapp_saas_active_sessions_total gauge');
    for (const slug of slugs) {
      const count = getActiveSessions(slug).length;
      lines.push(`whatsapp_saas_active_sessions_total{tenant="${slug}"} ${count}`);
    }

    // ── AI calls this month per tenant (from Redis) ───────────────────────
    lines.push('# HELP whatsapp_saas_ai_calls_total AI calls this calendar month');
    lines.push('# TYPE whatsapp_saas_ai_calls_total gauge');
    try {
      const redis  = getRedis();
      const month  = new Date().toISOString().slice(0, 7); // YYYY-MM
      for (const slug of slugs) {
        const key   = `ai_calls:${slug}:${month}`;
        const value = await redis.get(key);
        lines.push(`whatsapp_saas_ai_calls_total{tenant="${slug}"} ${parseInt(value || '0', 10)}`);
      }
    } catch {
      // Redis down — omit AI metrics, don't fail the whole endpoint
    }

    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(lines.join('\n') + '\n');
  } catch (err) {
    logger.error({ err: err.message }, '[Metrics] Error generando métricas');
    res.status(500).send('# error generating metrics\n');
  }
});

module.exports = router;
