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

## 0. Monitorear ataques SSH (read-only, sin riesgo)

El VPS recibe scans 24/7 desde botnets (Azure, GCP, ISPs varios). Es ruido
normal de internet, no ataque dirigido. La defensa activa la hace **Fail2Ban**
+ `PasswordAuthentication=no` + ciphers modernos.

### Comandos de monitoreo

```bash
# Estado actual: IPs baneadas en este momento
fail2ban-client status sshd

# Ataques fallidos de las últimas 24h (todos los logs sshd)
journalctl -u ssh --since "24 hours ago" | grep -iE "failed|invalid user|too many"

# Top 10 IPs atacantes (últimas 24h)
journalctl -u ssh --since "24 hours ago" --no-pager \
  | grep -oP "from \K[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+" \
  | sort | uniq -c | sort -rn | head -10

# Top 10 usernames que los bots prueban (catálogo del ataque)
journalctl -u ssh --since "24 hours ago" --no-pager \
  | grep -oP "Invalid user \K[^ ]+" \
  | sort | uniq -c | sort -rn | head -10

# Histórico de baneos (todas las IPs que Fail2Ban ha bloqueado alguna vez)
zgrep -h "Ban " /var/log/fail2ban.log* 2>/dev/null \
  | grep -oP "Ban \K[0-9.]+" | sort | uniq -c | sort -rn | head -20

# Ver una IP específica: ¿está baneada, hasta cuándo?
fail2ban-client status sshd
fail2ban-client get sshd banip --with-time
```

### Cómo interpretar lo que veas

| Patrón en logs | Qué significa |
|---|---|
| `Failed password for root from <IP>` | Bot probando passwords. Inofensivo: PasswordAuthentication=no los rechaza antes. |
| `Invalid user xxx from <IP>` | Bot probando usuarios genéricos (admin, ubuntu, oracle). Sin cuenta → no entra. |
| `Unable to negotiate ... no matching host key type` | Bot con cifrado viejo (ecdsa-sha2-nistp256). Nuestros ciphers modernos los cortan en handshake. |
| `Too many authentication failures` | El bot superó MaxAuthTries=3 → sshd cierra la conexión. |
| `Connection reset by authenticating user root <IP>` | Conexión legítima que se cerró (timeout o cierre del cliente). Mirar si la IP es tuya. |
| `Banned IP list: ...` en fail2ban-client | IPs activamente bloqueadas a nivel iptables/nftables. |

### IPs que NO son ataques (no alarmarse)

- **Tu propia IP** sale en el login banner (`Last login from X.X.X.X`). Si la ves en el top atacantes pero entras OK, fail2ban no te banea (los logins exitosos resetean el contador).
- `169.254.0.1` o `127.0.0.1` son loopback / link-local internos.
- IPs de **GitHub Actions** durante runs del pipeline (cambian, son AWS us-east).

### Cuándo preocuparse de verdad

- Si **Currently banned** crece mucho más rápido de lo normal (decenas/hora) → posible ataque dirigido, revisar threat intel de la IP.
- Si ves intentos exitosos (`Accepted password` o `Accepted publickey`) de IPs desconocidas → emergencia, rotar todas las keys.
- Si fail2ban deja de banear (Currently banned = 0 durante días) → verificar que el servicio esté corriendo: `systemctl status fail2ban`.

---

## 1. Hardening SSH ✅ COMPLETADO (2026-05-20)

**Estado:** aplicado vía `/root/harden-ssh.sh` + parche al override de cloud-init.

- ✅ `PasswordAuthentication=no` (login sólo con clave SSH)
- ✅ `PermitRootLogin=prohibit-password` (root sólo con clave)
- ✅ `MaxAuthTries=3` (kick a la cuarta)
- ✅ `ClientAliveInterval=300` / `CountMax=2` (kick conexiones idle)
- ✅ Ciphers/MACs/KEX modernos (curve25519, chacha20-poly1305, aes256-gcm)
- ✅ `X11Forwarding/AgentForwarding/TcpForwarding=no`
- ✅ Fail2Ban activo (3 fails → ban 1h, incremental hasta 1 semana)
- ✅ `/etc/ssh/sshd_config.d/50-cloud-init.conf` parcheado (tenía `PasswordAuthentication yes` que ganaba por orden lexicográfico)
- ✅ `authorized_keys` deduplicado (3 entradas duplicadas → 1)
- ✅ Puerto **22 mantenido** (decisión consciente: key-only + fail2ban > port obscurity; ahorra complejidad de firewall/secrets/monitoreo)

### Verificación

```bash
sshd -T | grep -Ei "passwordauth|permitroot|maxauthtries"
# Esperado:
#   permitrootlogin without-password
#   maxauthtries 3
#   passwordauthentication no

fail2ban-client status sshd
# Esperado: jail activo, "Currently banned" puede ser >= 0 según tráfico
```

### Si alguna vez necesitas revertir

Backups guardados en `/root/backups/`:
- `sshd_config.<fecha>.bak` — config original completa
- `50-cloud-init.conf.<fecha>.bak` — drop-in cloud-init pre-parche
- `authorized_keys.<fecha>.bak` — antes del dedup

Para deshacer todo:
```bash
ls /root/backups/sshd_config.*.bak
cp /root/backups/sshd_config.<fecha>.bak /etc/ssh/sshd_config
rm /etc/ssh/sshd_config.d/99-hardening.conf
cp /root/backups/50-cloud-init.conf.<fecha>.bak /etc/ssh/sshd_config.d/50-cloud-init.conf
sshd -t && systemctl reload ssh
```

### Si en el futuro quieres añadir más capas

(NO obligatorio — el hardening actual ya está al nivel CIS/Mozilla intermediate.)

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
