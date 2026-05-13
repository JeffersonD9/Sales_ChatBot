#!/bin/sh
set -eu

container="${POSTGRES_CONTAINER:-whatsapp-saas-postgres}"
backup_dir="${BACKUP_DIR:-/var/whatsapp-saas/backups/daily}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$backup_dir"

for db in "${PLATFORM_DB_NAME:-platform}" "${TENANT_DB_NAME_DEFAULT:-tenant_shared_low}"; do
  file="${backup_dir}/${db}_${stamp}.sql.gz"
  docker exec "$container" sh -c "pg_dump -U \"\$POSTGRES_USER\" -d \"$db\"" | gzip -9 > "$file"
  chmod 600 "$file"
  echo "Backup written: $file"
done
