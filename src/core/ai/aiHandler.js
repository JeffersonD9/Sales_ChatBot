'use strict';

const Anthropic        = require('@anthropic-ai/sdk');
const { logger }       = require('../../utils/logger');
const { increment }    = require('./aiMetrics');
const { buildSalesPrompt } = require('./salesPrompt');

// 3 turnos completos (user + assistant) = 6 entradas
const MAX_HISTORY     = 6;
// Máximo de caracteres por mensaje al almacenar en historial
const MAX_MSG_CHARS   = 500;

function _buildSystemContent(tenant) {
  const text = buildSalesPrompt(tenant);
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

function _truncate(str) {
  if (typeof str === 'string' && str.length > MAX_MSG_CHARS) {
    return str.slice(0, MAX_MSG_CHARS) + '…';
  }
  return str;
}

let _client = null;

function _getClient() {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _client = new Anthropic({ apiKey });
  return _client;
}

/**
 * Intenta responder con Claude Haiku cuando el flow determinístico no
 * reconoció el input del usuario.
 *
 * Contrato de fallo: retorna null en cualquier error (API caída, timeout,
 * clave ausente, AI_ENABLED=false). El caller es responsable del fallback.
 *
 * @param {string} phone    - Número del remitente
 * @param {string} text     - Mensaje del usuario
 * @param {object} session  - Estado mutable de la conversación
 * @param {object} tenant   - Config del tenant (products, bot_config, slug, plan)
 * @returns {Promise<string|null>}
 */
async function handleWithAILocally(phone, text, session, tenant) {
  if (process.env.AI_ENABLED === 'false') return null;

  const client = _getClient();
  if (!client) return null;

  // Historial acotado con truncado de mensajes largos para evitar acumulación
  const history  = (session.data.aiHistory || []).slice(-MAX_HISTORY);
  const messages = [
    ...history.map((m) => ({ ...m, content: _truncate(m.content) })),
    { role: 'user', content: text },
  ];

  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system:     _buildSystemContent(tenant),
      messages,
    });

    const reply = response.content?.[0]?.text ?? null;
    if (!reply) return null;

    const inputTokens  = response.usage?.input_tokens  || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const cacheHit     = (response.usage?.cache_read_input_tokens || 0) > 0;

    logger.info(
      { phone, tenantSlug: tenant.slug, inputTokens, outputTokens, cacheHit },
      '[AI] Respuesta generada'
    );

    // Guardar en historial con texto del usuario truncado (no la respuesta IA)
    session.data.aiHistory = [
      ...history,
      { role: 'user',      content: _truncate(text) },
      { role: 'assistant', content: reply            },
    ].slice(-MAX_HISTORY);

    // Contabilizar la llamada en Redis (fire-and-forget)
    increment(tenant.slug).catch(() => {});

    return reply;

  } catch (err) {
    logger.warn(
      { phone, tenantSlug: tenant.slug, err: err.message },
      '[AI] Error llamando Anthropic — usando fallback'
    );
    return null;
  }
}

async function handleWithAIQueued(phone, text, session, tenant) {
  const { enqueueAIRequest } = await import('../../queues/producers/aiRequestsProducer.js');
  const { getQueueEvents } = await import('../../queues/bullmqQueue.js');
  const { QUEUES } = await import('../../queues/names.js');

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

/** Solo para uso en tests — resetea el singleton del cliente. */
function _resetClientForTest() {
  _client = null;
}

module.exports = { handleWithAI, handleWithAILocally, _resetClientForTest };
