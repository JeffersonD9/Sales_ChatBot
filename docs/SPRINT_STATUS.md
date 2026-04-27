# Estado del Sprint — Pendientes

**Actualizado:** 2026-04-26

Todo lo que no esta en esta lista ya esta hecho y commiteado.

---

## Bloqueantes

| Bloqueante | Desbloquea |
|------------|-----------|
| Verificacion de empresa en Meta | Registrar webhooks en Meta (Tarea 4.3) |
| VPS provisionado | Tareas 2.4 en adelante |

---

## Pendiente

### Necesita solo VPS (sin Meta)

**Tarea 2.4 — Provisionar el VPS**
```bash
ssh USUARIO@IP_VPS
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Reconectar SSH
sudo apt install -y git ufw fail2ban
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/USUARIO/whatsapp-saas.git
cd whatsapp-saas
cp .env.example .env
nano .env   # pegar secrets de produccion, host=postgres (no localhost)
chmod 600 .env
```
Verificacion: `sudo ufw status` muestra 22/80/443. `docker --version` OK. `stat -c '%a' .env` = 600.

---

**Tarea 2.5 — Levantar stack en HTTP**
```bash
# Comentar bloque HTTPS en nginx.conf hasta tener cert
sed -i.tmp '/listen 443 ssl;/,/^  }$/s/^/#/' nginx/nginx.conf

docker compose -f docker-compose.yml -f docker-compose.prod.yml build app
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres redis
sleep 15
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm app node scripts/migrate.js
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d app nginx
```
Verificacion: `curl http://IP_VPS/health` responde 200.

---

**Tarea 3.1 — SSL**
```bash
test -f nginx/nginx.conf.tmp && mv nginx/nginx.conf.tmp nginx/nginx.conf
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop nginx
bash scripts/init-letsencrypt.sh bots.jesttech.com jeffersonm0915@gmail.com
```
Verificacion: `curl -I https://bots.jesttech.com/health` responde HTTP/2 200.

---

**Tarea 3.2-3.4 — Backups**
```bash
sudo tee /usr/local/bin/backup-saas.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR="/var/backups/whatsapp-saas"
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$BACKUP_DIR"
cd ~/apps/whatsapp-saas
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U app -d whatsapp_saas | gzip > "$BACKUP_DIR/backup_${TIMESTAMP}.sql.gz"
SIZE=$(stat -c%s "$BACKUP_DIR/backup_${TIMESTAMP}.sql.gz")
[[ $SIZE -lt 1024 ]] && { echo "ERROR: backup vacio"; rm "$BACKUP_DIR/backup_${TIMESTAMP}.sql.gz"; exit 1; }
find "$BACKUP_DIR" -name "backup_*.sql.gz" -mtime +7 -delete
echo "$(date -Iseconds) — Backup OK ($SIZE bytes)"
EOF
sudo chmod +x /usr/local/bin/backup-saas.sh
sudo mkdir -p /var/backups/whatsapp-saas && sudo chown $USER:$USER /var/backups/whatsapp-saas

# Ejecutar y verificar
/usr/local/bin/backup-saas.sh
ls -lh /var/backups/whatsapp-saas/

# Cron
(crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/backup-saas.sh >> /var/log/backup-saas.log 2>&1") | crontab -

# Probar restore
LATEST=$(ls -t /var/backups/whatsapp-saas/backup_*.sql.gz | head -1)
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres psql -U app -d postgres -c "CREATE DATABASE restore_test;"
gunzip -c "$LATEST" | docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres psql -U app -d restore_test
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres psql -U app -d restore_test -c "\dt"
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres psql -U app -d postgres -c "DROP DATABASE restore_test;"
```

---

### Necesita VPS + Meta verificada

**Tarea 4.1 — Crear tenant cliente1**
Ver `docs/CREAR_TENANT.md`. Datos que necesitas del cliente: slug, name, wa-token, phone-id, verify-token, owner-phone.

**Tarea 4.2 — Importar productos cliente1**
Ver `docs/ONBOARDING_CLIENTE.md` Paso 3.

**Tarea 4.3 — Registrar webhook en Meta** `[USUARIO]`
- Meta Business → App → WhatsApp → Webhook → Editar
- Callback URL: `https://bots.jesttech.com/webhook/<slug>`
- Verify token: el del tenant

**Tarea 4.4 — Smoke test con WhatsApp real** `[USUARIO]`
Enviar `hola` y recorrer el flujo completo. Ver tabla en `docs/ONBOARDING_CLIENTE.md` Paso 5.
