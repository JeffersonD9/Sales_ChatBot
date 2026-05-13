# Operational Scripts

Estos scripts quedan como utilidades puntuales de administracion. No forman parte del runtime de `api`, `whatsapp`, `worker` ni `ai-worker`.

## Scripts activos

- `create-tenant.js`: crea un tenant inicial en la DB de plataforma. Usa `PLATFORM_DATABASE_URL`.
- `check-token.js`: valida acceso a configuracion de WhatsApp para un tenant.
- `import-products.js`: importa catalogo desde CSV para un tenant. Usa `TENANT_DATABASE_URL_DEFAULT`.
- `mark-payment.js`: registra pagos o cambios operativos relacionados con billing. Usa `PLATFORM_DATABASE_URL`.
- `products-template.csv`: plantilla de importacion de productos.

## Scripts retirados

Se eliminaron los scripts antiguos de deploy, certificados y backup porque chocaban con la arquitectura nueva:

- Deploy y TLS se operan con `docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml ...`.
- Nginx vive en `infra/nginx`.
- Redis vive en `infra/redis` y `infra/compose`.
- Backups de platform DB y tenant DBs deben ejecutarse fuera del runtime de la app.

Antes de usar estos scripts en produccion, revisa que apunten a `PLATFORM_DATABASE_URL` o a la DB tenant correcta segun el caso.
