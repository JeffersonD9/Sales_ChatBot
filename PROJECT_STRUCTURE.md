# Estructura del proyecto

Este proyecto esta migrando de un MVP monolitico a una arquitectura interna separada por servicios y dominios. La fase 4 ya introduce BullMQ como modo real opcional para `whatsapp.inbound`, manteniendo modo directo para no romper el runtime actual.

## Entry points

El entrypoint historico sigue activo:

```bash
npm start
npm run dev
```

Nuevos entrypoints por boundary:

```bash
npm run start:api
npm run start:whatsapp
npm run start:worker
npm run start:ai-worker
```

Tambien existen variantes `dev:*` con `nodemon`.

## Estructura base

```text
src/
  services/
    api/
    whatsapp/
    worker/
    ai-worker/
  platform/
    auth/
    billing/
    database/
    tenancy/
  tenant/
    database/
    repositories/
    services/
    state/
    catalog/
    orders/
    conversations/
  queues/
    directQueue.js
    names.js
    producers/
    processors/
  integrations/
    whatsapp/
    anthropic/
    openai/
    email/
  observability/
    logger.js
    metrics.js
  config/
    env.js
  shared/
    constants/
    utils/
    validation/
```

## Responsabilidades

`src/services/api` es el servicio HTTP de plataforma. Maneja configuracion, admin, auth, billing, health y metrics. No debe procesar conversaciones ni llamar LLM.

`src/services/whatsapp` es el servicio HTTP para webhooks de Meta. Debe validar requests, resolver tenant minimo, responder rapido y delegar el trabajo a `queues/producers/whatsappInboundProducer.js`.

`src/services/worker` es el proceso de background. Ejecuta tareas existentes: billing check, scheduler premium y reactivaciones. Con `QUEUE_MODE=bullmq` consume `whatsapp.inbound` desde Redis/BullMQ.

`src/services/ai-worker` es el boundary para trabajos AI asincronos. Con `AI_QUEUE_MODE=bullmq` registra el processor de `ai.requests`.

`src/platform` contiene reglas y datos de la plataforma SaaS: tenant resolution, allocations, billing, auth, provisioning y DB de plataforma.

`src/tenant` contiene datos operativos por tenant: catalogo, sesiones, conversaciones, mensajes, ordenes y workflows. Todo acceso debe pasar por `tenantContext` o adaptadores tenant-aware.

`src/queues` contiene el contrato de colas. Los nombres estables viven en `src/queues/names.js`. `QUEUE_MODE=direct` sigue siendo el default compatible; `QUEUE_MODE=memory` usa el bus directo en memoria; `QUEUE_MODE=bullmq` usa Redis/BullMQ.

`src/integrations` contiene adaptadores a proveedores externos como WhatsApp, Anthropic, OpenAI y email. Aqui no deben vivir reglas de negocio.

`src/observability` contiene logger, metrics y tracing futuro. En fase 1 reexporta modulos existentes para migracion gradual.

`src/config` contiene carga y validacion de variables de entorno.

`src/shared` contiene codigo puro y transversal: constantes, formatters y schemas. No debe usar DB, Redis, HTTP ni variables de entorno directamente.

## Carpetas legacy

Estas carpetas siguen activas como wrappers o legacy mientras se migra modulo por modulo:

```text
src/core
src/tenants
src/webhooks
src/billing
src/notifications
src/utils
```

No se deben expandir con features nuevas salvo que sea temporal y de bajo riesgo.

## Canonicos movidos en fase 2

```text
src/services/whatsapp/webhooks/router.js
src/services/whatsapp/webhooks/verifier.js
src/services/whatsapp/ingestion/dispatcher.js
src/services/worker/schedules/premiumScheduler.js
src/platform/billing/billingService.js
src/platform/tenancy/repository.js
src/platform/tenancy/loader.js
src/platform/auth/tenantAuthMiddleware.js
src/tenant/repositories/whatsappConfigRepository.js
src/services/api/routes/whatsappConfigRouter.js
```

Detalle completo: `docs/architecture/folder-structure.md`.

## Canonicos introducidos en fase 3

```text
src/queues/directQueue.js
src/queues/producers/whatsappInboundProducer.js
src/queues/processors/whatsappInboundProcessor.js
```

El webhook ya llama al producer de `whatsapp.inbound`; el procesamiento real sigue intacto en modo directo.

## Canonicos introducidos en fase 4

```text
src/queues/mode.js
src/queues/bullmqQueue.js
src/queues/producers/aiRequestsProducer.js
src/queues/processors/aiRequestsProcessor.js
```

`whatsapp.inbound` puede ejecutarse entre procesos con `QUEUE_MODE=bullmq`. AI se activa de forma separada con `AI_QUEUE_MODE=bullmq` para no acoplar el despliegue del webhook al `ai-worker`.

## Boundary ESM fase 9

