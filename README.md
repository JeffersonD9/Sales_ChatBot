# WhatsApp SaaS — Plataforma multitenant de bots de ventas

Plataforma que permite gestionar múltiples bots de ventas por WhatsApp desde un único servidor. Cada cliente (tenant) tiene su propio número, catálogo de productos y configuración, completamente aislados entre sí.

Construido para **Jest Tech Solutions**.

---

## Cómo funciona

Un mensaje de WhatsApp llega al servidor y se enruta al bot correcto por el slug del tenant en la URL:

```
POST /webhook/boutique-ana  →  bot de Boutique Ana
POST /webhook/tienda-ropa   →  bot de Tienda Ropa
```

El bot guía al cliente por un flujo de ventas conversacional:

```
hola → Menú → Catálogo (talla + presupuesto) → Selección → Pedido → Confirmación
```

Al completar un pedido, el dueño del negocio recibe una notificación inmediata en su WhatsApp.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js 20 |
| Framework | Express |
| Base de datos | PostgreSQL 16 |
| Cache / sesiones | Redis 7 |
| Proxy / SSL | Nginx + Let's Encrypt |
| Contenedores | Docker + Docker Compose |
| API de mensajería | Meta WhatsApp Cloud API |

---

## Estructura del proyecto

```
src/
├── app.js                      # Express: middlewares y routers
├── server.js                   # Entry point, tareas periódicas, graceful shutdown
├── db.js                       # Pool PostgreSQL singleton
├── redis.js                    # Cliente Redis singleton
├── admin/                      # API de administración (/admin/*)
├── core/
│   ├── botService.js           # Procesar mensajes y actualizar config del bot
│   ├── catalog.js              # Filtrar productos por talla y presupuesto
│   ├── flow-engine/
│   │   ├── engine.js           # Router principal del flujo conversacional
│   │   └── steps/              # Handlers por estado (menu, catalog, order...)
│   ├── state/
│   │   └── manager.js          # Sesiones en RAM + PostgreSQL
│   └── whatsapp/
│       ├── parser.js           # Parsear mensajes entrantes de Meta
│       └── sender.js           # Enviar mensajes via Meta Cloud API
├── notifications/
│   └── notifier.js             # Notificaciones al dueño (WhatsApp + email)
├── tenants/
│   ├── loader.js               # Cache de tenants (TTL 5 min)
│   ├── repository.js           # SQL de tenants y productos
│   ├── configRepository.js     # Config avanzada del bot con cache Redis
│   ├── authMiddleware.js       # JWT auth + rate limiting por tenant
│   └── configRouter.js         # API REST /api/whatsapp/*
├── utils/
│   ├── constants.js            # STEP enum — estados del flujo
│   ├── crypto.js               # AES-256-CBC para tokens
│   ├── formatters.js           # Formateo de precios, teléfonos, nombres
│   ├── logger.js               # Logger Pino estructurado
│   ├── botConfigSchema.js      # Schema Zod de configuración del bot
│   └── validateEnv.js          # Validación de variables de entorno al arranque
└── webhooks/
    ├── dispatcher.js           # Deduplicación y despacho de mensajes
    ├── router.js               # GET/POST /webhook/:slug
    └── verifier.js             # Verificación HMAC-SHA256 de Meta

migrations/
├── 001_initial_schema.sql      # Tablas: tenants, products, sessions, orders
└── 002_tenant_whatsapp_config.sql  # Config avanzada del bot con pgcrypto + RLS

scripts/
├── create-tenant.js            # CLI para crear un nuevo cliente
├── import-products.js          # Importar catálogo desde CSV
├── migrate.js                  # Correr migrations pendientes
├── init-letsencrypt.sh         # Bootstrap SSL con Let's Encrypt
└── products-template.csv       # Template de catálogo

docs/
├── CREAR_TENANT.md             # Guía paso a paso para crear un tenant
├── ONBOARDING_CLIENTE.md       # Proceso completo de onboarding por cliente
├── RUNBOOK.md                  # Operación diaria, backups, troubleshooting
├── BACKLOG.md                  # Tareas pendientes priorizadas
└── SPRINT_STATUS.md            # Estado del deploy a producción
```

---

## Configuración inicial (desarrollo)

**Requisitos:** Docker Desktop, Node.js 20, Git.

```bash
# 1. Clonar
git clone https://github.com/JeffersonD9/Sales_ChatBot.git
cd Sales_ChatBot

# 2. Variables de entorno
cp .env.dev.example .env

# 3. Levantar todo (app + postgres + redis con hot reload)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# 4. Verificar
curl http://localhost:3000/health
# {"status":"ok", ...}
```

Con `DEMO_MODE=true` (valor por defecto en `.env.dev.example`) la app levanta sin DB real. Podés probar el flujo completo en `http://localhost:3000/demo`.

---

## Configuración con base de datos real

```bash
# 1. Cambiar DEMO_MODE=false en .env

# 2. Correr migrations
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app npm run migrate

# 3. Crear un tenant de prueba
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app \
  node scripts/create-tenant.js \
    --slug=test-local \
    --name="Test Local" \
    --wa-token=DUMMY \
    --phone-id=000000000000000 \
    --verify-token=test_token_123 \
    --owner-phone=573000000000

# 4. Verificar webhook
curl "http://localhost:3000/webhook/test-local?hub.mode=subscribe&hub.verify_token=test_token_123&hub.challenge=12345"
# Respuesta: 12345
```

