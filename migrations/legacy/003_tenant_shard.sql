-- ════════════════════════════════════════════════════════════════════
--  003_tenant_shard.sql — Campo db_shard en tenants
--
--  Prepara la arquitectura para sharding progresivo de base de datos.
--  Todos los tenants arrancan en 'shard-01' (la DB actual).
--
--  Cuando un tenant crece y se migra a otra DB, solo hay que hacer:
--    UPDATE tenants SET db_shard = 'shard-02' WHERE slug = 'cliente-grande';
--
--  El router de conexiones (db.js futuro) usa este campo para
--  dirigir cada query al pool correcto.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS db_shard VARCHAR(50) NOT NULL DEFAULT 'shard-01';

COMMENT ON COLUMN tenants.db_shard IS
  'Identificador del shard de base de datos donde viven los datos de este tenant.
   Valores posibles: shard-01, shard-02, ... o el slug de un shard dedicado.
   El connection router en db.js usa este campo para dirigir las queries.';

CREATE INDEX IF NOT EXISTS idx_tenants_shard
  ON tenants(db_shard);
