'use strict';

const { sql } = require('drizzle-orm');
const { getPlatformDb } = require('../database/platformDb');

function _today() {
  return new Date().toISOString().slice(0, 10);
}

async function getTodayUsage(tenantContext, usageDate = _today()) {
  const tenantId = tenantContext?.tenantId || tenantContext?.id;
  if (!tenantId) throw new Error('getTodayUsage requiere tenantContext.tenantId');

  const db = getPlatformDb();
  const result = await db.execute(sql`
    SELECT
      tenant_id,
      usage_date,
      inbound_messages,
      outbound_messages,
      ai_replies,
      ai_input_tokens,
      ai_output_tokens,
      billable_overage_amount
    FROM tenant_usage_daily
    WHERE tenant_id = ${tenantId}::uuid
      AND usage_date = ${usageDate}::date
    LIMIT 1
  `);

  return result.rows?.[0] || {
    tenant_id: tenantId,
    usage_date: usageDate,
    inbound_messages: 0,
    outbound_messages: 0,
    ai_replies: 0,
    ai_input_tokens: 0,
    ai_output_tokens: 0,
    billable_overage_amount: 0,
  };
}

async function canReceiveMessage(tenantContext) {
  const limit = tenantContext?.limits?.dailyMessages;
  if (!limit || limit <= 0) return { allowed: true, reason: null };

  const usage = await getTodayUsage(tenantContext);
  const used = Number(usage.inbound_messages || 0);

  return {
    allowed: used < limit,
    reason: used < limit ? null : 'daily_message_limit',
    used,
    limit,
  };
}

async function canUseAi(tenantContext, projectedTokens = 0) {
  if (!tenantContext?.features?.aiEnabled) {
    return { allowed: false, reason: 'ai_disabled_for_plan' };
  }

  const usage = await getTodayUsage(tenantContext);
  const aiReplyLimit = tenantContext?.limits?.dailyAiReplies || 0;
  const aiTokenLimit = tenantContext?.limits?.dailyAiTokens || 0;
  const usedReplies = Number(usage.ai_replies || 0);
  const usedTokens = Number(usage.ai_input_tokens || 0) + Number(usage.ai_output_tokens || 0);

  if (aiReplyLimit > 0 && usedReplies >= aiReplyLimit) {
    return { allowed: false, reason: 'daily_ai_reply_limit', used: usedReplies, limit: aiReplyLimit };
  }

  if (aiTokenLimit > 0 && usedTokens + projectedTokens > aiTokenLimit) {
    return { allowed: false, reason: 'daily_ai_token_limit', used: usedTokens, limit: aiTokenLimit };
  }

  return {
    allowed: true,
    reason: null,
    usedReplies,
    aiReplyLimit,
    usedTokens,
    aiTokenLimit,
  };
}

module.exports = {
  getTodayUsage,
  canReceiveMessage,
  canUseAi,
};
