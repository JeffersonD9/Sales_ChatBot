# /dev-up — Levantar y auditar el entorno de desarrollo

Levanta el entorno de desarrollo, detecta migraciones pendientes, cambios de esquema, actualizaciones de paquetes y cualquier cosa que requiera atención antes de empezar a trabajar. Ejecuta todos los pasos en orden sin preguntar.

**Directorio de trabajo:** `D:\Users\Jefferson\Documents\Proyectos-2026\Bots\whatsapp-saas`
**Comando docker base:** `docker compose -f docker-compose.yml -f docker-compose.dev.yml`

---

## PASO 1 — Estado de contenedores

Ejecuta:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps --format json
```

- Si todos los servicios (`app`, `postgres`, `redis`) están en estado `running`/`healthy` → continuar al PASO 2.
- Si alguno no está corriendo → ejecutar:
  ```
  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
  ```
  Esperar 6 segundos. Luego verificar estado de nuevo. Si sigue fallando: mostrar el error y detenerse.

---

## PASO 2 — Health check

Llama a `http://localhost:3000/health`.

Parsea la respuesta JSON:
- `db: "connected"` y `redis: "connected"` → ✅ infraestructura OK
- Cualquier otro valor → ❌ mostrar el campo que falla, sus logs y detenerse.
- Si `demo_mode: true` → advertir que la app corre en modo demo (sin DB real).

---

## PASO 3 — Migraciones pendientes

### 3a. Detectar archivos de migración sin aplicar (Drizzle)

Lee el directorio `drizzle/migrations/` (si existe). Si no existe o está vacío: saltar al 3b.

Busca el archivo `drizzle/migrations/meta/_journal.json`. Si existe, lee su campo `entries[]` para saber cuáles migraciones ya están registradas.

Luego lista los archivos `.sql` en `drizzle/migrations/`. Si hay archivos cuyo `tag` no aparece en el journal → hay migraciones pendientes.

Si hay migraciones pendientes:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app npm run migrate
```
Muestra el output. Si falla con error: mostrarlo completo y detenerse.

### 3b. Detectar cambios de esquema sin migración generada

Compara el schema definido en `src/drizzle/schema.js` con las migraciones existentes.

La forma más confiable es correr:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app npx drizzle-kit generate --name=check_pending 2>&1
```

- Si el output contiene `No schema changes` o `Nothing to migrate` → ✅ esquema sincronizado.
- Si genera un nuevo archivo SQL → hay cambios en el schema sin migración. Borrar el archivo generado (`git checkout -- drizzle/migrations/`) y advertir al usuario: "⚠️ El schema tiene cambios sin migrar — ejecuta `npm run db:generate` para crear la migración."

> Si drizzle-kit no está disponible en el contenedor, usar directamente desde el host: `npx drizzle-kit generate --name=check_pending`

---

## PASO 4 — Variables de entorno

Lee el archivo `.env` (si existe). Si no existe → advertir que falta `.env` y sugerir `cp .env.dev.example .env`.

Lee `.env.dev.example` y extrae todas las variables definidas (líneas que no empiecen con `#` y tengan `=`).

Compara contra las variables presentes en `.env`. Lista las que están en el ejemplo pero ausentes en `.env`.

- Sin ausentes → ✅
- Con ausentes → ⚠️ listar cada variable faltante con su comentario del `.env.dev.example`

---

## PASO 5 — Tests unitarios

Ejecuta:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app npm run test:unit 2>&1
```

Si el contenedor no tiene los módulos instalados o falla por eso, ejecutar directamente:
```
npm run test:unit 2>&1
```

Parsea el resultado final:
- `Tests: N passed` sin fallos → ✅ `N tests pasando`
- Hay tests fallidos → ❌ listar los nombres de los tests que fallaron (no el stack trace completo, solo el título)

---

## PASO 6 — Dependencias desactualizadas

Ejecuta (en el host, no en Docker):
```
npm outdated --json 2>/dev/null || npm outdated
```

Clasifica los resultados:
- **Parches** (`wanted` difiere solo en patch, ej. 1.2.3 → 1.2.4) → `ℹ️ parche disponible`
- **Menores** (`wanted` difiere en minor, ej. 1.2.x → 1.3.0) → `⚠️ actualización menor`
- **Mayores** (`wanted` difiere en major, ej. 1.x.x → 2.0.0) → `🔴 breaking change`

Si no hay paquetes desactualizados → ✅

---

## PASO 7 — Git status

Ejecuta:
```
git status --short
git log --oneline -5
```

Reporta:
- Archivos modificados sin commitear → listar (máx 10, luego "... y N más")
- Archivos sin trackear → listar solo si son relevantes (no `node_modules`, no `*.log`)
- Commits recientes (los 5 últimos, solo hash corto + mensaje)

---

## PASO 8 — Resumen final

Muestra un resumen con semáforo por área. Formato exacto:

```
╔══════════════════════════════════════════════════════════╗
║              ESTADO DEL ENTORNO DE DESARROLLO            ║
╠══════════════════════════════════════════════════════════╣
║  Contenedores    [✅/❌]  <detalle>                      ║
║  DB / Redis      [✅/❌]  <detalle>                      ║
║  Migraciones     [✅/⚠️]  <detalle>                      ║
║  Variables .env  [✅/⚠️]  <detalle>                      ║
║  Tests unitarios [✅/❌]  <N tests pasando / N fallando> ║
║  Dependencias    [✅/⚠️]  <N paquetes con updates>       ║
║  Git             [✅/⚠️]  <N archivos modificados>       ║
╚══════════════════════════════════════════════════════════╝
```

Luego una sección **"Acción requerida"** (solo si hay ⚠️ o ❌):

```
## Acción requerida

1. <descripción concisa del problema y el comando para resolverlo>
2. ...
```

Si todo es ✅, escribir simplemente:

```
Todo en orden. El entorno está listo para desarrollar.
```

---

## Notas de comportamiento

- No pedir confirmación en ningún paso, excepto antes de ejecutar `npm run migrate` en producción (verificar siempre que `NODE_ENV=development`).
- Si Docker Desktop no está corriendo (el daemon no responde), instrucciones al usuario: "Inicia Docker Desktop y vuelve a ejecutar `/dev-up`." Detenerse ahí.
- Si la app corre en modo `DEMO_MODE=true`: los pasos de migración y DB se marcan como "N/A (demo mode)" sin error.
- Los errores de `npm outdated` donde el paquete no tiene versión en el registro se ignoran silenciosamente.
