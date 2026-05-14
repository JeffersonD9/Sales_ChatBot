# whatsapp-saas

WhatsApp Sales Agent SaaS multi-tenant. La arquitectura objetivo separa plataforma, WhatsApp, workers y bases de datos de tenants para poder crecer desde un MVP sencillo hasta tenants dedicados sin reescribir el producto.

Regla critica: esta aplicacion no ejecuta migraciones. Las bases de datos y Redis viven fuera de este repo, y el schema se administra fuera del runtime de la app. Aqui solo se hacen consultas, inserts, updates, deletes y operaciones normales de producto. La conexion se configura por variables de entorno.

---

## Modelo objetivo

### Servicios

| Servicio | Responsabilidad |
| --- | --- |
| SaaS API | auth, tenants, billing, planes, admin, configuracion, metadata de ruteo |
| WhatsApp Bot Service | webhooks, verificacion Meta, ingestion, sesiones, envio de mensajes |
| Worker Service | jobs, reintentos, schedules, notificaciones, tareas de background |
| AI Worker opcional | LLM, vision, audio, embeddings, workflows AI |
| Redis | queues, cache, session store, rate limiting, locks |
| PostgreSQL | platform DB y tenant DBs compartidas o dedicadas |
| Reverse proxy | Nginx o Traefik |

El runtime operativo corre por boundaries separados. La meta no es Kubernetes; la meta es Docker Compose bien separado y facil de operar.

---

## Estrategia multi-tenant

La plataforma debe soportar asignacion hibrida:

| Tipo de tenant | Ubicacion |
| --- | --- |
| Small | DB compartida low-tier |
| Medium | DB compartida medium-tier |
| Large / elephant | DB dedicada |

Nunca asumir que todos los tenants viven en una unica base. Todo acceso tenant-domain debe pasar por Tenant Resolution Layer y Connection Manager.

### Platform database

Contiene metadata SaaS:

- users
- tenants
- subscriptions
- plans
- billing
- db_clusters
- tenant_db_allocations
- feature flags
- routing metadata

### Tenant databases

Contienen datos operativos del tenant:

- conversations
- messages
- sessions
- products / catalog
- orders
- workflows
- automations
- embeddings futuras
- customer data

Durante la transicion puede existir una DB compartida inicial, pero el codigo debe tratarla como una asignacion, no como un singleton global permanente.

---

## Analisis actual

### Lo que ya existe y conviene conservar

- Express esta separado por servicios en `apps/api-core` y `apps/wa-session-manager`.
- Redis ya existe como dependencia operativa.
- Webhook responde 200 rapido y procesa luego con `setImmediate`.
- Hay `TenantResolver` en `packages/platform-data`.
- Hay `ConnectionManager` en `packages/platform-data`.
- Hay `tenant_db_allocations` y `db_clusters` en `packages/platform-data/src/drizzle/schema.js`.
- El codigo usa Drizzle y consultas parametrizadas en varias zonas.
- Hay logging con Pino y endpoint `/metrics`.
- Hay healthchecks en compose para los servicios de app y Redis interno; las DB se verifican como dependencias externas.

### Bottlenecks actuales

- `packages/platform-data` todavia concentra DB/Redis/tenant repositories como capa compartida CommonJS.
- Algunas rutas tenant-domain aun necesitan adaptadores tenant-aware mas finos.
- `state/manager.js` lee y guarda sesiones contra el pool global.
- Partes de `core`, billing y admin siguen asumiendo DB unica.
- AI se ejecuta dentro del flujo del mensaje y puede bloquear procesamiento.
- BullMQ existe como modo opcional; falta validarlo contra el Redis interno del stack en staging.
- Idempotencia de mensajes entrantes esta en memoria, por proceso.
- Sesiones activas estan en RAM, lo que complica escalar horizontalmente.
- Schedules corren en el proceso `worker`.
- Docker modela `api`, `whatsapp` y `worker` como servicios separados.
- Compose prod/dev define healthchecks y limites por servicio de app.
- Backups deben operarse fuera del runtime de esta app; no hay script interno activo para backup/restore.

### Anti-patrones a eliminar progresivamente

