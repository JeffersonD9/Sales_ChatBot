'use strict';

/**
 * panel/routes.js — Router principal del panel
 *
 * Monta:
 *   /panel/auth/*  — autenticación (público + protegido)
 *   /panel/admin/* — gestión admin (requiere super_admin)
 *
 * Security headers en todas las respuestas del panel:
 *   X-Content-Type-Options: nosniff
 *   X-Frame-Options: DENY
 *   Cache-Control: no-store
 */

const express = require('express');

const router = express.Router();

// Cookie parser es necesario para leer las cookies httpOnly
// Express no incluye cookie-parser, pero podemos parsear manualmente
// si no está disponible, o requerir que se monte cookie-parser en app.js.
// Para no agregar dependencias, usamos un parser mínimo inline.
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
        // Cookie con encoding inválido — ignorar sin crash
        req.cookies[key.trim()] = val.join('=').trim();
      }
    });
  }
  next();
});

// Security headers
router.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Cache-Control', 'no-store');
  next();
});

router.use('/auth',  require('./auth/router'));
router.use('/admin', require('./admin/router'));

module.exports = router;