`src/queues` ya es el primer boundary convertido a ESM completo. Tiene su propio `src/queues/package.json` con `"type": "module"` y usa `import`/`export` internamente.

El resto de `src` sigue CommonJS temporalmente. Los consumidores (`webhook`, `worker`, `ai-worker`, `server` y AI) entran al boundary con `import()` en puntos async. Los caminos directos usados por tests/Jest conservan fallback CommonJS fuera de `src/queues`, porque la suite actual sigue sin `--experimental-vm-modules`.

## Boundary ESM fase 10

`src/services/whatsapp` ya es ESM completo para el proceso separado de webhooks. Incluye `server.js`, `app.js`, `webhooks/router.js`, `webhooks/verifier.js` y `ingestion/dispatcher.js`.

El monolito legacy mantiene `src/webhooks/*` en CommonJS como capa de compatibilidad hasta que `src/app.js` y el resto de servicios se conviertan. Redis/BullMQ siguen externos y solo se usan cuando `QUEUE_MODE=bullmq`.

## Boundaries ESM fases 11 y 12

`src/services/worker` y `src/services/ai-worker` ya son ESM. El worker separado usa `src/services/worker/schedules/premiumScheduler.js`; el monolito legacy usa `src/core/scheduler.js` como copia CommonJS temporal.

Los entrypoints ESM (`worker/index.js` y `ai-worker/index.js`) no arrancan timers cuando `NODE_ENV=test`, para permitir smokes de importacion sin procesos en background.

## Boundary ESM fase 13

`src/services/api` ya es ESM completo. Incluye `server.js`, `app.js` y `routes/whatsappConfigRouter.js`.

El monolito legacy mantiene `src/tenants/configRouter.js` como compatibilidad CommonJS hasta convertir o retirar `src/app.js`.

## Sistema de modulos

La raiz declara `"type": "module"`. Como puente progresivo, `src/package.json` y `tests/package.json` mantienen CommonJS para el runtime y la suite existentes. La conversion real a ESM debe hacerse por boundary completo y esta documentada en `docs/architecture/module-system.md`.

## Docker por servicios

`docker-compose.dev.yml` y `docker-compose.prod.yml` levantan `api`, `whatsapp` y `worker` como servicios separados por defecto. `ai-worker` vive bajo el perfil `ai` y el proceso monolitico historico vive bajo el perfil `legacy`. El compose no levanta PostgreSQL/MySQL ni Redis; esas dependencias son externas. Detalle operativo en `docs/architecture/docker-topology.md`.

## Infraestructura externa

Fase 7 alinea configuracion y healthchecks con infraestructura externa real:

```text
PLATFORM_DATABASE_URL       # DB de metadata SaaS; fallback temporal: DATABASE_URL
TENANT_DATABASE_URL_DEFAULT # allocation tenant compartida default; fallback temporal: DATABASE_URL
REDIS_URL                   # Redis externo para BullMQ/cache/locks
REDIS_TLS                   # true o rediss:// para Redis administrado con TLS
```

Los endpoints `/health` reportan `platform_db`, `tenant_default_db`, `redis`, `redis_required`, `queue_mode` y `ai_queue_mode`. En produccion y en modo BullMQ, `REDIS_URL` es requerido. `REDIS_PASSWORD` queda opcional cuando el password ya viene embebido en `REDIS_URL`.

## Limites operativos

Fase 8 agrega limites de CPU, memoria y `pids_limit` en `docker-compose.prod.yml`. Los procesos Node tambien fijan `NODE_OPTIONS=--max-old-space-size=...` para que el heap quede por debajo del limite del contenedor.

Los limites iniciales son conservadores: `api` y `whatsapp` quedan livianos, `worker` recibe mas CPU para procesar colas, `ai-worker` tiene mas memoria para requests AI, y `app` legacy conserva margen mientras exista. Dev no fija limites para no interferir con hot reload.

## Reglas

1. Nuevas rutas HTTP viven en `src/services/{service}`.
2. Reglas SaaS viven en `src/platform`.
3. Reglas operativas por tenant viven en `src/tenant`.
4. APIs externas viven en `src/integrations`.
5. Producers, processors y nombres de cola viven en `src/queues`.
6. Codigo compartido solo va en `src/shared` si no tiene IO.
7. Tenant-domain no debe importar directamente `src/db.js` ni `src/drizzle/db.js`.
8. Esta app no ejecuta migraciones desde runtime ni scripts de aplicacion.

## Siguiente fase sugerida

1. Probar `QUEUE_MODE=bullmq` contra Redis externo real en ambiente dev/staging.
2. Activar `AI_QUEUE_MODE=bullmq` con `start:ai-worker` en ambiente controlado.
3. Eliminar wrappers legacy cuando tests y scripts apunten a canonicos.
4. Migrar `src/app.js`/`src/server.js` legacy o retirarlos cuando ya no sean necesarios.
5. Convertir core/tenant/platform compartidos por boundaries.
