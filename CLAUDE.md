# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

WhatsApp Sales Agent SaaS multi-tenant. La arquitectura objetivo separa plataforma, WhatsApp, workers y bases de datos de tenants para poder crecer desde un MVP sencillo hasta tenants dedicados sin reescribir el producto.

**Regla critica:** esta aplicacion no ejecuta migraciones. Las bases de datos y Redis viven fuera de este repo, y el schema se administra fuera del runtime de la app. Aqui solo se hacen consultas, inserts, updates, deletes y operaciones normales de producto. La conexion se configura por variables de entorno.

Docs profundos:
- `DEPLOY.md` — guia completa de despliegue
- `PROJECT_STRUCTURE.md` — layout detallado del repo
- `docs/meta-whatsapp-template-compliance-2026-05.md` - reglas obligatorias para templates Meta, webhooks de estado/calidad y nuevos custom flows WhatsApp
- `docs/PLAN_MAESTRO.md`, `docs/runbook-*.md`, `docs/architecture/` — planes y runbooks

---

## Regla obligatoria: Meta WhatsApp templates y custom flows

Antes de crear o modificar un flow custom en `apps/message-worker/core/flows/custom/`, leer y aplicar `docs/meta-whatsapp-template-compliance-2026-05.md`.

Reglas duras:
- No iniciar conversaciones fuera de la ventana de 24h sin template aprobado.
- Usar categorias vigentes: `MARKETING`, `UTILITY`, `AUTHENTICATION` y mensajes `SERVICE` dentro de la ventana de 24h. No usar `TRANSACTIONAL` en docs o flows nuevos.
- No mezclar marketing en templates o pasos utility.
- Todo flow debe tener salida humana, opt-out respetado, copy corto y maximo 3 mensajes salientes consecutivos sin respuesta.
- Todo outbound debe pasar por los helpers `sendText`, `sendImage`, `sendInteractiveButtons`, `sendInteractiveList` o `sendAudio` para que corra `antiBanGuard`.
- Los webhooks de `failed`, template pausado/deshabilitado/rechazado y quality degradado son senales operativas para pausar/reducir envios, no solo logs.

## Quick orientation

Monorepo npm workspaces, root es **ESM** (`"type": "module"`). Cada app tiene su propio entrypoint.

| App | Entrypoint | Script dev | Script prod |
| --- | --- | --- | --- |
| api-core | `apps/api-core/server.js` | `npm run dev:api` | `npm run start:api` |
| wa-session-manager | `apps/wa-session-manager/server.js` | `npm run dev:whatsapp` | `npm run start:whatsapp` |
| message-worker | `apps/message-worker/index.js` | `npm run dev:worker` | `npm run start:worker` |
| ai-orchestrator | `apps/ai-orchestrator/index.js` | `npm run dev:ai-worker` | `npm run start:ai-worker` |
| dashboard | Next.js 15 (pnpm, en `apps/dashboard/`) | `pnpm dev` (port 3001) | `pnpm build` |

`npm run dev` / `npm start` apuntan a `api-core` por default.

### Folder structure (actual)

```text
apps/
  api-core/             Express — auth, billing, admin, whatsapp config
  wa-session-manager/   Express — webhooks Meta, ingestion, sesiones
  message-worker/       BullMQ worker — procesa mensajes entrantes
  ai-orchestrator/      BullMQ worker — LLM, audio, embeddings (perfil ai)
  dashboard/            Next.js 15 standalone — panel admin (port 3001)
packages/
  config/               env + config compartido
  http-runtime/         middlewares y helpers Express
  logger/               pino logger compartido
  notifications/        notify helpers (WhatsApp/email)
  platform-data/        DB pool, Drizzle schema, TenantResolver, ConnectionManager (CommonJS hoy)
  queues/               BullMQ wrappers, nombres de cola
  shared-types/         tipos compartidos
  shared-utils/         utilidades transversales
tests/
  unit/
  integration/
  helpers/
infra/compose/          overrides dev/prod de docker-compose
docs/                   runbooks, plan maestro, arquitectura
```