- Pool global como dependencia de repositorios tenant-domain.
- Joins desde datos tenant hacia `tenants` en la DB de plataforma para operaciones conversacionales.
- AI sin cola.
- Schedules con `setTimeout`/`setInterval` dentro del API.
- Cache e idempotencia por memoria local para datos que deben sobrevivir replicas.
- Scripts o instrucciones que pidan `npm run migrate` dentro de esta app.
- Documentacion que prometa "un solo proceso, N clientes aislados" como estado final.
- Mezclar auth/admin/billing con ingestion WhatsApp y AI en el mismo boundary logico.

---

## Roadmap de refactor

### Fase 0: contrato y seguridad operativa

- Mantener MVP operativo.
- Congelar regla: la app no corre migraciones.
- Cambiar docs y runbooks para usar `DATABASE_URL`, `PLATFORM_DATABASE_URL` y `TENANT_DATABASE_URL_DEFAULT`.
- Auditar repositorios internos de `packages/platform-data` que aun usan el pool compartido.
- Crear tests para resolver tenant y conexion por allocation.

### Fase 1: boundaries internos

- API, WhatsApp y Worker siguen en el mismo repo, pero con entrypoints separados.
- Mantener `apps/api-core`, `apps/wa-session-manager`, `apps/message-worker` y `apps/ai-orchestrator` como entrypoints separados.
- Mover schedules fuera de `server.js`.
- Convertir webhook POST en enqueue a Redis/BullMQ.
- Hacer que el worker procese mensajes y actualice sesiones.

### Fase 2: tenant-aware data access

- Todo repositorio tenant-domain recibe `tenantContext`.
- `state/manager.js` usa tenant DB o Redis session store, no platform singleton.
- Catalogo, orders, sessions y messages se mueven a repositorios tenant-aware.
- Platform DB solo resuelve metadata, billing, auth y routing.

### Fase 3: AI asincrona opcional

- Feature flag por tenant: `features.aiEnabled`.
- Cola separada para AI: `ai.jobs`.
- Worker AI escalable independiente.
- Timeouts, budgets, quotas y metrica por tenant.
- Guardar historial/respuesta sin bloquear webhook.

### Fase 4: infraestructura hibrida

- Compose con servicios separados de app: `api`, `whatsapp`, `worker`, `ai-worker` y `nginx`. Redis y las DB viven fuera de este repo.
- Agregar dedicated tenant DBs segun necesidad.
- Backups independientes por DB.
- Observabilidad lista para Loki/Grafana/Sentry.

---

## Service decomposition plan

### SaaS API

Debe exponer:

- `/health`
- `/metrics`
- `/admin/*`
- `/api/whatsapp/config`
- auth de usuarios y tenants
- billing
- tenant provisioning
- db allocation metadata

No debe procesar conversaciones ni llamar LLM.

### WhatsApp Bot Service

Debe exponer:

- `GET /webhook/:slug`
- `POST /webhook/:slug`

Debe hacer:

- validar slug
- validar firma Meta
- resolver tenant minimo
- deduplicar con Redis
- encolar mensaje
- responder rapido

No debe esperar LLM ni ejecutar workflows pesados.

### Worker Service

Debe procesar:

- mensajes entrantes
- retries de envio
- reactivaciones
- billing checks
- notificaciones
- jobs programados

### AI Worker

Debe procesar solo si el tenant tiene AI habilitada:

- texto LLM
- audio transcription
- image analysis
- embeddings futuros
- workflows AI

---

## Queue architecture

BullMQ es la opcion preferida.

Colas sugeridas:

| Cola | Proposito |
| --- | --- |
| `whatsapp.inbound` | mensajes entrantes desde webhooks |
| `whatsapp.outbound` | envio/reintentos hacia Meta |
| `ai.requests` | LLM, audio, imagen, embeddings |
| `tenant.schedules` | reactivaciones, resumen diario, billing |
| `maintenance` | backups, limpieza, metricas |

Cada job debe incluir:

- `tenantId`
- `tenantSlug`
- `allocationId`
- `messageId` o idempotency key
- payload minimo
- trace/correlation id

Redis debe manejar rate limit, locks e idempotencia. No usar memoria local para idempotencia en produccion multi-replica.

---

## Tenant resolution

`TenantResolver` debe ser la unica entrada para convertir slug/token/user en `tenantContext`.

Contrato sugerido:

```js
{
  tenantId,
  slug,
  status,
  plan,
  subscriptionStatus,
  dbAllocation: {
    allocationId,
    clusterId,
    strategy,
    tier,
    databaseUrl,
    databaseName,
    schemaName,
    poolMax
  },
  features: {
    aiEnabled,
    embeddingsEnabled,
    workflowsEnabled
  },
  whatsapp: {
    token,
    phoneNumberId,
    verifyToken,
    metaLive
  }
}
```

