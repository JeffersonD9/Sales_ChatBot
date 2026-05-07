'use strict';

/**
 * middleware/cors.js — Configuración CORS por tipo de ruta
 *
 * Rutas y política:
 *   /webhook/:slug     — No CORS. Meta llama server-to-server; nunca desde browser.
 *   /admin/*           — No CORS. El admin-ui se sirve desde el mismo origen.
 *   /panel/*           — No CORS. El panel-ui se sirve desde el mismo origen.
 *   /api/whatsapp/*    — CORS configurado. Los tenants pueden llamar desde su
 *                        propia aplicación (origen externo). Sin cookies — Bearer.
 *
 * Origen permitido: ALLOWED_ORIGINS (CSV). Si está vacío, cualquier origen
 * puede llamar a la API (útil en desarrollo). En producción DEBE configurarse.
 *
 * Escalabilidad: añadir nuevas rutas públicas → exportar una función factory
 * adicional con su propia política. No tocar app.js salvo para montarla.
 */

const cors   = require('cors');
const { logger } = require('../utils/logger');

function _buildOriginList() {
  const raw = (process.env.ALLOWED_ORIGINS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * CORS para /api/whatsapp — tenants llaman desde su propio front/backend.
 *
 * Sin credentials: los clientes usan Bearer token, no cookies.
 * OPTIONS (preflight) resuelve sin pasar por el stack de auth.
 */
function tenantApiCors() {
  const origins = _buildOriginList();

  return cors({
    origin(requestOrigin, cb) {
      // Sin Origin header → petición server-to-server → permitir siempre
      if (!requestOrigin) return cb(null, true);

      // Sin lista configurada → modo permisivo (desarrollo)
      if (origins.length === 0) return cb(null, true);

      if (origins.includes(requestOrigin)) return cb(null, true);

      logger.warn({ origin: requestOrigin }, '[CORS] Origen rechazado en /api/whatsapp');
      cb(Object.assign(new Error('CORS: origen no permitido'), { status: 403 }));
    },
    methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials:    false,   // Bearer tokens — las cookies no viajan cross-origin aquí
    maxAge:         600,     // El browser cachea el preflight 10 min
  });
}

module.exports = { tenantApiCors };
