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
    anthropic/
    openai/
  observability/
  middleware/
  config/
    env.js
```

## Responsabilidades

`src/services/api` es el servicio HTTP de plataforma. Maneja configuracion, admin, auth, billing, health y metrics. No expone la UI demo retirada, no debe procesar conversaciones ni llamar LLM.

`src/services/whatsapp` es el servicio HTTP para webhooks de Meta. Debe validar requests, resolver tenant minimo, responder rapido y delegar el trabajo a `queues/producers/whatsappInboundProducer.js`.

`src/services/worker` es el proceso de background. Ejecuta tareas existentes: billing check, scheduler premium y reactivaciones. Con `QUEUE_MODE=bullmq` consume `whatsapp.inbound` desde Redis/BullMQ.

`src/services/ai-worker` es el boundary para trabajos AI asincronos. Con `AI_QUEUE_MODE=bullmq` registra el processor de `ai.requests`.

`src/platform` contiene reglas y datos de la plataforma SaaS: tenant resolution, allocations, billing, auth, provisioning y DB de plataforma.

`src/tenant` contiene datos operativos por tenant: catalogo, sesiones, conversaciones, mensajes, ordenes y workflows. Todo acceso debe pasar por `tenantContext` o adaptadores tenant-aware.

`src/queues` contiene el contrato de colas. Los nombres estables viven en `src/queues/names.js`. `QUEUE_MODE=direct` sigue siendo el default compatible; `QUEUE_MODE=memory` usa el bus directo en memoria; `QUEUE_MODE=bullmq` usa Redis/BullMQ.

`src/integrations` queda reservado para adaptadores reales a proveedores externos. Los aliases historicos de WhatsApp/email fueron retirados; el envio WhatsApp actual sigue en `src/core/whatsapp/sender.js` hasta migrar ese boundary completo.

`src/observability` es boundary ESM para health y metrics. Los aliases `logger`/`metrics` fueron retirados; el router Prometheus canonico vive en `src/observability/metrics.js`.

`src/middleware` es boundary ESM para CORS, security headers, slug validation y rate limits HTTP.

`src/config` contiene carga y validacion de variables de entorno.

`src/shared` queda reservado para codigo puro y transversal. Los aliases historicos fueron retirados; el codigo compartido actual sigue en `src/utils` hasta migrar ese boundary completo.

## Carpetas legacy

Estas carpetas siguen activas como codigo legacy real mientras se migra modulo por modulo:

```text
src/core
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

Los webhooks legacy CommonJS fueron retirados; Redis/BullMQ siguen externos y solo se usan cuando `QUEUE_MODE=bullmq`.

## Boundaries ESM fases 11 y 12

`src/services/worker` y `src/services/ai-worker` ya son ESM. El worker separado usa `src/services/worker/schedules/premiumScheduler.js`.

Los entrypoints ESM (`worker/index.js` y `ai-worker/index.js`) no arrancan timers cuando `NODE_ENV=test`, para permitir smokes de importacion sin procesos en background.

## Boundary ESM fase 13

`src/services/api` ya es ESM completo. Incluye `server.js`, `app.js` y `routes/whatsappConfigRouter.js`.

`src/tenants/configRouter.js` fue retirado; la ruta canonica vive en `src/services/api/routes/whatsappConfigRouter.js`.

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

No se eliminaron archivos en esta fase porque todos tienen consumidores activos. La limpieza aplicada fue desacoplar `src/queues/producers/whatsappInboundProducer.js` del dispatcher legacy; ahora tanto producer como processor usan `src/services/whatsapp/ingestion/dispatcher.js` como canonico ESM.

Los criterios de retiro quedan documentados en `docs/architecture/folder-structure.md`.

## Ciclo de vida HTTP fase 15

Los entrypoints ESM HTTP (`src/services/api/server.js` y `src/services/whatsapp/server.js`) separan `startServer()`/`shutdown()` del `app` exportado y no arrancan listeners cuando `NODE_ENV=test`. Esto permite smoke tests de imports sin abrir puertos y reduce efectos colaterales al componer servicios.

## Retiro runtime monolitico fase 16

Se retiro el runtime monolitico de las rutas operativas:

Se eliminaron `src/server.js`, `src/core/scheduler.js`, el perfil Docker del proceso unico y los scripts npm del proceso unico.

`npm start` y `npm run dev` ya no arrancan el monolito; apuntan a `api`. Los schedulers y consumers viven en `src/services/worker`, y los webhooks viven en `src/services/whatsapp`.

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

Tambien se movieron las referencias activas a sus modulos canonicos: WhatsApp webhook usa `src/platform/tenancy/loader.js`, el worker premium usa `src/core/whatsapp/sender.js`, y el test de configuracion apunta a `src/tenant/repositories/whatsappConfigRepository.js`.

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

`docker-compose.dev.yml` y `docker-compose.prod.yml` levantan `api`, `whatsapp` y `worker` como servicios separados por defecto. `ai-worker` vive bajo el perfil `ai`. El compose no levanta PostgreSQL/MySQL ni Redis; esas dependencias son externas. Detalle operativo en `docs/architecture/docker-topology.md`.

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

Los limites iniciales son conservadores: `api` y `whatsapp` quedan livianos, `worker` recibe mas CPU para procesar colas, y `ai-worker` tiene mas memoria para requests AI. Dev no fija limites para no interferir con hot reload.

## Reglas

1. Nuevas rutas HTTP viven en `src/services/{service}`.
2. Reglas SaaS viven en `src/platform`.
3. Reglas operativas por tenant viven en `src/tenant`.
4. APIs externas nuevas viven en `src/integrations` solo cuando sean adaptadores reales, no aliases.
5. Producers, processors y nombres de cola viven en `src/queues`.
6. Codigo compartido solo vuelve a `src/shared` si no tiene IO y se migra como boundary real, no como wrapper.
7. Tenant-domain no debe importar directamente `src/db.js` ni `src/drizzle/db.js`.
8. Esta app no ejecuta migraciones desde runtime ni scripts de aplicacion.

## Estado final del refactor progresivo

El runtime productivo queda separado por servicios, sin monolito ni wrappers HTTP legacy. Queda trabajo evolutivo, no bloqueante para este refactor:

1. Probar `QUEUE_MODE=bullmq` contra Redis externo real en ambiente dev/staging.
2. Activar `AI_QUEUE_MODE=bullmq` con `start:ai-worker` en ambiente controlado.
3. Convertir `core`, `notifications`, `utils`, `platform` y `tenant` por dominios completos cuando se vaya a tocar su logica de negocio.
