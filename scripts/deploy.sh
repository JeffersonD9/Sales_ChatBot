#!/bin/bash
# ════════════════════════════════════════════════════════════════════
#  deploy.sh — Deploy completo de WhatsApp SaaS en VPS
#
#  Uso:
#    chmod +x scripts/deploy.sh
#    ./scripts/deploy.sh
#
#  Pre-requisitos en el VPS:
#    - Docker Engine + Docker Compose Plugin instalados
#    - Dominio apuntando al VPS (A record)
#    - Puerto 80 y 443 abiertos en el firewall
#    - .env configurado con valores de producción (ver .env.example)
# ════════════════════════════════════════════════════════════════════

set -euo pipefail

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

# ── Colores ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[deploy]${NC} $*"; }
success() { echo -e "${GREEN}[deploy]${NC} ✓ $*"; }
warn()    { echo -e "${YELLOW}[deploy]${NC} ⚠ $*"; }
error()   { echo -e "${RED}[deploy]${NC} ✗ $*"; exit 1; }

# ── 0. Verificaciones previas ─────────────────────────────────────────────────
info "Verificando pre-requisitos..."

command -v docker >/dev/null 2>&1 || error "Docker no está instalado"
docker compose version >/dev/null 2>&1 || error "Docker Compose plugin no está instalado"

[[ -f ".env" ]] || error "Falta el archivo .env — copia .env.example y completa los valores"

# Verificar variables críticas en .env
required_vars=(
  DATABASE_URL DB_PASSWORD REDIS_URL
  META_APP_SECRET ENCRYPTION_KEY APP_SECRET
  ADMIN_API_KEY JWT_SECRET
  PANEL_JWT_SECRET PANEL_REFRESH_SECRET
)
for var in "${required_vars[@]}"; do
  val=$(grep -E "^${var}=" .env | cut -d= -f2- | tr -d '"' | xargs || true)
  if [[ -z "$val" || "$val" == *"CHANGE"* || "$val" == *"your_"* || "$val" == *"dev_"* ]]; then
    error "Variable ${var} no configurada o tiene valor placeholder en .env"
  fi
done

# Verificar PANEL_COOKIE_SECURE=true en producción
cookie_secure=$(grep -E "^PANEL_COOKIE_SECURE=" .env | cut -d= -f2 | xargs || true)
if [[ "$cookie_secure" != "true" ]]; then
  warn "PANEL_COOKIE_SECURE no es 'true' — las cookies del panel no serán seguras (HTTPS)"
  read -rp "¿Continuar de todas formas? [y/N] " confirm
  [[ "$confirm" =~ ^[yY]$ ]] || exit 1
fi

success "Variables de entorno OK"

# ── 1. Pull de imágenes base ──────────────────────────────────────────────────
info "Actualizando imágenes base..."
docker pull postgres:16-alpine
docker pull redis:7-alpine
docker pull nginx:1.27-alpine
docker pull certbot/certbot:latest

# ── 2. Build de la imagen de la app ──────────────────────────────────────────
info "Construyendo imagen de producción..."
$COMPOSE build --no-cache app
success "Imagen construida"

# ── 3. Levantar infra (DB + Redis) primero ────────────────────────────────────
info "Levantando PostgreSQL y Redis..."
$COMPOSE up -d postgres redis
info "Esperando que la DB esté healthy..."
for i in {1..30}; do
  if $COMPOSE exec -T postgres pg_isready -U app -d whatsapp_saas >/dev/null 2>&1; then
    success "PostgreSQL healthy"
    break
  fi
  [[ $i -eq 30 ]] && error "PostgreSQL no respondió en 30 intentos"
  sleep 2
done

# ── 4. Correr migrations ──────────────────────────────────────────────────────
info "Corriendo migrations SQL..."
$COMPOSE run --rm app npm run migrate
success "Migrations aplicadas"

# ── 5. Levantar app ───────────────────────────────────────────────────────────
info "Levantando aplicación..."
$COMPOSE up -d app
sleep 3

