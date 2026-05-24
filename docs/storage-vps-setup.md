# Media storage local en la VPS — setup e contrato

> Infraestructura preparada el 2026-05-24. Sirve para CUALQUIER tenant sin
> reconfigurar nada: tenant nuevo = subcarpeta nueva creada por la app al
> primer upload. Diseñado para no saturar el VPS (cuotas + alertas + limpieza).

## Visión general

```
Board (dashboard) ── upload ──▶ app (api/worker) ── escribe ──▶ /var/whatsapp-saas/media/<tenant>/...
                                                                          │ (volumen media_data, bind)
WhatsApp / cliente  ◀── URL ──  nginx (read-only) ── sirve ──────────────┘
                                cdn.jestsolution.tech/<tenant>/...
```

- **Path de sistema:** `/var/whatsapp-saas/media` (volumen Docker `media_data`, ya bind-montado en `api`, `whatsapp`, `worker` con rw y en `nginx` con ro).
- **URL pública:** `https://cdn.jestsolution.tech` (vhost `media-cdn.conf.template`, cert SAN junto a `DOMAIN`).
- **Layout tenant-aware:**
  ```
  /var/whatsapp-saas/media/
  ├── _quarantine/                 uploads sin confirmar (TTL 24h)
  └── <tenant-slug>/
      ├── images/{products,flows}/
      └── audios/flows/
  ```

## Variables de entorno (sistema, NO comportamiento)

| Var | Valor | Dónde se usa |
|-----|-------|--------------|
| `MEDIA_STORAGE_BASE_PATH` | `/var/whatsapp-saas/media` | la app para escribir/leer archivos |
| `MEDIA_STORAGE_PUBLIC_BASE_URL` | `https://cdn.jestsolution.tech` | la app para construir URLs (concatena `/<tenant>/...`) |
| `CDN_DOMAIN` | `cdn.jestsolution.tech` | nginx (envsubst) + certbot (SAN) |

Todo lo demás (tamaños, calidad, formatos, límites) vive en la config del board por tenant, **no** en `.env`.

## Contrato para el código de la app (lo que debe cumplir Codex)

1. **Path base** = `process.env.MEDIA_STORAGE_BASE_PATH`. Crear subcarpetas con `fs.mkdir(dir, { recursive: true, mode: 0o750 })` al primer uso. No asumir que existen.
2. **Tenant-aware:** el primer segmento del path SIEMPRE es el `tenant.slug`. nginx replica el `SLUG_RE` de `packages/http-runtime/security.js` (`^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$`, 1–64 chars, sin guion bajo) y rechaza cualquier slug fuera de ese patrón. Si cambias `SLUG_RE`, actualiza el regex del vhost.
3. **Nombres:** uuid/hash, nunca el nombre original. Sanitizar para evitar path traversal.
4. **URL pública** = `${MEDIA_STORAGE_PUBLIC_BASE_URL}/${slug}/${subpath}`. Esa URL es la que se manda a Meta como `link` de imagen/audio.
5. **Cuotas:** antes de escribir, verificar el uso del tenant contra su cuota (ver más abajo). Si supera el 90 %, rechazar el upload con error claro.
6. **Quarantine (recomendado):** subir primero a `_quarantine/`, validar mime real, y mover al destino final solo si pasa. El cron borra quarantine >24h.
7. **Adapter:** toda escritura/lectura pasa por el `LocalVpsStorageAdapter`. Para migrar a S3 luego, solo se cambia el adapter; la URL pública la resuelve el adapter (`resolvePublicUrl`).

## Cuotas por tenant (anti-saturación)

VPS actual: **100 GB** de disco total. Defaults sugeridos:

| Tier | Cuota |
|------|-------|
| basic | 500 MB |
| premium | 5 GB |
| dedicated | sin límite (DB/disco dedicado) |

