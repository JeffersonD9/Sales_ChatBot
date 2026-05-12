'use strict';

const { getRedis } = require('../redis');
const { logger } = require('../utils/logger');

const rateLimitMemory = new Map();
const API_CSP = "default-src 'none'; frame-ancestors 'none'";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

function getIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function cleanRateLimitMemory(windowKey) {
  for (const key of rateLimitMemory.keys()) {
    if (!key.includes(`:w${windowKey}:`)) rateLimitMemory.delete(key);
  }
}

async function redisIncr(key, windowSec) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    return count;
  } catch {
    return null;
  }
}

function ipRateLimit({ prefix, max, windowSec = 60 }) {
  return async (req, res, next) => {
    const ip = getIp(req);
    const window = Math.floor(Date.now() / (windowSec * 1000));
    const key = `rl:${prefix}:${ip}:w${window}:`;

    let count = await redisIncr(key, windowSec);

    if (count === null) {
      cleanRateLimitMemory(`${window}`);
      count = (rateLimitMemory.get(key) || 0) + 1;
      rateLimitMemory.set(key, count);
    }

    if (count > max) {
      logger.warn({ ip, prefix, count, path: req.path }, '[Security] Rate limit excedido');
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta mas tarde.' });
    }

    return next();
  };
}

function securityHeaders({ csp = API_CSP } = {}) {
  return (_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('X-XSS-Protection', '0');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('Content-Security-Policy', csp);
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if (process.env.NODE_ENV === 'production') {
      const maxAge = parseInt(process.env.HSTS_MAX_AGE || '31536000', 10);
      res.set('Strict-Transport-Security', `max-age=${maxAge}; includeSubDomains`);
    }

    return next();
  };
}

securityHeaders.API_CSP = API_CSP;

function validateSlug(req, res, next) {
  const { slug } = req.params;
  if (!slug || !SLUG_RE.test(slug)) {
    logger.warn({ slug, ip: getIp(req), path: req.path }, '[Security] Slug invalido rechazado');
    return res.status(400).json({ error: 'Slug invalido' });
  }
  return next();
}

module.exports = {
  ipRateLimit,
  securityHeaders,
  validateSlug,
};
