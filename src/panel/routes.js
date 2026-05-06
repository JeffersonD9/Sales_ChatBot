'use strict';

/**
 * panel/routes.js — Router principal del panel
 *
 * Monta:
 *   /panel/auth/*  — autenticación (público + protegido)
 *   /panel/admin/* — gestión admin (requiere super_admin)
 *
 * Capas de seguridad aplicadas a todas las rutas del panel:
 *   1. Cookie parser inline (sin dependencia extra)
 *   2. securityHeaders   — CSP, X-Frame-Options, Referrer-Policy, etc.
 *   3. ipRateLimit       — 120 req/min por IP (configurable con PANEL_RATE_LIMIT)
 *   4. csrfOriginCheck   — valida Origin/Referer en POST/PUT/PATCH/DELETE
 *      (defensa en profundidad sobre SameSite=strict cookies)
 */

const express = require('express');
const {
  securityHeaders,
  ipRateLimit,
  csrfOriginCheck,
} = require('../middleware/security');

const router = express.Router();

// ── 1. Cookie parser mínimo (sin dependencia cookie-parser) ───────────────────
router.use((req, res, next) => {
  if (!req.cookies) {
    req.cookies = {};
    const cookieHeader = req.headers.cookie || '';
    cookieHeader.split(';').forEach((part) => {
      const [key, ...val] = part.trim().split('=');
      if (!key) return;
      try {
        req.cookies[key.trim()] = decodeURIComponent(val.join('=').trim());
      } catch {
        req.cookies[key.trim()] = val.join('=').trim();
      }
    });
  }
  next();
});

// ── 2. Security headers ───────────────────────────────────────────────────────
router.use(securityHeaders({ csp: securityHeaders.PANEL_CSP }));

// ── 3. Rate limiting por IP ───────────────────────────────────────────────────
// 120 req/min es amplio para uso humano del dashboard; contiene ataques de fuerza bruta.
// El login ya tiene su propio rate limit por DB (5 intentos/15 min en auth/service.js).
router.use(ipRateLimit({
  prefix:    'panel',
  max:       parseInt(process.env.PANEL_RATE_LIMIT || '120', 10),
  windowSec: 60,
}));

// ── 4. CSRF origin check ─────────────────────────────────────────────────────
// Solo aplica a métodos mutantes. Complementa SameSite=strict cookies.
router.use(csrfOriginCheck);

// ── 5. Sub-routers ────────────────────────────────────────────────────────────
router.use('/auth',  require('./auth/router'));
router.use('/admin', require('./admin/router'));

module.exports = router;
