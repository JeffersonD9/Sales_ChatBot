'use strict';

const { LRUCache } = require('lru-cache');
const tenantLoader = require('../platform/tenancy/loader');
const { getState, saveState } = require('../core/state/manager');
const { processMessage } = require('../core/flow-engine/engine');
const notifier = require('../notifications/notifier');
const { logger } = require('../utils/logger');

const processedIds = new LRUCache({
  max: 10_000,
  ttl: 24 * 60 * 60 * 1000,
});

function markProcessed(msgId) {
  processedIds.set(msgId, 1);
}

async function dispatch(tenantSlug, webhookBody) {
  if (webhookBody.object !== 'whatsapp_business_account') return;

  const tenant = await tenantLoader.get(tenantSlug);
  if (!tenant) {
    logger.warn({ tenantSlug }, '[Dispatcher] Tenant no encontrado - mensaje ignorado');
    return;
  }

  for (const entry of webhookBody.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;

      for (const message of change.value?.messages || []) {
        const waFrom = message.from;
        const msgId = message.id;

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
