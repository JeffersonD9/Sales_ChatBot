#!/bin/bash
set -euo pipefail

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[deploy]${NC} $*"; }
success() { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()    { echo -e "${YELLOW}[deploy]${NC} $*"; }
error()   { echo -e "${RED}[deploy]${NC} $*"; exit 1; }

info "Verificando pre-requisitos..."
command -v docker >/dev/null 2>&1 || error "Docker no esta instalado"
docker compose version >/dev/null 2>&1 || error "Docker Compose plugin no esta instalado"
[[ -f ".env" ]] || error "Falta el archivo .env"

required_vars=(
  DATABASE_URL DB_PASSWORD REDIS_URL REDIS_PASSWORD
  META_APP_SECRET ENCRYPTION_KEY APP_SECRET
  ADMIN_API_KEY JWT_SECRET
)

for var in "${required_vars[@]}"; do
  val=$(grep -E "^${var}=" .env | cut -d= -f2- | tr -d '"' | xargs || true)
  if [[ -z "$val" || "$val" == *"CHANGE"* || "$val" == *"your_"* || "$val" == *"dev_"* ]]; then
    error "Variable ${var} no configurada o tiene valor placeholder en .env"
  fi
done

success "Variables de entorno OK"

info "Actualizando imagenes base..."
docker pull postgres:16-alpine
docker pull redis:7-alpine
docker pull nginx:1.27-alpine
docker pull certbot/certbot:latest

info "Construyendo imagen de produccion..."
$COMPOSE build --no-cache app

info "Levantando PostgreSQL y Redis..."
$COMPOSE up -d postgres redis

info "Esperando PostgreSQL..."
for i in {1..30}; do
  if $COMPOSE exec -T postgres pg_isready -U app -d whatsapp_saas >/dev/null 2>&1; then
    success "PostgreSQL healthy"
    break
  fi
  [[ $i -eq 30 ]] && error "PostgreSQL no respondio en 30 intentos"
  sleep 2
done

info "Saltando migraciones: el schema se gestiona fuera del runtime de esta app"

info "Levantando aplicacion..."
$COMPOSE up -d app
sleep 3

for i in {1..15}; do
  if curl -sf http://localhost:3000/health | grep -q '"status":"ok"'; then
    success "App respondiendo en :3000"
    break
  fi
  [[ $i -eq 15 ]] && error "La app no respondio en 15 intentos"
  sleep 2
done

DOMAIN=$(grep -E "^DOMAIN=" .env | cut -d= -f2 | xargs || true)
EMAIL=$(grep -E "^CERTBOT_EMAIL=" .env | cut -d= -f2 | xargs || true)

if [[ -d "./certbot/conf/live/${DOMAIN:-}" ]]; then
  info "Certificado SSL ya existe para ${DOMAIN}"
elif [[ -n "${DOMAIN:-}" && -n "${EMAIL:-}" ]]; then
  info "Obteniendo certificado SSL para ${DOMAIN}..."
  mkdir -p certbot/conf certbot/www
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
else
  warn "DOMAIN o CERTBOT_EMAIL no definidos; se omite SSL"
fi

if [[ -d "./certbot/conf/live/${DOMAIN:-}" ]]; then
  info "Levantando nginx + certbot..."
  $COMPOSE up -d nginx certbot
fi

echo ""
success "Deploy completado"
if [[ -n "${DOMAIN:-}" && -d "./certbot/conf/live/${DOMAIN}" ]]; then
  echo -e "  Webhook:   ${BLUE}https://${DOMAIN}/webhook/{slug}${NC}"
  echo -e "  Health:    ${BLUE}https://${DOMAIN}/health${NC}"
else
  echo -e "  Webhook:   ${BLUE}http://IP_DEL_VPS:3000/webhook/{slug}${NC}"
  echo -e "  Health:    ${BLUE}http://IP_DEL_VPS:3000/health${NC}"
fi
echo "  Logs:      docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f app"
echo "  DB schema: gestionado externamente; esta app no ejecuta migraciones"
