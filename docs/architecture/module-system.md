# Module System

El repo ya no usa `src/` como runtime activo.

## Regla actual

- `apps/*` contiene entrypoints y logica propia de cada servicio desplegable.
- `packages/*` contiene contratos compartidos entre servicios.
- `src/` queda deprecado y solo conserva `src/README.md` como marcador historico.

## Paquetes activos

- `@whatsapp-saas/config`: variables de entorno y configuracion de infraestructura.
- `@whatsapp-saas/logger`: logger Pino compartido.
- `@whatsapp-saas/platform-data`: DB, Redis, tenancy, billing, auth tenant-aware y repositorios.
- `@whatsapp-saas/shared-types`: contratos JSDoc entre servicios.
- `@whatsapp-saas/shared-utils`: utilidades puras, crypto, schemas y constantes.
- `@whatsapp-saas/queues`: nombres de colas y adaptadores BullMQ/direct.
- `@whatsapp-saas/http-runtime`: middleware HTTP, health y metrics.
- `@whatsapp-saas/notifications`: notificaciones operativas.

## Regla de imports

Las apps deben importar paquetes por nombre:

```js
import loggerModule from '@whatsapp-saas/logger';
import { QUEUES } from '@whatsapp-saas/queues/names.js';
```

No crear nuevos imports hacia `src/*`.

## CommonJS y ESM

- La raiz del repo usa `"type": "module"`.
- Algunos paquetes siguen en CommonJS porque son consumidos por codigo legacy movido a `apps/message-worker/core` y `apps/ai-orchestrator/core`.
- Los paquetes ESM explicitos son `@whatsapp-saas/queues` y `@whatsapp-saas/http-runtime`.
- La conversion completa a ESM puede hacerse por paquete, sin revivir `src`.
