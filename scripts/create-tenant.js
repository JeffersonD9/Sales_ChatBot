/**
 * scripts/create-tenant.js - CLI productivo para crear tenants.
 *
 * Uso:
 *   node scripts/create-tenant.js \
 *     --slug=boutique-ana \
 *     --name="Boutique Ana" \
 *     --wa-token=EAAxxxxx \
 *     --phone-id=123456789 \
 *     --provider=meta \
 *     --owner-phone=573001234567 \
 *     --plan=basic
 *
 * Para 360dialog usa --provider=360dialog y pasa la D360-API-KEY en --wa-token.
 */

import { createRequire } from 'module';
import { randomBytes } from 'crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const require = createRequire(import.meta.url);
const { encrypt } = require('../packages/shared-utils/crypto');
const { Pool } = pg;

const PLAN_SETTINGS = {
  basic: {
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

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    args[key] = rest.join('=');
  }

  return {
    slug: args.slug || process.env.SLUG,
    name: args.name || process.env.NAME,
    plan: normalizePlan(args.plan || process.env.PLAN || 'basic'),
    waToken: args['wa-token'] || process.env.WA_TOKEN,
    phoneId: args['phone-id'] || process.env.PHONE_ID,
    provider: normalizeProvider(args.provider || process.env.WHATSAPP_PROVIDER || 'meta'),
    verifyToken: args['verify-token'] || process.env.VERIFY_TOKEN,
    ownerPhone: args['owner-phone'] || process.env.OWNER_PHONE,
    ownerEmail: args['owner-email'] || process.env.OWNER_EMAIL || null,
    city: args.city || process.env.CITY || 'Colombia',
    schedule: args.schedule || process.env.SCHEDULE || 'Lun-Sab 9am-7pm',
    flowType: args['flow-type'] || process.env.FLOW_TYPE || 'sales_v1',
    clusterCode: args['cluster-code'] || process.env.CLUSTER_CODE || null,
    databaseName: args['database-name'] || process.env.DATABASE_NAME || null,
    schemaName: args['schema-name'] || process.env.SCHEMA_NAME || 'public',
  };
}

function normalizePlan(plan) {
  if (plan === 'starter') return 'basic';
  if (PLAN_SETTINGS[plan]) return plan;
  return 'basic';
}

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (['360dialog', '360_dialog', 'd360', 'dialog360'].includes(value)) return '360dialog';
  return 'meta';
}

