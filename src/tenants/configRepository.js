'use strict';

// CRUD de tenant_whatsapp_config con caché Redis (TTL 5 min)
// Las operaciones con pgp_sym_encrypt/decrypt usan sql`` raw de Drizzle —
// no existe helper ORM para funciones pgcrypto.
const { sql, eq }           = require('drizzle-orm');
const { getDb }             = require('../drizzle/db');
const { tenantWhatsappConfig } = require('../drizzle/schema');
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
  const db = getDb();
  try {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);
      return tx.execute(sql`
        SELECT
          tenant_id,
          pgp_sym_decrypt(session_data, ${process.env.APP_SECRET})   AS session_data,
          bot_config,
          pgp_sym_decrypt(webhook_secret, ${process.env.APP_SECRET}) AS webhook_secret,
          is_active, created_at, updated_at
        FROM tenant_whatsapp_config
        WHERE tenant_id = ${tenantId}::uuid
      `);
    });
    return rows.rows[0] || null;
  } catch (err) {
    logger.error({ tenantId, err: err.message }, '[ConfigRepo] Error leyendo DB');
    throw err;
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
  const db = getDb();
  const validatedBotConfig = bot_config !== undefined ? validateBotConfig(bot_config) : undefined;
  const secret = process.env.APP_SECRET;

  try {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);
      return tx.execute(sql`
        INSERT INTO tenant_whatsapp_config
          (tenant_id, session_data, bot_config, webhook_secret, is_active)
        VALUES (
          ${tenantId}::uuid,
          ${session_data != null ? sql`pgp_sym_encrypt(${session_data}, ${secret})` : sql`NULL`},
          ${validatedBotConfig ? JSON.stringify(validatedBotConfig) : '{}'}::jsonb,
          ${webhook_secret != null ? sql`pgp_sym_encrypt(${webhook_secret}, ${secret})` : sql`NULL`},
          ${is_active ?? true}
        )
        ON CONFLICT (tenant_id) DO UPDATE SET
          session_data   = ${session_data != null
            ? sql`pgp_sym_encrypt(${session_data}, ${secret})`
            : sql`tenant_whatsapp_config.session_data`},
          bot_config     = ${validatedBotConfig
            ? sql`${JSON.stringify(validatedBotConfig)}::jsonb`
            : sql`tenant_whatsapp_config.bot_config`},
          webhook_secret = ${webhook_secret != null
            ? sql`pgp_sym_encrypt(${webhook_secret}, ${secret})`
            : sql`tenant_whatsapp_config.webhook_secret`},
          is_active      = ${is_active ?? sql`tenant_whatsapp_config.is_active`}
        RETURNING tenant_id, bot_config, is_active, created_at, updated_at
      `);
    });
    await bustCache(tenantId);
    logger.info({ tenantId }, '[ConfigRepo] Config guardada');
    return rows.rows[0];
  } catch (err) {
    logger.error({ tenantId, err: err.message }, '[ConfigRepo] Error guardando en DB');
    throw err;
  }
}

async function deleteConfig(tenantId) {
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);
      return tx.delete(tenantWhatsappConfig)
        .where(eq(tenantWhatsappConfig.tenant_id, tenantId));
    });
    await bustCache(tenantId);
    const deleted = result.rowCount > 0;
    logger.info({ tenantId, deleted }, '[ConfigRepo] Config eliminada');
    return deleted;
  } catch (err) {
    logger.error({ tenantId, err: err.message }, '[ConfigRepo] Error eliminando de DB');
    throw err;
  }
}

module.exports = { getConfig, saveConfig, deleteConfig };
