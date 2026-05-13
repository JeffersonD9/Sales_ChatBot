'use strict';

const { logger } = require('@whatsapp-saas/logger');
const { handleWithAILocally } = require('../../../ai-orchestrator/core/aiHandler');

async function handleWithAIQueued(phone, text, session, tenant) {
  const { enqueueAIRequest } = await import('../../producers/aiRequestsProducer.js');
  const { getQueueEvents } = await import('@whatsapp-saas/queues/bullmqQueue.js');
  const { QUEUES } = await import('@whatsapp-saas/queues/names.js');

  const job = await enqueueAIRequest({
    phone,
    text,
    session,
    tenant,
    requestedAt: new Date().toISOString(),
  });

  const timeout = parseInt(process.env.AI_QUEUE_TIMEOUT_MS || '25000', 10);
  const result = await job.waitUntilFinished(getQueueEvents(QUEUES.AI_REQUESTS), timeout);

  if (session.data && Array.isArray(result?.aiHistory)) {
    session.data.aiHistory = result.aiHistory;
  }

  return result?.reply || null;
}

async function handleWithAI(phone, text, session, tenant) {
  const aiQueueMode = (process.env.AI_QUEUE_MODE || 'direct').toLowerCase();
  const aiBullMQMode = aiQueueMode === 'bullmq' || aiQueueMode === 'redis';

  if (aiBullMQMode) {
    try {
      return await handleWithAIQueued(phone, text, session, tenant);
    } catch (err) {
      logger.warn(
        { phone, tenantSlug: tenant.slug, err: err.message },
        '[AI] Error en cola ai.requests - usando fallback'
      );
      return null;
    }
  }

  return handleWithAILocally(phone, text, session, tenant);
}

module.exports = { handleWithAI, handleWithAIQueued };
