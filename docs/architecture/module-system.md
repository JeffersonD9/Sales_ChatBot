# Module system

El repo declara `"type": "module"` en la raiz para que el codigo nuevo pueda usar ESM por defecto.

La migracion del runtime existente todavia es progresiva. `src/package.json` y `tests/package.json` mantienen `"type": "commonjs"` temporalmente porque la mayoria de modulos productivos y tests siguen usando `require`, `module.exports` y `jest.mock` CommonJS.

## Estado actual

- Raiz del repo: ESM por defecto.
- `src/`: CommonJS temporal para no romper `npm start`, `npm run dev`, workers ni tests.
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

1. Wrappers legacy.
2. Core/tenant/platform compartidos.

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

El proceso separado `npm run start:whatsapp` usa este boundary ESM. El `app` legacy conserva compatibilidad CommonJS en `src/webhooks/*` para mantener `npm start`, `npm run dev` y la suite Jest actual sin convertir todo el monolito al mismo tiempo.

## Boundaries Worker y AI Worker

Fases 11 y 12 convierten los procesos background a ESM:

```text
src/services/worker/package.json
src/services/worker/index.js
src/services/worker/schedules/premiumScheduler.js
src/services/ai-worker/package.json
src/services/ai-worker/index.js
```

`src/core/scheduler.js` queda como compatibilidad CommonJS para el monolito legacy hasta convertir `src/server.js`/`src/app.js`. Los entrypoints ESM no arrancan timers al importarse en `NODE_ENV=test`, lo que permite smoke tests limpios sin levantar workers reales.

## Boundary API

Fase 13 convierte `src/services/api` a ESM completo:

```text
src/services/api/package.json
src/services/api/server.js
src/services/api/app.js
src/services/api/routes/whatsappConfigRouter.js
```

El monolito legacy conserva `src/tenants/configRouter.js` como wrapper CommonJS real para mantener `src/app.js` sin dependencias sincronas hacia boundaries ESM.
