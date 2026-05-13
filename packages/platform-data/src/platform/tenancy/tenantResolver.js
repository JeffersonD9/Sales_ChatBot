'use strict';

/**
 * Tenant Resolution Layer.
 *
 * Resolves platform metadata and tenant DB routing without loading tenant-domain
 * data such as products, conversations or sessions. That split is what lets a
 * tenant move between shared and dedicated databases later.
 */

const { eq, and } = require('drizzle-orm');
const { getPlatformDb } = require('../database/platformDb');
const { getDefaultTenantAllocation, normalizeAllocation } = require('../database/connectionManager');
const {
  tenants,
  tenantDbAllocations,
  dbClusters,
  tenantEntitlements,
} = require('../../drizzle/platformSchema');
const { decrypt } = require('@whatsapp-saas/shared-utils');
const { logger } = require('@whatsapp-saas/logger');

const PLAN_DEFAULTS = {
  basic: {
    aiEnabled: false,
    dailyMessageLimit: 500,
    dailyAiReplyLimit: 0,
    dailyAiTokenLimit: 0,
    allocationStrategy: 'shared-low',
    tier: 'low',
  },
  premium: {
    aiEnabled: true,
    dailyMessageLimit: 3000,
    dailyAiReplyLimit: 500,
    dailyAiTokenLimit: 1000000,
    allocationStrategy: 'shared-medium',
    tier: 'medium',
  },
  enterprise: {
    aiEnabled: true,
    dailyMessageLimit: 20000,
    dailyAiReplyLimit: 5000,
    dailyAiTokenLimit: 10000000,
    allocationStrategy: 'dedicated-db',
    tier: 'enterprise',
  },
};

function _normalizePlan(plan) {
  if (plan === 'starter') return 'basic';
  if (PLAN_DEFAULTS[plan]) return plan;
  return 'basic';
}

function _decryptClusterUrl(row) {
  if (!row.database_url_encrypted) return null;
  try {
    return decrypt(row.database_url_encrypted);
  } catch (err) {
    logger.error({ tenantSlug: row.slug, err: err.message }, '[TenantResolver] Error desencriptando database_url');
    return null;
  }
}

function _allocationFromTenant(row) {
  const fallback = getDefaultTenantAllocation();
  const plan = _normalizePlan(row.plan);
  const planDefaults = PLAN_DEFAULTS[plan];
  const strategy = row.allocation_strategy || row.cluster_strategy || planDefaults.allocationStrategy;
  const clusterId = row.cluster_code || row.db_shard || fallback.clusterId;

  return normalizeAllocation({
    ...fallback,
    allocationId: row.cluster_code || row.database_name || row.db_shard || fallback.allocationId,
    clusterId,
    strategy,
    tier: row.cluster_tier || planDefaults.tier || fallback.tier,
    databaseUrl: _decryptClusterUrl(row) || fallback.databaseUrl,
    databaseName: row.database_name || null,
    schemaName: row.schema_name || 'public',
    status: row.allocation_status || 'active',
  });
}

function _featureFlags(row) {
  const config = row.bot_config || {};
  const plan = _normalizePlan(row.plan);
  const planDefaults = PLAN_DEFAULTS[plan];
  const entitlementAi = row.entitlement_ai_enabled;
  const planAllowsAi = Boolean(planDefaults.aiEnabled);
  const tenantAllowsAi = entitlementAi !== null && entitlementAi !== undefined
    ? Boolean(entitlementAi)
    : planAllowsAi;
  const aiEnabled = process.env.AI_ENABLED !== 'false'
    && planAllowsAi
    && tenantAllowsAi
    && config.ai_enabled !== false;

  return {
    aiEnabled,
    imageAnalysisEnabled: aiEnabled && Boolean(config.image_analysis_enabled),
    audioTranscriptionEnabled: aiEnabled && Boolean(config.audio_transcription_enabled),
    embeddingsEnabled: aiEnabled && Boolean(config.embeddings_enabled),
    workflowsEnabled: Boolean(config.workflows_enabled),
  };
}

