# Estructura del proyecto

Este proyecto esta migrando de un MVP monolitico a una arquitectura interna separada por servicios y dominios. La fase 4 ya introduce BullMQ como modo real opcional para `whatsapp.inbound`, manteniendo modo directo para no romper el runtime actual.

## Entry points

`npm start` y `npm run dev` apuntan al servicio API. Para correr la topologia completa en desarrollo usa Docker Compose, que levanta `api`, `whatsapp` y `worker` separados.

Entrypoints por boundary:

```bash
npm run start:api
npm run start:whatsapp
npm run start:worker
npm run start:ai-worker
```

Tambien existen variantes `dev:*` con `nodemon`.

## Estructura base

```text
apps/
  api-core/
  wa-session-manager/
  message-worker/
  ai-orchestrator/
packages/
  config/
  logger/
  platform-data/
  shared-types/
src/
  config/
  middleware/
  notifications/
  observability/
  queues/
    names.js
    mode.js
    directQueue.js
    bullmqQueue.js
  utils/
```

## Responsabilidades

`apps/api-core` es el servicio HTTP de plataforma. Maneja configuracion, admin, auth, billing, health y metrics. No expone la UI demo retirada, no recibe webhooks, no procesa conversaciones ni llama LLM.

`apps/wa-session-manager` es el servicio HTTP para webhooks de Meta. Debe validar requests, resolver tenant minimo, responder rapido y publicar eventos mediante `apps/wa-session-manager/producers/whatsappInboundProducer.js`.

`apps/message-worker` es el proceso de background y runtime conversacional. Ejecuta flow engine, estado de sesiones, billing check, scheduler premium y reactivaciones. Con `QUEUE_MODE=bullmq` consume `whatsapp.inbound` desde Redis/BullMQ.

`apps/ai-orchestrator` es el boundary para IA: prompt de ventas, Claude/OpenAI, audio, vision, escalamiento, metricas AI y trabajos asincronos. Con `AI_QUEUE_MODE=bullmq` registra el processor de `ai.requests`.

`packages/platform-data` contiene la capa compartida de datos: DB, Redis, tenant resolution, allocations, billing, auth tenant-aware, DB de plataforma y repositorios tenant. Las apps consumen su fachada `packages/platform-data/index.js`.

Dentro de `packages/platform-data/src/tenant` viven los datos operativos por tenant: catalogo, sesiones, conversaciones, mensajes, ordenes y workflows. Todo acceso debe pasar por repositorios o adaptadores tenant-aware.

`src/queues` contiene el contrato de colas. Los nombres estables viven en `src/queues/names.js`. `QUEUE_MODE=direct` sigue siendo el default compatible; `QUEUE_MODE=memory` usa el bus directo en memoria; `QUEUE_MODE=bullmq` usa Redis/BullMQ.

`src/observability` es boundary ESM para health y metrics. Los aliases `logger`/`metrics` fueron retirados; el router Prometheus canonico vive en `src/observability/metrics.js`.

`src/middleware` es boundary ESM para CORS, security headers, slug validation y rate limits HTTP.

`src/config` conserva wrappers de compatibilidad; el contrato canonico nuevo vive en `packages/config`.

`packages/logger`, `packages/config`, `packages/platform-data` y `packages/shared-types` son paquetes internos reales. `src/utils/logger.js`, `src/config/infra.js`, `src/config/env.js` y `src/utils/validateEnv.js` son wrappers legacy hacia esos paquetes cuando aplica.

## Carpetas legacy

Estas carpetas siguen activas como codigo compartido legacy mientras se migra modulo por modulo:

```text
src/notifications
src/utils
```

No se deben expandir con features nuevas salvo que sea temporal y de bajo riesgo.

## Canonicos movidos en fase 2

```text
apps/wa-session-manager/webhooks/router.js
apps/wa-session-manager/webhooks/verifier.js
apps/wa-session-manager/producers/whatsappInboundProducer.js
apps/message-worker/schedules/premiumScheduler.js
packages/platform-data/src/platform/billing/billingService.js
packages/platform-data/src/platform/tenancy/repository.js
packages/platform-data/src/platform/tenancy/loader.js
packages/platform-data/src/platform/auth/tenantAuthMiddleware.js
packages/platform-data/src/tenant/repositories/whatsappConfigRepository.js
apps/api-core/routes/whatsappConfigRouter.js
```

Detalle completo: `docs/architecture/folder-structure.md`.

## Canonicos introducidos en fase 3

