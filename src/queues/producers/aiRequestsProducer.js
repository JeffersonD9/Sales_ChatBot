import { QUEUES } from '../names.js';
import * as bullmqQueue from '../bullmqQueue.js';

function aiRequestJobId(payload) {
  const tenantSlug = payload?.tenant?.slug || 'tenant';
  const phone = payload?.phone || 'phone';
  return `ai:${tenantSlug}:${phone}:${Date.now()}`;
}

export async function enqueueAIRequest(payload) {
  return bullmqQueue.enqueue(QUEUES.AI_REQUESTS, payload, {
    name: 'ai.request',
    jobId: aiRequestJobId(payload),
  });
}
