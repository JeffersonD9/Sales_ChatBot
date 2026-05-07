-- ════════════════════════════════════════════════════════════════════
--  010_rls_products_sessions_orders.sql
--
--  Row Level Security para las tablas de datos de negocio.
--
--  Estrategia: "defensa en profundidad permisiva"
--  ─────────────────────────────────────────────────────────────────
--  El repositorio que ya usa RLS (configRepository.js) establece
--  el contexto de tenant con:
--    SET LOCAL app.current_tenant_id = '<uuid>'
--  dentro de una transacción explícita.
--
--  Las rutas del bot (state/manager.js, tenants/repository.js)
--  todavía no usan SET LOCAL, por lo que la política debe ser
--  PERMISIVA cuando no hay tenant_id en contexto (para no romper
--  el código existente) y RESTRICTIVA cuando sí lo hay.
--
--  Beneficio inmediato:
--    · Si en el futuro un repositorio establece app.current_tenant_id,
--      la DB garantiza aislamiento sin cambios aquí.
--    · Elimina cross-tenant leaks en cualquier query futura que
--      olvidara filtrar por tenant_id en la app layer.
--
--  Para obtener aislamiento completo a nivel DB:
--    1. Crear un rol de BD 'app_user' (sin BYPASSRLS) para el bot.
--    2. Crear un rol 'app_admin' (con BYPASSRLS) para /admin/* y migraciones.
--    3. Añadir SET LOCAL en state/manager.js, tenants/repository.js.
--    Hasta entonces, estas políticas son fundación, no garantía total.
-- ════════════════════════════════════════════════════════════════════

-- ── products ──────────────────────────────────────────────────────────────────
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Tabla ya tiene FORCE ROW LEVEL SECURITY implícita para usuarios no-superuser.
-- La añadimos explícita para que aplique también al owner de la tabla si fuera
-- el mismo rol que la app (edge case de configuración errónea de BD).
ALTER TABLE products FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_tenant_isolation ON products;

-- Política permisiva: permite acceso cuando no hay tenant_id en contexto
-- (queries existentes que filtran a nivel app) y restringe cuando lo hay
-- (queries futuras con SET LOCAL que deben quedar aisladas por tenant).
CREATE POLICY products_tenant_isolation ON products
  USING (
    COALESCE(current_setting('app.current_tenant_id', true), '') = ''
    OR tenant_id = current_setting('app.current_tenant_id', true)::UUID
  );

-- ── sessions ──────────────────────────────────────────────────────────────────
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_tenant_isolation ON sessions;

CREATE POLICY sessions_tenant_isolation ON sessions
  USING (
    COALESCE(current_setting('app.current_tenant_id', true), '') = ''
    OR tenant_id = current_setting('app.current_tenant_id', true)::UUID
  );

-- ── orders ────────────────────────────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_tenant_isolation ON orders;

CREATE POLICY orders_tenant_isolation ON orders
  USING (
    COALESCE(current_setting('app.current_tenant_id', true), '') = ''
    OR tenant_id = current_setting('app.current_tenant_id', true)::UUID
  );

-- ── Verificación (ejecutar manualmente en psql para confirmar) ────────────────
-- SELECT tablename, rowsecurity, forcerowsecurity
-- FROM pg_tables
-- WHERE tablename IN ('products', 'sessions', 'orders', 'tenant_whatsapp_config');
--
-- Resultado esperado:
--   products              | t | t
--   sessions              | t | t
--   orders                | t | t
--   tenant_whatsapp_config| t | f  ← migration 002, sin FORCE (el owner puede leer todo)