`apps/dashboard` es Next.js independiente (TypeScript, pnpm, Drizzle ORM). Usa dos conexiones: `DATABASE_URL` → `platform`, `TENANT_DATABASE_URL` → `tenant_shared_low`. No importa paquetes del monorepo raiz; se construye con su propio Dockerfile.

**ESM vs CommonJS:** root y la mayoria de apps son ESM. `packages/platform-data` aun es CommonJS — revisar el `package.json` del package antes de escribir imports.

---

## Comandos

### Desarrollo y tests

```bash
npm run dev                 # api-core con nodemon
npm run dev:whatsapp        # wa-session-manager
npm run dev:worker          # message-worker
npm run dev:ai-worker       # ai-orchestrator

npm test                    # todos los tests (unit + integration)
npm run test:unit
npm run test:integration
npm run test:coverage

# Un solo archivo de test (--forceExit es OBLIGATORIO; timers periodicos mantienen vivo el proceso)
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/unit/path/to/file.test.js --forceExit
```

### Docker

```bash
# Desarrollo — bot solamente
docker compose -f docker-compose.yml -f infra/compose/docker-compose.dev.yml up

# Desarrollo — bot + dashboard
docker compose -f docker-compose.yml -f infra/compose/docker-compose.dev.yml --profile dashboard up

# Desarrollo — bot + dashboard + AI worker
docker compose -f docker-compose.yml -f infra/compose/docker-compose.dev.yml --profile dashboard --profile ai up

# Produccion — bot solamente
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml up -d

# Produccion — bot + dashboard (configuracion actual)
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml --profile dashboard up -d

# Produccion — bot + dashboard + AI worker
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml --profile dashboard --profile ai up -d

# Bootstrap TLS Let's Encrypt (solo primera vez)
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml --profile tls-bootstrap up -d nginx-bootstrap
```

### Dashboard (desde `apps/dashboard/`)

```bash
pnpm dev
pnpm build
pnpm admin:create   # crear primer usuario admin
```

**No** documentar ni ejecutar comandos de migracion desde esta aplicacion.

---

## Estado actual

Lo que ya existe y conviene conservar:

- Express separado en `apps/api-core`, `apps/wa-session-manager`, `apps/message-worker`, `apps/ai-orchestrator`.
- Redis es dependencia operativa.
- Webhook responde 200 rapido y procesa luego con `setImmediate`.
- `TenantResolver` y `ConnectionManager` viven en `packages/platform-data`.
- `tenant_db_allocations` y `db_clusters` definidos en `packages/platform-data/src/drizzle/schema.js`.
- Drizzle + consultas parametrizadas en varias zonas.
- Logging Pino y endpoint `/metrics` Prometheus.
- Healthchecks en compose para apps y Redis interno; DBs verificadas como dependencias externas.
- `packages/queues` con BullMQ wrappers (modo opcional, pendiente validar contra el Redis del stack en staging).

Bottlenecks actuales:

- `packages/platform-data` aun concentra DB/Redis/tenant repositories como capa CommonJS compartida.
- Algunas rutas tenant-domain necesitan adaptadores tenant-aware mas finos.
- `state/manager.js` lee/guarda sesiones contra el pool global.
- Partes de `core`, billing y admin siguen asumiendo DB unica.
- AI se ejecuta dentro del flujo del mensaje y puede bloquear procesamiento.
- Idempotencia de mensajes entrantes esta en memoria (por proceso).
- Sesiones activas en RAM dificultan escalar horizontalmente.
- Schedules corren en el proceso `worker`.

Anti-patrones a eliminar progresivamente:

- Pool global como dependencia de repositorios tenant-domain.
- Joins desde datos tenant hacia `tenants` (platform DB) en operaciones conversacionales.
- AI sin cola.
- `setTimeout`/`setInterval` para schedules dentro del API.
- Cache/idempotencia por memoria local para datos que deben sobrevivir replicas.
- `npm run migrate` dentro de esta app.
- "Un solo proceso, N clientes aislados" como estado final.
- Mezclar auth/admin/billing con ingestion WhatsApp y AI en el mismo boundary logico.

---

## Modelo objetivo

### Servicios

