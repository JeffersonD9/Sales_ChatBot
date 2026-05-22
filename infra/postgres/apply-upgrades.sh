#!/usr/bin/env bash
# apply-upgrades.sh
# Aplica las migraciones SQL idempotentes contra el contenedor Postgres del stack.
# Se ejecuta automáticamente en cada deploy desde .github/workflows/deploy.yml.
#
# Regla dura: este script SOLO debe aplicar SQL idempotente.
#   ✓ CREATE TABLE IF NOT EXISTS
#   ✓ CREATE INDEX IF NOT EXISTS
#   ✓ ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... DEFAULT ...
#   ✓ INSERT ... ON CONFLICT DO UPDATE / DO NOTHING
#   ✗ DROP TABLE / DROP COLUMN / TRUNCATE / DELETE
#   ✗ ALTER COLUMN sin DEFAULT
#
# Cambios destructivos requieren runbook manual con backup previo
# (ver docs/runbook-db-migrations.md).

set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-whatsapp-saas-postgres}"
PLATFORM_DB="${PLATFORM_DB_NAME:-platform}"
TENANT_DB="${TENANT_DB_NAME_DEFAULT:-tenant_shared_low}"
PG_USER="${POSTGRES_USER:-app}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '[apply-upgrades] %s\n' "$*"; }
err() { printf '[apply-upgrades] ERROR: %s\n' "$*" >&2; }

if ! docker inspect -f '{{.State.Status}}' "$CONTAINER" >/dev/null 2>&1; then
  err "Contenedor $CONTAINER no existe. Levantá el stack antes."
  exit 1
fi

state="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo unknown)"
if [ "$state" != "healthy" ]; then
  log "Postgres no está healthy aún (estado=$state). Esperando hasta 60s..."
  for _ in $(seq 1 30); do
    state="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo unknown)"
    [ "$state" = "healthy" ] && break
    sleep 2
  done
  if [ "$state" != "healthy" ]; then
    err "Postgres sigue sin estar healthy (estado=$state). Abortando."
    exit 1
  fi
fi

apply_sql() {
  local db="$1"
  local file="$2"
  local basename
  basename="$(basename "$file")"

  if [ ! -f "$file" ]; then
    log "SKIP $basename (no existe)"
    return 0
  fi

  log "Aplicando $basename → DB $db"
  docker cp "$file" "$CONTAINER:/tmp/$basename"
  docker exec -e PGUSER="$PG_USER" "$CONTAINER" \
    psql -v ON_ERROR_STOP=1 --username "$PG_USER" --dbname "$db" -f "/tmp/$basename"
  docker exec "$CONTAINER" rm -f "/tmp/$basename"
  log "OK   $basename → DB $db"
}

log "Container: $CONTAINER | Platform DB: $PLATFORM_DB | Tenant DB: $TENANT_DB"

# Platform DB: schema + upgrades idempotentes.
apply_sql "$PLATFORM_DB" "$SCRIPT_DIR/init.sql"
apply_sql "$PLATFORM_DB" "$SCRIPT_DIR/upgrade-platform-tenancy.sql"

# Permisos del rol dashboard_app (idempotente; salta si el rol no existe).
apply_sql "$PLATFORM_DB" "$SCRIPT_DIR/grants.sql"

# Tenant DB compartida: schema base idempotente.
apply_sql "$TENANT_DB" "$SCRIPT_DIR/tenant-init.sql"

log "Migraciones aplicadas correctamente."
