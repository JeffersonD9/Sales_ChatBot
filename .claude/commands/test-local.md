# /test-local — Entorno de pruebas local con WhatsApp real

Levanta el entorno de desarrollo completo para probar el bot con un número de WhatsApp real.
Ejecuta TODOS los pasos en orden sin preguntar, excepto donde se indique explícitamente.

---

## PASO 1 — Verificar y levantar Docker

Ejecuta:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Espera 4 segundos y verifica que los tres contenedores estén corriendo:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Si algún contenedor tiene estado distinto a `running` o `healthy`, muestra el error y detente.

---

## PASO 2 — Verificar que la app responde

Llama a `http://localhost:3000/health`.

- Si `db` y `redis` son `connected` → continuar.
- Si alguno falla → mostrar el error y detente.

---

## PASO 3 — Levantar el túnel

Inicia localtunnel **en background**:
```
npx localtunnel --port 3000
```

Espera 6 segundos y lee el output del proceso para obtener la URL (`your url is: https://...`).

Luego verifica que el túnel alcanza el bot:
```
GET https://<URL_TUNEL>/health  con header  bypass-tunnel-reminder: true
```

- Si responde con `status: ok` → continuar con esa URL.
- Si falla → intentar una vez más (reiniciar localtunnel). Si vuelve a fallar, mostrar el error y detente.

---

## PASO 4 — Obtener tenants activos

Ejecuta en el contenedor postgres:
```sql
SELECT slug, verify_token, owner_phone, phone_number_id, status
FROM tenants
WHERE status = 'active'
ORDER BY created_at DESC;
```

---

## PASO 5 — Mostrar resumen de configuración

Muestra una tabla clara con TODA la información que el usuario necesita para configurar Meta:

```
╔══════════════════════════════════════════════════════════╗
║           ENTORNO LOCAL LISTO — CONFIGURACIÓN META       ║
╠══════════════════════════════════════════════════════════╣
║ URL del túnel:  https://<URL_TUNEL>                      ║
╠══════════════════════════════════════════════════════════╣
║ TENANT: <slug>                                           ║
║  Webhook URL:   https://<URL_TUNEL>/webhook/<slug>       ║
║  Verify token:  <verify_token>                           ║
║  Phone ID:      <phone_number_id>                        ║
║  Owner phone:   <owner_phone>                            ║
╚══════════════════════════════════════════════════════════╝
```

Repite el bloque de tenant para cada tenant activo.

Luego agrega este aviso:

> ⚠️ La URL del túnel cambia cada vez que se reinicia localtunnel.
> Si el túnel se cae, vuelve a ejecutar /test-local para obtener la nueva URL
> y actualízala en Meta → WhatsApp → Configuración → Webhook.

---

## PASO 6 — Iniciar monitoreo de logs en tiempo real

Inicia en background:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs app -f --tail=0
```

Informa al usuario que los logs están activos y que avisarás si hay errores al procesar mensajes.

Luego monitorea el output del proceso de logs. Cuando llegue un mensaje nuevo:
- Si contiene `[Dispatcher] Mensaje recibido` → informar: "📨 Mensaje recibido de <waFrom>"
- Si contiene `[Sender] Error Meta API` → informar: "❌ Error enviando respuesta a Meta: <detalle>"
- Si contiene `[Dispatcher] Error procesando mensaje` → informar: "❌ Error en el flujo: <err>"
- Si contiene `[Sender]` sin error → informar: "✅ Respuesta enviada"

---

## NOTAS IMPORTANTES

- El directorio de trabajo es siempre `D:\Users\Jefferson\Documents\Proyectos-2026\Bots\whatsapp-saas`
- El archivo `.env` ya tiene las variables de dev configuradas (DEMO_MODE=false, REDIS_PASSWORD, etc.)
- localtunnel es inestable — si el proceso background termina con error, reiniciarlo inmediatamente
- En Meta: después de pegar la URL de callback hay que hacer clic en "Verificar y guardar" Y luego suscribir el campo `messages` si no está suscrito
- El token de verificación es diferente por tenant — usar el de la tabla, no inventarlo
