# Migración a Drizzle ORM

## Por qué Drizzle

- DX: autocomplete de campos, errores en escritura, no más strings SQL sueltos.
- Queries como código: el schema es la fuente de verdad.
- Drizzle genera y aplica migrations automáticamente.
- No aleja del SQL cuando se necesita — `sql\`...\`` para pgcrypto y RLS.
- Sin binario externo (Prisma usa Rust engine) — cero overhead en runtime.

> Raw SQL no es el problema de escala. La decisión es puramente de DX.

---

## Stack resultante

```
drizzle-orm     → cliente ORM (runtime)
drizzle-kit     → CLI de migrations y schema push (devDependency)
pg              → driver PostgreSQL (ya instalado)
```

---

## Schema — tablas

| Tabla | Migration origen |
|-------|-----------------|
| `tenants` | 001 + 004 + 007 |
| `products` | 001 + 005 |
| `sessions` | 001 |
| `orders` | 001 |
| `tenant_whatsapp_config` | 002 |
| `panel_users` | 006 |
| `panel_sessions` | 006 |
| `panel_rate_limits` | 006 |

---

## Archivos que cambian

| Archivo | Cambio |
|---------|--------|
| `src/db.js` | Sin cambios — sigue siendo el pool `pg` |
| `src/drizzle/db.js` | **Nuevo** — wrapper Drizzle sobre el pool |
| `src/drizzle/schema.js` | **Nuevo** — definición de todas las tablas |
| `drizzle.config.js` | **Nuevo** — config de drizzle-kit |
| `src/tenants/repository.js` | Queries → Drizzle |
| `src/tenants/configRepository.js` | Queries → Drizzle (pgcrypto sigue como raw sql) |
| `src/core/state/manager.js` | Queries → Drizzle |
| `src/admin/router.js` | Queries → Drizzle |
| `src/billing/billingService.js` | Queries → Drizzle |
| `src/panel/auth/service.js` | Queries → Drizzle |
| `package.json` | Nuevos scripts `db:generate`, `db:migrate`, `db:studio` |
| `migrations/legacy/` | Los `.sql` originales se archivan aquí |
| `scripts/migrate.js` | Reemplazado por `drizzle-kit migrate` |

---

## Casos especiales

- **pgcrypto** (`pgp_sym_encrypt/decrypt`): Drizzle no tiene helpers. Se usa el tag `` sql`...` `` de Drizzle directamente en `configRepository.js` — limpio y explícito.
- **RLS**: sigue configurado en la migration Drizzle inicial como SQL custom (Drizzle soporta SQL raw en migrations).
- **`CREATE EXTENSION IF NOT EXISTS pgcrypto`**: va en la migration 0000 de Drizzle.

---

## Criterios de "done"

- [ ] `npm run db:migrate` en DB limpia crea todas las tablas.
- [ ] `npm test` pasa sin errores.
- [ ] App levanta en DEMO_MODE sin errores.
- [ ] App levanta con DB real y responde en `/health`.
- [ ] Un mensaje llega, se procesa y se persiste en `sessions`.
- [ ] No quedan `require('../db')` con `.query()` en repositorios (solo en el wrapper Drizzle y casos raw justificados).
- [ ] `migrations/*.sql` archivados en `migrations/legacy/`.