---

## Comandos útiles

```bash
# Alias recomendado
alias dcdev="docker compose -f docker-compose.yml -f docker-compose.dev.yml"

dcdev up -d                              # levantar en background
dcdev logs -f app                        # ver logs del bot
dcdev exec app npm run migrate           # correr migrations
dcdev exec app npm test                  # correr tests
dcdev down                               # apagar
dcdev down -v                            # apagar + borrar volúmenes (reset total)
```

---

## Tests

```bash
npm test                  # todos los tests
npm run test:unit         # solo unitarios
npm run test:coverage     # reporte de cobertura
```

Cobertura actual: **46 tests** en 4 suites.

| Suite | Tests |
|-------|-------|
| `webhooks/verifier` | 7 — HMAC válido, ausente, alterado, malformado |
| `core/catalog` | 25 — filterProducts, alternativas, store info, offers |
| `utils/formatters` | 14 — formatPrice, formatPhone, capitalizeName |
| `tenants/configRepository` | 11 — cache Redis, DB, validación Zod |

---

## Agregar un nuevo cliente

Ver el proceso completo en [`docs/ONBOARDING_CLIENTE.md`](docs/ONBOARDING_CLIENTE.md).

Resumen en 3 pasos:

```bash
# 1. Crear tenant
node scripts/create-tenant.js \
  --slug=boutique-ana \
  --name="Boutique Ana" \
  --wa-token=EAAxxxxx \
  --phone-id=123456789012345 \
  --verify-token=ana_verify_token \
  --owner-phone=573001234567

# 2. Importar productos
node scripts/import-products.js --slug=boutique-ana --file=data/productos.json

# 3. Registrar webhook en Meta Business
# URL: https://bots.jesttech.com/webhook/boutique-ana
# Verify token: el mismo del paso 1
```

---

## API

### Webhooks (Meta Cloud API)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/webhook/:slug` | Verificación del webhook (handshake Meta) |
| `POST` | `/webhook/:slug` | Recibir mensajes — requiere HMAC-SHA256 válido |

### Config del bot (Auth: `Authorization: Bearer <JWT>`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/whatsapp/config` | Leer configuración del bot |
| `PUT` | `/api/whatsapp/config` | Crear o actualizar configuración |
| `DELETE` | `/api/whatsapp/config` | Eliminar configuración |
| `POST` | `/api/whatsapp/webhook` | Procesar mensaje manualmente |

### Admin (Auth: `X-Api-Key: <ADMIN_API_KEY>`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/admin/tenants` | Listar todos los tenants |
| `POST` | `/admin/tenants` | Crear tenant |
| `GET` | `/admin/tenants/:slug/products` | Ver productos |
| `POST` | `/admin/tenants/:slug/products` | Agregar producto |

---

## Variables de entorno

Ver [`.env.example`](.env.example) para producción y [`.env.dev.example`](.env.dev.example) para desarrollo.

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `DATABASE_URL` | ✅ | URL de conexión PostgreSQL |
| `REDIS_URL` | ✅ | URL de conexión Redis |
| `META_APP_SECRET` | ✅ | Secret de la Meta App (verificación HMAC) |
| `ENCRYPTION_KEY` | ✅ | 64 hex chars — AES-256 para tokens de WhatsApp |
| `APP_SECRET` | ✅ | 32+ chars — pgcrypto para config avanzada |
| `ADMIN_API_KEY` | ✅ | API key para endpoints `/admin/*` |
| `JWT_SECRET` | ✅ | Firma de JWT para tenants |
| `DEMO_MODE` | ❌ | `true` para levantar sin DB real |

Generar los secrets:
```bash
node -e "const c=require('crypto'); console.log('ENCRYPTION_KEY='+c.randomBytes(32).toString('hex')); console.log('APP_SECRET='+c.randomBytes(32).toString('hex')); console.log('ADMIN_API_KEY='+c.randomBytes(32).toString('hex')); console.log('JWT_SECRET='+c.randomBytes(32).toString('hex'));"
```

---

## Deploy a producción

Ver el estado actual del deploy en [`docs/SPRINT_STATUS.md`](docs/SPRINT_STATUS.md).

Flujo resumido:
1. Provisionar VPS (Ubuntu 22.04, Docker, UFW)
2. Clonar repo y configurar `.env` con secrets reales
3. Correr migrations: `node scripts/migrate.js`
4. Activar SSL: `bash scripts/init-letsencrypt.sh bots.jesttech.com tu@email.com`
5. Levantar stack: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`

Para operación diaria ver [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

---

## Seguridad

- Webhooks verificados con HMAC-SHA256 (`timingSafeEqual`) antes de procesar
- Tokens de WhatsApp encriptados con AES-256-CBC en la DB
- Campos sensibles encriptados con `pgcrypto` (PostgreSQL)
- Row Level Security (RLS) habilitado para aislamiento entre tenants
- Rate limiting en nginx (20 req/s global) y en Redis (por tenant)
- Headers OWASP: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- Usuario non-root en el contenedor Docker de producción
- Validación de inputs con Zod en todos los endpoints de configuración

---

## Licencia

Propietario — Jest Tech Solutions. Uso interno.
