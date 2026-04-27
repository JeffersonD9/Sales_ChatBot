# SPRINT PRODUCCIÓN — Runbook ejecutable

**Versión:** 1.0
**Fecha:** 2026-04-26
**Duración:** 5 días hábiles
**Objetivo:** Cliente1 funcionando en producción al final de la semana, con webhook de Meta recibiendo mensajes reales y respondiendo correctamente.

---

## Cómo usar este documento

Este runbook está diseñado para ser ejecutado **paso a paso, en orden**, por Claude Code o un humano técnico. Cada tarea contiene:

1. **Contenido exacto** de archivos a crear/modificar (copia-pega).
2. **Comando exacto** a ejecutar.
3. **Verificación post-paso** — cómo confirmar que funcionó.
4. **Rollback** — qué hacer si falla.

> **Reglas de oro:**
> - **NO avanzar al siguiente paso si la verificación falla.** Detenerse, diagnosticar, arreglar.
> - **NO improvisar.** Si algo no aparece en este doc, preguntar antes de ejecutar.
> - **NO mezclar tareas de fases distintas.** Terminar una fase completa antes de la siguiente.
> - **Tareas marcadas con `[USUARIO]`** requieren acción humana (acceso a paneles externos, decisiones de negocio). Claude Code debe detenerse y pedir confirmación.

---

## Alcance del sprint

### IN-SCOPE (lo único que hacemos esta semana)
- Validación local del HMAC y flujo principal
- Generación de secrets de producción
- `docker-compose.prod.yml`, nginx con SSL, backups diarios
- Deploy en VPS
- Onboarding de cliente1
- Smoke test end-to-end con WhatsApp real

### OUT-OF-SCOPE (NO hacer esta semana, va al backlog)
- Tests automatizados (verifier, dispatcher, flow steps)
- Cola de notificaciones con reintentos
- Idempotencia persistente en Redis
- Métricas Prometheus
- Flow engine declarativo / templates custom
- UI de admin
- Alta de cliente2/cliente3 con flujo distinto

> Si durante el sprint surge la tentación de hacer algo OUT-OF-SCOPE: **anotar en `docs/BACKLOG.md` y seguir.** No tocar.

---

## Pre-requisitos (verificar ANTES de empezar)

Antes del Día 1, confirmar uno por uno:

- [ ] **VPS provisionado:** Ubuntu 22.04 LTS o superior, mínimo 2 GB RAM, 20 GB SSD, IP pública fija.
- [ ] **Acceso SSH al VPS** con usuario sudo (anotar IP, usuario, ruta a llave SSH).
- [ ] **Dominio configurado:** registro `A` apuntando a la IP del VPS. Verificar con `dig +short bots.jesttech.com` desde local. Debe responder con la IP exacta.
- [ ] **Cuenta Meta Business** con phone number aprobado para cliente1. Tener a mano:
  - WABA ID
  - Phone Number ID
  - Permanent Access Token (no el temporal de 24h)
  - App Secret (Configuración básica → Secret)
- [ ] **Repo accesible desde el VPS** (vía git clone HTTPS o SSH deploy key).
- [ ] **Productos de cliente1** en formato JSON o CSV listos para importar.
- [ ] **Email de owner para notificaciones** (opcional pero recomendado).

> Si **alguno** de estos pre-requisitos falla, **detenerse**. No continuar hasta resolverlos. Sin VPS o sin dominio no hay cómo seguir.

---

# DÍA 1 — Validación local y secrets

## Objetivo del día
Confirmar que el código actual funciona en local con la configuración de producción (no demo), generar todos los secrets reales, y validar que el HMAC de Meta funciona correctamente con un payload firmado.

## Tarea 1.1 — Generar secrets de producción

**Acción:**

Ejecutar localmente desde la raíz del proyecto:

```bash
node -e "
const c = require('crypto');
console.log('META_APP_SECRET=  [USUARIO: copiar desde Meta Business]');
console.log('ENCRYPTION_KEY=' + c.randomBytes(32).toString('hex'));
console.log('APP_SECRET=' + c.randomBytes(32).toString('hex'));
console.log('ADMIN_API_KEY=' + c.randomBytes(32).toString('hex'));
console.log('JWT_SECRET=' + c.randomBytes(32).toString('hex'));
console.log('DB_PASSWORD=' + c.randomBytes(24).toString('base64').replace(/[+/=]/g, ''));
"
```

Guardar el output en un gestor de contraseñas seguro (Bitwarden, 1Password). **No** pegar en Slack, email, o archivos sin cifrar.

**Verificación:**
- Cada valor tiene la longitud correcta:
  - `ENCRYPTION_KEY`: 64 caracteres hex
  - `APP_SECRET`, `ADMIN_API_KEY`, `JWT_SECRET`: 64 caracteres hex
  - `DB_PASSWORD`: 32+ caracteres alfanuméricos
- `META_APP_SECRET` copiado **sin espacios** del panel de Meta.

**Rollback:** N/A (solo generación, no se persiste nada aún).

---

## Tarea 1.2 — Crear `.env.prod` local para validación

**Acción:**

Crear archivo `.env.prod` en la raíz del proyecto (este archivo **nunca** se commitea, ya está en `.gitignore`).

```env
# .env.prod — validación local con configuración de producción
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

DATABASE_URL=postgresql://app:DB_PASSWORD_GENERADO@localhost:5432/whatsapp_saas
DB_PASSWORD=DB_PASSWORD_GENERADO

REDIS_URL=redis://localhost:6379

META_APP_SECRET=PEGAR_DEL_PANEL_DE_META
ENCRYPTION_KEY=GENERADO_EN_TAREA_1_1
APP_SECRET=GENERADO_EN_TAREA_1_1
ADMIN_API_KEY=GENERADO_EN_TAREA_1_1
JWT_SECRET=GENERADO_EN_TAREA_1_1

DEMO_MODE=false
```

**Verificación:**

```bash
# El archivo existe y está en .gitignore
test -f .env.prod && echo "OK"
grep -q "^.env.prod" .gitignore || echo ".env.prod" >> .gitignore
```

