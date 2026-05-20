#!/usr/bin/env bash
# Rebuildea la imagen del dashboard y crea 2 superadmins (miguel, jefferson).
# Idempotente: si los usuarios ya existen, el script Node devolverá error y se
# saltará al siguiente sin abortar el flujo (set +e antes de cada exec).
#
# Uso:
#   bash infra/scripts/create-admins.sh

set -euo pipefail

cd /opt/whatsapp-saas

COMPOSE_FILES=(-f docker-compose.yml -f infra/compose/docker-compose.prod.yml)
PROFILE=(--profile dashboard)

echo "[admins] Rebuilding dashboard image…"
docker compose "${COMPOSE_FILES[@]}" "${PROFILE[@]}" build dashboard

echo "[admins] Restarting dashboard container…"
docker compose "${COMPOSE_FILES[@]}" "${PROFILE[@]}" up -d dashboard
sleep 8

# Esperar que el container esté listo (no requiere health=healthy, sólo running)
for i in $(seq 1 20); do
  state=$(docker inspect -f '{{.State.Status}}' jestsolution-dashboard 2>/dev/null || echo missing)
  [ "$state" = "running" ] && break
  sleep 1
done
[ "$state" = "running" ] || { echo "[admins] dashboard no está running"; exit 1; }

create_admin() {
  local user="$1" email="$2" pw="$3"
  echo
  echo "[admins] Creando '$user' ($email)…"
  set +e
  docker exec \
    -e ADMIN_USERNAME="$user" \
    -e ADMIN_EMAIL="$email" \
    -e ADMIN_PASSWORD="$pw" \
    jestsolution-dashboard node scripts/create-admin-prod.cjs
  rc=$?
  set -e
  if [ $rc -ne 0 ]; then
    echo "[admins] (avance) '$user' ya existía o falló — continuando."
  fi
}

create_admin miguel    miguel@jestsolution.tech    'OrionVortex331*'
create_admin jefferson jeffersonm0915@gmail.com    'ZephyrNimbus308$'

echo
echo "[admins] Resumen panel_users:"
docker exec whatsapp-saas-postgres psql -U app -d platform -c \
  "SELECT id, username, email, role, is_active, created_at FROM panel_users ORDER BY created_at;"

echo
echo "[admins] Listo. URL panel: https://admin.jestsolution.tech/login"
