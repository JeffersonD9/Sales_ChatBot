#!/bin/sh
# Desactiva vhosts opcionales cuyo dominio no esté configurado, ANTES de que
# el script 20-envsubst-on-templates.sh procese los .template.
#
# Sin esto, un ${CDN_DOMAIN}/${ADMIN_DOMAIN} vacío generaría `server_name ;`
# y nginx no arrancaría. Esto hace que los vhosts sean realmente opcionales:
# defines el dominio en el .env y el vhost aparece; lo quitas y desaparece.
set -e

TEMPLATE_DIR="/etc/nginx/templates"

if [ -z "${CDN_DOMAIN:-}" ] && [ -f "$TEMPLATE_DIR/media-cdn.conf.template" ]; then
  echo "[entrypoint] CDN_DOMAIN vacío — desactivando media-cdn vhost"
  rm -f "$TEMPLATE_DIR/media-cdn.conf.template"
fi

if [ -z "${ADMIN_DOMAIN:-}" ] && [ -f "$TEMPLATE_DIR/admin.conf.template" ]; then
  echo "[entrypoint] ADMIN_DOMAIN vacío — desactivando admin vhost"
  rm -f "$TEMPLATE_DIR/admin.conf.template"
fi
