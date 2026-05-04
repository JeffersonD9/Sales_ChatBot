'use strict';

/**
 * panel/auth/middleware.js — Middleware de autenticación del panel
 */

const { validateAccessToken } = require('./service');
const { logger }              = require('../../utils/logger');

/**
 * Extrae el JWT de la cookie panel_at o del header Authorization: Bearer.
 * Valida firma y verifica que la sesión exista en DB.
 * Adjunta req.panelUser = { id, username, role, tenantId, sessionId }.
 */
async function requireAuth(req, res, next) {
  try {
    let token = null;

    if (req.cookies && req.cookies.panel_at) {
      token = req.cookies.panel_at;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
    }

    if (!token) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }

    const payload = await validateAccessToken(token);

    req.panelUser = {
      id:        payload.sub,
      username:  payload.username,
      role:      payload.role,
      tenantId:  payload.tenant_id || null,
      sessionId: payload.sid,
    };

    return next();
  } catch (err) {
    const status = err.status || 401;
    logger.warn({ path: req.path, err: err.message }, '[Panel] Auth fallida');
    return res.status(status).json({ ok: false, error: err.message || 'No autenticado' });
  }
}

/**
 * Factory que verifica req.panelUser.role contra la lista de roles permitidos.
 * Debe usarse DESPUÉS de requireAuth.
 * @param {...string} roles
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.panelUser) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }
    if (!roles.includes(req.panelUser.role)) {
      logger.warn(
        { userId: req.panelUser.id, role: req.panelUser.role, required: roles },
        '[Panel] Acceso denegado por rol'
      );
      return res.status(403).json({ ok: false, error: 'Acceso denegado' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
