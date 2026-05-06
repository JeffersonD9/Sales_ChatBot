'use strict';

/**
 * core/state/manager.js — Gestor de estado de conversaciones
 *
 * Arquitectura dual:
 *   L1 (RAM):        Map en proceso — lecturas en 0ms
 *   L2 (PostgreSQL): UPSERT en cada saveState — durabilidad en cada mensaje
 *
 * Clave de aislamiento multitenant: `{tenantSlug}:{waFrom}`
 *
 * En DEMO_MODE o NODE_ENV=test: solo L1, sin DB.
 */

const { eq, and, sql } = require('drizzle-orm');
const { getDb }        = require('../../drizzle/db');
const { sessions: sessionsTable, tenants } = require('../../drizzle/schema');
const { logger }       = require('../../utils/logger');

/** @type {Map<string, object>} L1 cache */
const sessions = new Map();

/**
 * Promesas en vuelo para getState: evita queries duplicadas ante mensajes
 * simultáneos del mismo usuario con cache miss.
 * @type {Map<string, Promise<object>>}
 */
const pending = new Map();

const isDemo = () => process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'test';

function _key(tenantSlug, waFrom) {
  return `${tenantSlug}:${waFrom}`;
}

function _defaultSession(tenantSlug, waFrom) {
  return {
    tenantSlug,
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

async function getState(tenantSlug, waFrom) {
  const key = _key(tenantSlug, waFrom);

  if (sessions.has(key)) return sessions.get(key);
  if (pending.has(key))  return pending.get(key);

  if (!isDemo()) {
    const promise = (async () => {
      try {
        const db   = getDb();
        const rows = await db
          .select({
            step:             sessionsTable.step,
            data:             sessionsTable.data,
            shown_products:   sessionsTable.shown_products,
            last_activity:    sessionsTable.last_activity,
            reactivation_sent: sessionsTable.reactivation_sent,
            created_at:       sessionsTable.created_at,
          })
          .from(sessionsTable)
          .innerJoin(tenants, eq(tenants.id, sessionsTable.tenant_id))
          .where(and(eq(tenants.slug, tenantSlug), eq(sessionsTable.wa_from, waFrom)))
          .limit(1);

        if (rows[0]) {
          const row     = rows[0];
          const session = {
            tenantSlug,
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
        logger.error({ tenantSlug, waFrom, err: err.message }, '[State] Error leyendo sesión de DB');
      } finally {
        pending.delete(key);
      }

      const session = _defaultSession(tenantSlug, waFrom);
      sessions.set(key, session);
      return session;
    })();

    pending.set(key, promise);
    return promise;
  }

  const session = _defaultSession(tenantSlug, waFrom);
  sessions.set(key, session);
  return session;
}

async function saveState(tenantSlug, waFrom, session) {
  session.lastActivity     = Date.now();
  session.reactivationSent = false;

  const key = _key(tenantSlug, waFrom);
  sessions.set(key, session);

  if (isDemo()) return;

  try {
    const db = getDb();
    await db.execute(sql`
      INSERT INTO sessions
        (tenant_id, wa_from, step, data, shown_products, last_activity, reactivation_sent)
      VALUES (
        (SELECT id FROM tenants WHERE slug = ${tenantSlug}),
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
    logger.error({ tenantSlug, waFrom, err: err.message }, '[State] Error persistiendo sesión en DB');
  }
}

async function clearState(tenantSlug, waFrom) {
  const key = _key(tenantSlug, waFrom);
  sessions.delete(key);

  if (isDemo()) return;

  try {
    const db = getDb();
    await db.execute(sql`
      DELETE FROM sessions
      WHERE tenant_id = (SELECT id FROM tenants WHERE slug = ${tenantSlug})
        AND wa_from = ${waFrom}
    `);
  } catch (err) {
    logger.error({ tenantSlug, waFrom, err: err.message }, '[State] Error eliminando sesión');
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
}

module.exports = { getState, saveState, clearState, getActiveSessions, _resetForTest };
