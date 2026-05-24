#!/usr/bin/env bash
# provision-storage-host.sh — prepara el host (VPS) para el media storage.
# IDEMPOTENTE: se puede correr múltiples veces sin romper nada.
#
# Hace:
#   1. Crea MEDIA_ROOT + _quarantine con permisos 0750.
#   2. Instala los scripts de mantenimiento en /opt/whatsapp-saas/storage/.
#   3. Genera /etc/whatsapp-saas-storage.env (config de los crons).
#   4. Instala crons: disk-alert (cada 15m), cleanup (diario), backup (diario).
#
# NO crea carpetas por tenant: eso lo hace la app con mkdir recursivo al
# primer upload. El host solo garantiza la raíz y el saneamiento.
#
# Variables de entorno aceptadas (con defaults):
#   MEDIA_ROOT=/var/whatsapp-saas/media
#   STORAGE_OWNER=         (vacío = no cambiar owner; ej "1000:1000")
#   ALERT_THRESHOLD=80
#   CRITICAL_THRESHOLD=90
#   ADMIN_API_URL=         (para alertas WhatsApp; ej http://localhost/api/admin/notify)
#   ADMIN_API_TOKEN=
#   OWNER_PHONE=
#   BACKUP_DIR=/var/backups/whatsapp-saas-media
#   BACKUP_RETENTION_DAYS=7
#   RCLONE_REMOTE=

set -euo pipefail

MEDIA_ROOT="${MEDIA_ROOT:-/var/whatsapp-saas/media}"
STORAGE_OWNER="${STORAGE_OWNER:-}"
ALERT_THRESHOLD="${ALERT_THRESHOLD:-80}"
CRITICAL_THRESHOLD="${CRITICAL_THRESHOLD:-90}"
ADMIN_API_URL="${ADMIN_API_URL:-}"
ADMIN_API_TOKEN="${ADMIN_API_TOKEN:-}"
OWNER_PHONE="${OWNER_PHONE:-}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/whatsapp-saas-media}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

INSTALL_DIR="/opt/whatsapp-saas/storage"
ENV_FILE="/etc/whatsapp-saas-storage.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[provision] $*"; }

# ─── 1. Dirs base ────────────────────────────────────────────────────────────
log "Creando $MEDIA_ROOT (+ _quarantine)…"
mkdir -p "$MEDIA_ROOT" "$MEDIA_ROOT/_quarantine" "$BACKUP_DIR" "$INSTALL_DIR"
chmod 0750 "$MEDIA_ROOT" "$MEDIA_ROOT/_quarantine"
if [ -n "$STORAGE_OWNER" ]; then
  log "chown $STORAGE_OWNER en $MEDIA_ROOT…"
  chown -R "$STORAGE_OWNER" "$MEDIA_ROOT"
fi

# Asegura dependencias mínimas para los scripts
for bin in curl jq find du df logger; do
  command -v "$bin" >/dev/null 2>&1 || log "WARN: '$bin' no está instalado (alertas/backup pueden fallar)"
done

# ─── 2. Instalar scripts ─────────────────────────────────────────────────────
log "Instalando scripts en $INSTALL_DIR…"
for s in storage-disk-alert.sh storage-cleanup.sh storage-backup.sh; do
  install -m 0750 "$SCRIPT_DIR/$s" "$INSTALL_DIR/$s"
done

# ─── 3. Env file de los crons ────────────────────────────────────────────────
log "Generando $ENV_FILE…"
umask 077
cat > "$ENV_FILE" <<EOF
# Generado por provision-storage-host.sh — $(date -u +%Y-%m-%dT%H:%M:%SZ)
MEDIA_ROOT=$MEDIA_ROOT
ALERT_THRESHOLD=$ALERT_THRESHOLD
CRITICAL_THRESHOLD=$CRITICAL_THRESHOLD
STATE_FILE=/var/lib/whatsapp-saas-storage/disk-alert.state
ADMIN_API_URL=$ADMIN_API_URL
ADMIN_API_TOKEN=$ADMIN_API_TOKEN
OWNER_PHONE=$OWNER_PHONE
BACKUP_DIR=$BACKUP_DIR
BACKUP_RETENTION_DAYS=$BACKUP_RETENTION_DAYS
RCLONE_REMOTE=$RCLONE_REMOTE
EOF
chmod 0600 "$ENV_FILE"
mkdir -p /var/lib/whatsapp-saas-storage

# ─── 4. Crons ────────────────────────────────────────────────────────────────
CRON_FILE="/etc/cron.d/whatsapp-saas-storage"
log "Instalando crons en $CRON_FILE…"
cat > "$CRON_FILE" <<EOF
# whatsapp-saas media storage — generado por provision-storage-host.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Alerta de disco cada 15 min
*/15 * * * * root $INSTALL_DIR/storage-disk-alert.sh >> /var/log/whatsapp-saas-storage.log 2>&1
# Limpieza diaria 03:30
30 3 * * *   root $INSTALL_DIR/storage-cleanup.sh    >> /var/log/whatsapp-saas-storage.log 2>&1
# Backup diario 04:00
0 4 * * *    root $INSTALL_DIR/storage-backup.sh     >> /var/log/whatsapp-saas-storage.log 2>&1
EOF
chmod 0644 "$CRON_FILE"

# Logrotate del log de storage
cat > /etc/logrotate.d/whatsapp-saas-storage <<'EOF'
/var/log/whatsapp-saas-storage.log {
  weekly
  rotate 4
  compress
  missingok
  notifempty
  copytruncate
}
EOF

log "OK. MEDIA_ROOT=$MEDIA_ROOT"
log "Verifica con: ls -la $MEDIA_ROOT && cat $CRON_FILE"
