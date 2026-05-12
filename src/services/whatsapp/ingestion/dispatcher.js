/**
 * webhooks/dispatcher.js — Despacha mensajes al flow engine del tenant correcto
 *
 * Flujo:
 *   1. Extraer tenantSlug y mensajes del body de Meta
 *   2. Cargar tenant desde loader (cache o DB)
 *   3. Para cada mensaje: cargar sesión → procesar → guardar sesión
 *
 * La idempotencia se maneja con un LRU cache de IDs procesados (máx 10k entradas,
 * TTL 24h). Reemplaza el Set+setTimeout anterior que crecía sin límite bajo carga.
 */

import { LRUCache } from 'lru-cache';
import tenantLoader from '../../../platform/tenancy/loader.js';
import stateManager from '../../../core/state/manager.js';
import flowEngine from '../../../core/flow-engine/engine.js';
import notifier from '../../../notifications/notifier.js';
import loggerModule from '../../../utils/logger.js';

const { getState, saveState } = stateManager;
const { processMessage } = flowEngine;
const { logger } = loggerModule;

// ── Idempotencia: evita procesar el mismo mensaje dos veces ───────────────
const processedIds = new LRUCache({
  max: 10_000,
  ttl: 24 * 60 * 60 * 1000, // 24h
});

function markProcessed(msgId) {
  processedIds.set(msgId, 1);
}

// ── Dispatch principal ────────────────────────────────────────────────────

/**
 * @param {string} tenantSlug
 * @param {object} webhookBody  - Body completo del POST de Meta
 */
export async function dispatch(tenantSlug, webhookBody) {
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
