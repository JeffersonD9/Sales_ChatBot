# Docker topology

La fase actual separa el runtime por boundaries sin eliminar el modo monolitico.

Este repo despliega solamente el bot y el proxy. No define contenedores de PostgreSQL, MySQL ni Redis. Esas piezas pertenecen a infraestructura externa.

## Desarrollo

Comando default:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Servicios default:

- `api`: HTTP SaaS en `localhost:3000`.
- `whatsapp`: webhooks de Meta en `localhost:3001`.
- `worker`: jobs, schedules y consumer de `whatsapp.inbound`.

Dependencias externas:

- `DATABASE_URL` o `PLATFORM_DATABASE_URL`.
- URLs de bases tenant compartidas/dedicadas segun allocations.
- `REDIS_URL` para cache, queues, locks y session store.

Servicios opcionales:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile ai up
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile legacy up
```

- Perfil `ai`: levanta `ai-worker` (boundary ESM) y habilita el consumer de `ai.requests`.
- Perfil `legacy`: levanta `app`, el proceso unico historico, en `localhost:3002`.

## Produccion

Comando default:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Servicios default:

- `api`: `node src/services/api/server.js` (boundary ESM).
- `whatsapp`: `node src/services/whatsapp/server.js` (boundary ESM).
- `worker`: `node src/services/worker/index.js` (boundary ESM).
- `nginx`: proxy publico.
- `certbot`: renovacion TLS.

No se levantan bases de datos ni Redis desde este compose. Produccion debe apuntar a servicios externos o administrados.

Nginx enruta:

- `/webhook/{slug}` hacia `whatsapp:3001`.
- `/health` y el resto hacia `api:3000`.

## Colas

`whatsapp` y `worker` corren con `QUEUE_MODE=bullmq` en compose dev/prod. Esto hace que el webhook responda rapido y que el procesamiento conversacional ocurra en el worker.

Redis no se define en este compose. `REDIS_URL` debe apuntar al contenedor o servicio Redis del proyecto de infraestructura externo.

AI se mantiene separado:

- `AI_QUEUE_MODE=direct`: AI se ejecuta en proceso.
- `AI_QUEUE_MODE=bullmq`: `api`/`worker` envian `ai.requests` y `ai-worker` las consume.

El perfil `ai` levanta `ai-worker`, pero activar `AI_QUEUE_MODE=bullmq` para otros servicios debe hacerse de forma controlada por entorno.

## Healthchecks

`api`, `whatsapp` y `app` exponen `/health`. La respuesta separa:

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
| `api` | 0.50 | 384 MB | 256 MB |
| `whatsapp` | 0.50 | 384 MB | 256 MB |
| `worker` | 1.00 | 512 MB | 384 MB |
| `ai-worker` | 1.00 | 768 MB | 512 MB |
| `app` legacy | 1.00 | 768 MB | 512 MB |
| `nginx` | 0.25 | 128 MB | n/a |
| `certbot` | 0.10 | 128 MB | n/a |

Estos valores son defaults conservadores para MVP. Si sube el trafico, primero ajustar `QUEUE_CONCURRENCY`, pools de DB y limites del `worker`; luego escalar replicas o separar nodos. Desarrollo no fija limites para no pelear con hot reload ni maquinas locales pequenas.

## Compatibilidad

La imagen conserva `CMD ["node", "src/server.js"]` para el proceso legacy. Los servicios separados sobreescriben `command`.

La raiz del repo usa `"type": "module"`, pero `src/package.json` mantiene el runtime existente en CommonJS hasta completar la migracion por boundaries.

## Backup flow

El flujo de backup no vive en este repo. Debe estar en infraestructura:

```text
PostgreSQL/MySQL dump
  -> /backups/daily/*.sql.gz
  -> cron/script externo
  -> Google Drive via rclone
```

Este runtime no ejecuta dumps, migraciones ni tareas administrativas sobre bases externas.
