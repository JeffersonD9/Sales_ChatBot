/**
 * core/state/manager.js — Gestor de estado de conversaciones
 *
 * Arquitectura dual:
 *   L1 (RAM):        Map en proceso — lecturas en 0ms
 *   L2 (PostgreSQL): UPSERT en cada saveState — durabilidad en cada mensaje
 *
 * Clave de aislamiento multitenant: `{tenantSlug}:{waFrom}`
 * Esto garantiza que el mismo número de teléfono no comparte estado
 * entre dos tenants distintos.
 *
 * En DEMO_MODE o NODE_ENV=test: solo L1, sin DB.
 */

const { query }  = require('../../db');
const { logger } = require('../../utils/logger');

/** @type {Map<string, object>} L1 cache */
const sessions = new Map();

/**
 * Promesas en vuelo para getState: evita que dos mensajes simultáneos del
 * mismo usuario disparen dos queries a DB cuando ambos tienen cache miss.
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

// ── API pública ───────────────────────────────────────────────────────────

/**
 * Retorna el estado de la conversación. Si no existe, crea uno nuevo.
 * Primero busca en L1, luego en PostgreSQL.
 *
 * El mutex `pending` evita que dos mensajes simultáneos con cache miss
 * disparen queries duplicadas a DB para la misma sesión.
 *
 * @param {string} tenantSlug
 * @param {string} waFrom
 * @returns {Promise<object>}
 */
async function getState(tenantSlug, waFrom) {
  const key = _key(tenantSlug, waFrom);

  if (sessions.has(key)) return sessions.get(key);

  // Si hay un fetch en vuelo para esta misma clave, reusar la misma promesa
  if (pending.has(key)) return pending.get(key);

  if (!isDemo()) {
    const promise = (async () => {
      try {
        const result = await query(
          `SELECT step, data, shown_products, last_activity, reactivation_sent, created_at
           FROM sessions
           WHERE tenant_id = (SELECT id FROM tenants WHERE slug = $1)
             AND wa_from = $2`,
          [tenantSlug, waFrom]
        );

        if (result.rows[0]) {
          const row     = result.rows[0];
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

/**
 * Persiste el estado en L1 y en PostgreSQL (await — no fire-and-forget).
 * Garantiza que si el proceso cae después de responder al usuario, el estado
 * ya está en DB antes de que saveState retorne.
 *
 * @param {string} tenantSlug
 * @param {string} waFrom
 * @param {object} session
 */
async function saveState(tenantSlug, waFrom, session) {
  session.lastActivity     = Date.now();
  session.reactivationSent = false;

  const key = _key(tenantSlug, waFrom);
  sessions.set(key, session);

  if (isDemo()) return;

  try {
    await query(
      `INSERT INTO sessions
         (tenant_id, wa_from, step, data, shown_products, last_activity, reactivation_sent)
       VALUES (
         (SELECT id FROM tenants WHERE slug = $1),
         $2, $3, $4, $5, to_timestamp($6 / 1000.0), $7
       )
       ON CONFLICT (tenant_id, wa_from) DO UPDATE
       SET step              = $3,
           data              = $4,
           shown_products    = $5,
           last_activity     = to_timestamp($6 / 1000.0),
           reactivation_sent = $7`,
      [
        tenantSlug,
        waFrom,
        session.step,
        JSON.stringify(session.data),
        JSON.stringify(session.shownProducts),
        session.lastActivity,
        session.reactivationSent,
      ]
    );
  } catch (err) {
    logger.error({ tenantSlug, waFrom, err: err.message }, '[State] Error persistiendo sesión en DB');
  }
}

/**
 * Elimina el estado de una conversación.
 * @param {string} tenantSlug
 * @param {string} waFrom
 */
async function clearState(tenantSlug, waFrom) {
  const key = _key(tenantSlug, waFrom);
  sessions.delete(key);

  if (isDemo()) return;

  try {
    await query(
      `DELETE FROM sessions
       WHERE tenant_id = (SELECT id FROM tenants WHERE slug = $1)
         AND wa_from = $2`,
      [tenantSlug, waFrom]
    );
  } catch (err) {
    logger.error({ tenantSlug, waFrom, err: err.message }, '[State] Error eliminando sesión');
  }
}

/**
 * Retorna todas las sesiones del L1 (RAM) para un tenant dado.
 * Usado por el proceso de reactivación.
 *
 * @param {string} tenantSlug
 * @returns {object[]}
 */
function getActiveSessions(tenantSlug) {
  const prefix = `${tenantSlug}:`;
  const result = [];
  for (const [key, session] of sessions) {
    if (key.startsWith(prefix)) result.push(session);
  }
  return result;
}

/**
 * Limpia toda la memoria. Solo para uso en tests.
 * @internal
 */
function _resetForTest() {
  sessions.clear();
  pending.clear();
}

module.exports = { getState, saveState, clearState, getActiveSessions, _resetForTest };
