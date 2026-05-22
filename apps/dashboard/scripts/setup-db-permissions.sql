-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos PostgreSQL para el panel admin de JestSolution
--
-- Ejecutar UNA SOLA VEZ en el servidor, conectado como superuser:
--
--   # Usuario del panel en la base 'platform' (tenants, panel auth, billing)
--   psql -U postgres -d platform -f scripts/setup-db-permissions.sql
--
--   # Usuario de lectura en la base 'tenant_shared_low' (orders, sessions, products, messages)
--   psql -U postgres -d tenant_shared_low -f scripts/setup-db-permissions-tenant.sql
--
-- Después de ejecutarlo, el panel usa:
--   DATABASE_URL        → postgresql://dashboard_app:PASSWORD@host:5432/platform
--   TENANT_DATABASE_URL → postgresql://dashboard_ro:PASSWORD@host:5432/tenant_shared_low
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Usuario con acceso de escritura al panel (platform DB)
CREATE USER dashboard_app WITH PASSWORD 'STRONG_PASSWORD_HERE';

GRANT CONNECT ON DATABASE platform TO dashboard_app;
GRANT USAGE   ON SCHEMA public TO dashboard_app;

-- Lectura en todas las tablas existentes
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_app;

-- Lectura automática en tablas futuras
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT TO dashboard_app;

-- Escritura en tablas propias del panel
GRANT INSERT, UPDATE, DELETE ON
  panel_users,
  panel_sessions,
  panel_rate_limits
TO dashboard_app;

-- El panel puede crear y actualizar tenants
GRANT INSERT, UPDATE ON tenants  TO dashboard_app;

-- El panel gestiona precios y capacidades del catálogo de planes
GRANT INSERT, UPDATE, DELETE ON plans TO dashboard_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- Lo que dashboard_app NO puede:
--   ✗ DROP / TRUNCATE / CREATE TABLE
--   ✗ Escribir en sessions, messages, orders, products (solo el bot)
-- ─────────────────────────────────────────────────────────────────────────────
