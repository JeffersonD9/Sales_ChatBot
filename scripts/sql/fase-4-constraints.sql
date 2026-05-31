-- ============================================================================
-- Fase 4 QA — Constraints UNIQUE adicionales
-- ============================================================================
-- Estos SQL los ejecutas TÚ fuera de la app (psql / DBeaver / pgAdmin).
-- La app no corre migraciones (regla del proyecto).
--
-- ORDEN: primero detectar duplicados existentes, luego decidir qué hacer con
-- ellos, recién después aplicar la constraint. Si saltás el paso de detección
-- y hay duplicados, el ADD CONSTRAINT falla con SQLSTATE 23505 y la DB queda
-- intacta — pero pierdes tiempo.
--
-- DBs involucradas:
--   - PLATFORM_DATABASE_URL  → constraint para tenants (owner_email lower)
--   - TENANT_DATABASE_URL_*  → constraint para products (tenant_id, name)
--                              Repetir para cada DB de tenant (shared-low,
--                              shared-medium, y cada dedicated).
-- ============================================================================


-- ─── 1. PLATFORM DB — owner_email case-insensitive UNIQUE ────────────────────
-- Razón: hoy 'Ana@x.com' y 'ana@x.com' pasan ambos el UNIQUE actual (Postgres
-- es case-sensitive en varchar). Con un mismo email en dos casings distintos,
-- el login después no encuentra al user de forma consistente.

-- 1a. Detectar duplicados case-insensitive (debe devolver 0 filas):
SELECT lower(owner_email) AS email_norm, count(*) AS cnt, array_agg(id) AS ids
  FROM tenants
 WHERE owner_email IS NOT NULL
 GROUP BY lower(owner_email)
HAVING count(*) > 1;

-- 1b. Si el query anterior devolvió filas, resolvé manualmente: borrar tenant
--     duplicado, normalizar email del que queda, o fusionar. NO continúes
--     hasta que el query devuelva 0 filas.

-- 1c. Normalizar emails actuales a lowercase (idempotente):
UPDATE tenants
   SET owner_email = lower(owner_email)
 WHERE owner_email IS NOT NULL
   AND owner_email <> lower(owner_email);

-- 1d. Crear el UNIQUE INDEX case-insensitive. NULL no choca (Postgres trata
--     NULL como distinto de NULL en UNIQUE).
--     CONCURRENTLY evita lock de tabla en una DB con tráfico — no se puede
--     usar dentro de transacción, ejecutar suelto.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS tenants_owner_email_lower_unique
    ON tenants (lower(owner_email))
 WHERE owner_email IS NOT NULL;

-- 1e. (Opcional) Drop del UNIQUE viejo case-sensitive si el nuevo lo cubre:
-- ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_owner_email_unique;
-- (No es obligatorio — tener ambos no rompe nada, solo es redundante.)


-- ─── 2. TENANT DB — products UNIQUE(tenant_id, lower(name)) ──────────────────
-- Razón: bulkCreateProducts hace check-then-insert en memoria. Dos imports
-- concurrentes podían crear dos productos con el mismo nombre. Con esta
-- constraint, Postgres garantiza unicidad y el segundo insert revienta de
-- forma controlada (mismo branch de error que ya manejamos en bulk).
--
-- ⚠️ EJECUTAR EN CADA DB DE TENANT:
--    - tenant_shared_low
--    - tenant_shared_medium (si existe)
--    - cada DB dedicada (consultar tabla tenant_db_allocations en platform)

-- 2a. Detectar duplicados case-insensitive por tenant (debe devolver 0 filas):
SELECT tenant_id, lower(name) AS name_norm, count(*) AS cnt, array_agg(id) AS ids
  FROM products
 GROUP BY tenant_id, lower(name)
HAVING count(*) > 1;

-- 2b. Si hubo duplicados, decidí: borrar los más viejos, renombrar, o ignorar.
--     Sugerencia: marcar como inactivos los duplicados antiguos para no
--     perder histórico de orders que los referencien:
-- UPDATE products SET active = false
--  WHERE id IN (
--    SELECT id FROM (
--      SELECT id, row_number() OVER (
--        PARTITION BY tenant_id, lower(name) ORDER BY created_at ASC
--      ) AS rn FROM products
--    ) t WHERE rn > 1
--  );

-- 2c. Aplicar la constraint UNIQUE (case-insensitive, considera espacios):
--     Usamos índice funcional para case-insensitive. Coalesce no necesario
--     porque tenant_id es NOT NULL en el schema.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS products_tenant_name_lower_unique
    ON products (tenant_id, lower(name));


-- ─── 3. Verificación post-aplicación ─────────────────────────────────────────
-- Tras correr lo anterior, validá que los índices existen:

-- En platform:
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE tablename = 'tenants'
   AND indexname LIKE '%owner_email%';

-- En cada tenant DB:
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE tablename = 'products'
   AND indexname LIKE '%tenant_name%';


-- ─── 4. Test de la constraint (opcional, en una DB de staging) ───────────────
-- Para confirmar que ahora la app NO puede meter duplicados:
-- BEGIN;
--   INSERT INTO products (tenant_id, name, price)
--     VALUES ('<un-tenant-uuid>', 'Camiseta X', 50000);
--   -- El segundo debe fallar con SQLSTATE 23505 (unique_violation):
--   INSERT INTO products (tenant_id, name, price)
--     VALUES ('<mismo-uuid>', 'CAMISETA X', 50000);
-- ROLLBACK;


-- ============================================================================
-- Notas operativas
-- ============================================================================
-- • CONCURRENTLY: usar siempre en producción. Toma lock corto en vez de lock
--   exclusivo durante todo el build. Requiere ejecutar fuera de transacción
--   (cada CREATE INDEX CONCURRENTLY como statement separado).
--
-- • IF NOT EXISTS: la idempotencia te deja ejecutar el script de nuevo sin
--   romper nada. Si el índice ya está, lo ignora.
--
-- • Backup: estos cambios no destruyen datos, pero antes de tocar producción
--   asegurate de tener pg_dump reciente (la documentación habla de rclone a
--   Google Drive en docs/runbook-golive.md).
--
-- • Post-aplicación, la app no necesita redeploy. El próximo bulk import o
--   create concurrente probará la nueva integridad. Los errores 23505 ya
--   están manejados en bulkCreateProducts (queries/products.ts:114).
-- ============================================================================
