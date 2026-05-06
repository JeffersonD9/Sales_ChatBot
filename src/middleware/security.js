'use strict';

/**
 * middleware/security.js — Primitivas de seguridad anti-spam reutilizables
 *
 * Exports:
 *   ipRateLimit(opts)       — rate limiting por IP (Redis + fallback in-memory)
 *   progressiveBackoff(opts)— bloqueo exponencial por intentos fallidos
 *   securityHeaders(opts)   — HTTP security headers (CSP, X-Frame-Options, etc.)
 *   ipWhitelist(envVar)     — whitelist de IPs configurable por env
 *   csrfOriginCheck         — valida Origin/Referer en mutaciones
 *   validateSlug            — valida formato de slug de tenant
 */

const { getRedis } = require('../redis');
const { logger }   = require('../utils/logger');

// ── IP Rate Limiter ────────────────────────────────────────────────────────────
// Redis-backed (compartido entre reinicios y contenedores).
// Fallback a Map en memoria si Redis no está disponible.

const _rlMemory = new Map();

function _rlCleanMemory(windowKey) {
  for (const k of _rlMemory.keys()) {
    if (!k.includes(`:w${windowKey}:`)) _rlMemory.delete(k);
  }
}

async function _rlRedisIncr(key, windowSec) {
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

/**
 * Factory: middleware de rate limiting por IP.
 *
 * @param {{ prefix: string, max: number, windowSec?: number }} opts
 *   prefix    — clave de namespace en Redis (ej. 'webhook', 'panel')
 *   max       — máximo de requests por ventana
 *   windowSec — tamaño de la ventana en segundos (default: 60)
 */
function ipRateLimit({ prefix, max, windowSec = 60 }) {
  return async (req, res, next) => {
    const ip     = _getIp(req);
    const window = Math.floor(Date.now() / (windowSec * 1000));
    const key    = `rl:${prefix}:${ip}:w${window}:`;

    let count = await _rlRedisIncr(key, windowSec);

    if (count === null) {
      _rlCleanMemory(`${window}`);
      count = (_rlMemory.get(key) || 0) + 1;
      _rlMemory.set(key, count);
    }

    if (count > max) {
      logger.warn({ ip, prefix, count, path: req.path, ua: req.headers['user-agent'] },
        '[Security] Rate limit excedido');
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta más tarde.' });
    }

    next();
  };
}

// ── Progressive Backoff ────────────────────────────────────────────────────────
// Registra intentos fallidos y bloquea con espera exponencial:
//   intento 5 → bloqueo por blockBaseSec
//   intento 6 → blockBaseSec × 2
//   intento 7 → blockBaseSec × 4  ... hasta maxBlockSec

const _boMemory = new Map();

/**
 * Factory: devuelve { middleware(keyFn), recordFailure(key), clearFailures(key) }
 *
 * @param {{ prefix: string, maxAttempts?: number, blockBaseSec?: number, maxBlockSec?: number }} opts
 */
function progressiveBackoff({
  prefix,
  maxAttempts   = 5,
  blockBaseSec  = 60,
  maxBlockSec   = 3600,
}) {
  const ns = `bo:${prefix}`;

  async function _get(key) {
    const redis = getRedis();
    if (redis) {
      try {
        const raw = await redis.get(`${ns}:${key}`);
        return raw ? JSON.parse(raw) : null;
      } catch { /* fall through to memory */ }
    }
    return _boMemory.get(`${ns}:${key}`) || null;
  }

  async function _set(key, data, ttlSec) {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.set(`${ns}:${key}`, JSON.stringify(data), 'EX', ttlSec);
        return;
      } catch { /* fall through to memory */ }
    }
    _boMemory.set(`${ns}:${key}`, data);
    // Auto-limpieza en memoria para no crecer indefinidamente
    setTimeout(() => _boMemory.delete(`${ns}:${key}`), ttlSec * 1000).unref?.();
  }

  async function _del(key) {
    const redis = getRedis();
    if (redis) {
      try { await redis.del(`${ns}:${key}`); } catch { /* ignore */ }
    }
    _boMemory.delete(`${ns}:${key}`);
  }

  /**
   * Registrar un intento fallido. Llamar DESPUÉS de verificar que el intento fue inválido.
   */
  async function recordFailure(key) {
    const now   = Date.now();
    const state = await _get(key) || { attempts: 0, blockedUntil: null };
    state.attempts += 1;

    if (state.attempts >= maxAttempts) {
      const exponent = state.attempts - maxAttempts;
      const blockMs  = Math.min(blockBaseSec * Math.pow(2, exponent), maxBlockSec) * 1000;
      state.blockedUntil = now + blockMs;
      const ttlSec = Math.ceil(blockMs / 1000) + 60;
      await _set(key, state, ttlSec);
    } else {
      // Guardar estado sin bloqueo durante la ventana máxima
      await _set(key, state, maxBlockSec);
    }

    logger.warn({ prefix, key, attempts: state.attempts, blockedUntil: state.blockedUntil },
      '[Security] Intento fallido registrado');
  }

  /**
   * Limpiar historial tras un intento exitoso.
   */
  async function clearFailures(key) {
    await _del(key);
  }

  /**
   * Middleware que bloquea si la IP está en período de backoff.
   * @param {(req: import('express').Request) => string} [keyFn] — extrae la clave de la request (default: IP)
   */
  function middleware(keyFn) {
    return async (req, res, next) => {
      const key   = keyFn ? keyFn(req) : _getIp(req);
      const state = await _get(key);

      if (state?.blockedUntil && state.blockedUntil > Date.now()) {
        const remainSec = Math.ceil((state.blockedUntil - Date.now()) / 1000);
        const remainMin = Math.ceil(remainSec / 60);
        logger.warn({ prefix, key, remainSec, path: req.path },
          '[Security] Acceso bloqueado por backoff progresivo');
        return res.status(429).json({
          error: `Acceso bloqueado temporalmente. Intenta en ${remainMin} minuto(s).`,
        });
      }

      next();
    };
  }

  return { middleware, recordFailure, clearFailures };
}

