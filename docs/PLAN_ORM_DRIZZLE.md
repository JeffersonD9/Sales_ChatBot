# Plan ORM / Drizzle

Documento archivado. La app puede usar Drizzle para consultar, insertar y actualizar datos, pero no debe ejecutar migraciones desde sus procesos ni desde sus scripts npm.

Reglas vigentes:

- `drizzle/schema.js` puede servir como referencia de tipos/tablas.
- El schema real se administra fuera del runtime de esta app.
- `api`, `whatsapp`, `worker` y `ai-worker` no ejecutan `drizzle-kit migrate`.
- Los repositorios tenant-domain deben recibir `tenantContext` y usar `ConnectionManager`.
- Platform DB y tenant DBs deben tener conexiones separables por variables de entorno.

Ver [`../CLAUDE.md`](../CLAUDE.md) para el roadmap actualizado.

