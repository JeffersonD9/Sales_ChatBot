# Guía: Crear un tenant

## Parámetros del script

| Parámetro | Flag | Requerido | Ejemplo |
|-----------|------|-----------|---------|
| Slug (URL-friendly) | `--slug` | ✅ | `boutique-ana` — solo minúsculas, números y guiones |
| Nombre del negocio | `--name` | ✅ | `"Boutique Ana"` |
| WhatsApp Access Token | `--wa-token` | ✅ | `EAAxxxxxxxxxxxxx` |
| Phone Number ID (Meta) | `--phone-id` | ✅ | `123456789012345` |
| Verify Token (libre) | `--verify-token` | ✅ | `ana_verify_2026_xxxx` |
| Teléfono del dueño | `--owner-phone` | ✅ | `573001234567` |
| Email del dueño | `--owner-email` | ❌ | `ana@ejemplo.com` |
| Ciudad | `--city` | ❌ (default: `Colombia`) | `"Bucaramanga"` |
| Horario | `--schedule` | ❌ (default: `Lun-Sáb 9am-7pm`) | `"Lun-Sáb 9am-7pm"` |

> **El `verify-token` es libre** (lo inventás vos), pero debe coincidir exactamente con lo que registres en el panel de Meta cuando configures el webhook.

---

## Entornos

### Desarrollo local (Docker)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app \
  node scripts/create-tenant.js \
    --slug=SLUG \
    --name="NOMBRE" \
    --wa-token=TOKEN \
    --phone-id=PHONE_ID \
    --verify-token=VERIFY_TOKEN \
    --owner-phone=OWNER_PHONE \
    --owner-email=OWNER_EMAIL \
    --city="CIUDAD" \
    --schedule="HORARIO"
```

### Producción (VPS)

```bash
cd ~/apps/whatsapp-saas
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app \
  node scripts/create-tenant.js \
    --slug=SLUG \
    --name="NOMBRE" \
    --wa-token=TOKEN \
    --phone-id=PHONE_ID \
    --verify-token=VERIFY_TOKEN \
    --owner-phone=OWNER_PHONE \
    --owner-email=OWNER_EMAIL \
    --city="CIUDAD" \
    --schedule="HORARIO"
```

---

## Verificación post-creación

```bash
# Confirmar que el tenant quedó activo en la DB
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "SELECT slug, name, status, owner_phone FROM tenants WHERE slug='SLUG';"

# Probar que el webhook GET responde con el challenge (usar el dominio real, no localhost)
curl "https://bots.jesttech.com/webhook/SLUG?hub.mode=subscribe&hub.verify_token=VERIFY_TOKEN&hub.challenge=12345"
# Debe responder: 12345
```

---

## Rollback

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "DELETE FROM tenants WHERE slug='SLUG';"
```

---

## Qué guarda en la DB

El script inserta en la tabla `tenants`:

- `slug` — identificador en la URL del webhook (`/webhook/<slug>`)
- `wa_token_encrypted` — token de Meta encriptado con AES-256-CBC (clave `ENCRYPTION_KEY`)
- `phone_number_id` — ID del número en Meta
- `verify_token` — token para verificar el webhook en Meta
- `owner_phone` / `owner_email` — a dónde van las notificaciones de ventas
- `bot_config` (JSONB) — `{ business_name, city, schedule, offers: [], flow_type: "sales_v1" }`
- `status` — `active` por defecto

---

## Ejemplo completo — Boutique Ana

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app \
  node scripts/create-tenant.js \
    --slug=boutique-ana \
    --name="Boutique Ana" \
    --wa-token=EAAxxxxxxxxxxxxx \
    --phone-id=123456789012345 \
    --verify-token=ana_verify_2026_xxxx \
    --owner-phone=573001234567 \
    --owner-email=ana@ejemplo.com \
    --city="Bucaramanga" \
    --schedule="Lun-Sáb 9am-7pm"
```

URL webhook resultante: `https://bots.jesttech.com/webhook/boutique-ana`

---

## Después de crear el tenant

1. **Registrar en Meta Business:**
   - App → WhatsApp → Configuración → Webhook → Editar
   - Callback URL: `https://bots.jesttech.com/webhook/<slug>`
   - Verify token: el mismo `--verify-token` que usaste
   - Suscribir al campo `messages`

2. **Importar productos** (ver `scripts/import-products.js`)

3. **Smoke test:** enviar `hola` desde un WhatsApp al número del cliente
