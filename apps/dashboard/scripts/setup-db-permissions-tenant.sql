-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos de SOLO LECTURA en la base de datos de tenants (tenant_shared_low)
--
-- Ejecutar UNA SOLA VEZ conectado como superuser:
--   psql -U postgres -d tenant_shared_low -f scripts/setup-db-permissions-tenant.sql
--
-- Este usuario es de solo lectura: el bot escribe, el panel solo lee.
-- El panel también puede actualizar el estado de órdenes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE USER dashboard_ro WITH PASSWORD 'STRONG_PASSWORD_HERE';

GRANT CONNECT ON DATABASE tenant_shared_low TO dashboard_ro;
GRANT USAGE   ON SCHEMA public TO dashboard_ro;

-- Lectura en todas las tablas existentes
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_ro;

-- Lectura automática en tablas futuras que cree el bot
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT TO dashboard_ro;

-- El panel puede actualizar el estado de las órdenes
GRANT UPDATE ON orders TO dashboard_ro;
