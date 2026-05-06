-- ════════════════════════════════════════════════════════════════════
--  007_tenant_meta_status.sql
--
--  Añade tracking manual del estado de conexión del tenant con Meta.
--  meta_live lo activa el admin cuando registra el webhook en Meta Business
--  Manager y verifica que los mensajes llegan correctamente.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_live         BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_connected_at TIMESTAMPTZ;
