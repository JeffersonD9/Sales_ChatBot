'use strict';

// JWT auth and rate limiting by tenant.
const jwt = require('jsonwebtoken');
const { getRedis } = require('../../redis');
const { resolveTenantById } = require('../tenancy/tenantResolver');
const { logger } = require('@whatsapp-saas/logger');

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10);

async function requireTenantAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Token ausente o mal formado' });
  }

  let payload;
  try {
    payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
  } catch (err) {
    logger.warn({ err: err.message, path: req.path }, '[TenantAuth] Token invalido');
    return res.status(401).json({ ok: false, error: 'Token invalido o expirado' });
  }

  if (!payload.tenant_id) {
    return res.status(401).json({ ok: false, error: 'Token sin tenant_id' });
  }

  req.tenantId = payload.tenant_id;

  try {
    const tenantContext = await resolveTenantById(payload.tenant_id);
    if (!tenantContext) {
      return res.status(403).json({ ok: false, error: 'Tenant inactivo o no encontrado' });
    }
    req.tenantContext = tenantContext;
    return next();
  } catch (err) {
    logger.error({ tenantId: payload.tenant_id, err: err.message }, '[TenantAuth] Error resolviendo tenant');
    return res.status(503).json({ ok: false, error: 'Tenant no disponible' });
  }
}

async function tenantRateLimit(req, res, next) {
  const redis = getRedis();
  if (!redis) {
    logger.warn({ tenantId: req.tenantId }, '[TenantAuth] Redis no disponible - sin rate limit');
    return next();
  }

  const key = `rate:${req.tenantId}:${Math.floor(Date.now() / 60000)}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60);

    if (count > RATE_LIMIT) {
      logger.warn({ tenantId: req.tenantId, count }, '[TenantAuth] Rate limit excedido');
      return res.status(429).json({ ok: false, error: `Limite de ${RATE_LIMIT} req/min excedido` });
    }
    return next();
  } catch (err) {
    logger.warn({ tenantId: req.tenantId, err: err.message }, '[TenantAuth] Error Redis - permitiendo');
    return next();
  }
}

module.exports = { requireTenantAuth, tenantRateLimit };