Persistir la cuota donde el board ya guarda config de tenant (ej. `tenants.storage_quota_mb` o el JSON de settings). La app la lee en runtime y bloquea al 90 %. **No** hace falta `quota` del kernel: el enforcement en app + el cron de auditoría son suficientes para este tamaño.

## Alertas de disco

- Cron `storage-disk-alert.sh` cada 15 min.
- WARN al 80 %, CRÍTICO al 90 % del **filesystem** (no por tenant).
- Notifica una sola vez por transición (no spamea).
- Canal: WhatsApp al `OWNER_PHONE` vía un endpoint interno de la API.
  - Requiere que la app exponga `STORAGE_ALERT_URL` (+ `STORAGE_ALERT_TOKEN`) en `.env`, que reciba `{to, body, kind}` y mande el WhatsApp.
  - **Mientras ese endpoint no exista**, la alerta cae a `logger`/`/var/log/whatsapp-saas-storage.log` sin romper. Es degradación elegante, no error.

## Mantenimiento automático (crons en el host)

| Script | Frecuencia | Qué hace |
|--------|-----------|----------|
| `storage-disk-alert.sh` | cada 15 min | alerta de disco |
| `storage-cleanup.sh` | diario 03:30 | borra `_quarantine` >24h + dirs de tenant vacíos |
| `storage-backup.sh` | diario 04:00 | tar.gz incremental (mtime <24h), retención 7d, sync rclone opcional |

Generados por `infra/storage/host-scripts/provision-storage-host.sh` (idempotente). Config en `/etc/whatsapp-saas-storage.env`.

## Pasos manuales / operativos en la VPS

Todo está automatizado por workflows; el orden es:

1. **DNS** — `cdn.jestsolution.tech A → 177.7.58.11`. ✅ Ya creado vía MCP Hostinger.
2. **Provisionar host** — ejecutar el workflow **"Provision media storage (VPS)"** (`provision-storage.yml`) desde GitHub Actions. Idempotente. Crea dirs, scripts y crons.
3. **`.env` de prod** — añadir en el VPS:
   ```
   CDN_DOMAIN=cdn.jestsolution.tech
   MEDIA_STORAGE_BASE_PATH=/var/whatsapp-saas/media
   MEDIA_STORAGE_PUBLIC_BASE_URL=https://cdn.jestsolution.tech
   ```
   (usar el workflow `apply-secret.yml` o editar el `.env` directo en el VPS).
4. **Deploy normal** — el `deploy.yml` recoge `CDN_DOMAIN`, emite/expande el cert SAN (`--expand`) y levanta nginx con el vhost del CDN.
5. **Verificar:**
   ```
   curl -I https://cdn.jestsolution.tech/healthz        # 200
   curl -I https://cdn.jestsolution.tech/               # 404 (sin listado)
   curl -I https://cdn.jestsolution.tech/algun-tenant/  # 404 si no hay archivo
   ```

## Migrar a S3 en el futuro

Sin tocar lógica de negocio:
1. Implementar `S3StorageAdapter` con la misma interfaz (`saveImage`, `saveAudio`, `delete`, `resolvePublicUrl`).
2. Cambiar la factory del adapter por config.
3. `resolvePublicUrl` devuelve la URL de S3/CloudFront. nginx/CDN local quedan sin uso.

## Seguridad aplicada

- 🔒 `autoindex off` — sin listado de directorios.
- 🔒 Bloqueo de ejecución de `.php/.py/.sh/.jsp/...` aunque se cuele un archivo.
- 🔒 Bloqueo de dotfiles.
- 🔒 nginx monta el volumen **read-only**; solo la app escribe.
- 🔒 Permisos `0750` en dirs.
- 🔒 Rate limit `100r/s` por IP en el CDN.
- 🔒 Slug validado por regex en nginx antes de tocar el filesystem.
- 🔒 Firewall sin cambios: todo sale por 80/443 vía nginx; no se abren puertos nuevos.