Reglas:

- Resolver metadata desde platform DB.
- Cachear contexto en Redis con TTL corto.
- Bust cache al cambiar configuracion o allocation.
- No cargar productos, sesiones ni conversaciones dentro del resolver.
- No devolver datos de otro tenant por fallback silencioso.

---

## Connection manager

`ConnectionManager` debe cachear pools por `allocationId`, no por tenant.

Reglas:

- Small/medium tenants que comparten DB usan el mismo pool.
- Dedicated tenants tienen pool propio.
- Limite global de pools con LRU.
- `poolMax` por allocation.
- Cierre ordenado en shutdown.
- Metricas: total, idle, waiting, eviction count.
- No crear pool por request.
- No crear pool por tenant small.

Variables sugeridas:

```env
PLATFORM_DATABASE_URL=postgresql://app:password@platform-postgres:5432/platform
TENANT_DATABASE_URL_DEFAULT=postgresql://app:password@tenant-postgres-low:5432/tenant_shared_low
TENANT_DB_POOL_MAX=10
TENANT_DB_POOL_CACHE_MAX=20
TENANT_DB_IDLE_TIMEOUT_MS=30000
TENANT_DB_CONNECTION_TIMEOUT_MS=2000
```

---

## Docker restructuring plan

Servicios objetivo en Compose:

- `nginx` o `traefik`
- `api`
- `whatsapp`
- `worker`
- `ai-worker` opcional, perfil `ai`
- `backup`

Requisitos:

- red interna para servicios
- exponer solo proxy
- healthchecks en todos los servicios
- restart policies
- DB externa y Redis interno del stack, con volumen persistente para AOF
- resource limits por servicio
- logs rotados
- perfiles para AI y backups

Ejemplo conceptual de limites:

```yaml
deploy:
  resources:
    limits:
      cpus: "0.75"
      memory: 768M
    reservations:
      memory: 256M
```

En Compose no Swarm, usar tambien `mem_limit` y `cpus` si el entorno lo requiere.

---

## Database migration strategy

Esta app no migra.

Estrategia recomendada:

1. Mantener schema management fuera del runtime.
2. Usar un proceso controlado por el responsable de DB para aplicar cambios.
3. Versionar SQL o Drizzle schema como referencia, pero no ejecutar `migrate` desde `api`, `whatsapp` ni `worker`.
4. Para mover tenant:
   - poner tenant en estado `migrating` o lock corto
   - detener jobs nuevos de ese tenant
   - copiar datos tenant-domain
   - validar checksums/counts
   - actualizar `tenant_db_allocations`
   - bust Redis cache
   - reactivar tenant

El codigo debe estar preparado para que una migracion cambie `allocationId` sin deploy.

---

## Backup strategy

Backups independientes:

- platform DB
- cada tenant shared DB
- cada tenant dedicated DB

Politica:

- dump comprimido con `pg_dump`
- nombre con db, fecha y tipo
- retencion local corta
- sync a Google Drive con rclone
- pruebas periodicas de restore

Ejemplo de estructura:

```text
backups/
  platform/
  tenants/shared-low/
  tenants/shared-medium/
  tenants/dedicated/{tenantSlug}/
```

Restore:

- nunca restaurar encima de produccion sin snapshot previo
- restaurar en DB temporal
- validar conteos y smoke tests
- cambiar allocation metadata si se restaura tenant dedicado

---

## Observability

Preparar desde ahora:

- logs JSON con `tenantId`, `tenantSlug`, `jobId`, `correlationId`, `allocationId`
- `/metrics` Prometheus
- metricas BullMQ por cola
- errores con Sentry
- trazas futuras con OpenTelemetry
- Loki/Grafana para logs

Metricas prioritarias:

- webhook latency
- enqueue latency
- job duration
- job failures/retries
- Meta API failures
- AI tokens/costo por tenant
- DB pool waiting count por allocation
- Redis latency

---

## Security concerns

- Cifrar tokens Meta y URLs de DB dedicadas.
- No loggear secrets, tokens, prompts completos con PII ni connection strings.
- Validar slug antes de tocar DB.
- HMAC Meta antes de aceptar webhooks.
- Rate limit por IP, tenant y endpoint.
- JWT con rotacion y expiracion.
- Separar credenciales platform DB y tenant DB cuando sea posible.
- Principle of least privilege en usuarios Postgres.
- Backups cifrados o almacenados en ubicacion restringida.
- Redis con password y solo red interna.
- Bloquear tenant suspendido antes de procesar jobs.

