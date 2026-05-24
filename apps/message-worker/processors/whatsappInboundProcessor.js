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
const { extractInput }  = require('../core/whatsapp/parser.js');
const { sendText }      = require('../core/whatsapp/sender.js');
const antiBanGuard      = require('../../../packages/platform-data/src/integrations/whatsapp/antiBanGuard.js');

const tenantLoader = platformData.tenantLoader;
const { getState, saveState } = stateManager;
const { logger } = loggerModule;

// Idempotencia: evita procesar el mismo mensaje dos veces.
const processedIds = new LRUCache({
  max: 10_000,
  ttl: 24 * 60 * 60 * 1000,
});

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function msSince(isoDate) {
  const parsed = Date.parse(isoDate);
  return Number.isNaN(parsed) ? null : Date.now() - parsed;
}

function templateSignalFromStatus(status) {
  const type = String(status.type || '').toLowerCase();
  const rawEvent = status.event || status.status || status.reason;
  const event = String(rawEvent || '').toUpperCase();

  if (type.includes('template') || [
    'APPROVED',
    'REJECTED',
    'PAUSED',
    'DISABLED',
    'FLAGGED',
    'PENDING',
    'LIMIT_EXCEEDED',
    'LOCKED',
    'REINSTATED',
  ].includes(event)) {
    return event || type.toUpperCase();
  }

  return null;
}

async function processWebhookStatuses({ tenantSlug, tenant, statuses = [], summary }) {
  for (const status of statuses) {
    summary.statusesProcessed += 1;

    const templateSignal = templateSignalFromStatus(status);
    if (templateSignal) {
      summary.templateSignals += 1;
      const level = ['REJECTED', 'PAUSED', 'DISABLED', 'FLAGGED', 'LIMIT_EXCEEDED'].includes(templateSignal)
        ? 'warn'
        : 'info';
      logger[level]({
        metric: 'worker.webhook.template_signal',
        tenantSlug,
        templateName: status.template_name || status.templateName || status.name,
        templateId: status.template_id || status.templateId,
        language: status.template_language || status.language,
        signal: templateSignal,
        reason: status.reason,
        description: status.description || status.information,
      }, '[Processor] Senal de template recibida por webhook');
    }

    if (status.status === 'failed' && status.errors?.length) {
      const phone = status.recipient_id || status.recipientId || 'unknown';
      const err = { response: { data: { error: status.errors[0] } } };
      const action = await antiBanGuard.handleApiError(err, tenant, phone);
      logger.warn({
        metric: 'worker.webhook.status_failed',
        tenantSlug,
        phone,
        messageId: status.id,
        code: status.errors[0]?.code,
        antiBanAction: action?.action,
      }, '[Processor] Status failed procesado desde webhook');
    }
  }
}