**Rollback:** Borrar el archivo. `rm .env.prod`.

---

## Tarea 1.3 — Levantar Postgres y Redis localmente con la config de producción

**Acción:**

```bash
# Copiar .env.prod a .env temporalmente para que docker-compose lo lea
cp .env .env.dev.backup
cp .env.prod .env

# Levantar SOLO postgres y redis (sin app)
docker compose up -d postgres redis

# Esperar 10 segundos
sleep 10

# Correr migrations
docker compose run --rm -v "$(pwd)":/app -w /app --network=whatsapp-saas_internal \
  -e DATABASE_URL="postgresql://app:DB_PASSWORD_GENERADO@postgres:5432/whatsapp_saas" \
  node:20-alpine sh -c "npm ci --omit=dev && node scripts/migrate.js"
```

**Verificación:**

```bash
# Postgres debe estar healthy
docker compose ps postgres | grep -q "healthy" && echo "OK postgres"

# Tablas creadas
docker compose exec postgres psql -U app -d whatsapp_saas -c "\dt"
# Debe listar: tenants, products, sessions, orders, tenant_whatsapp_config
```

**Rollback:**

```bash
docker compose down -v   # borra volúmenes y empieza de cero
cp .env.dev.backup .env
```

---

## Tarea 1.4 — Smoke test del flujo completo en local (sin Meta API)

**Acción:**

```bash
# Levantar la app en modo producción local
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d app

# Esperar a que arranque
sleep 15

# Verificar /health
curl -s http://localhost:3000/health
# Debe responder algo como: {"status":"ok","timestamp":"..."}
```

Crear un tenant de prueba con un token DUMMY (no se va a usar para llamar a Meta, solo para validar el flujo):

```bash
docker compose exec app node scripts/create-tenant.js \
  --slug=test-local \
  --name="Test Local" \
  --wa-token=DUMMY_TOKEN_FOR_LOCAL_TEST \
  --phone-id=000000000000000 \
  --verify-token=test_verify_token_123 \
  --owner-phone=573000000000
```

**Verificación:**

```bash
# El tenant se creó
docker compose exec postgres psql -U app -d whatsapp_saas \
  -c "SELECT slug, name, status FROM tenants WHERE slug='test-local';"

# Webhook GET (verificación de Meta) debe responder con el challenge
curl "http://localhost:3000/webhook/test-local?hub.mode=subscribe&hub.verify_token=test_verify_token_123&hub.challenge=12345"
# Debe responder: 12345
```

**Rollback:**

```bash
docker compose exec postgres psql -U app -d whatsapp_saas \
  -c "DELETE FROM tenants WHERE slug='test-local';"
```

---

## Tarea 1.5 — Smoke test del HMAC con payload firmado

**Crítico:** este es el test que valida que el código rechaza webhooks con firma inválida y acepta los válidos. Sin esto, **no se sale a producción**.

**Acción:**

Crear archivo temporal `scripts/smoke-hmac.js` (luego se borra):

```javascript
// scripts/smoke-hmac.js — Smoke test del HMAC verifier
// Uso: node scripts/smoke-hmac.js

const crypto = require('crypto');
const http = require('http');

const META_APP_SECRET = process.env.META_APP_SECRET;
if (!META_APP_SECRET) {
  console.error('ERROR: definir META_APP_SECRET en el entorno');
  process.exit(1);
}

const SLUG = 'test-local';
const HOST = 'localhost';
const PORT = 3000;

const payload = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'TEST_WABA_ID',
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: '000000000000000' },
        contacts: [{ wa_id: '573001234567', profile: { name: 'Test User' } }],
        messages: [{
          from: '573001234567',
          id: 'wamid.test_' + Date.now(),
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'text',
          text: { body: 'hola' },
        }],
      },
      field: 'messages',
    }],
  }],
});

function sign(body, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function postWebhook(signature) {
  return new Promise((resolve) => {
    const req = http.request({
      host: HOST,
      port: PORT,
      path: `/webhook/${SLUG}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-hub-signature-256': signature,
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.write(payload);
    req.end();
  });
}

(async () => {
  console.log('\n=== Test 1: HMAC válido ===');
  const validSig = sign(payload, META_APP_SECRET);
  const r1 = await postWebhook(validSig);
  console.log(`Status: ${r1.status} | Body: ${r1.body}`);
  if (r1.status !== 200) {
    console.error('❌ FAIL — esperaba 200 con firma válida');
    process.exit(1);
  }
  console.log('✅ PASS');

  console.log('\n=== Test 2: HMAC inválido (firma alterada) ===');
  const invalidSig = sign(payload, 'wrong_secret_xxxxxxxxxxxxxxxxxx');
  const r2 = await postWebhook(invalidSig);
  console.log(`Status: ${r2.status} | Body: ${r2.body}`);
  if (r2.status !== 401 && r2.status !== 403) {
    console.error('❌ FAIL — esperaba 401/403 con firma inválida (recibido ' + r2.status + ')');
    process.exit(1);
  }
  console.log('✅ PASS');

  console.log('\n=== Test 3: Sin header de firma ===');
  const r3 = await postWebhook(undefined);
  console.log(`Status: ${r3.status} | Body: ${r3.body}`);
  if (r3.status !== 401 && r3.status !== 403) {
    console.error('❌ FAIL — esperaba 401/403 sin firma (recibido ' + r3.status + ')');
    process.exit(1);
  }
  console.log('✅ PASS');

  console.log('\n=== Todos los tests pasaron ✅ ===');
})();
```

Ejecutar:

```bash
# Cargar el META_APP_SECRET del .env.prod
export $(grep META_APP_SECRET .env.prod | xargs)

# Correr el smoke test
node scripts/smoke-hmac.js
```

**Verificación:**
- Los 3 tests imprimen `✅ PASS`.
- El script termina con código de salida 0.

**Si Test 1 falla con 200 pero el bot no procesa el mensaje:** revisar logs (`docker compose logs app`) para confirmar que el dispatcher invocó al engine. Es probable que el tenant esté inactivo o falte algún campo.

**Si Test 2 o Test 3 retornan 200:** **CRÍTICO**. El HMAC verifier no está funcionando. Detener el sprint y arreglar antes de continuar. Revisar [src/webhooks/verifier.js](../src/webhooks/verifier.js).

**Rollback:**

```bash
rm scripts/smoke-hmac.js  # borrar después de validar
```

---

## Tarea 1.6 — Cleanup local

```bash
# Bajar todo
docker compose down

