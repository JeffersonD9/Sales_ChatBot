'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { logger } = require('@whatsapp-saas/logger');
const { increment } = require('./aiMetrics');
const { buildSalesPrompt } = require('./salesPrompt');

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// 3 full turns (user + assistant) = 6 entries.
const MAX_HISTORY = 6;
const MAX_MSG_CHARS = 500;

function _elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function _buildSystemContent(tenant) {
  const text = buildSalesPrompt(tenant);
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

function _truncate(str) {
  if (typeof str === 'string' && str.length > MAX_MSG_CHARS) {
    return `${str.slice(0, MAX_MSG_CHARS)}...`;
  }
  return str;
}

let _anthropicClient = null;

function _getAIProvider() {
  return (process.env.AI_PROVIDER || 'gemini').toLowerCase();
}

function _getAnthropicClient() {
  if (_anthropicClient) return _anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _anthropicClient = new Anthropic({ apiKey });
  return _anthropicClient;
}

function _buildGeminiContents(messages) {
  return messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: _truncate(message.content) }],
  }));
}

function _extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text).filter(Boolean).join('\n').trim() || null;
}

async function _callGemini(messages, tenant) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: buildSalesPrompt(tenant) }],
      },
      contents: _buildGeminiContents(messages),
      generationConfig: {
        maxOutputTokens: 300,
        temperature: 0.4,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 250)}`);
  }

  const payload = await res.json();
  const reply = _extractGeminiText(payload);
  if (!reply) return null;

  return {
    reply,
    inputTokens: payload.usageMetadata?.promptTokenCount || 0,
    outputTokens: payload.usageMetadata?.candidatesTokenCount || 0,
    cacheHit: false,
    model,
  };
}

async function _callAnthropic(messages, tenant) {
  const client = _getAnthropicClient();
  if (!client) return null;

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL,
    max_tokens: 300,
    system: _buildSystemContent(tenant),
    messages,
  });

  const reply = response.content?.[0]?.text ?? null;
  if (!reply) return null;

  return {
    reply,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    cacheHit: (response.usage?.cache_read_input_tokens || 0) > 0,
    model: process.env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL,
  };
}

/**
 * LLM fallback for inputs that the deterministic flow does not recognize.
 *
 * Failure contract: returns null on any provider error, disabled AI, or
 * missing API key. The caller owns the deterministic fallback response.
 */
async function handleWithAILocally(phone, text, session, tenant) {
  if (process.env.AI_ENABLED === 'false') return null;

  const history = (session.data.aiHistory || []).slice(-MAX_HISTORY);
  const messages = [
    ...history.map((m) => ({ ...m, content: _truncate(m.content) })),
    { role: 'user', content: text },
  ];

  try {
    const startedAt = process.hrtime.bigint();
    const provider = _getAIProvider();
    const result = provider === 'anthropic'
      ? await _callAnthropic(messages, tenant)
      : await _callGemini(messages, tenant);

    if (!result?.reply) return null;

    logger.info(
      {
        metric: 'ai.provider.completed',
        provider,
        model: result.model,
        phone,
        tenantSlug: tenant.slug,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheHit: result.cacheHit,
        durationMs: Math.round(_elapsedMs(startedAt)),
      },
      '[AI] Respuesta generada'
    );

    session.data.aiHistory = [
      ...history,
      { role: 'user', content: _truncate(text) },
      { role: 'assistant', content: result.reply },
    ].slice(-MAX_HISTORY);

    increment(tenant.slug).catch(() => {});

    return result.reply;
  } catch (err) {
    logger.warn(
      { phone, tenantSlug: tenant.slug, provider: _getAIProvider(), err: err.message },
      '[AI] Error llamando proveedor LLM - usando fallback'
    );
    return null;
  }
}

async function handleWithAI(phone, text, session, tenant) {
  return handleWithAILocally(phone, text, session, tenant);
}

function _resetClientForTest() {
  _anthropicClient = null;
}

module.exports = { handleWithAI, handleWithAILocally, _resetClientForTest };
