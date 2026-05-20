#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  deploy-prod.sh — Despliegue idempotente del stack whatsapp-saas en VPS.
#
#  Uso (desde la raíz del repo en el VPS):
#    bash infra/scripts/deploy-prod.sh
#
#  Hace:
#    1. Verifica prerequisitos (docker, openssl, dirs persistentes, swap).
#    2. Genera .env desde .env.example SÓLO si no existe (preserva secretos).
#    3. Levanta postgres + redis y espera healthchecks.
#    4. Levanta api + whatsapp + worker + dashboard.
#    5. Bootstrap TLS Let's Encrypt para DOMAIN y ADMIN_DOMAIN (si faltan certs).
#    6. Levanta nginx final + certbot.
#    7. Reporta estado.
#
#  Idempotente: re-ejecutable sin daño. NUNCA regenera ENCRYPTION_KEY ni .env si ya existen.
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_DIR="/opt/whatsapp-saas"
DATA_DIR="/var/whatsapp-saas"
BACKUP_DIR="/root/backups"
COMPOSE_FILES=(-f docker-compose.yml -f infra/compose/docker-compose.prod.yml)
PROFILE_DASHBOARD=(--profile dashboard)
PROFILE_TLS=(--profile tls-bootstrap)

# ─── helpers ────────────────────────────────────────────────────────────────
log()  { printf '\e[1;34m[deploy]\e[0m %s\n' "$*"; }
ok()   { printf '\e[1;32m[ ok  ]\e[0m %s\n' "$*"; }
warn() { printf '\e[1;33m[warn]\e[0m %s\n' "$*"; }
die()  { printf '\e[1;31m[FAIL]\e[0m %s\n' "$*" >&2; exit 1; }

# ─── 1. Prereqs ─────────────────────────────────────────────────────────────
log "Verificando prerequisitos…"
[ "$(id -u)" -eq 0 ] || die "Debe ejecutarse como root"
cd "$REPO_DIR" || die "No se encontró $REPO_DIR"
command -v docker >/dev/null || die "docker no instalado"
docker compose version >/dev/null 2>&1 || die "docker compose plugin no disponible"
command -v openssl >/dev/null || die "openssl no instalado"

mkdir -p "$DATA_DIR/postgres" "$DATA_DIR/media" "$BACKUP_DIR" certbot/conf certbot/www
chmod 700 "$BACKUP_DIR"

# Swap 4G si falta
if [ ! -f /swapfile ]; then
  log "Creando swap 4G…"
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "Swap activado"
else
  ok "Swap ya existe"
fi

# ─── 2. .env ────────────────────────────────────────────────────────────────
if [ -f .env ]; then
  ok ".env ya existe — se preservan secretos (ENCRYPTION_KEY etc.)"
else
  log "Generando .env desde .env.example…"
  cp .env.example .env

  DB_PASS=$(openssl rand -hex 24)
  REDIS_PASS=$(openssl rand -hex 24)
  ENC_KEY=$(openssl rand -hex 32)
  APP_SEC=$(openssl rand -hex 32)
  ADMIN_KEY=$(openssl rand -hex 32)
  JWT_SEC=$(openssl rand -hex 32)
  PANEL_JWT=$(openssl rand -hex 64)
  PANEL_REF=$(openssl rand -hex 64)
  DASH_AUTH=$(openssl rand -hex 32)
  META_PH=$(openssl rand -hex 32)

  sed -i "s|CHANGE_PASSWORD|${DB_PASS}|g" .env
  sed -i "s|your_redis_password_here|${REDIS_PASS}|g" .env
  sed -i "s|your_64_char_hex_key_here|${ENC_KEY}|" .env
  sed -i "s|your_app_secret_here|${APP_SEC}|" .env
  sed -i "s|your_admin_api_key_here|${ADMIN_KEY}|" .env
  sed -i "s|your_jwt_secret_here|${JWT_SEC}|" .env
  sed -i "s|your_meta_app_secret_here|${META_PH}|" .env
  sed -i "s|your_panel_jwt_secret_128_chars_hex|${PANEL_JWT}|" .env
  sed -i "s|your_panel_refresh_secret_128_chars_hex|${PANEL_REF}|" .env
  sed -i "s|replace_with_openssl_rand_hex_32|${DASH_AUTH}|" .env
  sed -i "s|your_gemini_api_key_here|set_later|" .env
  sed -i "s|sk-your-openai-key-here|set_later|" .env
  sed -i "s|^AI_ENABLED=true|AI_ENABLED=false|" .env

  chmod 600 .env

  # Validar que no quedaron placeholders críticos
  if grep -qE '(CHANGE_PASSWORD|your_.*_here|replace_with|sk-your)' .env; then
    warn "Quedaron placeholders en .env:"
    grep -nE '(CHANGE_PASSWORD|your_.*_here|replace_with|sk-your)' .env
  fi

  # Backup inmediato
  cp .env "$BACKUP_DIR/.env-prod-$(date +%Y%m%d-%H%M%S)"
  chmod 600 "$BACKUP_DIR"/.env-prod-*
  ok ".env creado y respaldado en $BACKUP_DIR"
fi

# Cargar DOMAIN/ADMIN_DOMAIN/CERTBOT_EMAIL del .env
DOMAIN=$(grep -E '^DOMAIN=' .env | head -1 | cut -d= -f2-)
ADMIN_DOMAIN=$(grep -E '^ADMIN_DOMAIN=' .env | head -1 | cut -d= -f2-)
CERTBOT_EMAIL=$(grep -E '^CERTBOT_EMAIL=' .env | head -1 | cut -d= -f2-)
[ -n "$DOMAIN" ] || die "DOMAIN no definido en .env"
[ -n "$CERTBOT_EMAIL" ] || die "CERTBOT_EMAIL no definido en .env"
log "DOMAIN=$DOMAIN  ADMIN_DOMAIN=${ADMIN_DOMAIN:-<none>}  EMAIL=$CERTBOT_EMAIL"

