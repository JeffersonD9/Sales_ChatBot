-- ════════════════════════════════════════════════════════════════════
--  001_initial_schema.sql — Schema inicial WhatsApp SaaS
--
--  Estrategia: Shared DB + tenant_id en todas las tablas.
--  Un solo comando de migración, un pool, un backup.
--  Agregar cliente = 1 INSERT en tenants.
-- ════════════════════════════════════════════════════════════════════

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Tenants (clientes del SaaS) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                VARCHAR(64) UNIQUE NOT NULL,  -- 'boutique-ana'
  name                VARCHAR(256) NOT NULL,
  status              VARCHAR(32)  NOT NULL DEFAULT 'active', -- active | suspended | trial

  -- Credenciales Meta (wa_token encriptado en la app con AES-256)
  wa_token_encrypted  TEXT,
  phone_number_id     VARCHAR(64),
  verify_token        VARCHAR(128),

  -- Contacto del dueño para notificaciones
  owner_phone         VARCHAR(32)  NOT NULL,
  owner_email         VARCHAR(256),

  -- Configuración del bot (flexible, sin alterar schema)
  -- Campos comunes: business_name, city, schedule, offers[], flow_type
  bot_config          JSONB        NOT NULL DEFAULT '{}',

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Productos por tenant ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(256) NOT NULL,
  description TEXT         NOT NULL DEFAULT '',
  price       INTEGER      NOT NULL,  -- En COP, sin decimales
  sizes       TEXT[]       NOT NULL DEFAULT '{}',  -- ['S', 'M', 'L', 'XL']
  image_url   TEXT         NOT NULL DEFAULT '',
  emoji       VARCHAR(8)   NOT NULL DEFAULT '🛍️',
  category    VARCHAR(128) NOT NULL DEFAULT '',
  active      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Sesiones de conversación (estado activo de cada usuario) ──────────────
-- Sustituye al Map en memoria + JSON de respaldo del proyecto original.
-- UPSERT en cada mensaje — es la fuente de verdad en producción.
CREATE TABLE IF NOT EXISTS sessions (
  tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wa_from           VARCHAR(32)  NOT NULL,  -- número del usuario final
  step              VARCHAR(64)  NOT NULL DEFAULT 'NEW',
  data              JSONB        NOT NULL DEFAULT '{}',  -- name, address, payment, etc.
  shown_products    JSONB        NOT NULL DEFAULT '[]',
  last_activity     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reactivation_sent BOOLEAN      NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  PRIMARY KEY (tenant_id, wa_from)
);

-- ── Pedidos generados por el bot ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_phone   VARCHAR(32) NOT NULL,
  customer_name    VARCHAR(256),
  customer_address TEXT,
  items            JSONB       NOT NULL DEFAULT '[]',  -- [{id, name, price, emoji}]
  payment_method   VARCHAR(64),
  total            INTEGER     NOT NULL DEFAULT 0,
  status           VARCHAR(32) NOT NULL DEFAULT 'pending',  -- pending | shipped | delivered | cancelled
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Índices críticos ──────────────────────────────────────────────────────
-- Productos activos por tenant (consulta más frecuente)
CREATE INDEX IF NOT EXISTS idx_products_tenant_active
  ON products(tenant_id) WHERE active = true;

-- Sesiones por tenant+número (lookup en cada mensaje)
-- Ya cubierto por el PRIMARY KEY (tenant_id, wa_from)

-- Sesiones inactivas para proceso de reactivación
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity
  ON sessions(last_activity) WHERE reactivation_sent = false;

-- Pedidos por tenant (para consultas del admin)
CREATE INDEX IF NOT EXISTS idx_orders_tenant_date
  ON orders(tenant_id, created_at DESC);

-- Pedidos por teléfono del cliente (para handleCheckOrder)
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone
  ON orders(tenant_id, customer_phone);

-- ── Trigger: actualizar updated_at en tenants ─────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenants_updated_at ON tenants;
CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