```text
src/queues/directQueue.js
apps/wa-session-manager/producers/whatsappInboundProducer.js
apps/message-worker/processors/whatsappInboundProcessor.js
```

El webhook ya llama al producer de `whatsapp.inbound`; en la topologia separada, `apps/message-worker` consume esa cola con `QUEUE_MODE=bullmq`.

## Canonicos introducidos en fase 4

```text
src/queues/mode.js
src/queues/bullmqQueue.js
apps/message-worker/producers/aiRequestsProducer.js
apps/ai-orchestrator/processors/aiRequestsProcessor.js
```

`whatsapp.inbound` puede ejecutarse entre procesos con `QUEUE_MODE=bullmq`. AI se activa de forma separada con `AI_QUEUE_MODE=bullmq` para no acoplar el despliegue del webhook al `ai-worker`.

## Boundary ESM fase 9

`src/queues` ya es el primer boundary convertido a ESM completo. Tiene su propio `src/queues/package.json` con `"type": "module"` y usa `import`/`export` internamente.

El resto de `src` sigue CommonJS temporalmente. Los consumidores (`webhook`, `worker`, `ai-worker`, `server` y AI) entran al boundary con `import()` en puntos async. Los caminos directos usados por tests/Jest conservan fallback CommonJS fuera de `src/queues`, porque la suite actual sigue sin `--experimental-vm-modules`.

## Boundary ESM fase 10

`apps/wa-session-manager` ya es ESM completo para el proceso separado de webhooks. Incluye `server.js`, `app.js`, `webhooks/router.js`, `webhooks/verifier.js` y `ingestion/dispatcher.js`.

Los webhooks legacy CommonJS fueron retirados; Redis/BullMQ siguen externos y solo se usan cuando `QUEUE_MODE=bullmq`.

## Boundaries ESM fases 11 y 12

`apps/message-worker` y `apps/ai-orchestrator` ya son ESM. El worker separado usa `apps/message-worker/schedules/premiumScheduler.js`.

Los entrypoints ESM (`worker/index.js` y `ai-worker/index.js`) no arrancan timers cuando `NODE_ENV=test`, para permitir smokes de importacion sin procesos en background.

## Boundary ESM fase 13

`apps/api-core` ya es ESM completo. Incluye `server.js`, `app.js` y `routes/whatsappConfigRouter.js`.

`src/tenants/configRouter.js` fue retirado; la ruta canonica vive en `apps/api-core/routes/whatsappConfigRouter.js`.

## Limpieza legacy fase 14

Se hizo inventario de wrappers CommonJS y se conserva solo lo que todavia sostiene el monolito historico, `npm start`, `npm run dev` o Jest CommonJS:

```text
src/app.js
src/server.js
src/webhooks/verifier.js
src/webhooks/router.js
src/webhooks/dispatcher.js
src/core/scheduler.js
src/tenants/configRouter.js
```

No se eliminaron archivos en esta fase porque todos tienen consumidores activos. La limpieza aplicada fue mover el producer historico de `whatsapp.inbound` a `apps/wa-session-manager/producers/whatsappInboundProducer.js`, dejando al servicio WhatsApp como dueno de publicar esa cola.

Los criterios de retiro quedan documentados en `docs/architecture/folder-structure.md`.

## Ciclo de vida HTTP fase 15

Los entrypoints ESM HTTP (`apps/api-core/server.js` y `apps/wa-session-manager/server.js`) separan `startServer()`/`shutdown()` del `app` exportado y no arrancan listeners cuando `NODE_ENV=test`. Esto permite smoke tests de imports sin abrir puertos y reduce efectos colaterales al componer servicios.

## Retiro runtime monolitico fase 16

Se retiro el runtime monolitico de las rutas operativas:

Se eliminaron `src/server.js`, `src/core/scheduler.js`, el perfil Docker del proceso unico y los scripts npm del proceso unico.

`npm start` y `npm run dev` ya no arrancan el monolito; apuntan a `api`. Los schedulers y consumers viven en `apps/message-worker`, y los webhooks viven en `apps/wa-session-manager`.

Fase 17 retiro `src/app.js`, `src/webhooks/*` y `src/tenants/configRouter.js` despues de migrar los tests de webhook al boundary ESM canonico.

Fase 18 retiro wrappers y demo HTTP sin consumidores:

```text
src/tenants/*
src/billing/billingService.js
src/demo/router.js
src/integrations/whatsapp/*
src/integrations/email/notifier.js
src/observability/logger.js
src/shared/*
```

