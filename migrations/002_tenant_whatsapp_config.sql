-- ============================================================
-- Migration 002: tenant_whatsapp_config
-- Tabla de configuración avanzada del bot WhatsApp por tenant.
--
-- Complementa la tabla `tenants` existente con:
--   · session_data   — Credenciales de sesión WhatsApp (pgcrypto)
--   · bot_config     — Flujos del bot validados con Zod en la app
--   · webhook_secret — Secret por tenant para verificar webhooks (pgcrypto)
--   · is_active      — Habilitar/deshabilitar bot sin borrar config
--
-- Seguridad:
--   · Campos sensibles encriptados con pgp_sym_encrypt (pgcrypto)
--   · Row Level Security (RLS) habilitado
--   · Política: cada tenant solo accede a su propia fila
-- ============================================================

-- pgcrypto es necesario para pgp_sym_encrypt / pgp_sym_decrypt
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Tabla principal ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_whatsapp_config (
  tenant_id      UUID        PRIMARY KEY
                             REFERENCES tenants(id) ON DELETE CASCADE,

  -- Credenciales de sesión WhatsApp (ej. refresh tokens, state de Baileys).
  -- Almacenado como bytea resultado de pgp_sym_encrypt — nunca en claro.
  session_data   BYTEA,

  -- Configuración del bot: saludo, árbol de keywords, acción de escalación.
  -- Validada con Zod en la capa de aplicación antes de guardar.
  bot_config     JSONB        NOT NULL DEFAULT '{}',

  -- Secret por tenant para firmar/verificar sus propios webhooks.
  -- Almacenado encriptado con pgcrypto.
  webhook_secret BYTEA,

  is_active      BOOLEAN      NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Índice parcial: solo filas activas, que son las que se consultan en runtime
CREATE INDEX IF NOT EXISTS idx_twc_tenant_active
  ON tenant_whatsapp_config(tenant_id)
  WHERE is_active = true;

-- ── Trigger: updated_at automático ──────────────────────────────────────────
-- Reutiliza la función update_updated_at() definida en la migration 001.
-- Si por algún motivo no existe, la creamos como fallback.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END;
$$;

CREATE TRIGGER trg_twc_updated_at
  BEFORE UPDATE ON tenant_whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────────
-- La política lee el tenant_id del setting de sesión que el repositorio
-- establece con: SET LOCAL app.current_tenant_id = '<uuid>'
-- dentro de una transacción explícita.
--
-- El usuario administrador (rol con BYPASSRLS) puede ver todas las filas.
ALTER TABLE tenant_whatsapp_config ENABLE ROW LEVEL SECURITY;

-- Política para el rol de aplicación (no-admin):
-- cada tenant solo puede leer/escribir su propia fila.
DROP POLICY IF EXISTS twc_tenant_isolation ON tenant_whatsapp_config;

CREATE POLICY twc_tenant_isolation ON tenant_whatsapp_config
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)::UUID
  );
