import { QUEUES } from '@whatsapp-saas/queues/names.js';
import * as bullmqQueue from '@whatsapp-saas/queues/bullmqQueue.js';
import aiHandlerModule from '../core/aiHandler.js';

const { handleWithAILocally } = aiHandlerModule;

export async function processAIRequest(job) {
  const { phone, text, session, tenant } = job.data || {};

  if (!phone || !tenant || !session) {
    throw new Error('Job ai.requests invalido');
  }

  const reply = await handleWithAILocally(phone, text, session, tenant);
  return {
    reply,
    aiHistory: session.data?.aiHistory || [],
  };
}

export function registerAIRequestsProcessor() {
  return bullmqQueue.registerProcessor(QUEUES.AI_REQUESTS, processAIRequest, {
    concurrency: process.env.AI_QUEUE_CONCURRENCY || process.env.QUEUE_CONCURRENCY || '2',
  });
}