Tambien se movieron las referencias activas a sus modulos canonicos: las apps consumen `packages/platform-data/index.js`, el worker premium usa `apps/message-worker/core/whatsapp/sender.js`, y el test de configuracion apunta al repositorio interno que valida `packages/platform-data`.

## Boundary ESM fase 19

`src/observability` ya es ESM completo:

```text
src/observability/package.json
src/observability/health.js
src/observability/metrics.js
```

El router Prometheus se movio desde `src/metrics.js` a `src/observability/metrics.js`; los servicios `api` y `whatsapp` consumen observability desde ese boundary.

## Boundary ESM fase 20

`src/middleware` ya es ESM completo:

```text
src/middleware/package.json
src/middleware/cors.js
src/middleware/security.js
```

Los servicios `api` y `whatsapp` importan sus middlewares con exports nombrados. Esta es la ultima fase de limpieza de la superficie HTTP productiva; no se convirtio `core/platform/tenant` de golpe porque ahi queda logica de negocio y acceso a datos que requiere una migracion por dominio.

## Sistema de modulos

La raiz declara `"type": "module"`. Como puente progresivo, `src/package.json` y `tests/package.json` mantienen CommonJS para el runtime y la suite existentes. La conversion real a ESM debe hacerse por boundary completo y esta documentada en `docs/architecture/module-system.md`.

## Docker por servicios

`infra/compose/docker-compose.dev.yml` y `infra/compose/docker-compose.prod.yml` levantan `redis`, `api`, `whatsapp` y `worker` como servicios separados por defecto. `ai-worker` vive bajo el perfil `ai`. El compose no levanta PostgreSQL/MySQL; esas bases son externas. Detalle operativo en `docs/architecture/docker-topology.md`.

## Infraestructura externa

Fase 7 alinea configuracion y healthchecks con infraestructura externa real:

```text
PLATFORM_DATABASE_URL       # DB de metadata SaaS; fallback temporal: DATABASE_URL
TENANT_DATABASE_URL_DEFAULT # allocation tenant compartida default; fallback temporal: DATABASE_URL
REDIS_URL                   # Redis interno del stack por defecto: redis://redis:6379
REDIS_TLS                   # true o rediss:// para Redis administrado con TLS
```

Los endpoints `/health` reportan `platform_db`, `tenant_default_db`, `redis`, `redis_required`, `queue_mode` y `ai_queue_mode`. En produccion y en modo BullMQ, Redis es requerido y lo provee el servicio `redis` del stack. `REDIS_PASSWORD` queda opcional para proteger Redis interno o cuando el password ya viene embebido en `REDIS_URL`.

## Limites operativos

Fase 8 agrega limites de CPU, memoria y `pids_limit` en `infra/compose/docker-compose.prod.yml`. Los procesos Node tambien fijan `NODE_OPTIONS=--max-old-space-size=...` para que el heap quede por debajo del limite del contenedor.

Los limites iniciales son conservadores: `api` y `whatsapp` quedan livianos, `worker` recibe mas CPU para procesar colas, y `ai-worker` tiene mas memoria para requests AI. Dev no fija limites para no interferir con hot reload.

## Reglas

1. Nuevas rutas HTTP viven en `apps/{service}`.
2. Reglas SaaS y acceso a datos viven en `packages/platform-data/src/platform`, expuestos por `packages/platform-data/index.js`.
3. Reglas operativas por tenant viven en `packages/platform-data/src/tenant`, expuestas por repositorios tenant-aware.
4. APIs externas nuevas viven en `src/integrations` solo cuando sean adaptadores reales, no aliases.
5. Los nombres/adaptadores de cola viven en `src/queues`; producers y processors de negocio viven en la app que los ejecuta.
6. Codigo compartido solo vuelve a `src/shared` si no tiene IO y se migra como boundary real, no como wrapper.
7. Tenant-domain no debe importar pools/ORM por rutas legacy; debe pasar por `packages/platform-data` y repositorios tenant-aware.
8. Esta app no ejecuta migraciones desde runtime ni scripts de aplicacion.

## Estado final del refactor progresivo

El runtime productivo queda separado por servicios, sin monolito ni wrappers HTTP legacy. Queda trabajo evolutivo, no bloqueante para este refactor:

1. Probar `QUEUE_MODE=bullmq` contra el Redis interno del stack en ambiente dev/staging.
2. Activar `AI_QUEUE_MODE=bullmq` con `start:ai-worker` en ambiente controlado.
3. Convertir `core`, `notifications`, `utils`, `platform` y `tenant` por dominios completos cuando se vaya a tocar su logica de negocio.
