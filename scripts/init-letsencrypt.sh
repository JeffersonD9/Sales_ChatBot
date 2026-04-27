#!/usr/bin/env bash
# scripts/init-letsencrypt.sh — Bootstrap de SSL con Let's Encrypt
# Uso: bash scripts/init-letsencrypt.sh <dominio> <email>
# Ejemplo: bash scripts/init-letsencrypt.sh bots.jesttech.com admin@jesttech.com

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Uso: $0 <dominio> <email>"
  exit 1
fi

DATA_PATH="./certbot"
RSA_KEY_SIZE=4096

if [[ -d "$DATA_PATH/conf/live/$DOMAIN" ]]; then
  read -p "Ya existe cert para $DOMAIN. ¿Re-emitir? (y/N) " RECREATE
  [[ "$RECREATE" != "y" ]] && exit 0
fi

echo "### Reemplazando DOMINIO_PLACEHOLDER en nginx.conf por $DOMAIN..."
sed -i.bak "s/DOMINIO_PLACEHOLDER/$DOMAIN/g" nginx/nginx.conf

echo "### Descargando parámetros TLS recomendados..."
mkdir -p "$DATA_PATH/conf"
curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
  > "$DATA_PATH/conf/options-ssl-nginx.conf"
curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem \
  > "$DATA_PATH/conf/ssl-dhparams.pem"

echo "### Creando cert dummy temporal para que nginx arranque..."
mkdir -p "$DATA_PATH/conf/live/$DOMAIN"
docker run --rm -v "$(pwd)/$DATA_PATH/conf:/etc/letsencrypt" \
  --entrypoint sh certbot/certbot:latest \
  -c "openssl req -x509 -nodes -newkey rsa:$RSA_KEY_SIZE \
      -days 1 -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
      -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
      -subj '/CN=localhost'"

echo "### Levantando nginx con cert dummy..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d nginx

echo "### Borrando cert dummy y solicitando cert real..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm --entrypoint "\
  rm -Rf /etc/letsencrypt/live/$DOMAIN && \
  rm -Rf /etc/letsencrypt/archive/$DOMAIN && \
  rm -Rf /etc/letsencrypt/renewal/$DOMAIN.conf" certbot

docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    --email $EMAIL \
    -d $DOMAIN \
    --rsa-key-size $RSA_KEY_SIZE \
    --agree-tos \
    --non-interactive \
    --no-eff-email" certbot

echo "### Recargando nginx con cert real..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx nginx -s reload

echo ""
echo "✅ SSL configurado. Verificar con:"
echo "    curl -I https://$DOMAIN/health"
