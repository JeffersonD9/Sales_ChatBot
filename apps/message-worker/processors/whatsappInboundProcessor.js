import { LRUCache } from 'lru-cache';
import { QUEUES } from '@whatsapp-saas/queues/names.js';
import * as directQueue from '@whatsapp-saas/queues/directQueue.js';
import * as bullmqQueue from '@whatsapp-saas/queues/bullmqQueue.js';
import { isBullMQMode } from '@whatsapp-saas/queues/mode.js';
import platformData from '../../../packages/platform-data/index.js';
import stateManager from '../core/state/manager.js';
import { createRequire } from 'module';
import notifier from '@whatsapp-saas/notifications';
import loggerModule from '@whatsapp-saas/logger';

const require = createRequire(import.meta.url);
const { getFlow }       = require('../core/flows/index.js');
const { buildServices } = require('../core/ai/services.js');

const tenantLoader = platformData.tenantLoader;
const { getState, saveState } = stateManager;
const { logger } = loggerModule;

// Idempotencia: evita procesar el mismo mensaje dos veces
// LRU con TTL de 24h — sobrevive reinicios de cola pero no de proceso
const processedIds = new LRUCache({
  max: 10_000,
  ttl: 24 * 60 * 60 * 1000,
});

async function dispatch(tenantSlug, webhookBody) {
  if (webhookBody.object !== 'whatsapp_business_account') return;

  const tenant = await tenantLoader.get(tenantSlug);
  if (!tenant) {
    logger.warn({ tenantSlug }, '[Processor] Tenant no encontrado — mensaje ignorado');
    return;
  }

  for (const entry of webhookBody.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;

      for (const message of change.value?.messages || []) {
        const waFrom = message.from;
        const msgId  = message.id;

        if (msgId && processedIds.has(msgId)) {
          logger.debug({ tenantSlug, waFrom, msgId }, '[Processor] Mensaje duplicado ignorado');
          continue;
        }
        if (msgId) processedIds.set(msgId, 1);

        logger.info({ tenantSlug, waFrom, type: message.type }, '[Processor] Mensaje recibido');

        try {
          const session  = await getState(tenant, waFrom);
          const flowType = tenant.bot_config?.flow_type ?? tenant.botConfig?.flow_type;
          const { engine, aiCapabilities } = getFlow(flowType);
          // Shim: flujos legacy usan bot_config/wa_token/phone_number_id (snake_case)
          const tenantForFlows = {
            ...tenant,
            bot_config:      tenant.bot_config      ?? tenant.botConfig,
            wa_token:        tenant.wa_token        ?? tenant.whatsapp?.token,
            phone_number_id: tenant.phone_number_id ?? tenant.whatsapp?.phoneNumberId,
          };
          const services = buildServices(tenantForFlows, aiCapabilities);
          await engine.processMessage(waFrom, message, session, tenantForFlows, notifier, services);
          await saveState(tenant, waFrom, session);
        } catch (err) {
          logger.error({ tenantSlug, waFrom, err: err.message }, '[Processor] Error procesando mensaje');
        }
      }
    }
  }
}

export async function processWhatsAppInbound(job) {
  const { tenantSlug, webhookBody } = job.data || {};
  if (!tenantSlug || !webhookBody) {
    throw new Error('Job whatsapp.inbound invalido');
  }
  await dispatch(tenantSlug, webhookBody);
}

export function registerWhatsAppInboundProcessor() {
  if (isBullMQMode()) {
    return bullmqQueue.registerProcessor(QUEUES.WHATSAPP_INBOUND, processWhatsAppInbound);
  }
  directQueue.registerProcessor(QUEUES.WHATSAPP_INBOUND, processWhatsAppInbound);
}