function defaultDatabaseName(slug, plan) {
  if (plan !== 'enterprise') return null;
  return `tenant_${String(slug).replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function generateVerifyToken(slug) {
  return `${slug}-${randomBytes(16).toString('hex')}`;
}

function validate(params) {
  const missing = ['slug', 'name', 'waToken', 'ownerPhone']
    .filter((key) => !params[key]);

  if (params.provider === 'meta' && !params.phoneId) {
    missing.push('phoneId');
  }

  if (missing.length > 0) {
    throw new Error(`Faltan parametros: ${missing.join(', ')}`);
  }

  if (!/^[a-z0-9-]+$/.test(params.slug)) {
    throw new Error(`Slug invalido: "${params.slug}". Usa letras minusculas, numeros y guiones.`);
  }
}

async function ensurePlans(client) {
  await client.query(`
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

async function provisionTenant(client, tenant, params) {
  const settings = PLAN_SETTINGS[params.plan];
  const clusterCode = params.clusterCode || settings.clusterCode;
  const databaseName = params.databaseName || defaultDatabaseName(params.slug, params.plan);

  const clusterResult = await client.query(
    `INSERT INTO db_clusters (
       code, tier, allocation_strategy, max_tenants, is_active, metadata
     )
     VALUES ($1, $2, $3, $4, true, $5::jsonb)
     ON CONFLICT (code) DO UPDATE SET
       tier = EXCLUDED.tier,
       allocation_strategy = EXCLUDED.allocation_strategy,
       max_tenants = EXCLUDED.max_tenants,
       is_active = true,
       updated_at = NOW()
     RETURNING id, code`,
    [
      clusterCode,
      settings.clusterTier,
      settings.clusterAllocationStrategy,
      settings.maxTenants,
      JSON.stringify({ provisionedBy: 'scripts/create-tenant.js' }),
    ]
  );

  const cluster = clusterResult.rows[0];

  await client.query(
    `INSERT INTO tenant_entitlements (
       tenant_id,
       plan_code,
       ai_enabled,
       daily_message_limit,
       daily_ai_reply_limit,
       daily_ai_token_limit,
       overage_enabled
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id) DO UPDATE SET
       plan_code = EXCLUDED.plan_code,
       ai_enabled = EXCLUDED.ai_enabled,
       daily_message_limit = EXCLUDED.daily_message_limit,
       daily_ai_reply_limit = EXCLUDED.daily_ai_reply_limit,
       daily_ai_token_limit = EXCLUDED.daily_ai_token_limit,
       overage_enabled = EXCLUDED.overage_enabled,
       updated_at = NOW()`,
    [
      tenant.id,
      params.plan,
      settings.aiEnabled,
      settings.dailyMessageLimit,
      settings.dailyAiReplyLimit,
      settings.dailyAiTokenLimit,
      settings.overageEnabled,
    ]
  );

  await client.query(
    `INSERT INTO tenant_db_allocations (
       tenant_id,
       cluster_id,
       allocation_strategy,
       database_name,
       schema_name,
       status,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, 'active', $6::jsonb)
     ON CONFLICT (tenant_id) DO UPDATE SET
       cluster_id = EXCLUDED.cluster_id,
       allocation_strategy = EXCLUDED.allocation_strategy,
       database_name = EXCLUDED.database_name,
       schema_name = EXCLUDED.schema_name,
       status = 'active',
       updated_at = NOW()`,
    [
      tenant.id,
      cluster.id,
      settings.allocationStrategy,
      databaseName,
      params.schemaName,
      JSON.stringify({ provisionedBy: 'scripts/create-tenant.js', plan: params.plan }),
    ]
  );

  return {
    clusterCode: cluster.code,
    allocationStrategy: settings.allocationStrategy,
    databaseName,
    schemaName: params.schemaName,
    aiEnabled: settings.aiEnabled,
  };
}

async function main() {
  const params = parseArgs();
  validate(params);

  const databaseUrl = process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Falta PLATFORM_DATABASE_URL para crear tenants.');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensurePlans(client);

    const verifyToken = params.verifyToken || generateVerifyToken(params.slug);
    const botConfig = {
      business_name: params.name,
      city: params.city,
      schedule: params.schedule,
      offers: [],
      flow_type: params.flowType,
      whatsapp_provider: params.provider,
    };

    const tenantResult = await client.query(
      `INSERT INTO tenants (
         slug,
         name,
         wa_token_encrypted,
         phone_number_id,
         verify_token,
         owner_phone,
         owner_email,
         bot_config,
         plan
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       RETURNING id, slug, name, status, plan, created_at`,
      [
        params.slug,
        params.name,
        encrypt(params.waToken),
        params.phoneId,
        verifyToken,
        params.ownerPhone,
        params.ownerEmail,
        JSON.stringify(botConfig),
        params.plan,
      ]
    );

    const tenant = tenantResult.rows[0];
    const provisioning = await provisionTenant(client, tenant, params);

    await client.query('COMMIT');

    console.log('\nTenant creado exitosamente:');
    console.log(`   ID:          ${tenant.id}`);
    console.log(`   Slug:        ${tenant.slug}`);
    console.log(`   Nombre:      ${tenant.name}`);
    console.log(`   Plan:        ${tenant.plan}`);
    console.log(`   WhatsApp:    ${params.provider}`);
    console.log(`   IA activa:   ${provisioning.aiEnabled ? 'si' : 'no'}`);
    console.log(`   Cluster:     ${provisioning.clusterCode}`);
    console.log(`   Allocation:  ${provisioning.allocationStrategy}`);
    console.log(`   DB name:     ${provisioning.databaseName || '(shared/default)'}`);
    console.log(`   Schema:      ${provisioning.schemaName}`);
    console.log(`   Verify token: ${verifyToken}`);
    console.log(`\n   Webhook: https://jestsolution.dev/webhook/${tenant.slug}`);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw new Error(`Ya existe un tenant con slug, nombre, telefono o token duplicado (${err.constraint || 'unique'})`);
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
