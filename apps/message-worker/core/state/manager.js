'use strict';

/**
 * core/state/manager.js — Gestor de estado de conversaciones
 *
 * Arquitectura dual:
 *   L1 (RAM):        Map en proceso — lecturas en 0ms
 *   L2 (PostgreSQL): UPSERT en cada saveState — durabilidad en cada mensaje
 *
 * Clave de aislamiento multitenant: `{tenantSlug}:{waFrom}`
 * Acceso DB: siempre vía getDbForTenant(tenantContext) → tenant DB.
 *
 * En DEMO_MODE o NODE_ENV=test: solo L1, sin DB.
 */

const { eq, and, sql } = require('drizzle-orm');
const platformData = require('../../../../packages/platform-data');
const { schema } = platformData;
const { logger }       = require('@whatsapp-saas/logger');

const { sessions: sessionsTable, tenants } = schema;

/** @type {Map<string, object>} L1 cache */
const sessions = new Map();
let dbOverride = null;

/**
 * Promesas en vuelo para getState: evita queries duplicadas ante mensajes
 * simultáneos del mismo usuario con cache miss.
 * @type {Map<string, Promise<object>>}
 */
const pending = new Map();

const isDemo = (tenantContext = null) => {
  if (dbOverride) return false;
  if (process.env.DEMO_MODE === 'true') return true;
  if (tenantContext?.tenantId || tenantContext?.dbAllocation) return false;
  return process.env.NODE_ENV === 'test' && process.env.DEMO_MODE !== 'false';
};

function _key(tenantSlug, waFrom) {
  return `${tenantSlug}:${waFrom}`;
}

function _tenantContext(input) {
  if (typeof input === 'string') {
    return { slug: input, tenantId: null, dbAllocation: null, legacyDb: true };
  }
  return {
    ...input,
    tenantId: input?.tenantId ?? input?.id ?? null,
    legacyDb: !input?.dbAllocation,
  };
}

function _dbForTenantContext(tenantContext) {
  if (dbOverride) return dbOverride;
  if (tenantContext.dbAllocation) {
    return platformData.tenantDb.getDbForTenant(tenantContext);
  }
  return platformData.drizzle.getDb();
}

function _resolveDbForTenantContext(tenantContext) {
  return _dbForTenantContext(tenantContext);
}

