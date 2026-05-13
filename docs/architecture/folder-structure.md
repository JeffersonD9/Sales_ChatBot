# Folder Structure

Diagrama de referencia: [architecture-diagram.png](architecture-diagram.png)

```text
apps/
  api-core/
  wa-session-manager/
  message-worker/
  ai-orchestrator/

infra/
  nginx/
  postgres/
  redis/
  minio/
  compose/

packages/
  config/
  http-runtime/
  logger/
  notifications/
  platform-data/
  queues/
  shared-types/
  shared-utils/

scripts/
  README.md

src/
  README.md
```

## Apps

- `apps/api-core`: API SaaS, admin, tenants, billing y configuracion.
- `apps/wa-session-manager`: webhooks de Meta, validacion, rate limit y publicacion de eventos.
- `apps/message-worker`: procesamiento de mensajes, flujos, sesiones, schedules y jobs.
- `apps/ai-orchestrator`: runtime AI y procesador de `ai.requests`.

Cada app es un boundary desplegable. No debe importar internals de otra app como contrato permanente.

## Packages

- `packages/config`: env/configuracion compartida.
- `packages/http-runtime`: middleware HTTP, `/health` y `/metrics`.
- `packages/logger`: logger compartido.
- `packages/notifications`: notificaciones operativas.
- `packages/platform-data`: acceso a DB, Redis, tenancy, billing y repositorios.
- `packages/queues`: colas, nombres y adaptadores BullMQ/direct.
- `packages/shared-types`: contratos JSDoc.
- `packages/shared-utils`: utilidades puras, crypto, schemas y constantes.

## Infra

- `infra/compose`: overlays dev/prod de Docker Compose.
- `infra/nginx`: proxy, templates y Dockerfile.
- `infra/redis`: configuracion del Redis interno del stack.
- `infra/postgres`: SQL de referencia/inicializacion.
- `infra/minio`: configuracion futura de media/S3-compatible.

## Src Deprecado

`src/` ya no es una fuente activa de codigo productivo. Queda solo como marcador historico con `src/README.md`.

Reglas:

- No agregar nuevos archivos en `src`.
- No crear nuevos imports hacia `src/*`.
- Codigo compartido nuevo va en `packages/*`.
- Codigo especifico de servicio va en `apps/*`.