| Servicio | Responsabilidad |
| --- | --- |
| SaaS API (`api-core`) | auth, tenants, billing, planes, admin, configuracion, metadata de ruteo |
| WhatsApp Bot Service (`wa-session-manager`) | webhooks, verificacion Meta, ingestion, sesiones, envio de mensajes |
| Worker Service (`message-worker`) | jobs, reintentos, schedules, notificaciones, tareas de background |
| AI Worker (`ai-orchestrator`, opcional) | LLM, vision, audio, embeddings, workflows AI |
| Redis | queues, cache, session store, rate limiting, locks |
| PostgreSQL | platform DB y tenant DBs compartidas o dedicadas |
| Reverse proxy | Nginx o Traefik |

Meta operativa: Docker Compose bien separado, no Kubernetes.

### Boundaries esperados

- **SaaS API** expone `/health`, `/metrics`, `/admin/*`, `/api/whatsapp/config`, auth, billing, provisioning, db allocation metadata. No procesa conversaciones ni llama LLM.
- **WhatsApp Bot Service** expone `GET/POST /webhook/:slug`. Valida slug, valida firma Meta, resuelve tenant minimo, deduplica con Redis, encola, responde rapido. No espera LLM.
- **Worker Service** procesa mensajes entrantes, retries de envio, reactivaciones, billing checks, notificaciones, jobs programados.
- **AI Worker** solo si el tenant tiene AI habilitada: LLM, audio transcription, image analysis, embeddings, workflows AI.

### Multi-tenant

Asignacion hibrida:

| Tipo de tenant | Ubicacion |
| --- | --- |
| Small | DB compartida low-tier |
| Medium | DB compartida medium-tier |
| Large / elephant | DB dedicada |

Todo acceso tenant-domain pasa por **Tenant Resolution Layer** + **Connection Manager**. Nunca asumir DB unica.

- **Platform DB:** users, tenants, subscriptions, plans, billing, db_clusters, tenant_db_allocations, feature flags, routing metadata.
- **Tenant DBs:** conversations, messages, sessions, products/catalog, orders, workflows, automations, embeddings, customer data.

### Tenant resolution (contrato)

`TenantResolver` es la unica entrada para convertir slug/token/user en `tenantContext`:

```js
{
  tenantId, slug, status, plan, subscriptionStatus,
  dbAllocation: { allocationId, clusterId, strategy, tier, databaseUrl, databaseName, schemaName, poolMax },
  features: { aiEnabled, embeddingsEnabled, workflowsEnabled },
  whatsapp: { token, phoneNumberId, verifyToken, metaLive }
}
```

Reglas: metadata desde platform DB, cache en Redis con TTL corto, bust al cambiar config/allocation, no cargar productos/sesiones/conversaciones dentro del resolver, sin fallback silencioso a otro tenant.

### Connection manager

Cachea pools por `allocationId` (no por tenant). Small/medium que comparten DB usan el mismo pool. Dedicated tienen pool propio. LRU global, `poolMax` por allocation, cierre ordenado, metricas (total/idle/waiting/eviction). No crear pool por request ni por tenant small.

Variables:

```env
PLATFORM_DATABASE_URL=postgresql://app:password@platform-postgres:5432/platform
TENANT_DATABASE_URL_DEFAULT=postgresql://app:password@tenant-postgres-low:5432/tenant_shared_low
TENANT_DB_POOL_MAX=10
TENANT_DB_POOL_CACHE_MAX=20
TENANT_DB_IDLE_TIMEOUT_MS=30000
TENANT_DB_CONNECTION_TIMEOUT_MS=2000
```

### Queues (BullMQ)

| Cola | Proposito |
| --- | --- |
| `whatsapp.inbound` | mensajes entrantes desde webhooks |
| `whatsapp.outbound` | envio/reintentos hacia Meta |
| `ai.requests` | LLM, audio, imagen, embeddings |
| `tenant.schedules` | reactivaciones, resumen diario, billing |
| `maintenance` | backups, limpieza, metricas |

Cada job incluye: `tenantId`, `tenantSlug`, `allocationId`, `messageId`/idempotency key, payload minimo, trace id. Redis maneja rate limit, locks e idempotencia — nada de memoria local en produccion multi-replica.

---

## Roadmap