# Restaurar .env de dev
mv .env.dev.backup .env

# Verificar que .env.prod NO se commitea
git status | grep -q ".env.prod" && echo "⚠️  Removerlo del staging" || echo "OK"
```

## Definition of Done — Día 1

- [ ] Secrets generados y guardados en gestor de contraseñas
- [ ] `.env.prod` creado localmente (no commiteado)
- [ ] Migrations corren sin error en local con config de producción
- [ ] Tenant de prueba creado y verificación GET de Meta responde correctamente
- [ ] **Smoke test HMAC: los 3 casos pasan ✅**
- [ ] Cleanup hecho

---

# DÍA 2 — Infraestructura de producción

## Objetivo del día
Crear el `docker-compose.prod.yml`, configuración de nginx con bloque HTTPS listo, provisionar el VPS con Docker, y dejar el stack corriendo en HTTP en el puerto 80 (HTTPS se activa el Día 3).

## Tarea 2.1 — Crear `docker-compose.prod.yml`

**Acción:**

Crear archivo `docker-compose.prod.yml` en la raíz:

```yaml
# ══════════════════════════════════════════════════════
#  docker-compose.prod.yml — Override de PRODUCCIÓN
#
#  Levantar:
#    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
#
#  Diferencias vs dev:
#    - App con stage `runner` (sin hot reload, sin devDependencies)
#    - SIN puertos expuestos en postgres/redis (red interna solamente)
#    - Restart policy unless-stopped
#    - Logs rotados (max 10MB x 3 archivos por servicio)
#    - Nginx + Certbot al frente
# ══════════════════════════════════════════════════════

services:

  # ── Aplicación ─────────────────────────────────────────────────────────────
  app:
    build:
      context: .
      target: runner
    image: jesttech/whatsapp-saas:prod
    container_name: whatsapp-saas-app
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - internal
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  # ── Postgres (sin exponer puerto al host) ──────────────────────────────────
  postgres:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  # ── Redis (sin exponer puerto al host) ─────────────────────────────────────
  redis:
    command: redis-server --save 60 1 --appendonly yes
    volumes:
      - redis_data:/data
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  # ── Nginx (proxy HTTPS) ────────────────────────────────────────────────────
  nginx:
    image: nginx:1.27-alpine
    container_name: whatsapp-saas-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
    depends_on:
      - app
    networks:
      - internal
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  # ── Certbot (renovación automática cada 12h) ───────────────────────────────
  certbot:
    image: certbot/certbot:latest
    container_name: whatsapp-saas-certbot
    restart: unless-stopped
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew --quiet; sleep 12h & wait $${!}; done;'"

volumes:
  redis_data:
```

**Verificación:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml config > /dev/null
# Debe completar sin errores. Si imprime warnings sobre variables faltantes, está OK
# (las variables están en .env del VPS, no acá).
```

**Rollback:** `rm docker-compose.prod.yml`.

---

## Tarea 2.2 — Sobrescribir `nginx/nginx.conf` con la config final

**Acción:**

Reemplazar **completamente** el contenido de `nginx/nginx.conf` con:

```nginx
# nginx/nginx.conf — Configuración de producción

events {
  worker_connections 1024;
}

http {
  server_tokens off;
  add_header X-Frame-Options "DENY" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "no-referrer" always;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

  # Tamaño máximo del body (los webhooks de Meta son < 50KB)
  client_max_body_size 1m;

  # Rate limiting global (20 req/s con burst 50)
  limit_req_zone $binary_remote_addr zone=webhook:10m rate=20r/s;

  # Logs estructurados
  log_format main '$remote_addr - $remote_user [$time_local] '
                  '"$request" $status $body_bytes_sent '
                  '"$http_referer" "$http_user_agent" rt=$request_time';
  access_log /var/log/nginx/access.log main;
  error_log /var/log/nginx/error.log warn;

  # ── HTTP — solo para ACME challenge y redirect a HTTPS ────────────────────
  server {
    listen 80;
    server_name _;

    location /.well-known/acme-challenge/ {
      root /var/www/certbot;
    }

    # Health check sin SSL (para que el orquestador pueda probar antes de SSL)
    location = /health {
      proxy_pass http://app:3000;
      proxy_set_header Host $host;
    }

    location / {
      return 301 https://$host$request_uri;
    }
  }

  # ── HTTPS — bloque principal (se activa en Día 3 después de obtener cert) ─
  # NO tocar este bloque hasta haber corrido init-letsencrypt.sh
  server {
    listen 443 ssl;
    http2 on;
    server_name DOMINIO_PLACEHOLDER;

    ssl_certificate     /etc/letsencrypt/live/DOMINIO_PLACEHOLDER/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/DOMINIO_PLACEHOLDER/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Webhooks de Meta — todos los tenants vía slug
    location ~ ^/webhook/[a-z0-9-]+$ {
      limit_req zone=webhook burst=50 nodelay;
      proxy_pass http://app:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto https;
      proxy_read_timeout 10s;
      proxy_connect_timeout 5s;
    }

    # Admin API — protegido por API key en el código, opcional whitelist por IP
    location /admin/ {
      # allow YOUR.IP.HERE;  # descomentar y poner IP fija si querés extra capa
      # deny all;
      proxy_pass http://app:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_read_timeout 30s;
    }

    # Health, demo, todo lo demás
    location / {
      proxy_pass http://app:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto https;
    }
  }
}
```

> **Importante:** las dos ocurrencias de `DOMINIO_PLACEHOLDER` se reemplazan en la Tarea 3.1 con el dominio real. Por ahora **dejarlas como están** — el bloque HTTPS se activa solo cuando exista el cert en `/etc/letsencrypt/live/<dominio>/`.

