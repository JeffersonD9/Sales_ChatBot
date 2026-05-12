# Module system

El repo declara `"type": "module"` en la raiz para que el codigo nuevo pueda usar ESM por defecto.

La migracion del runtime existente todavia es progresiva. `src/package.json` y `tests/package.json` mantienen `"type": "commonjs"` temporalmente porque la mayoria de modulos productivos y tests siguen usando `require`, `module.exports` y `jest.mock` CommonJS.

## Estado actual

- Raiz del repo: ESM por defecto.
- `src/`: CommonJS temporal para no romper modulos productivos pendientes ni tests.
- `src/queues`: ESM por boundary mediante `src/queues/package.json`.
- `src/services/whatsapp`: ESM por boundary mediante `src/services/whatsapp/package.json`.
- `src/services/worker`: ESM por boundary mediante `src/services/worker/package.json`.
- `src/services/ai-worker`: ESM por boundary mediante `src/services/ai-worker/package.json`.
- `src/services/api`: ESM por boundary mediante `src/services/api/package.json`.
- `tests/`: CommonJS temporal para conservar la suite Jest actual.
- Nuevos archivos fuera de scopes CommonJS pueden usar `import`/`export`.
- Nuevos archivos dentro de `src/` deben seguir el estilo del boundary donde viven hasta convertir ese boundary completo.

## Regla de conversion

La conversion a ESM debe hacerse por boundary completo, no archivo suelto:

1. Convertir imports/exports del modulo canonico.
2. Convertir wrappers legacy que lo reexportan.
3. Ajustar tests del boundary.
4. Ejecutar la suite.
5. Documentar el boundary convertido y retirar el scope CommonJS solo cuando `src/` completo este listo.

## Prioridad sugerida

1. Core/tenant/platform compartidos.
2. Reducir CommonJS por boundary completo.

## Boundary queues

Fase 9 convierte `src/queues` a ESM completo:

```text
src/queues/package.json
src/queues/names.js
src/queues/mode.js
src/queues/directQueue.js
src/queues/bullmqQueue.js
src/queues/producers/*.js
src/queues/processors/*.js
```

Los consumidores CommonJS cargan el boundary con `import()` solo en puntos async. Para mantener Jest CommonJS sin `--experimental-vm-modules`, los caminos directos que no usan cola conservan fallback CommonJS fuera del boundary.

## Boundary WhatsApp

Fase 10 convierte `src/services/whatsapp` a ESM completo:

```text
src/services/whatsapp/package.json
src/services/whatsapp/server.js
src/services/whatsapp/app.js
src/services/whatsapp/webhooks/*.js
src/services/whatsapp/ingestion/dispatcher.js
```

El proceso `npm run start:whatsapp` usa este boundary ESM. Los wrappers CommonJS de `src/webhooks/*` fueron retirados en fase 17 despues de migrar los tests al app canonico.

## Boundaries Worker y AI Worker

Fases 11 y 12 convierten los procesos background a ESM:

```text
src/services/worker/package.json
src/services/worker/index.js
src/services/worker/schedules/premiumScheduler.js
src/services/ai-worker/package.json
src/services/ai-worker/index.js
```

Los schedules canonicos viven en `src/services/worker/schedules/premiumScheduler.js`. Los entrypoints ESM no arrancan timers al importarse en `NODE_ENV=test`, lo que permite smoke tests limpios sin levantar workers reales.

## Boundary API

Fase 13 convierte `src/services/api` a ESM completo:

```text
src/services/api/package.json
src/services/api/server.js
src/services/api/app.js
src/services/api/routes/whatsappConfigRouter.js
```

`src/tenants/configRouter.js` fue retirado en fase 17; el API canonico usa `src/services/api/routes/whatsappConfigRouter.js`.

## Inventario legacy fases 14-18

Los wrappers CommonJS que solo reexportaban modulos canonicos ya fueron retirados cuando dejaron de tener consumidores:

- `src/tenants/*`
- `src/billing/billingService.js`
- `src/integrations/whatsapp/*`
- `src/integrations/email/notifier.js`
- `src/observability/logger.js`
- `src/shared/*`

Siguen vivos modulos CommonJS reales bajo `src/core`, `src/utils`, `src/notifications`, `src/platform` y `src/tenant`, pendientes de convertir por boundary.

La limpieza aplicada fue mover `src/queues/producers/whatsappInboundProducer.js` al dispatcher canonico ESM para que el boundary de colas no dependa del dispatcher CommonJS.

Criterio de retiro: eliminar un wrapper solo cuando no haya imports productivos ni tests apuntandole, y cuando su modulo canonico pueda cargarse desde el boundary que lo consume.

## Ciclo de vida HTTP fase 15

Los entrypoints HTTP ESM exportan `startServer()` y `shutdown()`, y solo arrancan listeners fuera de `NODE_ENV=test`. Importar `src/services/api/server.js` o `src/services/whatsapp/server.js` en smokes ya no abre puertos ni valida env de proceso hasta llamar `startServer()`.

## Retiro runtime monolitico fase 16

`src/server.js`, `src/core/scheduler.js`, `npm run start:legacy`, `npm run dev:legacy` y el perfil Docker `legacy` fueron retirados. `npm start` y `npm run dev` apuntan a `api`; la operacion completa local se hace con Docker Compose (`api`, `whatsapp`, `worker`).

Los restos CommonJS que quedan son compatibilidad de tests o boundaries aun no convertidos, no rutas operativas del runtime.

## Retiro wrappers HTTP fase 17

La suite Jest corre con `node --experimental-vm-modules` para poder importar boundaries ESM canonicos. Los tests de webhook apuntan a `src/services/whatsapp/app.js` y `src/services/whatsapp/webhooks/verifier.js`.

Con eso se retiraron:

- `src/app.js`
- `src/webhooks/verifier.js`
- `src/webhooks/router.js`
- `src/webhooks/dispatcher.js`
- `src/tenants/configRouter.js`

## Retiro aliases fase 18

La limpieza final de aliases retiro `src/tenants/*`, `src/billing/billingService.js`, aliases de `integrations`, aliases de `observability`, aliases de `shared` y la ruta HTTP `/demo`. El API separado ya no monta `demoRouter`; el worker y WhatsApp usan imports canonicos.

## Boundary Observability fase 19

`src/observability` ya es ESM completo:

```text
src/observability/package.json
src/observability/health.js
src/observability/metrics.js
```

`src/metrics.js` fue retirado. Los servicios HTTP montan `/metrics` desde `src/observability/metrics.js` y `/health` desde `src/observability/health.js`.

## Boundary Middleware fase 20

`src/middleware` ya es ESM completo:

```text
src/middleware/package.json
src/middleware/cors.js
src/middleware/security.js
```

Los servicios HTTP importan CORS, security headers, slug validation y rate limits como exports nombrados. Esta fase cierra la limpieza de la superficie HTTP productiva; el CommonJS restante vive en dominios de negocio o infraestructura compartida y debe migrarse solo por boundaries completos.
