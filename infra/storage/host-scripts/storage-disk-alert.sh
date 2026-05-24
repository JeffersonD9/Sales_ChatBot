#!/usr/bin/env bash
# storage-disk-alert.sh — alerta cuando el disco del VPS pasa umbrales.
#
# Pensado para correr por cron cada 15 minutos. Envia un WhatsApp al OWNER
# usando la SaaS API local (que ya tiene token + phone_number_id resuelto).
#
# Variables (vienen de /etc/whatsapp-saas-storage.env, generado por
# provision-storage-host.sh):
#   MEDIA_ROOT          /var/whatsapp-saas/media
#   ALERT_THRESHOLD     80
#   CRITICAL_THRESHOLD  90
#   STATE_FILE          /var/lib/whatsapp-saas-storage/disk-alert.state
#   ADMIN_API_URL       http://localhost/api/admin/notify (interna)
#   ADMIN_API_TOKEN     token de la API (compartido con el bot)
#   OWNER_PHONE         numero de WhatsApp del owner (E.164 sin +)
#
# El estado se persiste para evitar spam: solo notifica cuando el umbral
# se CRUZA hacia arriba (no en cada tick).

set -uo pipefail

ENV_FILE="/etc/whatsapp-saas-storage.env"
[ -f "$ENV_FILE" ] || { echo "[disk-alert] $ENV_FILE no existe — abort" >&2; exit 1; }
# shellcheck disable=SC1090
. "$ENV_FILE"

: "${MEDIA_ROOT:?MEDIA_ROOT requerido}"
: "${ALERT_THRESHOLD:=80}"
: "${CRITICAL_THRESHOLD:=90}"
: "${STATE_FILE:=/var/lib/whatsapp-saas-storage/disk-alert.state}"

mkdir -p "$(dirname "$STATE_FILE")"

# % usado del filesystem que contiene MEDIA_ROOT
USED_PCT=$(df --output=pcent "$MEDIA_ROOT" | tail -1 | tr -d ' %')
[[ "$USED_PCT" =~ ^[0-9]+$ ]] || { echo "[disk-alert] df devolvió valor inválido: $USED_PCT" >&2; exit 1; }

PREV_STATE=$(cat "$STATE_FILE" 2>/dev/null || echo "ok")
NEW_STATE="ok"
if [ "$USED_PCT" -ge "$CRITICAL_THRESHOLD" ]; then
  NEW_STATE="critical"
elif [ "$USED_PCT" -ge "$ALERT_THRESHOLD" ]; then
  NEW_STATE="warn"
fi

echo "[disk-alert] used=${USED_PCT}% prev=$PREV_STATE new=$NEW_STATE"

# Solo notifica en transición hacia arriba (warn→critical también notifica)
should_notify=0
case "$PREV_STATE:$NEW_STATE" in
  ok:warn|ok:critical|warn:critical) should_notify=1 ;;
esac

if [ "$should_notify" -eq 1 ]; then
  MEDIA_SIZE=$(du -sh "$MEDIA_ROOT" 2>/dev/null | awk '{print $1}')
  DF_LINE=$(df -h "$MEDIA_ROOT" | tail -1)
  MSG=$(printf '[storage-alert] disco al %s%% (%s)\nMEDIA_ROOT=%s tamano=%s\n%s' \
          "$USED_PCT" "$NEW_STATE" "$MEDIA_ROOT" "${MEDIA_SIZE:-?}" "$DF_LINE")

  if [ -n "${ADMIN_API_URL:-}" ] && [ -n "${ADMIN_API_TOKEN:-}" ] && [ -n "${OWNER_PHONE:-}" ]; then
    curl -fsS -m 10 -X POST "$ADMIN_API_URL" \
      -H "Authorization: Bearer $ADMIN_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg to "$OWNER_PHONE" --arg body "$MSG" \
            '{to:$to, body:$body, kind:"storage_alert"}')" \
      || echo "[disk-alert] notify api falló — alerta solo en log" >&2
  else
    echo "[disk-alert] ADMIN_API_* no configurado — alerta solo en log" >&2
  fi

  logger -t whatsapp-saas-storage "$MSG"
fi

echo "$NEW_STATE" > "$STATE_FILE"
