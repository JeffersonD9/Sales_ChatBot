# Post-deploy checklist — whatsapp-saas en VPS Hostinger

Estado del deploy al **2026-05-20**. Documento vivo: ir tachando items.

## Estado actual

- **VPS:** Hostinger KVM 2 — `srv1686217.hstgr.cloud` / `177.7.58.11` / IPv6 `2a02:4780:75:31dd::1`
- **OS:** Ubuntu 24.04 LTS, 2 vCPU / 8 GB RAM / 96 GB disk + 4 GB swap
- **Dominio:** `jestsolution.tech` (vence 2027-05-20)
- **Subdominios activos:** apex (bot) + `admin` (dashboard)
- **Stack:** `/opt/whatsapp-saas` — postgres, redis, api, wa-session-manager, worker, dashboard, nginx, certbot
- **TLS:** Let's Encrypt SAN para `jestsolution.tech` + `admin.jestsolution.tech` (vence 2026-08-18, auto-renew activo)
- **Superadmins:** `miguel`, `jefferson` (passwords en gestor del operador)
- **Secretos críticos:** `/root/backups/.env-prod-<timestamp>`. ⚠️ **NUNCA regenerar `ENCRYPTION_KEY` si la DB tiene tenants** — los tokens Meta serían irrecuperables.

### Comando de deploy idempotente

```bash
cd /opt/whatsapp-saas && git pull && bash infra/scripts/deploy-prod.sh
```

---

## 1. Hardening SSH (alta prioridad, riesgoso)

**Objetivo:** reducir superficie de ataque del puerto 22.

**Antes de empezar — verificar acceso por clave (NO PASSWORD):**

```bash
# Desde tu máquina local, generar par y subir pubkey si todavía usas password:
ssh-keygen -t ed25519 -C "jefferson-local" -f ~/.ssh/jest_vps
ssh-copy-id -i ~/.ssh/jest_vps.pub root@177.7.58.11

# Validar que entras sin password:
ssh -i ~/.ssh/jest_vps root@177.7.58.11
```

**Cuando puedas entrar por clave, ejecutar en el VPS:**

```bash
# Existe /root/harden-ssh.sh — revisa el contenido antes de correrlo.
cat /root/harden-ssh.sh
# Típicamente cambia puerto a 52221, deshabilita PasswordAuthentication,
# deshabilita PermitRootLogin con password, hace backup del sshd_config.
bash /root/harden-ssh.sh
# Actualizar el firewall Hostinger (vía MCP o panel) para abrir 52221 y cerrar 22.
```

**Firewall update (cambio de puerto):**
- Panel Hostinger → VPS → Firewall `whatsapp-saas-prod`
- Eliminar regla SSH 22
- Añadir regla TCP 52221 source=any
- Sync firewall

**Instalar Fail2Ban:**

```bash
apt-get update && apt-get install -y fail2ban
cat > /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
port = 52221
maxretry = 3
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban
fail2ban-client status sshd
```

**Verificación final:**
- Abrir una segunda sesión SSH al nuevo puerto **antes** de cerrar la actual
- `ss -ltnp | grep ssh` → debe escuchar sólo en :52221

---

## 2. Configurar Meta App real

**Objetivo:** pasar de placeholder a un App Secret real para validar firmas HMAC de los webhooks de Meta.

**En Meta for Developers (developers.facebook.com):**
1. Crear/abrir una App tipo "Business"
2. Añadir producto "WhatsApp"
3. En **Configuración básica** copiar el **App Secret**

**En el VPS:**

```bash
cd /opt/whatsapp-saas
# Backup antes de editar:
cp .env /root/backups/.env-prod-pre-meta-$(date +%Y%m%d-%H%M%S)
# Editar (reemplaza el placeholder META_APP_SECRET por el valor real):
nano .env
# Aplicar:
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml --profile dashboard up -d --force-recreate api whatsapp worker
```

**Configurar el webhook en Meta:**
- Callback URL: `https://jestsolution.tech/webhook/<tenant-slug>`
- Verify Token: el valor `META_VERIFY_TOKEN` del tenant (cuando crees el tenant en el dashboard)
- Suscribir a campos: `messages`, `messaging_postbacks`, `message_template_status_update`

**Verificación:**
```bash
docker logs whatsapp-saas-whatsapp --tail 30 -f
# enviar mensaje al número WhatsApp del tenant → debe aparecer log de enqueue
```

---

## 3. Backups automáticos PostgreSQL

**Objetivo:** dump diario de `platform` y `tenant_shared_low` + sync a Google Drive.

