CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(64) UNIQUE NOT NULL,
  name varchar(256) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  wa_token_encrypted text,
  phone_number_id varchar(64) UNIQUE,
  verify_token varchar(128) UNIQUE,
  owner_phone varchar(32) UNIQUE NOT NULL,
  owner_email varchar(256) UNIQUE,
  bot_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  db_shard varchar(50) NOT NULL DEFAULT 'shard-01',
  plan varchar(50) NOT NULL DEFAULT 'basic',
  billing_amount integer NOT NULL DEFAULT 0,
  subscription_status varchar(32) NOT NULL DEFAULT 'trial',
  billing_cycle_start date,
  next_billing_date date,
  grace_period_days integer NOT NULL DEFAULT 3,
  last_payment_at timestamptz,
  trial_ends_at date,
  meta_live boolean NOT NULL DEFAULT false,
  meta_connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_name_unique UNIQUE (name)
);

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
ON CONFLICT (code) DO NOTHING;
