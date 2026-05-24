#!/usr/bin/env bash
# storage-cleanup.sh — limpieza diaria del media storage.
#
# 1. Borra archivos de _quarantine/ con mtime >24h (uploads que nunca se
#    confirmaron y quedaron orfanados).
# 2. Borra directorios de tenant vacíos (resultado de tenants suspendidos).
#
# NO borra archivos huérfanos (sin referencia en DB) — eso requiere conocer
# el schema de la app y vive en un job de la app, no aquí.

set -uo pipefail

ENV_FILE="/etc/whatsapp-saas-storage.env"
[ -f "$ENV_FILE" ] || { echo "[cleanup] $ENV_FILE no existe — abort" >&2; exit 1; }
# shellcheck disable=SC1090
. "$ENV_FILE"

: "${MEDIA_ROOT:?MEDIA_ROOT requerido}"
QUARANTINE_DIR="$MEDIA_ROOT/_quarantine"

if [ -d "$QUARANTINE_DIR" ]; then
  removed=$(find "$QUARANTINE_DIR" -type f -mmin +1440 -print -delete | wc -l)
  echo "[cleanup] quarantine: $removed archivos >24h eliminados"
fi

# Directorios vacíos a nivel tenant (1 nivel bajo MEDIA_ROOT, excepto _quarantine)
find "$MEDIA_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '_*' -empty -print -delete \
  | sed 's/^/[cleanup] empty tenant dir removed: /'

# Reporte resumen
TOTAL_SIZE=$(du -sh "$MEDIA_ROOT" 2>/dev/null | awk '{print $1}')
TENANTS=$(find "$MEDIA_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '_*' | wc -l)
echo "[cleanup] total=$TOTAL_SIZE tenants=$TENANTS"