# ─── 3. Postgres + Redis ────────────────────────────────────────────────────
log "Levantando postgres + redis…"
docker compose "${COMPOSE_FILES[@]}" "${PROFILE_DASHBOARD[@]}" up -d postgres redis

log "Esperando healthcheck de postgres…"
for i in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' whatsapp-saas-postgres 2>/dev/null || echo starting)
  [ "$s" = "healthy" ] && break
  sleep 2
done
[ "$s" = "healthy" ] || { docker logs whatsapp-saas-postgres --tail 50; die "postgres no llegó a healthy"; }
ok "postgres healthy"

for i in $(seq 1 30); do
  s=$(docker inspect -f '{{.State.Health.Status}}' whatsapp-saas-redis 2>/dev/null || echo starting)
  [ "$s" = "healthy" ] && break
  sleep 2
done
[ "$s" = "healthy" ] || { docker logs whatsapp-saas-redis --tail 50; die "redis no llegó a healthy"; }
ok "redis healthy"

# ─── 4. Apps (api, whatsapp, worker, dashboard) ─────────────────────────────
log "Levantando api + whatsapp + worker + dashboard…"
docker compose "${COMPOSE_FILES[@]}" "${PROFILE_DASHBOARD[@]}" up -d api whatsapp worker dashboard

log "Esperando healthcheck de api (hasta 90s)…"
for i in $(seq 1 45); do
  s=$(docker inspect -f '{{.State.Health.Status}}' whatsapp-saas-api 2>/dev/null || echo starting)
  [ "$s" = "healthy" ] && break
  sleep 2
done
if [ "$s" != "healthy" ]; then
  warn "api no llegó a healthy en 90s — mostrando logs:"
  docker logs whatsapp-saas-api --tail 80
else
  ok "api healthy"
fi

# ─── 5. TLS bootstrap (sólo si faltan certs) ────────────────────────────────
CERT_BOT="certbot/conf/live/${DOMAIN}/fullchain.pem"
need_bot_cert=0
need_admin_cert=0
[ -f "$CERT_BOT" ] || need_bot_cert=1
if [ -n "$ADMIN_DOMAIN" ]; then
  [ -f "certbot/conf/live/${ADMIN_DOMAIN}/fullchain.pem" ] || need_admin_cert=1
fi

if [ "$need_bot_cert" -eq 1 ] || [ "$need_admin_cert" -eq 1 ]; then
  log "Faltan certs TLS — corriendo bootstrap Let's Encrypt…"

  # Parar nginx final si está corriendo (libera :80)
  docker compose "${COMPOSE_FILES[@]}" stop nginx 2>/dev/null || true
  docker compose "${COMPOSE_FILES[@]}" rm -f nginx 2>/dev/null || true

  # Levantar nginx-bootstrap (sólo :80, sirve ACME challenge)
  docker compose "${COMPOSE_FILES[@]}" "${PROFILE_TLS[@]}" up -d nginx-bootstrap
  sleep 5

  # Emitir certs
  CERT_DOMAINS=("-d" "$DOMAIN")
  [ -n "$ADMIN_DOMAIN" ] && CERT_DOMAINS+=("-d" "$ADMIN_DOMAIN")

  docker run --rm \
    -v "$REPO_DIR/certbot/conf:/etc/letsencrypt" \
    -v "$REPO_DIR/certbot/www:/var/www/certbot" \
    certbot/certbot:latest certonly --webroot \
    --webroot-path=/var/www/certbot \
    --email "$CERTBOT_EMAIL" --agree-tos --no-eff-email \
    --non-interactive \
    "${CERT_DOMAINS[@]}" || die "certbot falló"

  # Bajar bootstrap
  docker compose "${COMPOSE_FILES[@]}" "${PROFILE_TLS[@]}" stop nginx-bootstrap
  docker compose "${COMPOSE_FILES[@]}" "${PROFILE_TLS[@]}" rm -f nginx-bootstrap
  ok "Certs Let's Encrypt emitidos"
else
  ok "Certs TLS ya presentes — saltando bootstrap"
fi

# ─── 6. Nginx final + certbot renewal ───────────────────────────────────────
log "Levantando nginx (HTTPS) + certbot (auto-renew)…"
docker compose "${COMPOSE_FILES[@]}" "${PROFILE_DASHBOARD[@]}" up -d nginx certbot

sleep 5

# ─── 7. Estado final ────────────────────────────────────────────────────────
log "Estado final del stack:"
docker compose "${COMPOSE_FILES[@]}" "${PROFILE_DASHBOARD[@]}" ps
echo
log "Health probes:"
for c in postgres redis api whatsapp worker dashboard nginx; do
  name="whatsapp-saas-${c}"
  [ "$c" = "dashboard" ] && name="jestsolution-dashboard"
  state=$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || echo "missing")
  health=$(docker inspect -f '{{.State.Health.Status}}' "$name" 2>/dev/null || echo "n/a")
  printf "  %-30s state=%-10s health=%s\n" "$name" "$state" "$health"
done

echo
log "URLs:"
echo "  Bot:       https://${DOMAIN}/health"
[ -n "$ADMIN_DOMAIN" ] && echo "  Dashboard: https://${ADMIN_DOMAIN}/"
echo
ok "Deploy completado."
