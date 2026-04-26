/**
 * webhooks/dispatcher.js — Despacha mensajes al flow engine del tenant correcto
 *
 * Flujo:
 *   1. Extraer tenantSlug y mensajes del body de Meta
 *   2. Cargar tenant desde loader (cache o DB)
 *   3. Para cada mensaje: cargar sesión → procesar → guardar sesión
 *
 * La idempotencia se maneja con un Set en memoria de IDs procesados.
 * TTL: 24 horas (suficiente para el retry window de Meta).
 */

const tenantLoader               = require('../tenants/loader');
const { getState, saveState }    = require('../core/state/manager');
const { processMessage }         = require('../core/flow-engine/engine');
const notifier                   = require('../notifications/notifier');
const { logger }                 = require('../utils/logger');

// ── Idempotencia: evita procesar el mismo mensaje dos veces ───────────────
const processedIds  = new Set();
const PROCESSED_TTL = 24 * 60 * 60 * 1000; // 24h

function markProcessed(msgId) {
  processedIds.add(msgId);
  setTimeout(() => processedIds.delete(msgId), PROCESSED_TTL);
}

// ── Dispatch principal ────────────────────────────────────────────────────

/**
 * @param {string} tenantSlug
 * @param {object} webhookBody  - Body completo del POST de Meta
 */
async function dispatch(tenantSlug, webhookBody) {
  if (webhookBody.object !== 'whatsapp_business_account') return;

  const tenant = await tenantLoader.get(tenantSlug);
  if (!tenant) {
    logger.warn({ tenantSlug }, '[Dispatcher] Tenant no encontrado — mensaje ignorado');
    return;
  }

  for (const entry of webhookBody.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;

      for (const message of change.value?.messages || []) {
        const waFrom = message.from;
        const msgId  = message.id;

        // Idempotencia: Meta puede enviar el mismo webhook más de una vez
        if (msgId && processedIds.has(msgId)) {
          logger.debug({ tenantSlug, waFrom, msgId }, '[Dispatcher] Mensaje duplicado ignorado');
          continue;
        }
        if (msgId) markProcessed(msgId);

        logger.info({ tenantSlug, waFrom, type: message.type }, '[Dispatcher] Mensaje recibido');

        try {
          const session = await getState(tenantSlug, waFrom);
          await processMessage(waFrom, message, session, tenant, notifier);
          await saveState(tenantSlug, waFrom, session);
        } catch (err) {
          logger.error({ tenantSlug, waFrom, err: err.message }, '[Dispatcher] Error procesando mensaje');
        }
      }
    }
  }
}

module.exports = { dispatch };