**Script base — guardar en `/opt/scripts/backup-postgres.sh`:**

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
DEST=/var/backups/postgres
mkdir -p "$DEST"
docker exec whatsapp-saas-postgres pg_dump -U app -Fc platform           > "$DEST/platform_$TS.dump"
docker exec whatsapp-saas-postgres pg_dump -U app -Fc tenant_shared_low  > "$DEST/tenant_shared_low_$TS.dump"
# Retención local 7 días:
find "$DEST" -name '*.dump' -mtime +7 -delete
# Sync a Google Drive con rclone (ver paso siguiente):
rclone sync "$DEST" gdrive:whatsapp-saas-backups/postgres --max-age 7d
```

**Cron diario a las 03:00 UTC:**
```
0 3 * * * /opt/scripts/backup-postgres.sh >> /var/log/backup-postgres.log 2>&1
```

**Configurar rclone (una vez):**
```bash
apt-get install -y rclone
rclone config       # interactive: nuevo remote tipo "drive", scope "drive.file"
# Crea remote `gdrive:` apuntando a una carpeta Google Drive dedicada.
```

**Restore (drill anual):**
```bash
docker exec -i whatsapp-saas-postgres pg_restore -U app -d platform_test < /var/backups/postgres/platform_<TS>.dump
```

---

## 4. Monitoreo básico

**Opción recomendada: Netdata (todo-en-uno, en el VPS)**

```bash
bash <(curl -Ss https://my-netdata.io/kickstart.sh) --stable-channel --disable-telemetry --non-interactive
```

- UI: `http://177.7.58.11:19999` (bloquear con firewall salvo IPs propias, o ponerlo detrás de nginx con basic auth)
- Métricas: CPU, RAM, disco, IO, network, containers, postgres, redis, nginx — auto-detectadas

**Alertas a Discord/Telegram/email:** configurables en `/etc/netdata/health.d/`.

**Alternativa pro: Grafana Cloud free tier**
- Prometheus agent en VPS → push a Grafana Cloud
- Dashboards prefab para Docker/Postgres/Redis
- Alerting + on-call integraciones

**Métricas custom de la app:**
- `/metrics` Prometheus ya expuesto por `api-core` (puerto 3000 interno)
- Configurar scrape job cuando montes Prometheus/agent

---

## 5. CI/CD pipeline (auto-deploy en push a main)

**Objetivo:** que `git push origin main` redeploye solo.

**Setup:**
1. Generar par SSH dedicado para CI (no reusar el deploy key del VPS):
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./ci_key -N ""
   ```
2. Subir `ci_key.pub` al VPS:
   ```bash
   cat ci_key.pub >> /root/.ssh/authorized_keys
   ```
3. En GitHub repo → Settings → Secrets and variables → Actions:
   - `VPS_SSH_KEY` = contenido de `ci_key` (private)
   - `VPS_HOST` = `177.7.58.11`
   - `VPS_USER` = `root` (o el sudoer si hiciste hardening)
   - `VPS_PORT` = `22` (o el nuevo puerto tras hardening)

4. Crear `.github/workflows/deploy.yml`:

```yaml
name: Deploy to VPS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup SSH
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.VPS_SSH_KEY }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan -p ${{ secrets.VPS_PORT }} -H ${{ secrets.VPS_HOST }} >> ~/.ssh/known_hosts

      - name: Deploy
        run: |
          ssh -i ~/.ssh/id_ed25519 -p ${{ secrets.VPS_PORT }} \
              ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} \
              "cd /opt/whatsapp-saas && git pull && bash infra/scripts/deploy-prod.sh"
```

**Verificación:** push a `main` → ver workflow run verde → ver `git log` en el VPS actualizado.

---

## 6. Crear primer tenant real (smoke test end-to-end)

**Desde el dashboard:**
1. Login en https://admin.jestsolution.tech/login
2. **Tenants → Crear tenant**
   - slug (ej. `cliente-piloto`)
   - business_name
   - plan
3. Entrar al tenant → **Configuración WhatsApp**
   - Pegar el `phone_number_id` y `access_token` (el dashboard los cifra con `ENCRYPTION_KEY`)
   - Generar y guardar `verify_token`
4. **Productos** → cargar catálogo (CSV import disponible)
5. **Persona** → ajustar tono/instrucciones del bot
6. En Meta App → configurar webhook con la URL `https://jestsolution.tech/webhook/cliente-piloto` y el verify token

**Smoke test:**
- Enviar un mensaje al número del tenant
- `docker logs whatsapp-saas-whatsapp -f` → debe verse el enqueue
- `docker logs whatsapp-saas-worker -f` → debe verse el procesamiento
- Recibir respuesta en WhatsApp

---

## 7. Limpieza periódica del host

**Una vez al mes (o cuando disco > 70%):**

```bash
docker builder prune -af
docker image prune -af
# Logs de containers (rotación ya configurada a 10MB×3, pero por si acaso):
find /var/lib/docker/containers/*/*.log -size +50M -exec truncate -s 0 {} \;
# Snapshot Hostinger pre-cambios mayores:
# (vía MCP o panel) — sólo se mantiene 1 snapshot, así que tomarlo después de
# cualquier cambio que haya quedado estable.
```

---

## 8. Renovación de dominio

- **`jestsolution.tech` vence 2027-05-20** — Hostinger tiene autorenew por default si tienes método de pago activo. Verificar 60 días antes.

---

## Referencias

- Repo: https://github.com/JeffersonD9/Sales_ChatBot
- Plan maestro: `docs/PLAN_MAESTRO.md`
- Arquitectura: `docs/architecture/`
- Runbooks: `docs/runbook-*.md`
- Deploy script: `infra/scripts/deploy-prod.sh`
- Crear admins script: `infra/scripts/create-admins.sh`