function _defaultSession(tenantContext, waFrom) {
  return {
    tenantSlug:       tenantContext.slug,
    waFrom,
    step:             'NEW',
    data:             {},
    shownProducts:    [],
    lastActivity:     Date.now(),
    reactivationSent: false,
    createdAt:        Date.now(),
  };
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * @param {object} tenantContext  Contrato completo del tenant (requiere .slug y .dbAllocation).
 * @param {string} waFrom         Número WhatsApp del usuario.
 */
async function getState(tenantContext, waFrom) {
  const tenant = _tenantContext(tenantContext);
  const key = _key(tenant.slug, waFrom);

  if (sessions.has(key)) return sessions.get(key);
  if (pending.has(key))  return pending.get(key);

  if (!isDemo(tenant)) {
    const promise = (async () => {
      try {
        const dbResult = _resolveDbForTenantContext(tenant);
        const db = dbOverride ? dbResult : await dbResult;
        const baseSelect = db
          .select({
            step:              sessionsTable.step,
            data:              sessionsTable.data,
            shown_products:    sessionsTable.shown_products,
            last_activity:     sessionsTable.last_activity,
            reactivation_sent: sessionsTable.reactivation_sent,
            created_at:        sessionsTable.created_at,
          })
          .from(sessionsTable);

        const rows = tenant.tenantId
          ? await baseSelect
            .where(and(
              eq(sessionsTable.tenant_id, tenant.tenantId),
              eq(sessionsTable.wa_from, waFrom),
            ))
            .limit(1)
          : await baseSelect
            .innerJoin(tenants, eq(tenants.id, sessionsTable.tenant_id))
            .where(and(eq(tenants.slug, tenant.slug), eq(sessionsTable.wa_from, waFrom)))
            .limit(1);

        if (rows[0]) {
          const row     = rows[0];
          const session = {
            tenantSlug:       tenant.slug,
            waFrom,
            step:             row.step,
            data:             row.data || {},
            shownProducts:    row.shown_products || [],
            lastActivity:     new Date(row.last_activity).getTime(),
            reactivationSent: row.reactivation_sent || false,
            createdAt:        new Date(row.created_at).getTime(),
          };
          sessions.set(key, session);
          return session;
        }
      } catch (err) {
        logger.error({ tenantSlug: tenant.slug, waFrom, err: err.message }, '[State] Error leyendo sesión de DB');
      } finally {
        pending.delete(key);
      }

      const session = _defaultSession(tenant, waFrom);
      sessions.set(key, session);
      return session;
    })();

    pending.set(key, promise);
    return promise;
  }

  const session = _defaultSession(tenant, waFrom);
  sessions.set(key, session);
  return session;
}

async function saveState(tenantContext, waFrom, session) {
  const tenant = _tenantContext(tenantContext);
  session.lastActivity     = Date.now();
  session.reactivationSent = false;

  const key = _key(tenant.slug, waFrom);
  sessions.set(key, session);

  if (isDemo(tenant)) return;

  try {
    const dbResult = _resolveDbForTenantContext(tenant);
    const db = dbOverride ? dbResult : await dbResult;
    const tenantIdSql = tenant.tenantId
      ? sql`${tenant.tenantId}::uuid`
      : sql`(SELECT id FROM tenants WHERE slug = ${tenant.slug})`;

    await db.execute(sql`
        INSERT INTO sessions
          (tenant_id, wa_from, step, data, shown_products, last_activity, reactivation_sent)
        VALUES (
          ${tenantIdSql},
          ${waFrom},
          ${session.step},
          ${JSON.stringify(session.data)}::jsonb,
          ${JSON.stringify(session.shownProducts)}::jsonb,
          to_timestamp(${session.lastActivity} / 1000.0),
          ${session.reactivationSent}
        )
        ON CONFLICT (tenant_id, wa_from) DO UPDATE SET
          step              = ${session.step},
          data              = ${JSON.stringify(session.data)}::jsonb,
          shown_products    = ${JSON.stringify(session.shownProducts)}::jsonb,
          last_activity     = to_timestamp(${session.lastActivity} / 1000.0),
          reactivation_sent = ${session.reactivationSent}
      `);
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, waFrom, err: err.message }, '[State] Error persistiendo sesión en DB');
  }
}

async function clearState(tenantContext, waFrom) {
  const tenant = _tenantContext(tenantContext);
  const key = _key(tenant.slug, waFrom);
  sessions.delete(key);

  if (isDemo(tenant)) return;

  try {
    const dbResult = _resolveDbForTenantContext(tenant);
    const db = dbOverride ? dbResult : await dbResult;
    const tenantPredicate = tenant.tenantId
      ? sql`tenant_id = ${tenant.tenantId}::uuid`
      : sql`tenant_id = (SELECT id FROM tenants WHERE slug = ${tenant.slug})`;

    await db.execute(sql`
        DELETE FROM sessions
        WHERE ${tenantPredicate}
          AND wa_from = ${waFrom}
      `);
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, waFrom, err: err.message }, '[State] Error eliminando sesión');
  }
}

function getActiveSessions(tenantSlug) {
  const prefix = `${tenantSlug}:`;
  const result = [];
  for (const [key, session] of sessions) {
    if (key.startsWith(prefix)) result.push(session);
  }
  return result;
}

/** Solo para uso en tests. */
function _resetForTest() {
  sessions.clear();
  pending.clear();
  dbOverride = null;
}

function _setDbForTest(db) {
  dbOverride = db;
}

module.exports = { getState, saveState, clearState, getActiveSessions, _resetForTest, _setDbForTest };