**Problema previsto:** nginx fallará al arrancar si carga el bloque HTTPS y no encuentra el cert. **Solución:** la Tarea 3.1 incluye un cert dummy temporal para que arranque. Hasta entonces, si necesitás levantar nginx hoy mismo, comentar el bloque `server { listen 443 ssl; ... }` con `#`.

**Verificación local:**

```bash
docker run --rm -v "$(pwd)/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:1.27-alpine nginx -t
# Output esperado:
#   nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
#   nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Si falla por el cert (`cannot load certificate`), está bien — eso lo arregla la Tarea 3.1.

**Rollback:** `git checkout nginx/nginx.conf`.

---

## Tarea 2.3 — Crear script de bootstrap SSL

**Acción:**

Crear `scripts/init-letsencrypt.sh`:

```bash
#!/usr/bin/env bash
# scripts/init-letsencrypt.sh — bootstrap de SSL con Let's Encrypt
# Uso: bash scripts/init-letsencrypt.sh <dominio> <email>
# Ejemplo: bash scripts/init-letsencrypt.sh bots.jesttech.com admin@jesttech.com

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Uso: $0 <dominio> <email>"
  exit 1
fi

DATA_PATH="./certbot"
RSA_KEY_SIZE=4096

if [[ -d "$DATA_PATH/conf/live/$DOMAIN" ]]; then
  read -p "Ya existe cert para $DOMAIN. ¿Re-emitir? (y/N) " RECREATE
  [[ "$RECREATE" != "y" ]] && exit 0
fi

echo "### Reemplazando DOMINIO_PLACEHOLDER en nginx.conf por $DOMAIN..."
sed -i.bak "s/DOMINIO_PLACEHOLDER/$DOMAIN/g" nginx/nginx.conf

echo "### Descargando parámetros TLS recomendados..."
mkdir -p "$DATA_PATH/conf"
curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > "$DATA_PATH/conf/options-ssl-nginx.conf"
curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > "$DATA_PATH/conf/ssl-dhparams.pem"

echo "### Creando cert dummy temporal para que nginx arranque..."
mkdir -p "$DATA_PATH/conf/live/$DOMAIN"
docker run --rm -v "$(pwd)/$DATA_PATH/conf:/etc/letsencrypt" \
  --entrypoint sh certbot/certbot:latest \
  -c "openssl req -x509 -nodes -newkey rsa:$RSA_KEY_SIZE \
      -days 1 -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
      -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
      -subj '/CN=localhost'"

echo "### Levantando nginx con cert dummy..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d nginx

echo "### Borrando cert dummy y solicitando cert real..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm --entrypoint "\
  rm -Rf /etc/letsencrypt/live/$DOMAIN && \
  rm -Rf /etc/letsencrypt/archive/$DOMAIN && \
  rm -Rf /etc/letsencrypt/renewal/$DOMAIN.conf" certbot

docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    --email $EMAIL \
    -d $DOMAIN \
    --rsa-key-size $RSA_KEY_SIZE \
    --agree-tos \
    --non-interactive \
    --no-eff-email" certbot

echo "### Recargando nginx con cert real..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx nginx -s reload

echo ""
echo "✅ SSL configurado. Verificar con:"
echo "    curl -I https://$DOMAIN/health"
```

```bash
chmod +x scripts/init-letsencrypt.sh
```

**Verificación:**

```bash
test -x scripts/init-letsencrypt.sh && echo "OK"
```

**Rollback:** `rm scripts/init-letsencrypt.sh`.

---

## Tarea 2.4 — Provisionar el VPS

**[USUARIO]** Esta tarea requiere acceso SSH al VPS y privilegios sudo.

**Acción:** desde local, conectarse al VPS y ejecutar:

```bash
ssh USUARIO@IP_VPS

# (Dentro del VPS) — Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Docker (oficial)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Cerrar y reabrir SSH para que aplique el grupo docker
exit
```

```bash
# Reconectar
ssh USUARIO@IP_VPS

# Verificar Docker
docker --version
docker compose version

# Instalar utilidades
sudo apt install -y git ufw fail2ban

# Configurar firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status

# Clonar el repo
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/USUARIO/whatsapp-saas.git
cd whatsapp-saas

# Crear .env de producción
cp .env.example .env
nano .env   # pegar los valores generados en Tarea 1.1, ajustar DATABASE_URL host=postgres
```

> **Detalle clave del `.env` en VPS:** `DATABASE_URL=postgresql://app:DB_PASSWORD@postgres:5432/whatsapp_saas` (host = `postgres`, no `localhost`, porque está dentro de la red Docker).

```bash
# Permisos restrictivos
chmod 600 .env

# Verificar
ls -la .env   # debe ser -rw------- (solo dueño)
```

**Verificación:**

```bash
# En el VPS:
sudo ufw status | grep -E "(80|443|22)/tcp"
# Las 3 deben aparecer como ALLOW
docker --version
test -f .env && stat -c '%a' .env   # debe ser 600
```

**Rollback:** la VPS se reprovisiona si algo sale muy mal. Anotar el snapshot inicial del proveedor antes de empezar.

---

## Tarea 2.5 — Levantar el stack en HTTP (sin SSL aún)

**Acción:** en el VPS, dentro de `~/apps/whatsapp-saas`:

Comentar temporalmente el bloque `server { listen 443 ssl; ... }` en `nginx/nginx.conf` (sino nginx no arranca por falta de cert):

```bash
# Comentar el bloque HTTPS provisoriamente
sed -i.tmp '/listen 443 ssl;/,/^  }$/s/^/#/' nginx/nginx.conf
```

Levantar el stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml build app
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres redis

# Esperar a que postgres esté healthy
sleep 15
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps postgres | grep healthy

# Correr migrations
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm app node scripts/migrate.js

# Levantar app y nginx
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d app nginx
```

**Verificación:**

```bash
# Desde el VPS
curl http://localhost/health
# Debe responder: {"status":"ok",...}

# Desde local (reemplazar con tu IP de VPS)
curl http://IP_VPS/health
# Mismo resultado
```

Si falla:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=50 app
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=50 nginx
```