async function dispatch(tenantSlug, webhookBody) {
  const summary = {
    messagesTotal: 0,
    messagesProcessed: 0,
    messagesDuplicated: 0,
    messagesFailed: 0,
    statusesProcessed: 0,
    templateSignals: 0,
  };

  if (webhookBody.object !== 'whatsapp_business_account') return summary;

  const tenant = await tenantLoader.get(tenantSlug);
  if (!tenant) {
    logger.warn({ tenantSlug }, '[Processor] Tenant no encontrado - mensaje ignorado');
    return summary;
  }

  for (const entry of webhookBody.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') {
        await processWebhookStatuses({
          tenantSlug,
          tenant,
          statuses: change.value ? [{ ...change.value, type: change.field }] : [],
          summary,
        });
        continue;
      }

      await processWebhookStatuses({
        tenantSlug,
        tenant,
        statuses: change.value?.statuses || [],
        summary,
      });

      for (const message of change.value?.messages || []) {
        const startedAt = process.hrtime.bigint();
        const waFrom = message.from;
        const msgId  = message.id;
        summary.messagesTotal += 1;

        if (msgId && processedIds.has(msgId)) {
          summary.messagesDuplicated += 1;
          logger.info({
            metric: 'worker.message.duplicated',
            tenantSlug,
            waFrom,
            msgId,
            type: message.type,
          }, '[Processor] Mensaje duplicado ignorado');
          continue;
        }
        if (msgId) processedIds.set(msgId, 1);

        logger.info({
          metric: 'worker.message.received',
          tenantSlug,
          waFrom,
          msgId,
          type: message.type,
        }, '[Processor] Mensaje recibido');

        try {
          const tenantForFlows = {
            ...tenant,
            bot_config:      tenant.bot_config      ?? tenant.botConfig,
            wa_token:        tenant.wa_token        ?? tenant.whatsapp?.token,
            phone_number_id: tenant.phone_number_id ?? tenant.whatsapp?.phoneNumberId,
          };
          const parsed = extractInput(message);
          const antiBanInbound = await antiBanGuard.handleInboundMessage(tenantForFlows, waFrom, parsed.text || '');

          if (antiBanInbound.optOut) {
            await sendText(
              waFrom,
              'Listo, no te enviaremos mas mensajes por WhatsApp. Si necesitas ayuda, puedes escribirnos de nuevo cuando quieras.',
              tenantForFlows,
              { antiBanBypass: true }
            );
            summary.messagesProcessed += 1;
            logger.info({
              metric: 'worker.message.opt_out',
              tenantSlug,
              waFrom,
              msgId,
            }, '[Processor] Opt-out procesado');
            continue;
          }

          const session  = await getState(tenant, waFrom);
          if (antiBanInbound.asksForHuman) {
            session.data = { ...(session.data || {}), escalated: true, humanRequestedAt: new Date().toISOString() };
          }

          const flowType = tenant.bot_config?.flow_type ?? tenant.botConfig?.flow_type;
          const { engine, aiCapabilities } = getFlow(flowType);
          const services = buildServices(tenantForFlows, aiCapabilities);
          await engine.processMessage(waFrom, message, session, tenantForFlows, notifier, services);
          await saveState(tenant, waFrom, session);
          summary.messagesProcessed += 1;
          logger.info({
            metric: 'worker.message.processed',
            tenantSlug,
            waFrom,
            msgId,
            type: message.type,
            flowType: flowType || 'default',
            durationMs: Math.round(elapsedMs(startedAt)),
          }, '[Processor] Mensaje procesado');
        } catch (err) {
          summary.messagesFailed += 1;
          logger.error({
            metric: 'worker.message.failed',
            tenantSlug,
            waFrom,
            msgId,
            type: message.type,
            durationMs: Math.round(elapsedMs(startedAt)),
            err: err.message,
          }, '[Processor] Error procesando mensaje');
        }
      }
    }
  }

  return summary;
}

export async function processWhatsAppInbound(job) {
  const startedAt = process.hrtime.bigint();
  const { tenantSlug, webhookBody } = job.data || {};
  if (!tenantSlug || !webhookBody) {
    throw new Error('Job whatsapp.inbound invalido');
  }

  logger.info({
    metric: 'worker.inbound.job.started',
    tenantSlug,
    jobId: job.id,
    queueWaitMs: msSince(job.data.receivedAt),
  }, '[Processor] Job inbound iniciado');

  const summary = await dispatch(tenantSlug, webhookBody);

  logger.info({
    metric: 'worker.inbound.job.completed',
    tenantSlug,
    jobId: job.id,
    queueWaitMs: msSince(job.data.receivedAt),
    durationMs: Math.round(elapsedMs(startedAt)),
    ...summary,
  }, '[Processor] Job inbound completado');
}

export function registerWhatsAppInboundProcessor() {
  if (isBullMQMode()) {
    return bullmqQueue.registerProcessor(QUEUES.WHATSAPP_INBOUND, processWhatsAppInbound);
  }
  directQueue.registerProcessor(QUEUES.WHATSAPP_INBOUND, processWhatsAppInbound);
}
