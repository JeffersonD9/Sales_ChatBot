# Backlog post-produccion

Abordar **una vez que el bot este generando ingresos**. Ordenado por impacto.

---

## P0 — Semanas 2-3 post go-live

### Tests del flow-engine (steps menu / catalog / order)
Sin esto cualquier cambio al flujo puede romper la experiencia sin que nos demos cuenta.
Estimacion: 2 dias.

### Idempotencia persistente en Redis
Un reinicio del proceso durante un mensaje puede procesarlo dos veces.
Estimacion: 1 dia.

### Cola de notificaciones con reintentos
Si Meta API falla al notificar una venta al dueno, se pierde silenciosamente.
Estimacion: 1.5 dias.

---

## P1 — Mes 2

### Tests del parser y dispatcher
`src/core/whatsapp/parser.js` y `src/webhooks/dispatcher.js` sin cobertura.
Estimacion: 1 dia.

### Metricas Prometheus + Grafana
Ver volumen de mensajes, latencia y errores por tenant en tiempo real.
Estimacion: 1 dia.

### Cache bust atomico en configRepository
Condicion de carrera posible si dos requests actualizan config simultaneamente.
Estimacion: 0.5 dias.

---

## P2 — Mes 2-3

### Flow Engine declarativo (FASE 2)
Soportar flujos distintos por cliente (lead capture, soporte, citas) sin tocar codigo.
Ver `docs/PLAN_MAESTRO.md` Fase 2.
Estimacion: 3-4 semanas.

### UI admin para gestion de tenants
Panel web para crear clientes, ver ordenes y actualizar productos sin usar psql.
Estimacion: 1 semana.

### Dashboard de ventas por cliente
Resumen diario/semanal de ordenes y revenue por tenant.
Estimacion: 1 semana.

---

## P3 — Escalabilidad de base de datos (sharding progresivo)

### Contexto y estrategia

La DB actual (shard-01) es compartida por todos los tenants. Esto es correcto para
empezar, pero a medida que crezca el numero de clientes y su volumen de datos,
conviene distribuirlos entre multiples bases de datos.

**Umbral orientativo para mover un tenant a otro shard:**
- Mas de 400-500 productos activos, O
- Mas de 500 mensajes/dia sostenidos

**Regla de agrupacion:**
- Maximo 3-4 tenants medianos por shard compartido
- Tenants de alto volumen pasan a shard dedicado

**El campo `db_shard` en la tabla `tenants` ya existe** (migration 003).
Todos los tenants arrancan en `shard-01`. Cuando se migra uno, solo hay que
actualizar ese campo y el router de conexiones hace el resto.

```
FASE 1 — hoy               FASE 2 — crecimiento          FASE 3 — escala
────────────────────       ──────────────────────         ─────────────────────
shard-01 (DB actual)       shard-01                       shard-01
  cliente1                   cliente1 (~150 prods)          cliente1
  cliente2                   cliente2 (~200 prods)          cliente2
  clienteN                   cliente3 (~100 prods)
                                                           shard-02
                           shard-02                          cliente3
                             cliente4 (~300 prods)           cliente4
                             cliente5 (~250 prods)
                                                           shard-03 (dedicado)
                                                             clienteN (600 prods,
                                                             alto volumen)
```

---

### Tarea: Connection router multi-shard en `db.js`

**Cuando hacer esto:** al llegar al segundo shard (primer tenant que se migra).

**Que hay que cambiar:**

`src/db.js` hoy es un singleton con un solo pool. Hay que convertirlo en un
mapa de pools indexado por shard:

```javascript
// Antes
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Despues
const pools = new Map();

function getPoolForShard(shardId) {
  if (pools.has(shardId)) return pools.get(shardId);
  const url = process.env[`DATABASE_URL_${shardId.toUpperCase().replace('-','_')}`];
  // Ej: DATABASE_URL_SHARD_01, DATABASE_URL_SHARD_02
  const pool = new Pool({ connectionString: url, max: 20, ... });
  pools.set(shardId, pool);
  return pool;
}
```

Cada query necesita saber el shard del tenant antes de ejecutarse.
El tenant loader ya cachea el objeto completo del tenant (incluye `db_shard`),
asi que el dato esta disponible en cada request sin query extra.

**Archivos a modificar:**
- `src/db.js` — convertir singleton a mapa de pools
- `src/tenants/loader.js` — exponer `db_shard` en el objeto cacheado (ya lo trae de DB)
- `src/core/state/manager.js` — pasar shard al hacer queries de sesion
- `src/core/flow-engine/engine.js` — pasar shard al llamar handlers
- `src/tenants/repository.js` — queries de tenants siguen en shard-01 (el registro central)
- `.env` — agregar `DATABASE_URL_SHARD_02`, `DATABASE_URL_SHARD_03`, etc.

**Estimacion:** 2-3 dias + 1 dia de tests.

---

### Tarea: Script de migracion de tenant entre shards

Script CLI para mover todos los datos de un tenant de un shard a otro
sin downtime (copiar → verificar → activar → borrar origen).

```bash
node scripts/migrate-tenant-shard.js \
  --slug=boutique-grande \
  --from=shard-01 \
  --to=shard-02
```

**Pasos internos del script:**
1. Volcar `products`, `sessions`, `orders`, `tenant_whatsapp_config` del tenant
2. Insertar en la DB destino
3. Verificar conteos (origen == destino)
4. `UPDATE tenants SET db_shard = 'shard-02' WHERE slug = '...'`
5. Invalidar cache del tenant en Redis
6. Borrar datos del origen

**Estimacion:** 1 dia.

---

### Variables de entorno necesarias al activar shard-02

```env
# Shard 01 (actual)
DATABASE_URL_SHARD_01=postgresql://app:PASSWORD@postgres-01:5432/whatsapp_saas

# Shard 02 (cuando se active)
DATABASE_URL_SHARD_02=postgresql://app:PASSWORD@postgres-02:5432/whatsapp_saas
```

El `DATABASE_URL` existente pasa a ser el alias de `shard-01` y el registro
central de tenants (la tabla `tenants` siempre vive en shard-01).
