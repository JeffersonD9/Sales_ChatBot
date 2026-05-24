#!/usr/bin/env bash
# storage-backup.sh — backup diario incremental del media storage.
#
# Estrategia: tar gzip de los archivos modificados en las últimas 24h.
# Rotación: retención 7 días en local. Sync a remoto (rclone) si está configurado.
#
# Si el media storage crece mucho, considerar:
#   - Cambiar a rsync con --link-dest (snapshots por hard links).
#   - Mover backup a un disco separado o a B2/Drive directamente.

set -uo pipefail

ENV_FILE="/etc/whatsapp-saas-storage.env"
[ -f "$ENV_FILE" ] || { echo "[backup] $ENV_FILE no existe — abort" >&2; exit 1; }
# shellcheck disable=SC1090
. "$ENV_FILE"

: "${MEDIA_ROOT:?MEDIA_ROOT requerido}"
: "${BACKUP_DIR:=/var/backups/whatsapp-saas-media}"
: "${BACKUP_RETENTION_DAYS:=7}"
: "${RCLONE_REMOTE:=}"  # opcional, ej: gdrive:whatsapp-saas/media

mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/media-$TS.tar.gz"

# Lista de archivos modificados en las últimas 24h (relativos a MEDIA_ROOT)
cd "$(dirname "$MEDIA_ROOT")" || exit 1
FILES=$(find "$(basename "$MEDIA_ROOT")" -type f -mtime -1 \
        ! -path "*/\\_quarantine/*" -print 2>/dev/null)

if [ -z "$FILES" ]; then
  echo "[backup] nada nuevo en 24h — skip"
  exit 0
fi

# Pasar lista por stdin a tar (evita arg list too long)
echo "$FILES" | tar -czf "$OUT" -T - 2>/dev/null
SIZE=$(du -h "$OUT" | awk '{print $1}')
COUNT=$(echo "$FILES" | wc -l)
echo "[backup] ok: $OUT ($SIZE, $COUNT archivos)"

# Rotación local
find "$BACKUP_DIR" -name 'media-*.tar.gz' -mtime "+$BACKUP_RETENTION_DAYS" -print -delete \
  | sed 's/^/[backup] rotated: /'

# Sync remoto (opcional)
if [ -n "$RCLONE_REMOTE" ] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$OUT" "$RCLONE_REMOTE" --quiet \
    && echo "[backup] uploaded to $RCLONE_REMOTE" \
    || echo "[backup] rclone upload failed" >&2
fi
