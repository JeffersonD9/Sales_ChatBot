'use strict';

// CRUD de tenant_whatsapp_config con caché Redis (TTL 5 min)
const { getPool }           = require('../db');
const { getRedis }          = require('../redis');
const { validateBotConfig } = require('../utils/botConfigSchema');
const { logger }            = require('../utils/logger');

const CACHE_TTL = 300;
const cacheKey  = (id) => `wa:config:${id}`;

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function fromCache(tenantId) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(cacheKey(tenantId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn({ tenantId, err: err.message }, '[ConfigRepo] Redis GET falló');
    return null;
  }
}

async function toCache(tenantId, config) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(cacheKey(tenantId), JSON.stringify(config), 'EX', CACHE_TTL);
  } catch (err) {
    logger.warn({ tenantId, err: err.message }, '[ConfigRepo] Redis SET falló');
  }
}

async function bustCache(tenantId) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(cacheKey(tenantId));
  } catch (err) {
    logger.warn({ tenantId, err: err.message }, '[ConfigRepo] Redis DEL falló');
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function fromDB(tenantId) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);
    const { rows } = await client.query(
      `SELECT
         tenant_id,
         pgp_sym_decrypt(session_data, $2)   AS session_data,
         bot_config,
         pgp_sym_decrypt(webhook_secret, $2) AS webhook_secret,
         is_active, created_at, updated_at
       FROM tenant_whatsapp_config
       WHERE tenant_id = $1`,
      [tenantId, process.env.APP_SECRET]
    );
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ tenantId, err: err.message }, '[ConfigRepo] Error leyendo DB');
    throw err;
  } finally {
    client.release();
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

async function getConfig(tenantId) {
  const cached = await fromCache(tenantId);
  if (cached) return cached;

  const config = await fromDB(tenantId);
  if (config) await toCache(tenantId, config);
  return config;
}

async function saveConfig(tenantId, { session_data, bot_config, webhook_secret, is_active }) {
  const validatedBotConfig = bot_config !== undefined ? validateBotConfig(bot_config) : undefined;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);
    const { rows } = await client.query(
      `INSERT INTO tenant_whatsapp_config
         (tenant_id, session_data, bot_config, webhook_secret, is_active)
       VALUES (
         $1,
         CASE WHEN $2::TEXT IS NOT NULL THEN pgp_sym_encrypt($2, $5) ELSE NULL END,
         COALESCE($3::jsonb, '{}'),
         CASE WHEN $4::TEXT IS NOT NULL THEN pgp_sym_encrypt($4, $5) ELSE NULL END,
         COALESCE($6, true)
       )
       ON CONFLICT (tenant_id) DO UPDATE SET
         session_data   = CASE WHEN $2::TEXT IS NOT NULL THEN pgp_sym_encrypt($2, $5)
                               ELSE tenant_whatsapp_config.session_data END,
         bot_config     = COALESCE($3::jsonb, tenant_whatsapp_config.bot_config),
         webhook_secret = CASE WHEN $4::TEXT IS NOT NULL THEN pgp_sym_encrypt($4, $5)
                               ELSE tenant_whatsapp_config.webhook_secret END,
         is_active      = COALESCE($6, tenant_whatsapp_config.is_active)
       RETURNING tenant_id, bot_config, is_active, created_at, updated_at`,
      [
        tenantId,
        session_data   ?? null,
        validatedBotConfig ? JSON.stringify(validatedBotConfig) : null,
        webhook_secret ?? null,
        process.env.APP_SECRET,
        is_active      ?? null,
      ]
    );
    await client.query('COMMIT');
    await bustCache(tenantId);
    logger.info({ tenantId }, '[ConfigRepo] Config guardada');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ tenantId, err: err.message }, '[ConfigRepo] Error guardando en DB');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteConfig(tenantId) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);
    const { rowCount } = await client.query(
      'DELETE FROM tenant_whatsapp_config WHERE tenant_id = $1',
      [tenantId]
    );
    await client.query('COMMIT');
    await bustCache(tenantId);
    logger.info({ tenantId, deleted: rowCount > 0 }, '[ConfigRepo] Config eliminada');
    return rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ tenantId, err: err.message }, '[ConfigRepo] Error eliminando de DB');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getConfig, saveConfig, deleteConfig };
