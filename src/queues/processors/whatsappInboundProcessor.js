import { QUEUES } from '../names.js';
import * as directQueue from '../directQueue.js';
import * as bullmqQueue from '../bullmqQueue.js';
import { isBullMQMode } from '../mode.js';
import { dispatch } from '../../services/whatsapp/ingestion/dispatcher.js';

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