**Rollback:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
mv nginx/nginx.conf.tmp nginx/nginx.conf  # restaurar bloque HTTPS
```

## Definition of Done — Día 2

- [ ] `docker-compose.prod.yml` creado y validado con `config`
- [ ] `nginx/nginx.conf` reescrito con bloque HTTPS preparado
- [ ] `scripts/init-letsencrypt.sh` creado y ejecutable
- [ ] VPS provisionado (Docker, firewall, repo clonado, `.env` con `chmod 600`)
- [ ] Migrations corridas en VPS sin error
- [ ] `curl http://IP_VPS/health` responde 200 desde local

---

# DÍA 3 — SSL + backups

## Objetivo del día
Activar HTTPS con cert válido de Let's Encrypt, configurar backup diario de PostgreSQL, y probar restore.

## Tarea 3.1 — Activar SSL

**Acción:** en el VPS:

```bash
cd ~/apps/whatsapp-saas

# Restaurar el bloque HTTPS (si lo comentaste en 2.5)
test -f nginx/nginx.conf.tmp && mv nginx/nginx.conf.tmp nginx/nginx.conf

# Bajar nginx para que el script lo levante limpio
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop nginx

# Correr bootstrap SSL (REEMPLAZAR DOMINIO Y EMAIL)
bash scripts/init-letsencrypt.sh bots.jesttech.com admin@jesttech.com
```

**Verificación:**

Desde local:

```bash
curl -I https://bots.jesttech.com/health
# Esperado: HTTP/2 200
# Si responde "200 OK" sin errores SSL, funcionó.

# Verificar grado del cert
curl -sI https://bots.jesttech.com/health | grep -i strict-transport
# Debe incluir: strict-transport-security: max-age=31536000; includeSubDomains
```

Test en navegador: abrir `https://bots.jesttech.com/health` → candado verde, sin warnings.

Verificación opcional con SSL Labs (puede tardar 2 min): `https://www.ssllabs.com/ssltest/analyze.html?d=bots.jesttech.com` → grado A o A+.

**Rollback:**

```bash
# Si el cert quedó mal, borrar y volver a empezar
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
sudo rm -rf certbot/conf/live certbot/conf/archive certbot/conf/renewal
# Ejecutar init-letsencrypt.sh de nuevo
```

---

## Tarea 3.2 — Script de backup de PostgreSQL

**Acción:** en el VPS:

Crear `/usr/local/bin/backup-saas.sh`:

```bash
sudo tee /usr/local/bin/backup-saas.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
# backup-saas.sh — Backup diario de PostgreSQL + rotación 7 días
set -euo pipefail

BACKUP_DIR="/var/backups/whatsapp-saas"
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
RETENTION_DAYS=7
COMPOSE_DIR="/home/USUARIO_VPS/apps/whatsapp-saas"

mkdir -p "$BACKUP_DIR"

cd "$COMPOSE_DIR"

# Dump comprimido
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U app -d whatsapp_saas \
  | gzip > "$BACKUP_DIR/backup_${TIMESTAMP}.sql.gz"

# Verificar que el archivo no está vacío (mínimo 1KB)
SIZE=$(stat -c%s "$BACKUP_DIR/backup_${TIMESTAMP}.sql.gz")
if [[ $SIZE -lt 1024 ]]; then
  echo "ERROR: Backup vacío o muy pequeño ($SIZE bytes)" >&2
  rm "$BACKUP_DIR/backup_${TIMESTAMP}.sql.gz"
  exit 1
fi

# Rotación
find "$BACKUP_DIR" -name "backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "$(date -Iseconds) — Backup OK: backup_${TIMESTAMP}.sql.gz ($SIZE bytes)"
EOF

# Ajustar el path al usuario real
sudo sed -i "s|USUARIO_VPS|$USER|g" /usr/local/bin/backup-saas.sh

sudo chmod +x /usr/local/bin/backup-saas.sh
sudo mkdir -p /var/backups/whatsapp-saas
sudo chown $USER:$USER /var/backups/whatsapp-saas
```

**Verificación:**

```bash
# Ejecutar manualmente una vez
/usr/local/bin/backup-saas.sh

# Listar backups
ls -lh /var/backups/whatsapp-saas/
# Debe haber al menos un archivo backup_*.sql.gz > 1KB
```

**Rollback:** `sudo rm /usr/local/bin/backup-saas.sh /var/backups/whatsapp-saas/*`.

---

## Tarea 3.3 — Cron diario

**Acción:** en el VPS:

```bash
# Editar crontab del usuario
(crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/backup-saas.sh >> /var/log/backup-saas.log 2>&1") | crontab -

# Asegurar que el log es escribible
sudo touch /var/log/backup-saas.log
sudo chown $USER:$USER /var/log/backup-saas.log
```

**Verificación:**

```bash
crontab -l | grep backup-saas
# Debe imprimir: 0 3 * * * /usr/local/bin/backup-saas.sh ...
```

**Rollback:** `crontab -e` y borrar la línea.

---

## Tarea 3.4 — Probar restore

**Crítico:** un backup que no se prueba **no es un backup**.

**Acción:** en el VPS:

```bash
# Tomar el backup más reciente
LATEST=$(ls -t /var/backups/whatsapp-saas/backup_*.sql.gz | head -1)
echo "Probando restore de: $LATEST"

# Crear DB temporal de prueba
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d postgres -c "CREATE DATABASE restore_test;"

# Restaurar en la DB temporal
gunzip -c "$LATEST" | docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  psql -U app -d restore_test

# Verificar que tiene las tablas esperadas
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d restore_test -c "\dt"

# Cleanup
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d postgres -c "DROP DATABASE restore_test;"
```

**Verificación:**
- El `\dt` debe mostrar las 5 tablas: `tenants`, `products`, `sessions`, `orders`, `tenant_whatsapp_config`.
- No errores durante el restore.

**Rollback:** N/A (la DB temporal se borra al final).

## Definition of Done — Día 3

