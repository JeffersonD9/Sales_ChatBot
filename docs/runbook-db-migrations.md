# Runbook — DB migrations (CI-driven, schema-safe)

Este runbook describe cómo cambiar el schema de Postgres sin perder data ni intervenir
manualmente en el VPS.

## Filosofía

La aplicación **no** ejecuta migraciones (regla dura del proyecto). Las migraciones se aplican
**desde el CI/CD**, no desde el runtime de las apps, usando archivos SQL idempotentes que se
ejecutan en cada deploy contra el contenedor `whatsapp-saas-postgres`.

> Idempotente = correr el script N veces produce el mismo estado final. Si la columna ya
> existe, `ADD COLUMN IF NOT EXISTS` no hace nada. Si la tabla existe, `CREATE TABLE IF NOT
> EXISTS` no hace nada.

## Cómo funciona en cada deploy

1. Push a `main` → GitHub Actions corre `.github/workflows/deploy.yml`.
2. El job `deploy` hace `git pull` en el VPS.
3. **Antes** de `docker compose up -d`, ejecuta `infra/postgres/apply-upgrades.sh`.
4. El script:
   - Verifica que `whatsapp-saas-postgres` esté healthy.
   - Aplica `init.sql` y `upgrade-platform-tenancy.sql` contra la DB `platform`.
   - Aplica `tenant-init.sql` contra la DB `tenant_shared_low`.
   - Si **cualquier** SQL falla → exit 1 → deploy abortado **sin tocar imágenes**.
5. Si las migraciones pasaron, sigue el `pull` + `up -d` + smoke + rollback.

## Qué cambios son seguros vía CI

Permitidos (van en `upgrade-platform-tenancy.sql`):

| Operación | Patrón |
|---|---|
| Nueva tabla | `CREATE TABLE IF NOT EXISTS ...` |
| Nueva columna | `ALTER TABLE x ADD COLUMN IF NOT EXISTS col TYPE NOT NULL DEFAULT ...` |
| Nuevo índice | `CREATE INDEX IF NOT EXISTS ... ON ...` |
| Nuevo dato seed | `INSERT ... ON CONFLICT (...) DO UPDATE SET ...` |
| Constraint nuevo (con default seguro) | `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS ...` (Postgres 16: usar `DO $$` + check) |

Regla: **toda columna nueva con `NOT NULL` debe tener `DEFAULT`** — si no, romperás filas existentes.

## Qué NO va por CI (requiere runbook manual)

- `DROP TABLE` / `DROP COLUMN` / `TRUNCATE` / `DELETE`
- Renombrar columnas o tablas
- Cambiar tipo de columna (`ALTER COLUMN ... TYPE`)
- Cambiar `NOT NULL` a una columna existente sin default
- Foreign keys nuevas sobre tablas con data inconsistente

Para estos casos:

1. Tomar **snapshot del VPS** vía MCP antes de tocar nada (`VPS_createSnapshotV1`).
2. Hacer backup específico de la DB afectada con `pg_dump`.
3. Aplicar el cambio manualmente en una ventana de mantenimiento.
4. Documentar en este archivo qué se hizo y por qué.

## Cómo añadir un cambio nuevo de schema

1. Editar `infra/postgres/upgrade-platform-tenancy.sql`. Añadir al final del archivo en orden
   cronológico. **No** modificar bloques anteriores (otros entornos ya los aplicaron).
2. Si el cambio toca también un schema base nuevo, replicarlo en `init.sql` para que nuevos
   bootstraps salgan correctos desde cero.
3. Probar localmente: `bash infra/postgres/apply-upgrades.sh` (con stack dev levantado).
4. Commit + push a `main`. El CI lo aplica solo.

## Ejecutar fuera de un deploy (manual)

Si necesitás aplicar las migraciones sin pushear:

```bash
# En el VPS, en el directorio del repo:
git pull
bash infra/postgres/apply-upgrades.sh
```

Variables que respeta:

- `POSTGRES_CONTAINER` (default: `whatsapp-saas-postgres`)
- `PLATFORM_DB_NAME` (default: `platform`)
- `TENANT_DB_NAME_DEFAULT` (default: `tenant_shared_low`)
- `POSTGRES_USER` (default: `app`)

## Rollback

Las migraciones de este flujo **no se revierten automáticamente**, porque solo añaden
estructura (no rompen lo existente). Si un deploy falla por otra razón, el smoke test del
workflow revierte las **imágenes** pero deja el schema con las columnas/tablas nuevas — esto
es seguro: el código anterior simplemente ignora lo nuevo.

Si por error se introdujo SQL destructivo o se necesita revertir un cambio de schema, usar
el snapshot de Hostinger o el backup de `pg_dump` previo.
