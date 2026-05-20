# Docker topology

La fase actual corre el runtime por boundaries separados. El modo monolitico ya no forma parte de Docker ni de los scripts npm operativos.

Este repo despliega el bot, el proxy, Redis y PostgreSQL como infraestructura interna. Redis y PostgreSQL viven solo en la red Docker `internal`, sin puertos publicos, parecido a una VPC privada dentro del VPS.

El contrato de comunicacion entre servicios esta documentado en `docs/architecture/service-communication.md`.

## Desarrollo

Comando default:

```bash
docker compose -f docker-compose.yml -f infra/compose/docker-compose.dev.yml up
```

Servicios default:

- `redis`: cola/cache interna con AOF, configurada desde `infra/redis/redis.conf`.
- `api`: HTTP SaaS en `localhost:3000`.
- `whatsapp`: webhooks de Meta en `localhost:3001`.
- `worker`: jobs, schedules y consumer de `whatsapp.inbound`.

Dependencias internas:

- `postgres`: platform DB y tenant DB default.
- `redis`: colas/cache/rate limit.

Redis se levanta en el stack y las apps usan `REDIS_URL=redis://redis:6379` por defecto. Si defines `REDIS_PASSWORD`, el servicio Redis y los clientes lo usan.

Servicios opcionales:

```bash
docker compose -f docker-compose.yml -f infra/compose/docker-compose.dev.yml --profile ai up
```

- Perfil `ai`: levanta `ai-worker` (boundary ESM) y habilita el consumer de `ai.requests`.

## Produccion

Comando default:

```bash
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml up -d
```

Servicios default:

- `postgres`: PostgreSQL interno, sin puerto publico, con DBs `platform` y `tenant_shared_low`.
- `redis`: Redis interno para BullMQ/cache, sin puerto publico.
- `api`: `node apps/api-core/server.js` (boundary ESM).
- `whatsapp`: `node apps/wa-session-manager/server.js` (boundary ESM).
- `worker`: `node apps/message-worker/index.js` (boundary ESM).
- `nginx`: proxy publico construido desde `infra/nginx/Dockerfile`.
- `certbot`: renovacion TLS.

Produccion levanta PostgreSQL y Redis dentro del stack. Las apps dependen de sus healthchecks antes de iniciar. Si mas adelante se usa una DB administrada, conviene crear un overlay Compose separado para reemplazar `PLATFORM_DATABASE_URL` y `TENANT_DATABASE_URL_DEFAULT`.

Nginx enruta:

- `/webhook/{slug}` hacia `whatsapp:3001`.
- `/health` y el resto hacia `api:3000`.

Para el primer certificado TLS se usa el perfil `tls-bootstrap`, que levanta `nginx-bootstrap` solo en HTTP para servir `/.well-known/acme-challenge/` antes de arrancar el Nginx productivo con certificados reales.

## Colas

`whatsapp` y `worker` corren con `QUEUE_MODE=bullmq` en compose dev/prod. Esto hace que el webhook responda rapido y que el procesamiento conversacional ocurra en el worker.

Redis se define como servicio `redis` en Compose y usa `infra/redis/redis.conf`. `REDIS_URL` queda por defecto como `redis://redis:6379`; si se usa Redis administrado, se puede sobreescribir por entorno.

AI se mantiene separado:

- `AI_QUEUE_MODE=direct`: AI se ejecuta en proceso.
- `AI_QUEUE_MODE=bullmq`: `api`/`worker` envian `ai.requests` y `ai-worker` las consume.

El perfil `ai` levanta `ai-worker`, pero activar `AI_QUEUE_MODE=bullmq` para otros servicios debe hacerse de forma controlada por entorno.

## Healthchecks

`api` y `whatsapp` exponen `/health`. La respuesta separa:

- `platform_db`: conectividad a `PLATFORM_DATABASE_URL` o fallback `DATABASE_URL`.
- `tenant_default_db`: allocation default configurada con `TENANT_DATABASE_URL_DEFAULT` o fallback `DATABASE_URL`.
- `redis`: conectividad a `REDIS_URL`.
- `redis_required`: true cuando produccion o BullMQ necesitan Redis.
- `queue_mode` y `ai_queue_mode`: modo activo de colas.

Docker Compose usa esos endpoints para servicios HTTP. `worker` y `ai-worker` no exponen HTTP todavia; su healthcheck valida configuracion requerida del entorno.

Si `QUEUE_MODE=bullmq` o `AI_QUEUE_MODE=bullmq`, `REDIS_URL` es obligatorio. `REDIS_PASSWORD` es opcional cuando la credencial ya vive dentro de `REDIS_URL`. Redis administrado con TLS debe usar `rediss://...` o `REDIS_TLS=true`.

## Resource limits

Produccion define limites por contenedor para evitar que una carga puntual afecte todo el host:

| Servicio | CPU | Memoria | Node heap |
| --- | ---: | ---: | ---: |
| `postgres` | 1.00 | 1536 MB | n/a |
| `redis` | 0.50 | 640 MB | n/a |
| `api` | 0.50 | 384 MB | 256 MB |
| `whatsapp` | 0.50 | 384 MB | 256 MB |
| `worker` | 1.00 | 512 MB | 384 MB |
| `ai-worker` | 1.00 | 768 MB | 512 MB |
| `nginx` | 0.25 | 128 MB | n/a |
| `certbot` | 0.10 | 128 MB | n/a |

Estos valores son defaults conservadores para MVP. Si sube el trafico, primero ajustar `QUEUE_CONCURRENCY`, pools de DB y limites del `worker`; luego escalar replicas o separar nodos. Desarrollo no fija limites para no pelear con hot reload ni maquinas locales pequenas.

## Compatibilidad

La imagen usa `api` como CMD por defecto. Los servicios separados sobreescriben `command` y apuntan a sus entrypoints ESM:

- `api`: `apps/api-core/server.js`.
- `whatsapp`: `apps/wa-session-manager/server.js`.
- `worker`: `apps/message-worker/index.js`.
- `ai-worker`: `apps/ai-orchestrator/index.js`.

Nginx usa una imagen separada `jestsolution.tech/whatsapp-saas-nginx:prod`, construida desde `infra/nginx`, para mantener proxy, TLS y templates fuera de la imagen Node.

Los entrypoints HTTP separados exportan funciones de ciclo de vida (`startServer()`/`shutdown()`) y no arrancan listeners bajo `NODE_ENV=test`, de modo que los smokes de importacion no abren puertos ni compiten entre servicios.

La raiz del repo usa `"type": "module"`. `src/` esta deprecado y no participa en el runtime; los boundaries compartidos viven en `packages/*`.

## Backup flow

El flujo de backup no vive en este repo. Debe estar en infraestructura:

```text
PostgreSQL dump
  -> /var/whatsapp-saas/backups/daily/*.sql.gz
  -> scripts/backup-postgres.sh desde cron del VPS
  -> Google Drive via rclone
```

El runtime no ejecuta dumps ni migraciones automaticas. En el VPS se debe configurar un cron de backup para el contenedor `postgres` antes de abrir produccion:

```bash
0 3 * * * cd /opt/whatsapp-saas && BACKUP_DIR=/var/whatsapp-saas/backups/daily sh scripts/backup-postgres.sh >> /var/log/whatsapp-saas-backup.log 2>&1
```
