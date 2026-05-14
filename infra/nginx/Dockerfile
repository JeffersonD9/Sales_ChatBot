FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/nginx.conf

# bot.conf.template   — siempre activo (webhooks + API Core)
# admin.conf.template — panel admin, OPCIONAL
#
# Para desacoplar el panel de esta infraestructura, reemplazar la línea
# siguiente por: COPY templates/bot.conf.template /etc/nginx/templates/
COPY templates /etc/nginx/templates
