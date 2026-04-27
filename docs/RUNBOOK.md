# Runbook operacional

## Ver estado del sistema

```bash
cd ~/apps/whatsapp-saas

# Health
curl https://bots.jesttech.com/health

# Estado de contenedores
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Logs en vivo
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f app

# Errores de las ultimas 24h
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --since=24h app | grep -i error
```

---

## Tenants

### Crear un cliente nuevo
Ver `docs/ONBOARDING_CLIENTE.md` — proceso completo paso a paso.

### Pausar cliente
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "UPDATE tenants SET status='inactive' WHERE slug='SLUG';"
```

### Reactivar cliente
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "UPDATE tenants SET status='active' WHERE slug='SLUG';"
```

### Ver ordenes recientes de un cliente
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas -c "
    SELECT created_at, customer_name, total, status FROM orders
    WHERE tenant_id = (SELECT id FROM tenants WHERE slug='SLUG')
    ORDER BY created_at DESC LIMIT 20;"
```

### Actualizar productos
```bash
scp productos.json USUARIO@IP_VPS:~/apps/whatsapp-saas/data/
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app \
  node scripts/import-products.js --slug=SLUG --file=data/productos.json --replace
```

---

## Backups

### Ejecutar backup manual
```bash
/usr/local/bin/backup-saas.sh
ls -lh /var/backups/whatsapp-saas/
```

### Restaurar de backup (DR)
```bash
# Detener app (no postgres)
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop app

# Restaurar — CUIDADO: sobrescribe la DB actual
gunzip -c /var/backups/whatsapp-saas/backup_FECHA.sql.gz | \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  psql -U app -d whatsapp_saas

# Reanudar
docker compose -f docker-compose.yml -f docker-compose.prod.yml start app
```

---

## Monitoreo diario (primeros 7 dias post go-live)

```bash
# 1. Health
curl -s https://bots.jesttech.com/health | jq .

# 2. Contenedores
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# 3. Errores ultimas 24h
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --since=24h app | grep -i error | head -20

# 4. Backup de la noche
ls -lh /var/backups/whatsapp-saas/ | head -3

# 5. Mensajes procesados en 24h
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas -c "
    SELECT t.slug, COUNT(*) AS msgs FROM sessions s
    JOIN tenants t ON s.tenant_id = t.id
    WHERE s.\"lastActivity\" > NOW() - INTERVAL '24 hours'
    GROUP BY t.slug;"

# 6. Ordenes en 24h
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas -c "
    SELECT t.slug, COUNT(*) AS ordenes, SUM(o.total) AS revenue FROM orders o
    JOIN tenants t ON o.tenant_id = t.id
    WHERE o.created_at > NOW() - INTERVAL '24 hours'
    GROUP BY t.slug;"

# 7. Disco
df -h | grep -E "/$|/var"
```

---

## Troubleshooting

### El bot no responde
1. `curl https://bots.jesttech.com/health` — debe dar 200
2. `docker compose ... ps` — todos los servicios deben estar `Up (healthy)`
3. `docker compose ... logs app | grep SLUG` — buscar errores del tenant
4. Si aparecen errores HMAC: verificar `META_APP_SECRET` en `.env`
5. Si aparece 401 de Meta API: regenerar `wa_token` del cliente en Meta Business

### Bot tarda mucho en responder
1. `docker stats whatsapp-saas-app` — CPU/RAM
2. `docker exec whatsapp-saas-redis redis-cli --latency` — latencia Redis
3. Si ambos OK: revisar `https://developers.facebook.com/status/`

### Disco lleno
```bash
df -h
docker system prune -f          # limpia imagenes/contenedores sin uso
ls -lh /var/backups/whatsapp-saas/   # ya rotan a 7 dias
```

### Renovar SSL manualmente
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm certbot renew
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx nginx -s reload
```

---

## Contacto

- Admin tecnico: jeffersonm0915@gmail.com
- Hosting: Hostinger VPS panel