- [ ] `https://bots.jesttech.com/health` responde 200 con cert válido
- [ ] HSTS header presente
- [ ] SSL Labs grade ≥ A
- [ ] Backup script ejecutado manualmente, archivo > 1KB en `/var/backups/whatsapp-saas/`
- [ ] Cron diario configurado en `crontab -l`
- [ ] Restore probado exitosamente en DB temporal

---

# DÍA 4 — Onboarding Cliente1

## Objetivo del día
Crear el tenant para cliente1, importar su catálogo, registrar el webhook en Meta Business Manager, y validar el flujo completo enviando mensajes desde un WhatsApp real.

## Tarea 4.1 — Crear tenant cliente1

**[USUARIO]** Necesitás los siguientes datos de cliente1:
- `slug` (URL-friendly, ej: `boutique-ana`)
- `name` (visible en mensajes)
- `wa_token` (Permanent Access Token de Meta)
- `phone_number_id` (de Meta)
- `verify_token` (lo inventás vos, debe coincidir con lo que registres en Meta)
- `owner_phone` (número del dueño para notificaciones)

**Acción:** en el VPS:

```bash
cd ~/apps/whatsapp-saas

docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app \
  node scripts/create-tenant.js \
    --slug=boutique-ana \
    --name="Boutique Ana" \
    --wa-token=EAAxxxxxxxxxxxxx \
    --phone-id=123456789012345 \
    --verify-token=ana_verify_2026_xxxx \
    --owner-phone=573001234567 \
    --owner-email=ana@example.com \
    --city="Bucaramanga" \
    --schedule="Lun-Sáb 9am-7pm"
```

> El `verify-token` es libre, pero **anotalo**: lo necesitás en la Tarea 4.3 para registrarlo en Meta.

**Verificación:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "SELECT slug, name, status, owner_phone FROM tenants WHERE slug='boutique-ana';"
```

**Rollback:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas -c "DELETE FROM tenants WHERE slug='boutique-ana';"
```

---

## Tarea 4.2 — Importar productos

**[USUARIO]** Necesitás un archivo JSON o CSV con los productos de cliente1. Si tenés CSV, usar el formato de `scripts/products-template.csv`.

**Acción:** copiar el archivo al VPS y correr:

```bash
# Desde local, copiar el JSON al VPS
scp productos-boutique-ana.json USUARIO@IP_VPS:~/apps/whatsapp-saas/data/

# En el VPS
cd ~/apps/whatsapp-saas
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app \
  node scripts/import-products.js --slug=boutique-ana --file=data/productos-boutique-ana.json
```

**Verificación:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "SELECT COUNT(*) FROM products p JOIN tenants t ON p.tenant_id = t.id WHERE t.slug='boutique-ana';"
# Debe imprimir el número total de productos importados
```

**Rollback:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "DELETE FROM products WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='boutique-ana');"
```

---

## Tarea 4.3 — Registrar webhook en Meta Business Manager

**[USUARIO]** Esta tarea requiere acceso al panel de Meta Business.

**Acción manual:**

