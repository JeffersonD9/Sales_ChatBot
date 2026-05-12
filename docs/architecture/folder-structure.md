# Folder structure

Este documento describe la estructura objetivo despues de la fase 4 de reorganizacion. El objetivo sigue siendo progresivo: separar boundaries sin apagar el MVP ni romper imports historicos.

## Servicios

```text
src/services/
  api/
    app.js
    server.js
    routes/
  whatsapp/
    app.js
    server.js
    webhooks/
    ingestion/
  worker/
    index.js
    processors/
    schedules/
  ai-worker/
    index.js
    processors/
```

`services/api` contiene HTTP de plataforma: configuracion del bot, demo, metrics, health y futuras rutas admin/billing.

`services/whatsapp` contiene el boundary HTTP de Meta: verificacion, raw body, firma HMAC y despacho inicial de eventos entrantes. El POST del webhook pasa por `queues/producers/whatsappInboundProducer.js`.

`services/worker` contiene procesos de background: schedules, processors y jobs no HTTP. El scheduler premium vive en `services/worker/schedules/premiumScheduler.js`, y registra el processor de `whatsapp.inbound` segun el modo de cola.

`services/ai-worker` es el boundary para trabajos AI asincronos. Con `AI_QUEUE_MODE=bullmq` consume `ai.requests`.

## Dominios

```text
src/platform/
  auth/
  billing/
  database/
  tenancy/

src/tenant/
  database/
  repositories/
  services/
  state/
  catalog/
  orders/
  conversations/
```

`platform` contiene reglas SaaS y metadatos globales: autenticacion, billing, tenancy, allocations y conexiones.

`tenant` contiene datos operativos por tenant: catalogo, configuracion WhatsApp tenant-aware, sesiones, conversaciones y ordenes.

## Integraciones y soporte

```text
src/integrations/
  whatsapp/
  anthropic/
  openai/
  email/

src/queues/
  names.js
  producers/
  processors/

src/observability/
src/config/
src/shared/
src/drizzle/
```

`integrations` contiene adaptadores a APIs externas. No debe contener reglas de negocio.

`queues` contiene contratos de cola, producers y processors. Los nombres estables viven en `queues/names.js`.

En fase 4 existen adaptadores directos y BullMQ:

```text
src/queues/directQueue.js
src/queues/bullmqQueue.js
src/queues/mode.js
src/queues/producers/whatsappInboundProducer.js
src/queues/processors/whatsappInboundProcessor.js
src/queues/producers/aiRequestsProducer.js
src/queues/processors/aiRequestsProcessor.js
```

`QUEUE_MODE=direct` mantiene el comportamiento del MVP: el producer llama al dispatcher en background dentro del proceso del webhook. `QUEUE_MODE=memory` usa un registro de processors en memoria, util para pruebas locales de contrato pero no para separar procesos. `QUEUE_MODE=bullmq` usa Redis/BullMQ para que `services/worker` procese `whatsapp.inbound`.

`AI_QUEUE_MODE=direct` mantiene AI en proceso. `AI_QUEUE_MODE=bullmq` envia `ai.requests` al `services/ai-worker`.

`observability` contiene logger, metrics y tracing futuro.

`config` centraliza env y settings.

`shared` contiene utilidades puras sin IO.

`drizzle` contiene schema y cliente ORM. No ejecutar migraciones desde runtime.

## Wrappers legacy

Estas rutas siguen existiendo solo como compatibilidad:

```text
src/webhooks/*
src/billing/billingService.js
src/tenants/*
src/core/scheduler.js
```

Regla: no agregar funcionalidad nueva ahi. Si hay un cambio real, hacerlo en el modulo canonico y dejar el wrapper exportando.

## Modulos canonicos de fase 2

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

## Modulos canonicos de fase 3

```text
src/queues/directQueue.js
src/queues/producers/whatsappInboundProducer.js
src/queues/processors/whatsappInboundProcessor.js
```

## Modulos canonicos de fase 4

```text
src/queues/mode.js
src/queues/bullmqQueue.js
src/queues/producers/aiRequestsProducer.js
src/queues/processors/aiRequestsProcessor.js
```

## Sistema de modulos

La raiz declara `"type": "module"`. `src/` y `tests/` siguen temporalmente en CommonJS mediante package scopes para preservar el runtime actual. La guia de migracion esta en `docs/architecture/module-system.md`.

## Docker

La topologia Docker default separa `api`, `whatsapp` y `worker`. `ai-worker` se activa con el perfil `ai`; el proceso unico historico se conserva con el perfil `legacy`. Docker no define bases de datos ni Redis en este repo; esos servicios son externos. Ver `docs/architecture/docker-topology.md`.

## Reglas anti-mezcla

1. `api` no procesa mensajes conversacionales.
2. `whatsapp/webhooks` responde rapido y debe hablar con producers, no con processors.
3. `worker` ejecuta jobs y schedules, no expone rutas HTTP.
4. `platform` puede conocer tenants como cuentas SaaS; no debe implementar flujos de venta.
5. `tenant` no debe depender de Express ni de detalles de Meta.
6. `integrations` no decide reglas de negocio.
7. `shared` no usa DB, Redis, HTTP ni env directo.
8. Las rutas legacy son temporales y deben reducirse con cada fase.
