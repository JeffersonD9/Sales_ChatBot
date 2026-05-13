CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan varchar(50) NOT NULL DEFAULT 'basic';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_amount integer NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status varchar(32) NOT NULL DEFAULT 'trial';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_cycle_start date;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS next_billing_date date;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_period_days integer NOT NULL DEFAULT 3;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_payment_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at date;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_live boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_connected_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS db_shard varchar(50) NOT NULL DEFAULT 'shard-01';
ALTER TABLE tenants ALTER COLUMN plan SET DEFAULT 'basic';

UPDATE tenants SET plan = 'basic' WHERE plan IS NULL OR plan = 'starter';

CREATE TABLE IF NOT EXISTS db_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(80) UNIQUE NOT NULL,
  tier varchar(32) NOT NULL DEFAULT 'low',
  allocation_strategy varchar(32) NOT NULL DEFAULT 'shared',
  database_url_encrypted text,
  max_tenants integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_db_allocations (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  cluster_id uuid REFERENCES db_clusters(id) ON DELETE RESTRICT,
  allocation_strategy varchar(32) NOT NULL DEFAULT 'shared-low',
  database_name varchar(128),
  schema_name varchar(128) NOT NULL DEFAULT 'public',
  status varchar(32) NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  migrated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  code varchar(50) PRIMARY KEY,
  name varchar(128) NOT NULL,
  tier varchar(32) NOT NULL DEFAULT 'basic',
  ai_enabled boolean NOT NULL DEFAULT false,
  daily_message_limit integer NOT NULL DEFAULT 500,
  daily_ai_reply_limit integer NOT NULL DEFAULT 0,
  daily_ai_token_limit integer NOT NULL DEFAULT 0,
  default_allocation_strategy varchar(32) NOT NULL DEFAULT 'shared-low',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_entitlements (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  plan_code varchar(50) NOT NULL DEFAULT 'basic',
  ai_enabled boolean NOT NULL DEFAULT false,
  daily_message_limit integer NOT NULL DEFAULT 500,
  daily_ai_reply_limit integer NOT NULL DEFAULT 0,
  daily_ai_token_limit integer NOT NULL DEFAULT 0,
  overage_enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_usage_daily (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  inbound_messages integer NOT NULL DEFAULT 0,
  outbound_messages integer NOT NULL DEFAULT 0,
  ai_replies integer NOT NULL DEFAULT 0,
  ai_input_tokens integer NOT NULL DEFAULT 0,
  ai_output_tokens integer NOT NULL DEFAULT 0,
  billable_overage_amount integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, usage_date)
);

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
  updated_at = now();

INSERT INTO db_clusters (code, tier, allocation_strategy, max_tenants, is_active, metadata)
VALUES
  ('shared-low-01', 'low', 'shared', 100, true, '{"bootstrap": true}'::jsonb),
  ('shared-medium-01', 'medium', 'shared', 50, true, '{"bootstrap": true}'::jsonb),
  ('enterprise-dedicated-01', 'enterprise', 'dedicated', 1, true, '{"bootstrap": true}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  tier = EXCLUDED.tier,
  allocation_strategy = EXCLUDED.allocation_strategy,
  max_tenants = EXCLUDED.max_tenants,
  is_active = true,
  updated_at = now();

INSERT INTO tenant_entitlements (
  tenant_id,
  plan_code,
  ai_enabled,
  daily_message_limit,
  daily_ai_reply_limit,
  daily_ai_token_limit,
  overage_enabled
)
SELECT
  t.id,
  CASE WHEN t.plan IN ('premium', 'enterprise') THEN t.plan ELSE 'basic' END,
  CASE WHEN t.plan IN ('premium', 'enterprise') THEN true ELSE false END,
  CASE
    WHEN t.plan = 'enterprise' THEN 20000
    WHEN t.plan = 'premium' THEN 3000
    ELSE 500
  END,
  CASE
    WHEN t.plan = 'enterprise' THEN 5000
    WHEN t.plan = 'premium' THEN 500
    ELSE 0
  END,
  CASE
    WHEN t.plan = 'enterprise' THEN 10000000
    WHEN t.plan = 'premium' THEN 1000000
    ELSE 0
  END,
  CASE WHEN t.plan IN ('premium', 'enterprise') THEN true ELSE false END
FROM tenants t
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO tenant_db_allocations (
  tenant_id,
  cluster_id,
  allocation_strategy,
  database_name,
  schema_name,
  status,
  metadata
)
SELECT
  t.id,
  c.id,
  CASE
    WHEN t.plan = 'enterprise' THEN 'dedicated-db'
    WHEN t.plan = 'premium' THEN 'shared-medium'
    ELSE 'shared-low'
  END,
  CASE
    WHEN t.plan = 'enterprise' THEN 'tenant_' || replace(t.slug, '-', '_')
    ELSE NULL
  END,
  'public',
  'active',
  jsonb_build_object('bootstrap', true, 'source', 'upgrade-platform-tenancy.sql')
FROM tenants t
JOIN db_clusters c ON c.code = CASE
  WHEN t.plan = 'enterprise' THEN 'enterprise-dedicated-01'
  WHEN t.plan = 'premium' THEN 'shared-medium-01'
  ELSE 'shared-low-01'
END
ON CONFLICT (tenant_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_tenant_usage_daily_date ON tenant_usage_daily (usage_date);

-- Tenant-domain tables now live in tenant databases. Existing installations that
-- still have products/sessions/orders in the platform database should migrate
-- those rows to the tenant DB selected by tenant_db_allocations before dropping
-- the legacy tables.