1. Ir a [Meta Business Suite](https://business.facebook.com/) → tu App → WhatsApp → Configuración.
2. En "Webhook" → "Editar":
   - **Callback URL:** `https://bots.jesttech.com/webhook/boutique-ana`
   - **Verify token:** `ana_verify_2026_xxxx` (el mismo del paso 4.1)
3. Click **"Verificar y guardar"**. Meta hará un GET al endpoint y debe responder con el `hub.challenge`.
4. En "Campos del webhook", suscribirse a:
   - `messages` (obligatorio)
   - `message_template_status_update` (opcional)

**Verificación desde el VPS** (mientras Meta hace la verificación):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f app | grep boutique-ana
# Deberías ver el GET /webhook/boutique-ana de Meta y la respuesta 200
```

**Si falla la verificación en Meta:**
- Revisar que el `verify_token` en Meta es **idéntico** al que se pasó a `create-tenant.js`.
- Revisar que la URL es accesible: desde local `curl "https://bots.jesttech.com/webhook/boutique-ana?hub.mode=subscribe&hub.verify_token=ana_verify_2026_xxxx&hub.challenge=test123"` debe responder `test123`.
- Revisar logs de nginx y app.

**Rollback:** desuscribirse del webhook desde el panel de Meta.

---

## Tarea 4.4 — Smoke test end-to-end con WhatsApp real

**[USUARIO]** Necesitás un teléfono con WhatsApp distinto del `owner_phone` para hacer el test.

**Acción:** desde tu WhatsApp personal, enviar mensajes al número de cliente1 (el que tiene aprobado en Meta).

Recorrido completo a probar:

| Paso | Mensaje a enviar | Respuesta esperada |
|------|------------------|--------------------|
| 1 | `hola` | Menú principal con opciones 1, 2, 3 |
| 2 | `1` (Catálogo) | Pregunta por talla |
| 3 | `M` | Pregunta por presupuesto |
| 4 | `100000` | Muestra hasta 3 productos con foto y precio |
| 5 | (selección de un producto) | Pide nombre |
| 6 | `Pedro Pérez` | Pide dirección |
| 7 | `Calle 123 #45-67, Bucaramanga` | Pide método de pago |
| 8 | `Nequi` | Confirma pedido + el dueño recibe notificación en su WhatsApp |
| 9 | `menu` | Vuelve al menú principal |

**Verificación:**

Mientras hacés el recorrido, en otra terminal del VPS:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f app
```

Tienen que aparecer logs estructurados con `tenantSlug=boutique-ana` y el `waFrom` de tu número, sin errores.

Verificar en DB que se creó la sesión y la orden:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas -c "
    SELECT step, lastActivity FROM sessions
    WHERE tenant_id = (SELECT id FROM tenants WHERE slug='boutique-ana')
    ORDER BY lastActivity DESC LIMIT 5;
  "

docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas -c "
    SELECT customer_name, total, status, created_at FROM orders
    WHERE tenant_id = (SELECT id FROM tenants WHERE slug='boutique-ana')
    ORDER BY created_at DESC LIMIT 5;
  "
```

**Si el bot no responde:**

1. ¿Llega el webhook? `docker compose logs nginx | grep webhook/boutique-ana`
2. ¿El HMAC valida? `docker compose logs app | grep -i "signature\|verifier"`
3. ¿Está activo el tenant? `SELECT status FROM tenants WHERE slug='boutique-ana';`
4. ¿El token Meta funciona? Probar manualmente: `curl -H "Authorization: Bearer EAAxxxx" https://graph.facebook.com/v20.0/PHONE_NUMBER_ID`

**Rollback:** marcar el tenant como inactivo:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "UPDATE tenants SET status='inactive' WHERE slug='boutique-ana';"
```

## Definition of Done — Día 4

- [ ] Tenant `boutique-ana` creado y activo en DB
- [ ] Productos importados (verificar conteo)
- [ ] Webhook verificado en Meta Business (status verde)
- [ ] **Smoke test end-to-end completado al menos 2 veces sin errores**
- [ ] Owner recibió notificación de la venta de prueba en su WhatsApp
- [ ] Orden registrada en tabla `orders`

---

# DÍA 5 — Buffer + clientes adicionales + handoff

## Objetivo del día
Buffer para resolver incidentes que aparezcan en las primeras horas de operación real, onboarding de clientes adicionales (si aplica), y dejar documentación operativa para el dueño.

## Tarea 5.1 — Monitoreo activo de las primeras 24h

**Acción:** mantener una terminal en el VPS con:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail=100 app | \
  grep -E "ERROR|WARN|error|warn"
```

Si aparecen errores, anotarlos en `docs/INCIDENTES.md` (crear el archivo) con:
- Timestamp
- Mensaje del error
- Tenant afectado
- Acción tomada
- Si requiere fix de código → al backlog, NO fixear en caliente a menos que sea bloqueante.

**Errores aceptables (no bloquean):**
- Timeouts puntuales de Meta API (429, 503) — el flujo continúa.
- Mensajes con `type=unsupported` (audio, ubicación) — el bot responde con instrucciones.

**Errores bloqueantes (sí pausar):**
- HMAC failures recurrentes (más de 3 en una hora con un secret correcto).
- Errores de DB (`connection refused`, `too many connections`).
- Notificaciones al owner que nunca llegan (el cliente1 no recibe avisos de venta).

---

## Tarea 5.2 — Onboarding de clientes adicionales (si aplica)

Por cada cliente adicional, repetir Tareas 4.1 → 4.4. **Importante:** mismo flujo (`flow_type=sales_v1`) para todos esta semana. Flujos custom van en Fase 2 (otro sprint).

---

## Tarea 5.3 — Crear `docs/RUNBOOK.md` con operación diaria

**Acción:** crear archivo `docs/RUNBOOK.md` con el siguiente contenido (resumen operativo para el dueño/operador):

```markdown
# Runbook operacional — whatsapp-saas

## Comandos diarios

### Ver logs en vivo
```bash
cd ~/apps/whatsapp-saas
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f app
```

### Ver salud del sistema
```bash
curl https://bots.jesttech.com/health
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

### Ver últimas órdenes de un tenant
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas -c "
    SELECT created_at, customer_name, total, status FROM orders
    WHERE tenant_id = (SELECT id FROM tenants WHERE slug='SLUG_AQUI')
    ORDER BY created_at DESC LIMIT 20;
  "
```

## Tareas comunes

### Agregar un nuevo cliente
Ver Tareas 4.1 → 4.4 de `docs/SPRINT_PRODUCCION.md`.

### Actualizar productos de un cliente
```bash
# Subir el JSON nuevo al VPS
scp productos-cliente.json USUARIO@IP_VPS:~/apps/whatsapp-saas/data/

# Importar (sobrescribe)
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app \
  node scripts/import-products.js --slug=CLIENTE_SLUG --file=data/productos-cliente.json --replace
```

### Pausar un cliente
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "UPDATE tenants SET status='inactive' WHERE slug='CLIENTE_SLUG';"
```

### Reactivar un cliente
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "UPDATE tenants SET status='active' WHERE slug='CLIENTE_SLUG';"
```

### Restaurar de backup (DR)
```bash
# Listar backups disponibles
ls -lh /var/backups/whatsapp-saas/

# Detener app (no postgres)
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop app

# Restaurar (CUIDADO: sobrescribe la DB actual)
gunzip -c /var/backups/whatsapp-saas/backup_FECHA.sql.gz | \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  psql -U app -d whatsapp_saas

# Reanudar app
docker compose -f docker-compose.yml -f docker-compose.prod.yml start app
```

## Troubleshooting

### "El bot no responde"
1. `curl https://bots.jesttech.com/health` — debe responder 200.
2. `docker compose ... ps` — todos los servicios deben estar `Up (healthy)`.
3. Logs del app filtrados por el slug del cliente: `docker compose ... logs app | grep CLIENTE_SLUG`.
4. Si los logs muestran errores de HMAC, revisar `META_APP_SECRET` en `.env`.
5. Si los logs muestran 401 de Meta API, regenerar el `wa_token` en Meta Business y actualizar el tenant.

### "El cliente recibe el mensaje pero el bot tarda mucho"
1. Verificar latencia DB: `docker stats whatsapp-saas-db`.
2. Verificar latencia Redis: `docker exec whatsapp-saas-redis redis-cli --latency`.
3. Si ambos están OK, es Meta API. Revisar `https://developers.facebook.com/status/`.

### "Se llenó el disco"
```bash
df -h
# Si es por logs de Docker:
docker system prune -a --volumes
# Si es por backups:
ls -lh /var/backups/whatsapp-saas/  # ya rotan a 7 días, no debería pasar
```

## Contacto de emergencia

- Owner cliente1: 573001234567
- Admin técnico: jeffersonm0915@gmail.com
- Hosting: Hostinger panel
```

**Verificación:**

```bash
test -f docs/RUNBOOK.md && echo "OK"
```

---

## Tarea 5.4 — Crear `docs/BACKLOG.md` para el post-deploy

**Acción:** crear archivo con todo lo que quedó OUT-OF-SCOPE para retomarlo cuando ya esté facturando:

```markdown
# Backlog post-producción

Tareas de mejora a abordar **una vez que el bot esté generando ingresos**.
Priorizadas por impacto en el negocio.

## P0 — Crítico operacional (semanas 2-3 después del go-live)

### B1. Tests automatizados del verifier y dispatcher
**Por qué:** sin esto, cualquier refactor puede romper la verificación HMAC silenciosamente.
**Estimación:** 2 días.
**Detalle en:** `docs/PLAN_MAESTRO.md` → Sprint 1.1.

### B2. Idempotencia persistente en Redis
**Por qué:** un reinicio del proceso (deploy, OOM, restart) puede causar mensajes duplicados.
**Estimación:** 1 día.
**Detalle en:** `docs/PLAN_MAESTRO.md` → T1.3.1.

### B3. Cola de notificaciones con reintentos
**Por qué:** si Meta API falla justo al notificar al dueño una venta, se pierde.
**Estimación:** 1.5 días.
**Detalle en:** `docs/PLAN_MAESTRO.md` → T1.3.3.

## P1 — Calidad y observabilidad (mes 2)

### B4. Tests del flow-engine (steps menu/catalog/order)
**Estimación:** 2 días.

### B5. Métricas Prometheus + Grafana
**Estimación:** 1 día.

### B6. Cache bust atómico en `configRepository`
**Estimación:** 0.5 día.

## P2 — Features de producto (mes 2-3)

### B7. Flow Engine declarativo (FASE 2 del plan maestro)
**Por qué:** soportar clientes con flujos distintos (lead capture, soporte, citas) sin tocar código.
**Estimación:** 3-4 semanas.
**Detalle en:** `docs/PLAN_MAESTRO.md` → FASE 2.

### B8. UI admin para gestión de tenants
**Estimación:** 1 semana.

### B9. Dashboard de ventas por cliente
**Estimación:** 1 semana.
```

**Verificación:**

```bash
test -f docs/BACKLOG.md && echo "OK"
```

## Definition of Done — Día 5

- [ ] Sin errores bloqueantes en las últimas 24h de operación
- [ ] Clientes adicionales onboardeados (si aplica)
- [ ] `docs/RUNBOOK.md` creado y revisado
- [ ] `docs/BACKLOG.md` creado con todo lo diferido
- [ ] Owner de cliente1 capacitado para ver sus pedidos en WhatsApp

---

# Definition of Done — SPRINT COMPLETO

**No declarar el sprint terminado hasta que cada uno de estos puntos esté checkeado:**

## Seguridad
- [ ] Todos los secrets de producción son distintos a los de dev
- [ ] `.env` en VPS con permisos 600
- [ ] HMAC verifier valida firmas correctamente (smoke test día 1 ✅)
- [ ] HTTPS funcional con cert válido > 30 días de vigencia
- [ ] Headers de seguridad presentes (`HSTS`, `X-Frame-Options`, `X-Content-Type-Options`)
- [ ] Firewall UFW activo permitiendo solo 22, 80, 443

## Datos
- [ ] Migrations corridas en producción
- [ ] Backup diario configurado en cron
- [ ] Backup ejecutado al menos una vez con archivo > 1KB
- [ ] **Restore probado exitosamente** en DB temporal

## Operación
- [ ] `https://bots.jesttech.com/health` responde 200
- [ ] Cliente1 con tenant activo + productos importados
- [ ] Webhook de Meta verificado para cliente1
- [ ] **Smoke test end-to-end con WhatsApp real completado 2+ veces**
- [ ] Owner cliente1 recibió notificación real de venta de prueba

## Documentación
- [ ] `docs/RUNBOOK.md` con comandos diarios y troubleshooting
- [ ] `docs/BACKLOG.md` con todo lo diferido y prioridades
- [ ] Owner cliente1 sabe cómo recibir y procesar pedidos

---

# Anexo A — Procedimiento de rollback completo

Si **algo crítico** falla y hay que volver atrás:

```bash
# En el VPS
cd ~/apps/whatsapp-saas

# 1. Pausar todos los tenants (deja de procesar mensajes)
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas -c "UPDATE tenants SET status='inactive';"

# 2. Bajar la app (postgres y redis quedan up)
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop app nginx

# 3. (Si hace falta) restaurar DB del último backup
LATEST=$(ls -t /var/backups/whatsapp-saas/backup_*.sql.gz | head -1)
gunzip -c "$LATEST" | docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  psql -U app -d whatsapp_saas

# 4. (Si hace falta) checkout del git a commit estable
git log --oneline -10
git checkout COMMIT_ESTABLE
docker compose -f docker-compose.yml -f docker-compose.prod.yml build app
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

# Anexo B — Checklist diario de los primeros 7 días post go-live

Cada mañana durante la primera semana, ejecutar:

```bash
# 1. Health
curl -s https://bots.jesttech.com/health | jq .

# 2. Estado servicios
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# 3. Errores en últimas 24h
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --since=24h app | grep -i "error" | head -20

# 4. Backup de la noche
ls -lh /var/backups/whatsapp-saas/ | head -3

# 5. Volumen de mensajes procesados
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas -c "
    SELECT t.slug, COUNT(*) as msgs_24h FROM sessions s
    JOIN tenants t ON s.tenant_id = t.id
    WHERE s.\"lastActivity\" > NOW() - INTERVAL '24 hours'
    GROUP BY t.slug;
  "

# 6. Órdenes generadas en 24h
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas -c "
    SELECT t.slug, COUNT(*) as orders_24h, SUM(o.total) as revenue FROM orders o
    JOIN tenants t ON o.tenant_id = t.id
    WHERE o.created_at > NOW() - INTERVAL '24 hours'
    GROUP BY t.slug;
  "

# 7. Disk space
df -h | grep -E "/$|/var"
```

Si algún número se ve raro (errores en aumento, 0 mensajes cuando antes había, disk > 80%), abrir incidente y bajar prioridad de cualquier otra cosa.

---

**Fin del runbook.** Cuando todos los DoD estén checkeados: **estás en producción**. 🎯
