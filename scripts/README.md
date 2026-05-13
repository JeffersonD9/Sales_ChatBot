# Operational Scripts

Estos scripts quedan como utilidades puntuales de administracion. No forman parte del runtime de `api`, `whatsapp`, `worker` ni `ai-worker`.

## Scripts activos

- `create-tenant.js`: crea un tenant productivo en Platform DB. Tambien crea `tenant_entitlements`, `db_clusters` y `tenant_db_allocations`. Usa `PLATFORM_DATABASE_URL`.
- `check-token.js`: valida acceso a configuracion de WhatsApp para un tenant.
- `import-products.js`: importa catalogo desde CSV para un tenant. Usa `TENANT_DATABASE_URL_DEFAULT`.
- `mark-payment.js`: registra pagos o cambios operativos relacionados con billing. Usa `PLATFORM_DATABASE_URL`.
- `backup-postgres.sh`: genera dumps gzip de `platform` y `tenant_shared_low` desde el contenedor interno `postgres`.
- `products-template.csv`: plantilla de importacion de productos.

## SQL operativo

- `infra/postgres/init.sql`: bootstrap completo para entorno nuevo/shared.
- `infra/postgres/upgrade-platform-tenancy.sql`: upgrade no destructivo para una Platform DB existente.
- `infra/postgres/tenant-init.sql`: crea solo tablas operativas tenant, util para DB dedicada enterprise.

## Crear tenant

```bash
node scripts/create-tenant.js \
  --slug=boutique-ana \
  --name="Boutique Ana" \
  --wa-token=EAAxxxxx \
  --phone-id=123456789 \
  --owner-phone=573001234567 \
  --plan=basic
```

Planes soportados:

- `basic`: sin IA, `shared-low`.
- `premium`: IA habilitada, `shared-medium`.
- `enterprise`: IA habilitada, `dedicated-db`.

## Scripts retirados

Se eliminaron los scripts antiguos de deploy y certificados porque chocaban con la arquitectura nueva:

- Deploy y TLS se operan con `docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml ...`.
- Nginx vive en `infra/nginx`.
- Redis vive en `infra/redis` y `infra/compose`.
- Backups de platform DB y tenant DBs se ejecutan desde cron del VPS con `backup-postgres.sh`.

Antes de usar estos scripts en produccion, revisa que apunten a `PLATFORM_DATABASE_URL` o a la DB tenant correcta segun el caso.
