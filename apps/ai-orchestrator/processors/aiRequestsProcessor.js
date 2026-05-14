import { QUEUES } from '@whatsapp-saas/queues/names.js';
import * as bullmqQueue from '@whatsapp-saas/queues/bullmqQueue.js';
import aiHandlerModule from '../core/aiHandler.js';
import loggerModule from '@whatsapp-saas/logger';

const { handleWithAILocally } = aiHandlerModule;
const { logger } = loggerModule;

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function msSince(isoDate) {
  const parsed = Date.parse(isoDate);
  return Number.isNaN(parsed) ? null : Date.now() - parsed;
}

export async function processAIRequest(job) {
  const startedAt = process.hrtime.bigint();
  const { phone, text, session, tenant } = job.data || {};

  if (!phone || !tenant || !session) {
    throw new Error('Job ai.requests invalido');
  }

  logger.info({
    metric: 'ai.job.started',
    tenantSlug: tenant.slug,
    phone,
    jobId: job.id,
    queueWaitMs: msSince(job.data.requestedAt),
  }, '[AI Worker] Job AI iniciado');

  const reply = await handleWithAILocally(phone, text, session, tenant);
  logger.info({
    metric: 'ai.job.completed',
    tenantSlug: tenant.slug,
    phone,
    jobId: job.id,
    queueWaitMs: msSince(job.data.requestedAt),
    durationMs: Math.round(elapsedMs(startedAt)),
    replied: Boolean(reply),
  }, '[AI Worker] Job AI completado');

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
