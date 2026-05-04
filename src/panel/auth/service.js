'use strict';

/**
 * panel/auth/service.js — Lógica de autenticación del panel
 *
 * Importa solo: src/db.js, src/utils/logger.js
 * (sin Redis — rate limiting persiste en DB para sobrevivir reinicios)
 *
 * Garantías de seguridad:
 *   - bcrypt cost 12 para passwords
 *   - Refresh token: crypto.randomBytes(64), HMAC-SHA256 antes de guardar en DB
 *   - Access token: JWT 15 min con { sub, username, role, tenant_id, sid }
 *   - Rotación de sesiones en cada refresh
 *   - Rate limiting: 5 intentos / 15 min por IP → bloqueo 15 min
 *   - Timing-safe: bcrypt.compare (no ===), timingSafeEqual para HMAC
 *   - Nunca loguear passwords, tokens ni hashes
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');

const { query }  = require('../../db');
const { logger } = require('../../utils/logger');

const ACCESS_TOKEN_TTL   = '10m';
const REFRESH_TOKEN_DAYS = 7;
const RATE_WINDOW_MS     = 15 * 60 * 1000; // 15 minutos
const RATE_MAX_ATTEMPTS  = 5;
const RATE_BLOCK_MS      = 15 * 60 * 1000; // 15 minutos

function _refreshSecret() {
  const s = process.env.PANEL_REFRESH_SECRET;
  if (!s || s.length < 32) throw new Error('PANEL_REFRESH_SECRET no configurado o demasiado corto (mín 32 chars)');
  return s;
}

function _jwtSecret() {
  const s = process.env.PANEL_JWT_SECRET;
  if (!s || s.length < 32) throw new Error('PANEL_JWT_SECRET no configurado o demasiado corto (mín 32 chars)');
  return s;
}

function _hmac(token) {
  return crypto
    .createHmac('sha256', _refreshSecret())
    .update(token)
    .digest('hex');
}

function _generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Verifica rate limit por IP. Lanza error si está bloqueado.
 * Incrementa el contador si no lo está.
 * @param {string} ip
 */
async function _checkRateLimit(ip) {
  const key = `login:ip::${ip}`;
  const now = new Date();

  const { rows } = await query(
    'SELECT count, first_attempt_at, blocked_until FROM panel_rate_limits WHERE key = $1',
    [key]
  );

  if (rows.length > 0) {
    const row = rows[0];

    // Bloqueado activamente
    if (row.blocked_until && new Date(row.blocked_until) > now) {
      const err = new Error('Demasiados intentos fallidos. Intenta en 15 minutos.');
      err.status = 429;
      throw err;
    }

    // Ventana expirada → reiniciar
    if (row.first_attempt_at && (now - new Date(row.first_attempt_at)) > RATE_WINDOW_MS) {
      await query(
        `UPDATE panel_rate_limits
         SET count = 1, first_attempt_at = $2, blocked_until = NULL
         WHERE key = $1`,
        [key, now]
      );
      return;
    }

    // Dentro de la ventana — ¿ya alcanzó el límite?
    if (row.count >= RATE_MAX_ATTEMPTS) {
      const blockedUntil = new Date(now.getTime() + RATE_BLOCK_MS);
      await query(
        'UPDATE panel_rate_limits SET blocked_until = $2 WHERE key = $1',
        [key, blockedUntil]
      );
      logger.warn({ ip }, '[Panel] Rate limit excedido — IP bloqueada 15 min');
      const err = new Error('Demasiados intentos fallidos. Intenta en 15 minutos.');
      err.status = 429;
      throw err;
    }

    await query(
      'UPDATE panel_rate_limits SET count = count + 1 WHERE key = $1',
      [key]
    );
  } else {
    await query(
      `INSERT INTO panel_rate_limits (key, count, first_attempt_at)
       VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE
         SET count = panel_rate_limits.count + 1`,
      [key, now]
    );
  }
}

/**
 * Limpia el rate limit tras un login exitoso.
 * @param {string} ip
 */
async function _clearRateLimit(ip) {
  await query('DELETE FROM panel_rate_limits WHERE key = $1', [`login:ip::${ip}`]);
}

/**
 * Crea una nueva sesión en DB y retorna los tokens.
 * @param {{ id, username, role, tenant_id }} user
 * @param {string} ip
 * @param {string} userAgent
 * @returns {{ accessToken: string, refreshToken: string }}
 */
