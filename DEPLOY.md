# Deploy Guide — JestSolution WhatsApp SaaS

Stack completo: API Core · WhatsApp Bot · Worker · Dashboard · Redis · PostgreSQL · Nginx

**VPS objetivo:** Hostinger KVM2 (4 vCPU / 8 GB RAM) — Ubuntu 22.04

> El panel admin (`dashboard`) es un servicio **opcional** controlado por el perfil `--profile dashboard`.
> Puede desacoplarse de esta infraestructura en cualquier momento — ver [sección al final](#desacople-del-panel-admin).

---

## Requisitos previos

```bash
# Docker + Compose v2
curl -fsSL https://get.docker.com | sh
docker compose version   # debe ser >= 2.x

# Certbot (para TLS)
snap install --classic certbot
ln -s /snap/bin/certbot /usr/bin/certbot
```

---

## 1. Clonar el repo en el VPS

```bash
git clone https://github.com/JeffersonD9/Sales_ChatBot.git /opt/jestsolution
cd /opt/jestsolution
```

---

## 2. DNS (Hostinger)

Crear dos registros A apuntando a la IP de la VPS:

| Tipo | Host      | Valor      |
|------|-----------|------------|
| A    | `@`       | `<IP_VPS>` |
| A    | `admin`   | `<IP_VPS>` |

Esperar propagación (normalmente < 30 min). Verificar:

```bash
dig jestsolution.tech +short
dig admin.jestsolution.tech +short
```

---

## 3. Variables de entorno

```bash
cp .env.example .env
nano .env
```

Campos obligatorios a completar:

```dotenv
# ── Base de datos ─────────────────────────────────────────────────────────────
DB_PASSWORD=<genera: openssl rand -hex 24>
POSTGRES_USER=app
POSTGRES_DB=postgres
PLATFORM_DB_NAME=platform
TENANT_DB_NAME_DEFAULT=tenant_shared_low

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_PASSWORD=<genera: openssl rand -hex 24>
REDIS_URL=redis://:REDIS_PASSWORD@redis:6379

# ── Seguridad del bot ─────────────────────────────────────────────────────────
META_APP_SECRET=<de Meta Developers>
ENCRYPTION_KEY=<genera: openssl rand -hex 32>
APP_SECRET=<genera: openssl rand -hex 32>
ADMIN_API_KEY=<genera: openssl rand -hex 32>
JWT_SECRET=<genera: openssl rand -hex 32>

# ── IA ───────────────────────────────────────────────────────────────────────
AI_ENABLED=true
AI_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_API_KEY=<de Google AI Studio>
AI_QUEUE_MODE=direct
# Alternativa compatible:
# AI_PROVIDER=anthropic
# ANTHROPIC_API_KEY=sk-ant-...

# Schedulers premium
ENABLE_PREMIUM_SCHEDULER=false

# ── Dominios ─────────────────────────────────────────────────────────────────
DOMAIN=jestsolution.tech
ADMIN_DOMAIN=admin.jestsolution.tech
CERTBOT_EMAIL=jeffersonm0915@gmail.com

# ── Dashboard ────────────────────────────────────────────────────────────────
DASHBOARD_AUTH_SECRET=<genera: openssl rand -hex 32>
DASHBOARD_SESSION_TTL_SECONDS=28800
DASHBOARD_ALLOWED_IPS=          # vacío = sin restricción; o pon tu IP fija
```

---

## 4. Directorios de datos

```bash
mkdir -p /var/whatsapp-saas/postgres
mkdir -p /var/whatsapp-saas/media
```

---

## 5. TLS Bootstrap (primera vez)

El nginx definitivo necesita los certificados antes de arrancar.
Usa el nginx-bootstrap para obtener el primer certificado Let's Encrypt:

```bash
# Paso 5a — levantar nginx mínimo para el desafío ACME
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  --profile tls-bootstrap up -d nginx-bootstrap

# Paso 5b — certificado para el dominio del bot
certbot certonly --webroot \
  -w ./certbot/www \
  -d jestsolution.tech \
  --email jeffersonm0915@gmail.com \
  --agree-tos --non-interactive

# Paso 5c — certificado para el panel admin
certbot certonly --webroot \
  -w ./certbot/www \
  -d admin.jestsolution.tech \
  --email jeffersonm0915@gmail.com \
  --agree-tos --non-interactive

# Paso 5d — bajar bootstrap
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  --profile tls-bootstrap down nginx-bootstrap
```

---

## 6. Permisos de base de datos

Las tablas se crean automáticamente al primer `up` (via `bootstrap.sh`).
Los usuarios con permisos restringidos para el panel se crean manualmente:

```bash
# Esperar que postgres esté sano:
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  exec postgres pg_isready -U app -d platform

# Usuario del panel (platform DB — tenants, auth):
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  exec -T postgres psql -U app -d platform \
  -f /dev/stdin < apps/dashboard/scripts/setup-db-permissions.sql

# Usuario de solo lectura (tenant DB — orders, sessions, products, messages):
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  exec -T postgres psql -U app -d tenant_shared_low \
  -f /dev/stdin < apps/dashboard/scripts/setup-db-permissions-tenant.sql

# Asignar contraseñas a los usuarios creados:
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  exec postgres psql -U app -d platform -c \
  "ALTER USER dashboard_app PASSWORD '<MISMA_QUE_EN_DATABASE_URL>';"

docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  exec postgres psql -U app -d tenant_shared_low -c \
  "ALTER USER dashboard_ro PASSWORD '<MISMA_QUE_EN_TENANT_DATABASE_URL>';"
```

> En el `.env` de producción, las variables `DATABASE_URL` y `TENANT_DATABASE_URL`
> del dashboard usan el usuario `app` (el mismo del bot) porque están en la red
> interna. Solo en acceso externo se recomienda `dashboard_app` / `dashboard_ro`.

---

## 7. Deploy completo

```bash
cd /opt/jestsolution

# Bot + panel admin (configuración por defecto)
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  --profile dashboard up -d --build

# Bot + panel admin + AI worker
# Requiere AI_QUEUE_MODE=bullmq en .env para que el worker envie solicitudes a la cola AI.
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  --profile dashboard --profile ai up -d --build

# Solo el bot (sin panel admin)
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml up -d --build
```

Verificar que todos los servicios están sanos:

```bash
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml ps
```

Deberías ver todos en `(healthy)`:

```
NAME                         STATUS
whatsapp-saas-postgres       Up (healthy)
whatsapp-saas-redis          Up (healthy)
whatsapp-saas-api            Up (healthy)
whatsapp-saas-whatsapp       Up (healthy)
whatsapp-saas-worker         Up (healthy)
jestsolution-dashboard       Up (healthy)
whatsapp-saas-nginx          Up (healthy)
```

---

## 8. Crear el primer usuario admin del panel

```bash
# Opción A — desde el contenedor (pnpm)
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  exec dashboard pnpm admin:create

# Opción B — desde el host si pnpm está instalado
cd apps/dashboard
DATABASE_URL="postgresql://app:<DB_PASSWORD>@localhost:5432/platform" \
  pnpm admin:create
```

---

## 9. Verificar endpoints

```bash
# Bot API
curl https://jestsolution.tech/health

# Panel admin
curl https://admin.jestsolution.tech/api/health

# Webhook (handshake Meta)
curl "https://jestsolution.tech/webhook/<slug>?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=test"
```

---

## 10. Actualizaciones (deploys posteriores)

```bash
cd /opt/jestsolution
git pull

# Rebuild solo los servicios que cambiaron (el resto se reutiliza del cache)
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  up -d --build

# Para forzar rebuild del dashboard solo:
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  up -d --build dashboard

# Para forzar rebuild de los servicios del bot:
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  up -d --build api whatsapp worker
```

---

## 11. Logs

```bash
# Todos los servicios en tiempo real
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml logs -f

# Solo el dashboard
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  logs -f dashboard

# Solo el bot
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  logs -f api whatsapp worker
```

---

## 12. Renovación de certificados

Certbot corre como servicio dentro del stack (`whatsapp-saas-certbot`) y renueva
automáticamente cada 12 horas. Verificar manualmente:

```bash
certbot renew --dry-run
```

Para forzar renovación:

```bash
certbot renew --force-renewal
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  exec nginx nginx -s reload
```

---

## 13. Backup manual de la DB

```bash
# Platform DB
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  exec postgres pg_dump -U app platform | gzip > backups/platform_$(date +%Y%m%d).sql.gz

# Tenant shared DB
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  exec postgres pg_dump -U app tenant_shared_low | gzip > backups/tenant_shared_$(date +%Y%m%d).sql.gz
```

---

## Troubleshooting

**nginx no arranca — cert no encontrado:**
```bash
# Verificar que existen los certs
ls -la certbot/conf/live/jestsolution.tech/
ls -la certbot/conf/live/admin.jestsolution.tech/
# Si no existen, repetir paso 5
```

**Dashboard no conecta a DB:**
```bash
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  exec dashboard wget -qO- http://localhost:3001/api/health
# Si falla, verificar DATABASE_URL y TENANT_DATABASE_URL en .env
```

**El panel muestra "No autenticado" después de crear el usuario:**
```bash
# Verificar que DASHBOARD_AUTH_SECRET está en .env (mínimo 32 chars)
grep DASHBOARD_AUTH_SECRET .env
```

---

## Desacople del panel admin

Cuando necesites mover el panel a su propia infraestructura (otra VPS, otro
servicio, recursos dedicados), son exactamente 3 cambios:

### Paso 1 — Desconectar nginx del panel

En `infra/nginx/Dockerfile`, reemplazar:
```dockerfile
COPY templates /etc/nginx/templates
```
por:
```dockerfile
COPY templates/bot.conf.template /etc/nginx/templates/
```

Rebuild nginx: `docker compose ... up -d --build nginx`

### Paso 2 — Quitar el servicio del compose

En `infra/compose/docker-compose.prod.yml`, eliminar el bloque `dashboard:` completo
(el que tiene `profiles: [dashboard]`).

El bot, redis, postgres y nginx siguen exactamente igual. Sin cambios en ningún otro servicio.

### Paso 3 — Limpiar variables de entorno del bot

En `.env`, eliminar (o ignorar):
```
ADMIN_DOMAIN
DASHBOARD_AUTH_SECRET
DASHBOARD_SESSION_TTL_SECONDS
DASHBOARD_ALLOWED_IPS
```

---

### Deploy independiente del panel

Una vez desacoplado, el código vive en `apps/dashboard/` y tiene todo lo que necesita:
su propio `Dockerfile`, `pnpm-lock.yaml` y `scripts/`.

```bash
# En el nuevo servidor / servicio
git clone https://github.com/JeffersonD9/Sales_ChatBot.git /opt/jestsolution
cd /opt/jestsolution/apps/dashboard

# Variables de entorno (apuntando a la DB existente por IP/hostname)
cp .env.example .env
nano .env
# DATABASE_URL=postgresql://dashboard_app:PASSWORD@<IP_POSTGRES>:5432/platform
# TENANT_DATABASE_URL=postgresql://dashboard_ro:PASSWORD@<IP_POSTGRES>:5432/tenant_shared_low
# AUTH_SECRET=<openssl rand -hex 32>

# Build y levantar (con su propio nginx/caddy aparte)
docker build -t jestsolution/dashboard:latest .
docker run -d \
  --name dashboard \
  --env-file .env \
  -p 127.0.0.1:3001:3001 \
  --restart unless-stopped \
  jestsolution/dashboard:latest
```

La BD sigue siendo la misma — solo cambia la red desde donde se accede.
Los usuarios del panel (`dashboard_app`, `dashboard_ro`) ya tienen permisos
restringidos, así que no hay riesgo de exponer el bot.
