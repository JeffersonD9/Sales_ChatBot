'use strict';

// JWT auth y rate limiting por tenant — igual que admin/middleware.js pero para tenants
const jwt          = require('jsonwebtoken');
const { getRedis } = require('../redis');
const { logger }   = require('../utils/logger');

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10);

function requireTenantAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Token ausente o mal formado' });
  }

  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    if (!payload.tenant_id) {
      return res.status(401).json({ ok: false, error: 'Token sin tenant_id' });
    }
    req.tenantId = payload.tenant_id;
    next();
  } catch (err) {
    logger.warn({ err: err.message, path: req.path }, '[TenantAuth] Token inválido');
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }
}

async function tenantRateLimit(req, res, next) {
  const redis = getRedis();
  if (!redis) {
    logger.warn({ tenantId: req.tenantId }, '[TenantAuth] Redis no disponible — sin rate limit');
    return next();
  }

  const key = `rate:${req.tenantId}:${Math.floor(Date.now() / 60000)}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60);

    if (count > RATE_LIMIT) {
      logger.warn({ tenantId: req.tenantId, count }, '[TenantAuth] Rate limit excedido');
      return res.status(429).json({ ok: false, error: `Límite de ${RATE_LIMIT} req/min excedido` });
    }
    next();
  } catch (err) {
    logger.warn({ tenantId: req.tenantId, err: err.message }, '[TenantAuth] Error Redis — permitiendo');
    next();
  }
}

module.exports = { requireTenantAuth, tenantRateLimit };
