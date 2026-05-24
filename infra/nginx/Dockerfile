FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/nginx.conf

# bot.conf.template   — siempre activo (webhooks + API Core)
# admin.conf.template — panel admin, OPCIONAL
#
# Para desacoplar el panel de esta infraestructura, reemplazar la línea
# siguiente por: COPY templates/bot.conf.template /etc/nginx/templates/
COPY templates /etc/nginx/templates

# Desactiva vhosts opcionales (CDN/admin) si su dominio no está en el env,
# antes del envsubst. Evita `server_name ;` vacío que rompería nginx.
COPY docker-entrypoint.d/15-optional-vhosts.sh /docker-entrypoint.d/15-optional-vhosts.sh
RUN chmod +x /docker-entrypoint.d/15-optional-vhosts.sh
