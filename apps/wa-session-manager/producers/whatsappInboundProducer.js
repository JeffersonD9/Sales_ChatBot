import { QUEUES } from '@whatsapp-saas/queues/names.js';
import * as directQueue from '@whatsapp-saas/queues/directQueue.js';
import * as bullmqQueue from '@whatsapp-saas/queues/bullmqQueue.js';
import { isBullMQMode } from '@whatsapp-saas/queues/mode.js';

function inboundJobId(tenantSlug, webhookBody) {
  const ids = [];

  for (const entry of webhookBody?.entry || []) {
    for (const change of entry.changes || []) {
      for (const message of change.value?.messages || []) {
        if (message.id) ids.push(message.id);
      }
    }
  }

  if (ids.length > 0) {
    return `wa:${tenantSlug}:${ids.join(':')}`;
  }

  const entryId = webhookBody?.entry?.[0]?.id || 'unknown';
  return `wa:${tenantSlug}:${entryId}:${Date.now()}`;
}

export async function enqueueInboundWebhook(tenantSlug, webhookBody) {
  const payload = {
    tenantSlug,
    webhookBody,
    receivedAt: new Date().toISOString(),
  };

  if (isBullMQMode()) {
    return bullmqQueue.enqueue(QUEUES.WHATSAPP_INBOUND, payload, {
      name: 'whatsapp.inbound.webhook',
      jobId: inboundJobId(tenantSlug, webhookBody),
    });
  }

  return directQueue.enqueue(QUEUES.WHATSAPP_INBOUND, payload, {
    name: 'whatsapp.inbound.webhook',
    jobId: inboundJobId(tenantSlug, webhookBody),
  });
}
