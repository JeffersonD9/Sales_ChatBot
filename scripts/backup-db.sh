#!/usr/bin/env bash
# scripts/backup-db.sh — Backup de PostgreSQL con pg_dump
#
# Uso:
#   ./scripts/backup-db.sh
#
# Variables de entorno requeridas (tomar del .env de producción):
#   DATABASE_URL     — postgresql://user:pass@host:5432/dbname
#   BACKUP_DIR       — directorio donde guardar los backups (default: /backups)
#   BACKUP_KEEP_DAYS — días a retener (default: 7)
#
# Cron sugerido (cada día a las 2am):
#   0 2 * * * /app/scripts/backup-db.sh >> /var/log/backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="whatsapp_saas_${TIMESTAMP}.dump"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[backup] ERROR: DATABASE_URL no definida" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "[backup] Iniciando backup: ${FILEPATH}"
pg_dump \
  --format=custom \
  --compress=9 \
  --no-password \
  "${DATABASE_URL}" \
  --file="${FILEPATH}"

SIZE=$(du -sh "${FILEPATH}" | cut -f1)
echo "[backup] Backup completado: ${FILENAME} (${SIZE})"

# Eliminar backups más antiguos que BACKUP_KEEP_DAYS
DELETED=$(find "${BACKUP_DIR}" -name "whatsapp_saas_*.dump" -mtime "+${BACKUP_KEEP_DAYS}" -print -delete | wc -l)
if [[ "${DELETED}" -gt 0 ]]; then
  echo "[backup] Eliminados ${DELETED} backups con más de ${BACKUP_KEEP_DAYS} días"
fi

echo "[backup] Listo. Backups actuales:"
ls -lh "${BACKUP_DIR}"/whatsapp_saas_*.dump 2>/dev/null || echo "  (ninguno)"
