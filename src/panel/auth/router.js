'use strict';

/**
 * panel/auth/router.js — Rutas de autenticación del panel
 *
 * POST /panel/auth/login   — login, setea cookies httpOnly
 * POST /panel/auth/refresh — rota tokens
 * POST /panel/auth/logout  — revoca sesión, limpia cookies
 * GET  /panel/auth/me      — usuario actual (requiere auth)
 */

const express  = require('express');
const service  = require('./service');
const { requireAuth } = require('./middleware');

const router = express.Router();

const SECURE = process.env.PANEL_COOKIE_SECURE === 'true';

function _cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure:   SECURE,
    sameSite: 'strict',
    maxAge:   maxAgeMs,
    path:     '/',
  };
}

function _setTokenCookies(res, accessToken, refreshToken) {
  res.cookie('panel_at', accessToken,  _cookieOptions(15 * 60 * 1000));           // 15 min
  res.cookie('panel_rt', refreshToken, _cookieOptions(7 * 24 * 60 * 60 * 1000)); // 7 días
}

function _clearTokenCookies(res) {
  const base = { path: '/', httpOnly: true, secure: SECURE, sameSite: 'strict' };
  res.clearCookie('panel_at', base);
  res.clearCookie('panel_rt', base);
}

// POST /panel/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'username y password requeridos' });
    }

    const ip        = req.ip || req.connection.remoteAddress || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || '';

    const { accessToken, refreshToken, user } = await service.login(username, password, ip, userAgent);

    _setTokenCookies(res, accessToken, refreshToken);
    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /panel/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies && req.cookies.panel_rt;
    if (!refreshToken) {
      return res.status(401).json({ ok: false, error: 'Sin refresh token' });
    }

    const ip = req.ip || req.connection.remoteAddress || '0.0.0.0';
    const { accessToken, refreshToken: newRefresh, user } = await service.refresh(refreshToken, ip);

    _setTokenCookies(res, accessToken, newRefresh);
    return res.json({ ok: true, user });
  } catch (err) {
    _clearTokenCookies(res);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /panel/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const refreshToken = req.cookies && req.cookies.panel_rt;
    if (refreshToken) {
      await service.logout(refreshToken);
    }
    _clearTokenCookies(res);
    return res.json({ ok: true });
  } catch (err) {
    _clearTokenCookies(res);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /panel/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.panelUser });
});

module.exports = router;
