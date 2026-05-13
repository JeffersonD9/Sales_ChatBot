'use strict';

const { sql } = require('drizzle-orm');
const { getPlatformDb } = require('../database/platformDb');

const USAGE_FIELDS = [
  'inboundMessages',
  'outboundMessages',
  'aiReplies',
  'aiInputTokens',
  'aiOutputTokens',
];

function _amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}

async function recordTenantUsage(tenantContext, usage = {}) {
  const tenantId = tenantContext?.tenantId || tenantContext?.id;
  if (!tenantId) throw new Error('recordTenantUsage requiere tenantContext.tenantId');

  const increments = {};
  for (const field of USAGE_FIELDS) {
    increments[field] = _amount(usage[field]);
  }

  if (Object.values(increments).every((value) => value === 0)) {
    return null;
  }

  const usageDate = usage.usageDate || _today();
  const db = getPlatformDb();

  const result = await db.execute(sql`
    INSERT INTO tenant_usage_daily (
      tenant_id,
      usage_date,
      inbound_messages,
      outbound_messages,
      ai_replies,
      ai_input_tokens,
      ai_output_tokens,
      updated_at
    )
    VALUES (
      ${tenantId}::uuid,
      ${usageDate}::date,
      ${increments.inboundMessages},
      ${increments.outboundMessages},
      ${increments.aiReplies},
      ${increments.aiInputTokens},
      ${increments.aiOutputTokens},
      NOW()
    )
    ON CONFLICT (tenant_id, usage_date) DO UPDATE SET
      inbound_messages = tenant_usage_daily.inbound_messages + EXCLUDED.inbound_messages,
      outbound_messages = tenant_usage_daily.outbound_messages + EXCLUDED.outbound_messages,
      ai_replies = tenant_usage_daily.ai_replies + EXCLUDED.ai_replies,
      ai_input_tokens = tenant_usage_daily.ai_input_tokens + EXCLUDED.ai_input_tokens,
      ai_output_tokens = tenant_usage_daily.ai_output_tokens + EXCLUDED.ai_output_tokens,
      updated_at = NOW()
    RETURNING *
  `);

  return result.rows?.[0] || null;
}

module.exports = {
  recordTenantUsage,
  recordInboundMessage: (tenantContext) => recordTenantUsage(tenantContext, { inboundMessages: 1 }),
  recordOutboundMessage: (tenantContext) => recordTenantUsage(tenantContext, { outboundMessages: 1 }),
  recordAiUsage: (tenantContext, usage = {}) => recordTenantUsage(tenantContext, {
    aiReplies: usage.aiReplies ?? 1,
    aiInputTokens: usage.inputTokens || usage.aiInputTokens || 0,
    aiOutputTokens: usage.outputTokens || usage.aiOutputTokens || 0,
  }),
};