### Fase 0 — contrato y seguridad operativa
- MVP operativo.
- Regla: la app no corre migraciones.
- Docs/runbooks usan `DATABASE_URL`, `PLATFORM_DATABASE_URL`, `TENANT_DATABASE_URL_DEFAULT`.
- Auditar repos internos de `packages/platform-data` con pool compartido.
- Tests para resolver tenant y conexion por allocation.

### Fase 1 — boundaries internos
- Apps en el mismo repo pero con entrypoints separados (ya existen: `api-core`, `wa-session-manager`, `message-worker`, `ai-orchestrator`).
- Mover schedules fuera de `server.js`.
- Webhook POST → enqueue en Redis/BullMQ.
- Worker procesa mensajes y actualiza sesiones.

### Fase 2 — tenant-aware data access
- Repositorios tenant-domain reciben `tenantContext`.
- `state/manager.js` usa tenant DB o Redis session store.
- Catalogo, orders, sessions y messages tenant-aware.
- Platform DB solo metadata/billing/auth/routing.

### Fase 3 — AI asincrona opcional
- Feature flag `features.aiEnabled` por tenant.
- Cola `ai.jobs`.
- Worker AI escalable independiente, timeouts/budgets/quotas por tenant.
- Guardar historial/respuesta sin bloquear webhook.

### Fase 4 — infraestructura hibrida
- Compose con `api`, `whatsapp`, `worker`, `ai-worker`, `nginx`. Redis interno; DBs externas.
- Dedicated tenant DBs segun necesidad.
- Backups independientes por DB.
- Observabilidad Loki/Grafana/Sentry.

### Orden de implementacion sugerido
1. Actualizar docs, eliminar instrucciones de migracion desde la app.
2. Agregar `PLATFORM_DATABASE_URL` y `TENANT_DATABASE_URL_DEFAULT`.
3. `platformDb` con pool propio de plataforma.
4. Adaptadores tenant-aware para sesiones, catalogo, orders.
5. Reemplazar `getDb()` tenant-domain por `getDbForTenant(tenantContext)`.
6. Introducir BullMQ y cola `whatsapp.inbound`.
7. Webhook POST encola y responde 200.
8. Worker de mensajes con el flujo actual.
9. Idempotencia en Redis.
10. Schedules al worker.
11. AI como job asincrono con feature flag.
12. Separar entrypoints Docker.
13. Resource limits, healthchecks, logs rotados.
14. Backup service con rclone.
15. Metricas por cola/pool/tenant.
16. Migracion operativa de tenants fuera de la app.

---

## Migraciones, backups, observabilidad, seguridad

Estos topicos viven en detalle en `docs/`. Resumen de reglas duras:

- **Migraciones:** la app **no** migra. Schema afuera; el codigo solo consulta. Mover tenant requiere lock, copia, validacion de counts/checksums, update de `tenant_db_allocations`, bust de cache Redis. `allocationId` puede cambiar sin deploy.
- **Backups:** independientes por DB (platform, shared-low, shared-medium, dedicated). `pg_dump` comprimido, retencion local corta, sync a Google Drive con rclone. Restore en DB temporal antes de tocar produccion.
- **Observabilidad:** logs JSON con `tenantId/tenantSlug/jobId/correlationId/allocationId`; `/metrics` Prometheus; metricas BullMQ por cola; Sentry; OpenTelemetry futuro. Prioridad: webhook latency, enqueue latency, job duration/failures, Meta API failures, AI tokens/costo por tenant, DB pool waiting, Redis latency.
- **Seguridad:** cifrar tokens Meta y URLs de DB dedicadas; no loggear secrets/PII/connection strings; validar slug antes de tocar DB; HMAC Meta antes de aceptar webhook; rate limit por IP/tenant/endpoint; JWT con rotacion; credenciales platform y tenant separadas; least privilege en Postgres; Redis con password y red interna; bloquear tenants suspendidos antes de procesar jobs.
- **Costo:** small → shared low, medium → shared medium solo si metricas lo justifican, dedicated solo grandes/compliance; AI off por default, budget por tenant, respuestas deterministicas antes de LLM, cache de tenant context, pool por allocation no por tenant.

Para detalle completo ver `docs/runbook-golive.md`, `docs/runbook-local-dev.md`, `docs/architecture/`.