---

## Cost optimization

- Small tenants en DB compartida low-tier.
- Medium tenants en shared medium solo cuando metricas lo justifiquen.
- Dedicated DB solo para tenants grandes o con compliance.
- AI apagada por defecto y activada por plan/feature flag.
- Budget mensual de AI por tenant.
- Respuestas deterministicas antes de LLM.
- Cache de tenant context y config.
- Pool caching por allocation, no por tenant.
- Workers AI escalados solo cuando haya jobs.
- Backups con retencion razonable segun criticidad.

---

## Folder structure sugerida

```text
apps/
  api-core/             Express — auth, billing, admin, whatsapp config
  wa-session-manager/   Express — webhooks Meta, ingestion, sesiones
  message-worker/       BullMQ worker — procesa mensajes entrantes
  ai-orchestrator/      BullMQ worker — LLM, audio, embeddings (perfil ai)
  dashboard/            Next.js 15 standalone — panel admin (port 3001)
packages/
  platform-data/
  config/
  logger/
  shared-types/
src/
  queues/
    bullmq.js
    names.js
  observability/
    metrics.js
  middleware/
  config/
    env.js
```

`apps/dashboard` es un proyecto Next.js independiente (TypeScript, pnpm, Drizzle ORM).
Usa dos conexiones de BD: `DATABASE_URL` → `platform`, `TENANT_DATABASE_URL` → `tenant_shared_low`.
No importa paquetes del monorepo raíz; se construye con su propio Dockerfile.

Mantener `src` solo para soporte transversal que aun no se ha movido a packages o apps.

---

## Step-by-step implementation order

1. Actualizar documentacion y eliminar instrucciones de migracion desde la app.
2. Agregar variables `PLATFORM_DATABASE_URL` y `TENANT_DATABASE_URL_DEFAULT`.
3. Cambiar `platformDb` para usar pool propio de plataforma.
4. Crear adaptadores tenant-aware para sesiones, catalogo y orders.
5. Reemplazar usos tenant-domain de `getDb()` por `getDbForTenant(tenantContext)`.
6. Introducir BullMQ y cola `whatsapp.inbound`.
7. Cambiar webhook POST para encolar y responder 200.
8. Crear worker de mensajes con el flujo actual.
9. Mover idempotencia a Redis.
10. Mover schedules a worker.
11. Convertir AI en job asincrono con feature flag.
12. Separar entrypoints Docker: `api`, `whatsapp`, `worker`, `ai-worker`.
13. Agregar resource limits, healthchecks y logs rotados.
14. Agregar backup service con rclone.
15. Agregar metricas por cola, pool y tenant.
16. Ejecutar migracion operativa de tenants small/medium/dedicated fuera de la app.

---

## Comandos permitidos en esta app

Desarrollo:

```bash
npm run dev
npm start
npm test
npm run test:unit
npm run test:integration
```

Docker:

```bash
# Desarrollo — bot solamente
docker compose -f docker-compose.yml -f infra/compose/docker-compose.dev.yml up

# Desarrollo — bot + panel admin
docker compose -f docker-compose.yml -f infra/compose/docker-compose.dev.yml --profile dashboard up

# Desarrollo — bot + panel admin + AI worker
docker compose -f docker-compose.yml -f infra/compose/docker-compose.dev.yml --profile dashboard --profile ai up

# Producción — bot solamente
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml up -d

# Producción — bot + panel admin  (configuración actual)
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml --profile dashboard up -d

# Producción — bot + panel admin + AI worker
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml --profile dashboard --profile ai up -d

# Bootstrap TLS (primera vez, para obtener certificado Let's Encrypt)
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml --profile tls-bootstrap up -d nginx-bootstrap
```

No documentar ni ejecutar comandos de migracion desde esta aplicacion.

Dashboard (desde `apps/dashboard/`):

```bash
pnpm dev          # Servidor de desarrollo (port 3001)
pnpm build        # Build de producción
pnpm admin:create # Crear primer usuario admin
```

Deploy completo (desde la raiz del repo):

```bash
# Ver DEPLOY.md para la guia completa
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml up -d --build
```
