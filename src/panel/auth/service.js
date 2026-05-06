'use strict';

/**
 * panel/auth/service.js — Lógica de autenticación del panel
 *
 * Garantías de seguridad:
 *   - bcrypt cost 12 para passwords
 *   - Refresh token: crypto.randomBytes(64), HMAC-SHA256 antes de guardar en DB
 *   - Access token: JWT 10 min con { sub, username, role, tenant_id, sid }
 *   - Rotación de sesiones en cada refresh
 *   - Rate limiting: 5 intentos / 15 min por IP → bloqueo 15 min
 *   - Timing-safe: bcrypt.compare (no ===), timingSafeEqual para HMAC
 *   - Nunca loguear passwords, tokens ni hashes
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');

const { eq, and, lt, sql, or } = require('drizzle-orm');
const { getDb }        = require('../../drizzle/db');
const { panelUsers, panelSessions, panelRateLimits } = require('../../drizzle/schema');
const { logger }       = require('../../utils/logger');

const ACCESS_TOKEN_TTL   = '10m';
const REFRESH_TOKEN_DAYS = 7;
const RATE_WINDOW_MS     = 15 * 60 * 1000;
const RATE_MAX_ATTEMPTS  = 5;
const RATE_BLOCK_MS      = 15 * 60 * 1000;

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
  return crypto.createHmac('sha256', _refreshSecret()).update(token).digest('hex');
}

function _generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

async function _checkRateLimit(ip) {
  const db  = getDb();
  const key = `login:ip::${ip}`;
  const now = new Date();

  const rows = await db
    .select()
    .from(panelRateLimits)
    .where(eq(panelRateLimits.key, key))
    .limit(1);

  if (rows.length > 0) {
    const row = rows[0];

    if (row.blocked_until && new Date(row.blocked_until) > now) {
      const err = new Error('Demasiados intentos fallidos. Intenta en 15 minutos.');
      err.status = 429;
      throw err;
    }

    if (row.first_attempt_at && (now - new Date(row.first_attempt_at)) > RATE_WINDOW_MS) {
      await db.update(panelRateLimits)
        .set({ count: 1, first_attempt_at: now, blocked_until: null })
        .where(eq(panelRateLimits.key, key));
      return;
    }

    if (row.count >= RATE_MAX_ATTEMPTS) {
      const blockedUntil = new Date(now.getTime() + RATE_BLOCK_MS);
      await db.update(panelRateLimits)
        .set({ blocked_until: blockedUntil })
        .where(eq(panelRateLimits.key, key));
      logger.warn({ ip }, '[Panel] Rate limit excedido — IP bloqueada 15 min');
      const err = new Error('Demasiados intentos fallidos. Intenta en 15 minutos.');
      err.status = 429;
      throw err;
    }

    await db.update(panelRateLimits)
      .set({ count: sql`${panelRateLimits.count} + 1` })
      .where(eq(panelRateLimits.key, key));
  } else {
    await db.insert(panelRateLimits)
      .values({ key, count: 1, first_attempt_at: now })
      .onConflictDoUpdate({
        target: panelRateLimits.key,
        set:    { count: sql`${panelRateLimits.count} + 1` },
      });
  }
}

async function _clearRateLimit(ip) {
  const db = getDb();
  await db.delete(panelRateLimits).where(eq(panelRateLimits.key, `login:ip::${ip}`));
}

async function _createSession(user, ip, userAgent) {
  const db           = getDb();
  const refreshToken = _generateRefreshToken();
  const tokenHash    = _hmac(refreshToken);
  const expiresAt    = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .insert(panelSessions)
    .values({
      user_id:    user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      ip_address: ip || null,
      user_agent: userAgent || null,
    })
    .returning({ id: panelSessions.id });

  const sessionId = rows[0].id;

  const accessToken = jwt.sign(
    { sub: user.id, username: user.username, role: user.role, tenant_id: user.tenant_id || null, sid: sessionId },
    _jwtSecret(),
    { expiresIn: ACCESS_TOKEN_TTL }
  );

  logger.info({ userId: user.id, sessionId, ip }, '[Panel] Sesión creada');

  return { accessToken, refreshToken };
}

// ── Exports públicos ──────────────────────────────────────────────────────────

async function login(username, password, ip, userAgent) {
  await _checkRateLimit(ip);

  const db   = getDb();
  const rows = await db
    .select({
      id:            panelUsers.id,
      username:      panelUsers.username,
      email:         panelUsers.email,
      role:          panelUsers.role,
      tenant_id:     panelUsers.tenant_id,
      password_hash: panelUsers.password_hash,
      is_active:     panelUsers.is_active,
    })
    .from(panelUsers)
    .where(eq(panelUsers.username, username))
    .limit(1);

  const dummyHash  = '$2b$12$invalidhashpadding00000000000000000000000000000000000000';
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

async function refresh(refreshToken, ip) {
  const db        = getDb();
  const tokenHash = _hmac(refreshToken);

  const rows = await db
    .select({
      id:          panelSessions.id,
      user_id:     panelSessions.user_id,
      expires_at:  panelSessions.expires_at,
      is_active:   panelSessions.is_active,
      username:    panelUsers.username,
      role:        panelUsers.role,
      tenant_id:   panelUsers.tenant_id,
      user_active: panelUsers.is_active,
    })
    .from(panelSessions)
    .innerJoin(panelUsers, eq(panelUsers.id, panelSessions.user_id))
    .where(eq(panelSessions.token_hash, tokenHash))
    .limit(1);

  const s = rows[0];
  if (!s || !s.is_active || new Date(s.expires_at) < new Date() || !s.user_active) {
    const err = new Error('Sesión inválida o expirada');
    err.status = 401;
    throw err;
  }

  await db.update(panelSessions)
    .set({ is_active: false, revoked_at: sql`NOW()`, revoke_reason: 'rotated' })
    .where(eq(panelSessions.id, s.id));

  const user   = { id: s.user_id, username: s.username, role: s.role, tenant_id: s.tenant_id };
  const tokens = await _createSession(user, ip, null);

  logger.info({ userId: user.id, oldSessionId: s.id }, '[Panel] Sesión rotada');

  return { ...tokens, user: { id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id } };
}

async function logout(refreshToken) {
  const db        = getDb();
  const tokenHash = _hmac(refreshToken);

  const rows = await db
    .select({ id: panelSessions.id, user_id: panelSessions.user_id })
    .from(panelSessions)
    .where(and(eq(panelSessions.token_hash, tokenHash), eq(panelSessions.is_active, true)))
    .limit(1);

  if (!rows[0]) return;

  await db.update(panelSessions)
    .set({ is_active: false, revoked_at: sql`NOW()`, revoke_reason: 'logout' })
    .where(eq(panelSessions.id, rows[0].id));

  logger.info({ userId: rows[0].user_id, sessionId: rows[0].id }, '[Panel] Logout');
}

async function logoutAll(userId) {
  const db = getDb();

  await db.update(panelSessions)
    .set({ is_active: false, revoked_at: sql`NOW()`, revoke_reason: 'logout_all' })
    .where(and(eq(panelSessions.user_id, userId), eq(panelSessions.is_active, true)));

  logger.info({ userId }, '[Panel] Logout all sessions');
}

async function validateAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, _jwtSecret());
  } catch {
    const e = new Error('Token inválido o expirado');
    e.status = 401;
    throw e;
  }

  const db   = getDb();
  const rows = await db
    .select({ id: panelSessions.id })
    .from(panelSessions)
    .where(
      and(
        eq(panelSessions.id, payload.sid),
        eq(panelSessions.is_active, true),
        sql`${panelSessions.expires_at} > NOW()`
      )
    )
    .limit(1);

  if (!rows[0]) {
    const err = new Error('Sesión revocada o expirada');
    err.status = 401;
    throw err;
  }

  return payload;
}

async function cleanExpiredSessions() {
  const db = getDb();

  const { rowCount: sessionsDeleted } = await db.execute(sql`
    DELETE FROM panel_sessions
    WHERE expires_at < NOW()
       OR (is_active = false AND revoked_at < NOW() - INTERVAL '7 days')
  `);

  const { rowCount: rateLimitsDeleted } = await db.execute(sql`
    DELETE FROM panel_rate_limits
    WHERE blocked_until IS NOT NULL AND blocked_until < NOW() - INTERVAL '1 hour'
  `);

  if (sessionsDeleted > 0 || rateLimitsDeleted > 0) {
    logger.info({ sessionsDeleted, rateLimitsDeleted }, '[Panel] Limpieza de sesiones expiradas');
  }
}

module.exports = { login, refresh, logout, logoutAll, validateAccessToken, cleanExpiredSessions };
