'use strict';

const { sql } = require('drizzle-orm');

const PLAN_SETTINGS = {
  basic: {
    planCode: 'basic',
    aiEnabled: false,
    dailyMessageLimit: 500,
    dailyAiReplyLimit: 0,
    dailyAiTokenLimit: 0,
    overageEnabled: false,
    allocationStrategy: 'shared-low',
    clusterCode: process.env.TENANT_DB_CLUSTER_BASIC || 'shared-low-01',
    clusterTier: 'low',
    clusterAllocationStrategy: 'shared',
    maxTenants: 100,
  },
  premium: {
    planCode: 'premium',
    aiEnabled: true,
    dailyMessageLimit: 3000,
    dailyAiReplyLimit: 500,
    dailyAiTokenLimit: 1000000,
    overageEnabled: true,
    allocationStrategy: 'shared-medium',
    clusterCode: process.env.TENANT_DB_CLUSTER_PREMIUM || 'shared-medium-01',
    clusterTier: 'medium',
    clusterAllocationStrategy: 'shared',
    maxTenants: 50,
  },
  enterprise: {
    planCode: 'enterprise',
    aiEnabled: true,
    dailyMessageLimit: 20000,
    dailyAiReplyLimit: 5000,
    dailyAiTokenLimit: 10000000,
    overageEnabled: true,
    allocationStrategy: 'dedicated-db',
    clusterCode: process.env.TENANT_DB_CLUSTER_ENTERPRISE || 'enterprise-dedicated-01',
    clusterTier: 'enterprise',
    clusterAllocationStrategy: 'dedicated',
    maxTenants: 1,
  },
};

function normalizePlan(plan) {
  if (plan === 'starter') return 'basic';
  if (PLAN_SETTINGS[plan]) return plan;
  return 'basic';
}

function getPlanSettings(plan, overrides = {}) {
  const normalized = normalizePlan(plan);
  return {
    ...PLAN_SETTINGS[normalized],
    planCode: normalized,
    ...overrides,
  };
}

function defaultDatabaseName(slug, plan) {
  if (normalizePlan(plan) !== 'enterprise') return null;
  return `tenant_${String(slug || '').replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

async function ensurePlanRows(db) {
  await db.execute(sql`
    INSERT INTO plans (
      code,
      name,
      tier,
      ai_enabled,
      daily_message_limit,
      daily_ai_reply_limit,
      daily_ai_token_limit,
      default_allocation_strategy
    )
    VALUES
      ('basic', 'Basic', 'basic', false, 500, 0, 0, 'shared-low'),
      ('premium', 'Premium', 'premium', true, 3000, 500, 1000000, 'shared-medium'),
      ('enterprise', 'Enterprise', 'enterprise', true, 20000, 5000, 10000000, 'dedicated-db')
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      tier = EXCLUDED.tier,
      ai_enabled = EXCLUDED.ai_enabled,
      daily_message_limit = EXCLUDED.daily_message_limit,
      daily_ai_reply_limit = EXCLUDED.daily_ai_reply_limit,
      daily_ai_token_limit = EXCLUDED.daily_ai_token_limit,
      default_allocation_strategy = EXCLUDED.default_allocation_strategy,
      updated_at = NOW()
  `);
}

async function provisionTenant(db, tenant, options = {}) {
  if (!tenant?.id) throw new Error('provisionTenant requiere tenant.id');

  const plan = normalizePlan(options.plan || tenant.plan);
  const settings = getPlanSettings(plan, options.entitlements);
  const clusterCode = options.clusterCode || settings.clusterCode;
  const schemaName = options.schemaName || 'public';
  const databaseName = options.databaseName || defaultDatabaseName(tenant.slug, plan);

  await ensurePlanRows(db);

  const clusterResult = await db.execute(sql`
    INSERT INTO db_clusters (
      code,
      tier,
      allocation_strategy,
      max_tenants,
      is_active,
      metadata
    )
    VALUES (
      ${clusterCode},
      ${settings.clusterTier},
      ${settings.clusterAllocationStrategy},
      ${settings.maxTenants},
      true,
      ${JSON.stringify({ provisionedBy: 'provisionTenant' })}::jsonb
    )
    ON CONFLICT (code) DO UPDATE SET
      tier = EXCLUDED.tier,
      allocation_strategy = EXCLUDED.allocation_strategy,
      max_tenants = EXCLUDED.max_tenants,
      is_active = true,
      updated_at = NOW()
    RETURNING id, code
  `);

  const cluster = clusterResult.rows[0];

  await db.execute(sql`
    INSERT INTO tenant_entitlements (
      tenant_id,
      plan_code,
      ai_enabled,
      daily_message_limit,
      daily_ai_reply_limit,
      daily_ai_token_limit,
      overage_enabled
    )
    VALUES (
      ${tenant.id}::uuid,
      ${plan},
      ${settings.aiEnabled},
      ${settings.dailyMessageLimit},
      ${settings.dailyAiReplyLimit},
      ${settings.dailyAiTokenLimit},
      ${settings.overageEnabled}
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      plan_code = EXCLUDED.plan_code,
      ai_enabled = EXCLUDED.ai_enabled,
      daily_message_limit = EXCLUDED.daily_message_limit,
      daily_ai_reply_limit = EXCLUDED.daily_ai_reply_limit,
      daily_ai_token_limit = EXCLUDED.daily_ai_token_limit,
      overage_enabled = EXCLUDED.overage_enabled,
      updated_at = NOW()
  `);

  await db.execute(sql`
    INSERT INTO tenant_db_allocations (
      tenant_id,
      cluster_id,
      allocation_strategy,
      database_name,
      schema_name,
      status,
      metadata
    )
    VALUES (
      ${tenant.id}::uuid,
      ${cluster.id}::uuid,
      ${settings.allocationStrategy},
      ${databaseName},
      ${schemaName},
      'active',
      ${JSON.stringify({ provisionedBy: 'provisionTenant', plan })}::jsonb
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      cluster_id = EXCLUDED.cluster_id,
      allocation_strategy = EXCLUDED.allocation_strategy,
      database_name = EXCLUDED.database_name,
      schema_name = EXCLUDED.schema_name,
      status = 'active',
      updated_at = NOW()
  `);

  return {
    plan,
    clusterCode,
    allocationStrategy: settings.allocationStrategy,
    databaseName,
    schemaName,
    aiEnabled: settings.aiEnabled,
  };
}

module.exports = {
  PLAN_SETTINGS,
  normalizePlan,
  getPlanSettings,
  provisionTenant,
  ensurePlanRows,
};
