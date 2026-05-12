import { QUEUES } from '../names.js';
import * as directQueue from '../directQueue.js';
import * as bullmqQueue from '../bullmqQueue.js';
import { getQueueMode, isBullMQMode, isDirectQueueMode } from '../mode.js';
import { dispatch } from '../../services/whatsapp/ingestion/dispatcher.js';

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

  if (isDirectQueueMode()) {
    return directQueue.enqueue(QUEUES.WHATSAPP_INBOUND, payload, {
      name: 'whatsapp.inbound.webhook',
      jobId: webhookBody?.entry?.[0]?.id,
    });
  }

  await dispatch(tenantSlug, webhookBody);
  return {
    id: null,
    name: 'whatsapp.inbound.direct',
    mode: getQueueMode(),
    data: payload,
  };
}
