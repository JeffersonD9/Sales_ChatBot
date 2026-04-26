# whatsapp-saas

Plataforma SaaS multi-tenant de bots de ventas por WhatsApp. Un solo proceso, N clientes aislados.

> Para entender la arquitectura en detalle (flujos, capas de datos, aislamiento multi-tenant), ver [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Comandos de desarrollo

```bash
# Levantar entorno completo (app + postgres + redis con hot reload)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Alias recomendado
alias dcdev="docker compose -f docker-compose.yml -f docker-compose.dev.yml"
dcdev up -d                              # en background
dcdev logs -f app                        # ver logs
dcdev exec app npm run migrate           # correr migrations SQL
dcdev exec app node scripts/create-tenant.js --slug=demo ...
dcdev down                               # apagar
dcdev down -v                            # apagar + borrar volúmenes (reset total)
```

**Sin Docker (solo Node):**
```bash
npm run dev          # nodemon, requiere postgres y redis locales
npm start            # producción
npm test             # todos los tests
npm run test:unit    # solo unitarios
npm run migrate      # correr migrations SQL pendientes
```

---

## Setup inicial (primera vez)

```bash
# 1. Copiar variables de entorno para desarrollo
cp .env.dev.example .env

# 2. Levantar infra + app
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# 3. Correr migrations (con DEMO_MODE=false en .env)
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app npm run migrate

# 4. Verificar en http://localhost:3000/health
```

Con `DEMO_MODE=true` (valor por defecto en `.env.dev.example`): no necesitas correr migrations.
La app levanta sin DB real y puedes probar el flujo en http://localhost:3000/demo.

---

## Arquitectura

### Flujo de un mensaje entrante
```
POST /webhook/:slug
  → verifier.js       verificar HMAC-SHA256
  → dispatcher.js     cargar tenant, deduplicar, cargar sesión
  → engine.js         router por session.step
  → steps/*.js        handler específico
  → sender.js         responder vía Meta Cloud API
```

### Flujo de configuración avanzada del bot
```
PUT /api/whatsapp/config
  → authMiddleware.js  verificar JWT del tenant
  → configRouter.js   validar body
  → botService.js     validateBotConfig (Zod) → saveConfig
  → configRepository  DB (pgcrypto) → bust Redis cache
```

### Acceso a datos por capa

| Capa | Tecnología | TTL | Propósito |
|------|-----------|-----|-----------|
| L1 RAM | `Map` en `state/manager.js` | proceso | sesiones de conversación activas |
| L1 RAM | `Map` en `tenants/loader.js` | 5 min | config básica del tenant (token, productos) |
| L2 Redis | `tenants/configRepository.js` | 5 min | config avanzada del bot (`tenant_whatsapp_config`) |
| L3 PostgreSQL | toda lectura/escritura | — | fuente de verdad |

### Machine de estados (STEP enum — `utils/constants.js`)
```
NEW → MENU → OPT_CATALOGO → CATALOG_TALLA → CATALOG_PRESUPUESTO → CATALOG_SHOWING
                                               → CATALOG_SELECTING / CATALOG_OBJECTION → ORDER_NAME
           → ORDER_NAME → ORDER_ADDRESS → ORDER_PAYMENT → ORDER_DONE
           → CHECK_ORDER
```
Comandos globales (`menu`, `hola`, `inicio`, `0`) resetean a MENU desde cualquier step.

---

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/app.js` | Express: middleware y routers |
| `src/db.js` | Pool PostgreSQL singleton |
| `src/redis.js` | Cliente Redis singleton |
| `src/tenants/loader.js` | Cache de tenants (slug → objeto completo con productos) |
| `src/tenants/repository.js` | SQL de tenants y productos |
| `src/tenants/configRepository.js` | CRUD de `tenant_whatsapp_config` con caché Redis |
| `src/tenants/authMiddleware.js` | JWT auth + rate limiting por tenant |
| `src/tenants/configRouter.js` | API REST `/api/whatsapp/*` |
| `src/core/botService.js` | Lógica del bot: procesar mensaje, init, actualizar config |
| `src/core/flow-engine/engine.js` | Router principal de mensajes — empezar aquí para bugs de flujo |
| `src/core/whatsapp/sender.js` | Llamadas a Meta Cloud API (`graph.facebook.com/v20.0`) |
| `src/utils/botConfigSchema.js` | Schema Zod de `bot_config` |
| `src/webhooks/router.js` | `GET /webhook/:slug` (verify) + `POST /webhook/:slug` (mensajes) |
| `src/webhooks/verifier.js` | HMAC-SHA256 con `timingSafeEqual` |
| `src/admin/router.js` | API admin (`/admin/*`) para gestionar tenants y productos |
| `migrations/001_initial_schema.sql` | Tablas: `tenants`, `products`, `sessions`, `orders` |
| `migrations/002_tenant_whatsapp_config.sql` | Tabla `tenant_whatsapp_config` con pgcrypto + RLS |

---

## Infraestructura Docker

### Archivos

| Archivo | Propósito |
|---------|-----------|
| `Dockerfile` | Multi-stage: `dev` (hot reload) + `runner` (producción) |
| `docker-compose.yml` | Base: servicios compartidos (postgres + redis) |
| `docker-compose.dev.yml` | Override dev: app con nodemon, puertos expuestos |
| `docker-compose.prod.yml` | Override prod: app + nginx + certbot (pendiente) |
| `.dockerignore` | Excluye node_modules, .env, tests de la imagen |
| `.env.dev.example` | Template para desarrollo (DEMO_MODE=true por defecto) |
| `.env.example` | Template para producción |
| `nginx/nginx.conf` | Config nginx (HTTP→HTTPS + proxy) — para producción |

### Por qué dos compose files

`docker-compose.yml` define solo postgres y redis (infra compartida).
El override dev añade el servicio `app` con volumen montado para hot reload y expone puertos de infra para herramientas locales.
El override prod añadirá nginx + certbot y removerá los puertos expuestos de infra.

---

## Schema de base de datos

### `tenants` (migration 001)
Clientes del SaaS. Contiene el token Meta encriptado a nivel aplicación (`ENCRYPTION_KEY`), `bot_config` JSONB con metadata básica del negocio.

### `products` (migration 001)
Catálogo por tenant. `filterProducts(products, talla, budget)` en `core/catalog.js` los filtra y ordena.

### `sessions` (migration 001)
Estado de cada conversación. PK compuesta `(tenant_id, wa_from)`. UPSERT en cada mensaje. L1 RAM en `state/manager.js`.

### `orders` (migration 001)
Pedidos generados por el bot.

### `tenant_whatsapp_config` (migration 002)
Config avanzada del bot. 1:1 con `tenants`. Campos `session_data` y `webhook_secret` encriptados con `pgp_sym_encrypt` (pgcrypto, llave `APP_SECRET`). RLS habilitado.

---

## API `/api/whatsapp` — Auth: `Authorization: Bearer <JWT>`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/webhook` | Procesar mensaje (fire-and-forget, 200 inmediato) |
| `GET` | `/config` | Leer `bot_config` del tenant |
| `PUT` | `/config` | Crear/actualizar config del bot |
| `DELETE` | `/config` | Eliminar config |

---

## Variables de entorno

```env
# App
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Base de datos
DATABASE_URL=postgresql://app:PASSWORD@postgres:5432/whatsapp_saas
DB_PASSWORD=PASSWORD            # mismo password del DATABASE_URL

# Redis
REDIS_URL=redis://redis:6379

# Seguridad
META_APP_SECRET=                # Secret de Meta App (HMAC webhook)
ENCRYPTION_KEY=                 # AES-256 para wa_token (64 hex chars)
APP_SECRET=                     # pgcrypto para tenant_whatsapp_config (min 32 chars)
ADMIN_API_KEY=                  # Header X-Api-Key para /admin/*
JWT_SECRET=                     # Firma tokens de tenant para /api/whatsapp/*

# Demo
DEMO_MODE=false
DEMO_SLUG=demo-store
DEMO_BUSINESS_NAME=Glamour Store (Demo)
DEMO_OWNER_PHONE=573001234567
DEMO_CITY=Bucaramanga
DEMO_SCHEDULE=Lun-Sab 9am-7pm

# Email (opcional — solo si SMTP_HOST está definido)
# SMTP_HOST= SMTP_PORT= SMTP_USER= SMTP_PASS=
```

---

## Tests

```bash
npm run test:unit                                         # todos los unitarios
jest tests/unit/tenants/configRepository.test.js         # solo el repository
```

Convenciones:
- Mock de `db.js` y `redis.js` en tests unitarios con `jest.mock()`
- `--forceExit` siempre (timers del server.js mantienen el proceso vivo)
- `NODE_ENV=test` desactiva DB real y tareas periódicas

Tests pendientes (aún no escritos):
- `src/webhooks/verifier.js` — HMAC válido e inválido
- `src/core/whatsapp/parser.js`
- `src/core/catalog.js`
- `src/core/state/manager.js`
- `src/core/flow-engine/steps/menu.js`
- Integration test del webhook con slug

---

## Agregar un nuevo cliente

```bash
# 1. Crear el tenant en la BD
node scripts/create-tenant.js \
  --slug=nueva-tienda \
  --name="Nueva Tienda" \
  --wa-token=EAAxxxxx \
  --phone-id=PHONE_NUMBER_ID \
  --verify-token=TOKEN \
  --owner-phone=573001234567

# 2. Registrar la URL en Meta Business:
#    https://bots.jesttech.com/webhook/nueva-tienda
#
# No hay que reiniciar el servidor. El loader.js carga el
# nuevo tenant automáticamente en el primer mensaje entrante.
```

---

## Estado del proyecto

| Qué | Estado |
|-----|--------|
| Código base completo | ✅ |
| Redis + caché por tenant | ✅ |
| JWT auth + rate limiting | ✅ |
| Tests unitarios configRepository (11 tests) | ✅ |
| Entorno Docker dev | ✅ |
| Base de datos en VPS | Pendiente |
| Migrations corridas | Pendiente |
| Redis en VPS | Pendiente |
| docker-compose.prod.yml | Pendiente |
| SSL / nginx | Pendiente |
| Tests del flujo principal | Pendiente |
| cliente1 migrado a la nueva BD | Pendiente |
| Deploy en VPS | Pendiente |