function _limits(row) {
  const plan = _normalizePlan(row.plan);
  const defaults = PLAN_DEFAULTS[plan];
  const aiEnabled = _featureFlags(row).aiEnabled;

  return {
    dailyMessages: row.daily_message_limit ?? defaults.dailyMessageLimit,
    dailyAiReplies: aiEnabled ? (row.daily_ai_reply_limit ?? defaults.dailyAiReplyLimit) : 0,
    dailyAiTokens: aiEnabled ? (row.daily_ai_token_limit ?? defaults.dailyAiTokenLimit) : 0,
    overageEnabled: Boolean(row.overage_enabled),
  };
}

async function _resolveTenant(whereClause, logContext = {}) {
  const db = getPlatformDb();

  const rows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      status: tenants.status,
      wa_token_encrypted: tenants.wa_token_encrypted,
      phone_number_id: tenants.phone_number_id,
      verify_token: tenants.verify_token,
      owner_phone: tenants.owner_phone,
      owner_email: tenants.owner_email,
      bot_config: tenants.bot_config,
      db_shard: tenants.db_shard,
      plan: tenants.plan,
      subscription_status: tenants.subscription_status,
      meta_live: tenants.meta_live,
      entitlement_ai_enabled: tenantEntitlements.ai_enabled,
      daily_message_limit: tenantEntitlements.daily_message_limit,
      daily_ai_reply_limit: tenantEntitlements.daily_ai_reply_limit,
      daily_ai_token_limit: tenantEntitlements.daily_ai_token_limit,
      overage_enabled: tenantEntitlements.overage_enabled,
      allocation_strategy: tenantDbAllocations.allocation_strategy,
      database_name: tenantDbAllocations.database_name,
      schema_name: tenantDbAllocations.schema_name,
      allocation_status: tenantDbAllocations.status,
      cluster_code: dbClusters.code,
      cluster_tier: dbClusters.tier,
      cluster_strategy: dbClusters.allocation_strategy,
      database_url_encrypted: dbClusters.database_url_encrypted,
    })
    .from(tenants)
    .leftJoin(tenantEntitlements, eq(tenantEntitlements.tenant_id, tenants.id))
    .leftJoin(tenantDbAllocations, eq(tenantDbAllocations.tenant_id, tenants.id))
    .leftJoin(dbClusters, eq(dbClusters.id, tenantDbAllocations.cluster_id))
    .where(and(whereClause, eq(tenants.status, 'active')))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  let waToken = '';
  try {
    waToken = row.wa_token_encrypted ? decrypt(row.wa_token_encrypted) : '';
  } catch (err) {
    logger.error({ ...logContext, tenantSlug: row.slug, err: err.message }, '[TenantResolver] Error desencriptando wa_token');
  }

  const plan = _normalizePlan(row.plan);
  const features = _featureFlags(row);

  return {
    tenantId: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    plan,
    subscriptionStatus: row.subscription_status,
    dbAllocation: _allocationFromTenant(row),
    features,
    limits: _limits(row),
    whatsapp: {
      token: waToken,
      phoneNumberId: row.phone_number_id,
      verifyToken: row.verify_token,
      metaLive: row.meta_live,
    },
    owner: {
      phone: row.owner_phone,
      email: row.owner_email,
    },
    botConfig: row.bot_config || {},
  };
}

async function resolveTenantBySlug(slug) {
  return _resolveTenant(eq(tenants.slug, slug), { tenantSlug: slug });
}

async function resolveTenantById(tenantId) {
  return _resolveTenant(eq(tenants.id, tenantId), { tenantId });
}

function toLegacyTenant(context, tenantData = {}) {
  if (!context) return null;
  return {
    id: context.tenantId,
    slug: context.slug,
    name: context.name,
    status: context.status,
    plan: context.plan,
    tenantId: context.tenantId,
    subscriptionStatus: context.subscriptionStatus,
    subscription_status: context.subscriptionStatus,
    dbAllocation: context.dbAllocation,
    features: context.features,
    limits: context.limits,
    whatsapp: context.whatsapp,
    owner: context.owner,
    botConfig: context.botConfig,
    wa_token: context.whatsapp.token,
    phone_number_id: context.whatsapp.phoneNumberId,
    verify_token: context.whatsapp.verifyToken,
    owner_phone: context.owner.phone,
    owner_email: context.owner.email,
    bot_config: context.botConfig,
    products: tenantData.products || [],
  };
}

module.exports = {
  resolveTenantById,
  resolveTenantBySlug,
  toLegacyTenant,
};
