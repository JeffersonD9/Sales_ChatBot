-- ─────────────────────────────────────────────────────────────────────────────
-- grants.sql — permisos del rol dashboard_app sobre la platform DB.
--
-- 100% idempotente: solo GRANT / ALTER DEFAULT PRIVILEGES sobre objetos
-- existentes. NO crea usuarios (el bootstrap inicial lo hace
-- apps/dashboard/scripts/setup-db-permissions.sql manualmente, una sola vez).
--
-- Se aplica en cada deploy desde infra/postgres/apply-upgrades.sh.
-- Ver docs/runbook-db-migrations.md.
-- ─────────────────────────────────────────────────────────────────────────────

-- Si el rol no existe, salimos sin error (entornos donde no hay dashboard).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    RAISE NOTICE 'Rol dashboard_app no existe; saltando GRANTs.';
    RETURN;
  END IF;

  -- Conexión + uso del schema público.
  EXECUTE 'GRANT CONNECT ON DATABASE ' || quote_ident(current_database()) || ' TO dashboard_app';
  EXECUTE 'GRANT USAGE ON SCHEMA public TO dashboard_app';

  -- Lectura en todas las tablas existentes.
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_app';

  -- Lectura automática en tablas futuras.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT TO dashboard_app';

  -- Escritura sobre tablas propias del panel.
  EXECUTE 'GRANT INSERT, UPDATE, DELETE ON panel_users, panel_sessions, panel_rate_limits TO dashboard_app';

  -- Tenants: crear/actualizar pero no borrar.
  EXECUTE 'GRANT INSERT, UPDATE ON tenants TO dashboard_app';

  -- Planes: CRUD completo (catálogo administrado desde el panel).
  EXECUTE 'GRANT INSERT, UPDATE, DELETE ON plans TO dashboard_app';
END
$$;