// ── Security Headers ──────────────────────────────────────────────────────────

// CSP del panel: necesita unsafe-inline para estilos del SPA (CSS variables inline).
// Los scripts del SPA están en el mismo origen (self).
// frame-ancestors 'none' duplica X-Frame-Options para navegadores modernos.
const PANEL_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",       // unsafe-inline requerido por el SPA dashboard
  "style-src 'self' 'unsafe-inline'",        // CSS variables y estilos inline del dashboard
  "img-src 'self' data: https:",             // imágenes de productos pueden ser URLs externas
  "font-src 'self'",
  "connect-src 'self'",                      // fetch() a /panel/auth/* y /panel/admin/*
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// CSP para la API pública (no sirve HTML; previene sniffing si alguien la accede en browser)
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * Agrega headers de seguridad HTTP a las respuestas.
 * @param {{ csp?: string }} opts
 */
function securityHeaders({ csp = API_CSP } = {}) {
  return (_req, res, next) => {
    res.set('X-Content-Type-Options',  'nosniff');
    res.set('X-Frame-Options',         'DENY');
    // X-XSS-Protection desactivado: los navegadores modernos lo ignoran o tienen bugs con él;
    // la protección real viene del CSP.
    res.set('X-XSS-Protection',        '0');
    res.set('Referrer-Policy',         'strict-origin-when-cross-origin');
    res.set('Content-Security-Policy', csp);
    res.set('Permissions-Policy',      'camera=(), microphone=(), geolocation=()');
    next();
  };
}

securityHeaders.PANEL_CSP = PANEL_CSP;
securityHeaders.API_CSP   = API_CSP;

// ── IP Whitelist ──────────────────────────────────────────────────────────────

/**
 * Middleware que solo permite el paso a IPs listadas en la variable de entorno.
 * Si la variable está vacía o no definida, no aplica ninguna restricción.
 *
 * @param {string} envVar — nombre de la env var (comma-separated, ej. "1.2.3.4,5.6.7.8")
 */
function ipWhitelist(envVar) {
  return (req, res, next) => {
    const raw = process.env[envVar] || '';
    if (!raw.trim()) return next(); // whitelist vacía → sin restricción

    const allowed      = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const ip           = _getIp(req);
    // Normalizar IPv4-mapped IPv6 (::ffff:1.2.3.4 → 1.2.3.4)
    const normalizedIp = ip.replace(/^::ffff:/, '');

    if (!allowed.includes(normalizedIp)) {
      logger.warn({ ip: normalizedIp, path: req.path, ua: req.headers['user-agent'] },
        `[Security] Acceso denegado por whitelist (${envVar})`);
      return res.status(403).json({ error: 'Acceso no permitido desde esta IP' });
    }

    next();
  };
}

// ── CSRF Origin Check ─────────────────────────────────────────────────────────
// El panel ya usa cookies httpOnly + SameSite=strict, que mitigan CSRF en
// navegadores modernos. Esta verificación de Origin es defensa en profundidad
// para proteger también contra ataques desde redes locales (CORS bypass).

/**
 * Para métodos mutantes (POST/PUT/PATCH/DELETE) verifica que el header Origin
 * o Referer corresponda al dominio del servidor.
 * Solo aplica a las rutas del panel (no al webhook de Meta, que no envía Origin).
 */
function csrfOriginCheck(req, res, next) {
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  if (SAFE_METHODS.has(req.method)) return next();

  const origin  = req.headers['origin']  || '';
  const referer = req.headers['referer'] || '';
  const source  = origin || referer;

  // Construir lista de orígenes permitidos basada en DOMAIN y PORT
  const domain  = process.env.DOMAIN || '';
  const port    = process.env.PORT   || '3000';
  const allowed = new Set([
    domain  ? `https://${domain}`             : null,
    domain  ? `http://${domain}`              : null,
    `http://localhost:${port}`,
    `http://localhost`,
    `http://127.0.0.1:${port}`,
  ].filter(Boolean));

  const isAllowed = [...allowed].some((o) => source.startsWith(o));

  if (!isAllowed) {
    logger.warn({ origin, referer, path: req.path, ua: req.headers['user-agent'], ip: _getIp(req) },
      '[Security] CSRF origin check fallido');
    return res.status(403).json({ error: 'Origen de la solicitud no permitido' });
  }

  next();
}

// ── Slug Validator ────────────────────────────────────────────────────────────
// Slugs válidos: solo letras minúsculas, números y guiones. Max 64 caracteres.
// Previene path traversal y fuerza bruta de slugs con caracteres especiales.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

/**
 * Middleware que valida req.params.slug antes de llegar al handler.
 */
function validateSlug(req, res, next) {
  const { slug } = req.params;
  if (!slug || !SLUG_RE.test(slug)) {
    logger.warn({ slug, ip: _getIp(req), path: req.path }, '[Security] Slug inválido rechazado');
    return res.status(400).json({ error: 'Slug inválido' });
  }
  next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getIp(req) {
  // Express pone la IP real en req.ip cuando trust proxy está configurado.
  // En desarrollo sin proxy, puede ser ::1 o ::ffff:127.0.0.1.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

module.exports = {
  ipRateLimit,
  progressiveBackoff,
  securityHeaders,
  ipWhitelist,
  csrfOriginCheck,
  validateSlug,
};
