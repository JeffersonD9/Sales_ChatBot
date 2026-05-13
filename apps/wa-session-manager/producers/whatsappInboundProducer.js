import { QUEUES } from '@whatsapp-saas/queues/names.js';
import * as directQueue from '@whatsapp-saas/queues/directQueue.js';
import * as bullmqQueue from '@whatsapp-saas/queues/bullmqQueue.js';
import { isBullMQMode } from '@whatsapp-saas/queues/mode.js';

export async function enqueueInboundWebhook(tenantSlug, webhookBody) {
  const payload = {
    tenantSlug,
    webhookBody,
    receivedAt: new Date().toISOString(),
  };

  if (isBullMQMode()) {
    return bullmqQueue.enqueue(QUEUES.WHATSAPP_INBOUND, payload, {
      name: 'whatsapp.inbound.webhook',
      jobId: webhookBody?.entry?.[0]?.id,
    });
  }

  return directQueue.enqueue(QUEUES.WHATSAPP_INBOUND, payload, {
    name: 'whatsapp.inbound.webhook',
    jobId: webhookBody?.entry?.[0]?.id,
  });
}
