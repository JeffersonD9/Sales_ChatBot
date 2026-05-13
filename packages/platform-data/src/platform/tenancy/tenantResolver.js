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
const { tenants, tenantDbAllocations, dbClusters } = require('../../drizzle/schema');
const { decrypt } = require('@whatsapp-saas/shared-utils');
const { logger } = require('@whatsapp-saas/logger');

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
  return normalizeAllocation({
    ...fallback,
    allocationId: row.cluster_code || row.db_shard || fallback.allocationId,
    clusterId: row.cluster_code || row.db_shard || fallback.clusterId,
    strategy: row.allocation_strategy || fallback.strategy,
    tier: row.cluster_tier || fallback.tier,
    databaseUrl: _decryptClusterUrl(row) || fallback.databaseUrl,
    databaseName: row.database_name || null,
    schemaName: row.schema_name || 'public',
    status: row.allocation_status || 'active',
  });
}

function _featureFlags(row) {
  const config = row.bot_config || {};
  return {
    aiEnabled: process.env.AI_ENABLED !== 'false' && Boolean(config.ai_enabled || ['premium', 'enterprise'].includes(row.plan)),
    embeddingsEnabled: Boolean(config.embeddings_enabled),
    workflowsEnabled: Boolean(config.workflows_enabled),
  };
}

async function resolveTenantBySlug(slug) {
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
    .leftJoin(tenantDbAllocations, eq(tenantDbAllocations.tenant_id, tenants.id))
    .leftJoin(dbClusters, eq(dbClusters.id, tenantDbAllocations.cluster_id))
    .where(and(eq(tenants.slug, slug), eq(tenants.status, 'active')))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  let waToken = '';
  try {
    waToken = row.wa_token_encrypted ? decrypt(row.wa_token_encrypted) : '';
  } catch (err) {
    logger.error({ tenantSlug: slug, err: err.message }, '[TenantResolver] Error desencriptando wa_token');
  }

  return {
    tenantId: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    plan: row.plan || 'starter',
    subscriptionStatus: row.subscription_status,
    dbAllocation: _allocationFromTenant(row),
    features: _featureFlags(row),
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

function toLegacyTenant(context, tenantData = {}) {
  if (!context) return null;
  return {
    id: context.tenantId,
    slug: context.slug,
    name: context.name,
    status: context.status,
    plan: context.plan,
    subscription_status: context.subscriptionStatus,
    dbAllocation: context.dbAllocation,
    features: context.features,
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
  resolveTenantBySlug,
  toLegacyTenant,
};
