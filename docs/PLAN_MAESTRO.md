# Plan Maestro

Este plan queda reemplazado por el modelo de arquitectura definido en [`../CLAUDE.md`](../CLAUDE.md).

Decision vigente:

- La app no ejecuta migraciones.
- La plataforma debe soportar tenants en DB compartidas low/medium y DBs dedicadas.
- AI debe ser opcional por tenant y procesarse de forma asincrona.
- API, WhatsApp, workers y AI workers deben separarse progresivamente.
- No asumir una unica base de datos global para siempre.

Orden de trabajo actual:

1. Mantener MVP operativo.
2. Separar platform DB y tenant DB a nivel de abstracciones.
3. Hacer tenant-aware los repositorios de sesiones, catalogo y pedidos.
4. Introducir BullMQ y mover webhooks/schedules/AI a workers.
5. Reestructurar Docker en servicios separados con limites de recursos.
6. Agregar backups independientes por platform DB y tenant DBs.

