# Integracion 360dialog

Plan B para operar WhatsApp Business API mediante 360dialog mientras el portafolio de Meta no esta verificado.

## Que cambia frente a Meta directo

- El formato de mensajes y webhooks sigue siendo compatible con WhatsApp Business Platform.
- El envio saliente cambia de Graph API a `POST https://waba-v2.360dialog.io/messages`.
- La autenticacion saliente usa el header `D360-API-KEY`, no `Authorization: Bearer`.
- La API key de 360dialog es por numero/canal. En este proyecto se guarda en el mismo campo cifrado `wa_token_encrypted`.
- `phone_number_id` no es necesario para enviar por 360dialog, pero puede guardarse si lo tenemos para trazabilidad.

## Configuracion del tenant

Crear un tenant nuevo con 360dialog:

```bash
node scripts/create-tenant.js \
  --slug=cliente-demo \
  --name="Cliente Demo" \
  --provider=360dialog \
  --wa-token=D360_API_KEY_DEL_CANAL \
  --owner-phone=573001234567 \
  --plan=basic
```

Para un tenant existente, actualizar `tenants.bot_config`:

```sql
UPDATE tenants
SET bot_config = bot_config || '{"whatsapp_provider":"360dialog"}'::jsonb
WHERE slug = 'cliente-demo';
```

El token cifrado del tenant debe ser la `D360-API-KEY` entregada por 360dialog para ese numero/canal.

## Webhook

Configurar en 360dialog Hub el webhook del numero hacia:

```text
https://TU_DOMINIO/webhook/{slug}
```

Ejemplo:

```text
https://jestsolution.tech/webhook/cliente-demo
```

El servicio ya responde `200 OK` antes de procesar y encola el payload en `whatsapp.inbound`, que es el comportamiento recomendado para evitar reintentos por latencia.

Si quieres proteger el webhook con header desde 360dialog Hub, configura `D360_WEBHOOK_AUTHORIZATION` con el valor exacto esperado. Ejemplo para Basic Auth:

```env
D360_WEBHOOK_AUTHORIZATION=Basic dXNlcjpwYXNz
```

## Variables utiles

```env
WHATSAPP_PROVIDER=meta
D360_BASE_URL=https://waba-v2.360dialog.io
# D360_API_KEY=solo_para_desarrollo_o_un_tenant_unico
# D360_WEBHOOK_AUTHORIZATION=Basic dXNlcjpwYXNz
```

En produccion multitenant, preferir el token cifrado por tenant. `D360_API_KEY` solo sirve como fallback local o para un despliegue de un solo tenant.

## Checklist de salida

- Canal de 360dialog en estado `ready`.
- API key generada y guardada como token del tenant.
- `bot_config.whatsapp_provider = "360dialog"`.
- Webhook HTTPS configurado en 360dialog Hub.
- Prueba de mensaje entrante hacia `/webhook/{slug}`.
- Prueba de respuesta saliente desde el bot.
