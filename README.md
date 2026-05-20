# WhatsApp SaaS

WhatsApp Sales Agent SaaS multi-tenant. El objetivo del proyecto es mantener un MVP operable mientras se evoluciona hacia una plataforma con tenants en bases compartidas o dedicadas, workers separados y cargas AI opcionales.

La aplicacion no ejecuta migraciones en runtime. El schema se inicializa o actualiza con SQL explicito desde `infra/postgres`. Docker en produccion levanta el bot, proxy, Redis y PostgreSQL dentro de una red interna; las apps solo realizan operaciones normales de producto: consultas, inserts, updates y deletes.

---

## Arquitectura objetivo

Diagrama de referencia: [docs/architecture/architecture-diagram.png](docs/architecture/architecture-diagram.png)

Servicios:

- SaaS API: auth, tenants, billing, admin, planes y metadata de ruteo.
- WA Session Manager: webhooks, verificacion de Meta y publicacion de eventos entrantes.
- Worker Service: jobs, retries, schedules y background tasks.
- AI Worker opcional: LLM, audio, vision, embeddings y workflows AI.
- Redis: queues, cache, session store, rate limiting y locks.
- PostgreSQL: platform DB y tenant DBs compartidas o dedicadas.
- Reverse proxy: Nginx o Traefik.

El runtime operativo corre separado por servicios. El codigo nuevo debe respetar los boundaries anteriores.

---

## Multi-tenant

La plataforma debe soportar asignacion hibrida:

- Small tenants: DB compartida low-tier.
- Medium tenants: DB compartida medium-tier.
- Large tenants: DB dedicada.

No se debe asumir que todos los tenants viven para siempre en una unica DB. Todo acceso a datos de tenant debe pasar por Tenant Resolution Layer y Connection Manager.

Platform DB:

- tenants
- users
- plans
- subscriptions
- billing
- db_clusters
- tenant_db_allocations
- feature flags

Tenant DBs:

- conversations
- messages
- sessions
- products
- orders
- workflows
- automations
- embeddings futuras
- customer data

---

## Estructura actual relevante

```text
apps/
  api-core/
  wa-session-manager/
  message-worker/
  ai-orchestrator/
infra/
  nginx/
  compose/
  postgres/
  redis/
  minio/
packages/
  config/
  http-runtime/
  logger/
  notifications/
  platform-data/
  queues/
  shared-types/
  shared-utils/
src/
  README.md
```

Puntos importantes:

- `infra/redis/redis.conf` es la configuracion del Redis interno usado por BullMQ/cache.
- `TenantResolver` vive en `packages/platform-data` y resuelve metadata de tenant y allocation.
- `ConnectionManager` vive en `packages/platform-data` y cachea pools por allocation.
- Las apps consumen codigo compartido desde `packages/*`; `src/` esta deprecado y no debe recibir codigo nuevo.
- AI se ejecuta en proceso por defecto, pero puede enviarse a `ai-worker` con `AI_QUEUE_MODE=bullmq`.
- Webhook responde rapido y puede usar BullMQ con `QUEUE_MODE=bullmq`.

---

## Variables principales

```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

POSTGRES_USER=app
POSTGRES_DB=postgres
PLATFORM_DB_NAME=platform
TENANT_DB_NAME_DEFAULT=tenant_shared_low
DB_PASSWORD=password
DATABASE_URL=postgresql://app:password@postgres:5432/platform
PLATFORM_DATABASE_URL=postgresql://app:password@postgres:5432/platform
TENANT_DATABASE_URL_DEFAULT=postgresql://app:password@postgres:5432/tenant_shared_low
TENANT_DB_POOL_MAX=10
TENANT_DB_POOL_CACHE_MAX=20

REDIS_URL=redis://:password@redis:6379
REDIS_PASSWORD=password
REDIS_TLS=false

META_APP_SECRET=
WHATSAPP_ANTIBAN_ENABLED=true
WHATSAPP_MAX_OUTBOUND_WITHOUT_REPLY=3
WHATSAPP_MAX_RATE_PER_MIN=60
WHATSAPP_SEND_WINDOW_ENABLED=false
WHATSAPP_SEND_WINDOW_START=9
WHATSAPP_SEND_WINDOW_END=20
ENCRYPTION_KEY=
APP_SECRET=
ADMIN_API_KEY=
JWT_SECRET=

AI_ENABLED=false
AI_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

QUEUE_MODE=direct
AI_QUEUE_MODE=direct
```

Durante la transicion `DATABASE_URL` puede seguir siendo el fallback, pero produccion debe definir `PLATFORM_DATABASE_URL` y `TENANT_DATABASE_URL_DEFAULT`.
`REDIS_PASSWORD` es opcional si la credencial ya esta incluida en `REDIS_URL`. Para Redis administrado con TLS usa `rediss://...` o `REDIS_TLS=true`.

---

## Desarrollo

```bash
cp .env.dev.example .env
docker compose -f docker-compose.yml -f infra/compose/docker-compose.dev.yml up -d
curl http://localhost:3000/health
```

Comandos permitidos:

```bash
npm run dev
npm start
npm test
npm run test:unit
npm run test:integration
```

Docker:

```bash
docker compose -f docker-compose.yml -f infra/compose/docker-compose.dev.yml up
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml up -d
```

La topologia Docker default corre servicios separados: `redis`, `api`, `whatsapp` y `worker`. El `ai-worker` se levanta con `--profile ai`. Ver `docs/architecture/docker-topology.md`.
El flujo de comunicacion entre servicios esta en `docs/architecture/service-communication.md`.

El compose de produccion incluye PostgreSQL interno como `postgres` y Redis interno como `redis`, ambos sin puertos publicos. `PLATFORM_DATABASE_URL` y `TENANT_DATABASE_URL_DEFAULT` deben apuntar a `postgres` salvo que decidas mover la DB a infraestructura administrada mas adelante.

No correr migraciones desde esta app.

---

## Roadmap corto

1. Separar platform DB de tenant DB a nivel de pools.
2. Convertir repositorios tenant-domain para recibir `tenantContext`.
3. Probar BullMQ en staging con `QUEUE_MODE=bullmq`.
4. Activar worker de mensajes como proceso separado.
5. Activar AI asincrono con `AI_QUEUE_MODE=bullmq`.
6. Convertir boundaries canonicos a ESM por grupos.
7. Agregar resource limits, backups independientes y observabilidad.
8. Convertir CommonJS restante por boundary completo y completar migracion ESM.