async function _createSession(user, ip, userAgent) {
  const refreshToken  = _generateRefreshToken();
  const tokenHash     = _hmac(refreshToken);
  const expiresAt     = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  const { rows } = await query(
    `INSERT INTO panel_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [user.id, tokenHash, expiresAt, ip || null, userAgent || null]
  );

  const sessionId = rows[0].id;

  const accessToken = jwt.sign(
    {
      sub:       user.id,
      username:  user.username,
      role:      user.role,
      tenant_id: user.tenant_id || null,
      sid:       sessionId,
    },
    _jwtSecret(),
    { expiresIn: ACCESS_TOKEN_TTL }
  );

  logger.info({ userId: user.id, sessionId, ip }, '[Panel] Sesión creada');

  return { accessToken, refreshToken };
}

// ── Exports públicos ──────────────────────────────────────────────────────────

/**
 * Login con username + password.
 * @param {string} username
 * @param {string} password
 * @param {string} ip
 * @param {string} userAgent
 * @returns {{ accessToken, refreshToken, user }}
 */
async function login(username, password, ip, userAgent) {
  await _checkRateLimit(ip);

  const { rows } = await query(
    'SELECT id, username, email, role, tenant_id, password_hash, is_active FROM panel_users WHERE username = $1',
    [username]
  );

  // Timing-safe: siempre ejecutar bcrypt aunque el usuario no exista
  const dummyHash = '$2b$12$invalidhashpadding00000000000000000000000000000000000000';
  const storedHash = rows[0] ? rows[0].password_hash : dummyHash;
  const passwordOk = await bcrypt.compare(password, storedHash);

  if (!rows[0] || !passwordOk || !rows[0].is_active) {
    logger.warn({ username, ip }, '[Panel] Intento de login fallido');
    const err = new Error('Credenciales inválidas');
    err.status = 401;
    throw err;
  }

  const user = rows[0];
  await _clearRateLimit(ip);

  const { accessToken, refreshToken } = await _createSession(user, ip, userAgent);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id },
  };
}

/**
 * Rota el refresh token: revoca la sesión anterior y crea una nueva.
 * @param {string} refreshToken
 * @param {string} ip
 * @returns {{ accessToken, refreshToken, user }}
 */
async function refresh(refreshToken, ip) {
  const tokenHash = _hmac(refreshToken);

  const { rows } = await query(
    `SELECT ps.id, ps.user_id, ps.expires_at, ps.is_active,
            pu.username, pu.role, pu.tenant_id, pu.is_active AS user_active
     FROM panel_sessions ps
     JOIN panel_users pu ON pu.id = ps.user_id
     WHERE ps.token_hash = $1`,
    [tokenHash]
  );

  if (!rows[0] || !rows[0].is_active || new Date(rows[0].expires_at) < new Date() || !rows[0].user_active) {
    const err = new Error('Sesión inválida o expirada');
    err.status = 401;
    throw err;
  }

  const session = rows[0];

  // Revocar sesión anterior
  await query(
    `UPDATE panel_sessions
     SET is_active = false, revoked_at = NOW(), revoke_reason = 'rotated'
     WHERE id = $1`,
    [session.id]
  );

  const user = { id: session.user_id, username: session.username, role: session.role, tenant_id: session.tenant_id };
  const tokens = await _createSession(user, ip, null);

  logger.info({ userId: user.id, oldSessionId: session.id }, '[Panel] Sesión rotada');

  return {
    ...tokens,
    user: { id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id },
  };
}

/**
 * Revoca una sesión por refresh token.
 * @param {string} refreshToken
 */
async function logout(refreshToken) {
  const tokenHash = _hmac(refreshToken);

  const { rows } = await query(
    'SELECT id, user_id FROM panel_sessions WHERE token_hash = $1 AND is_active = true',
    [tokenHash]
  );

  if (!rows[0]) return;

  await query(
    `UPDATE panel_sessions
     SET is_active = false, revoked_at = NOW(), revoke_reason = 'logout'
     WHERE id = $1`,
    [rows[0].id]
  );

  logger.info({ userId: rows[0].user_id, sessionId: rows[0].id }, '[Panel] Logout');
}

/**
 * Revoca todas las sesiones activas de un usuario.
 * @param {string} userId
 */
async function logoutAll(userId) {
  await query(
    `UPDATE panel_sessions
     SET is_active = false, revoked_at = NOW(), revoke_reason = 'logout_all'
     WHERE user_id = $1 AND is_active = true`,
    [userId]
  );

  logger.info({ userId }, '[Panel] Logout all sessions');
}

/**
 * Valida un access token JWT y verifica que la sesión exista en DB.
 * Lanza error si el token es inválido, expirado, o la sesión fue revocada.
 * @param {string} token
 * @returns {{ sub, username, role, tenant_id, sid }}
 */
async function validateAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, _jwtSecret());
  } catch (err) {
    const e = new Error('Token inválido o expirado');
    e.status = 401;
    throw e;
  }

  const { rows } = await query(
    `SELECT id FROM panel_sessions
     WHERE id = $1 AND is_active = true AND expires_at > NOW()`,
    [payload.sid]
  );

  if (!rows[0]) {
    const err = new Error('Sesión revocada o expirada');
    err.status = 401;
    throw err;
  }

  return payload;
}

/**
 * Limpia sesiones expiradas y registros de rate limit vencidos.
 * Llamar periódicamente (ej: desde server.js cada hora).
 */
async function cleanExpiredSessions() {
  const { rowCount: sessionsDeleted } = await query(
    `DELETE FROM panel_sessions
     WHERE expires_at < NOW()
       OR (is_active = false AND revoked_at < NOW() - INTERVAL '7 days')`,
    []
  );

  const { rowCount: rateLimitsDeleted } = await query(
    `DELETE FROM panel_rate_limits
     WHERE blocked_until IS NOT NULL AND blocked_until < NOW() - INTERVAL '1 hour'`,
    []
  );

  if (sessionsDeleted > 0 || rateLimitsDeleted > 0) {
    logger.info({ sessionsDeleted, rateLimitsDeleted }, '[Panel] Limpieza de sesiones expiradas');
  }
}

module.exports = { login, refresh, logout, logoutAll, validateAccessToken, cleanExpiredSessions };