# Health check de la app
for i in {1..15}; do
  if curl -sf http://localhost:3000/health | grep -q '"status":"ok"'; then
    success "App respondiendo en :3000"
    break
  fi
  [[ $i -eq 15 ]] && error "La app no respondió en 15 intentos"
  sleep 2
done

# ── 6. Bootstrap SSL con Certbot ──────────────────────────────────────────────
DOMAIN=$(grep -E "^DOMAIN=" .env | cut -d= -f2 | xargs || true)
EMAIL=$(grep -E "^CERTBOT_EMAIL=" .env | cut -d= -f2 | xargs || true)

if [[ -d "./certbot/conf/live/${DOMAIN}" ]]; then
  info "Certificado SSL ya existe para ${DOMAIN} — saltando Certbot"
else
  if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
    warn "DOMAIN o CERTBOT_EMAIL no definidos en .env — saltando SSL"
    warn "Agrega DOMAIN=tu.dominio.com y CERTBOT_EMAIL=tu@email.com para habilitar HTTPS"
  else
    info "Obteniendo certificado SSL para ${DOMAIN}..."
    mkdir -p certbot/conf certbot/www

    # Levantar nginx en modo HTTP primero (para el challenge ACME)
    # Temporalmente sin el bloque SSL activo
    docker run --rm \
      -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
      -v "$(pwd)/certbot/www:/var/www/certbot" \
      -p 80:80 \
      certbot/certbot certonly \
        --standalone \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        -d "$DOMAIN"

    success "Certificado SSL obtenido para ${DOMAIN}"
    info "Actualizando nginx.conf con el dominio..."
    sed -i "s/DOMINIO_PLACEHOLDER/${DOMAIN}/g" nginx/nginx.conf
  fi
fi

# ── 7. Levantar nginx (y certbot si hay SSL) ──────────────────────────────────
info "Levantando nginx..."
if [[ -d "./certbot/conf/live/${DOMAIN:-}" ]]; then
  $COMPOSE up -d nginx certbot
  success "Nginx + Certbot activos"
else
  warn "Sin SSL — nginx no levantado. Configura DOMAIN y CERTBOT_EMAIL en .env"
fi

# ── 8. Crear super admin del panel ───────────────────────────────────────────
echo ""
echo -e "${YELLOW}══════════════════════════════════════════${NC}"
echo -e "${YELLOW}  Crear super admin del panel (opcional)  ${NC}"
echo -e "${YELLOW}══════════════════════════════════════════${NC}"
read -rp "¿Crear super admin ahora? [y/N] " create_admin

if [[ "$create_admin" =~ ^[yY]$ ]]; then
  read -rp "  Username: " admin_username
  read -rsp "  Password (mín 8 chars): " admin_password; echo ""
  read -rp "  Email: " admin_email

  $COMPOSE exec app node src/panel/scripts/create-super-admin.js \
    --username="$admin_username" \
    --password="$admin_password" \
    --email="$admin_email"
fi

# ── 9. Resumen final ──────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  Deploy completado                     ${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""

if [[ -n "${DOMAIN:-}" && -d "./certbot/conf/live/${DOMAIN}" ]]; then
  echo -e "  Panel:     ${BLUE}https://${DOMAIN}/panel-ui/login.html${NC}"
  echo -e "  Webhook:   ${BLUE}https://${DOMAIN}/webhook/{slug}${NC}"
  echo -e "  Health:    ${BLUE}https://${DOMAIN}/health${NC}"
else
  echo -e "  Panel:     ${BLUE}http://IP_DEL_VPS:3000/panel-ui/login.html${NC}"
  echo -e "  Webhook:   ${BLUE}http://IP_DEL_VPS:3000/webhook/{slug}${NC}"
  echo -e "  Health:    ${BLUE}http://IP_DEL_VPS:3000/health${NC}"
fi

echo ""
echo "  Logs:      docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f app"
echo "  Migrate:   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app npm run migrate"
echo ""
