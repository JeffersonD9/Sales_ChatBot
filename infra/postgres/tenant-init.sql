CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  description text NOT NULL DEFAULT '',
  price integer NOT NULL,
  sizes text[] NOT NULL DEFAULT '{}',
  image_url text NOT NULL DEFAULT '',
  emoji varchar(8) NOT NULL DEFAULT '',
  category varchar(128) NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  tenant_id uuid NOT NULL,
  wa_from varchar(32) NOT NULL,
  step varchar(64) NOT NULL DEFAULT 'NEW',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  shown_products jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_activity timestamptz NOT NULL DEFAULT now(),
  reactivation_sent boolean NOT NULL DEFAULT false,
  abandoned_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, wa_from)
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_phone varchar(32) NOT NULL,
  customer_name varchar(256),
  customer_address text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_method varchar(64),
  total integer NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_whatsapp_config (
  tenant_id uuid PRIMARY KEY,
  session_data bytea,
  bot_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  webhook_secret bytea,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  wa_from       varchar(32) NOT NULL,
  direction     varchar(8) NOT NULL,
  type          varchar(32) NOT NULL DEFAULT 'text',
  body          text NOT NULL DEFAULT '',
  wa_message_id varchar(256),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_tenant_active ON products (tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_activity ON sessions (tenant_id, last_activity);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON orders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_tenant_wa_idx ON messages (tenant_id, wa_from);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at);
