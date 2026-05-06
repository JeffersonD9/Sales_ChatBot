# Guía: Agregar un nuevo cliente al bot (Meta Developer Portal)

## Cómo funciona la plataforma

JestSolution tiene **una sola Meta App** registrada en developers.facebook.com.
Todos los clientes (tenants) comparten esa app. Lo que varía por cliente es:

- El **número de WhatsApp Business** del cliente (su propio número)
- El **webhook override** de ese número apuntando a `https://jestsolution.dev/webhook/{slug}`

No hay que crear una app nueva por cliente. Solo conectas el número del cliente a tu app existente y configuras el webhook.

---

## Flujo completo para un cliente nuevo

```
1. Crear tenant en dashboard  →  obtienes webhook_url + verify_token
2. Agregar número en Meta     →  obtienes phone_number_id + access token
3. Actualizar tenant          →  pegar phone_number_id y wa_token
4. Configurar webhook Meta    →  pegar webhook_url + verify_token en Meta
5. Suscribir eventos          →  activar "messages"
```

---

## Paso 1 — Crear el tenant en el dashboard

1. Entra a `https://jestsolution.dev/panel` con tu cuenta de administrador.
2. Clic en **+ Nuevo tenant**.
3. Llena:
   - **Nombre del negocio**: nombre del cliente
   - **Verify Token**: un texto que tú eliges, sin espacios (ej. `boutique-ana-2026`). Lo necesitarás en el paso 4.
   - **Teléfono del dueño** y demás datos del cliente
   - `wa_token` y `Phone Number ID` puedes dejarlo vacío ahora y actualizarlo en el paso 3
4. Clic en **Crear tenant**.
5. El sistema te muestra un modal con:
   - **URL del Webhook** → la copias para el paso 4
   - **Verify Token** → confirmación del que ingresaste
   - Copia ambos antes de cerrar.

---

## Paso 2 — Agregar el número del cliente a tu Meta App

> **Ruta exacta:** [developers.facebook.com](https://developers.facebook.com) →
> selecciona tu app (arriba a la izquierda) →
> barra lateral **WhatsApp** → **Configuración de la API**

En esa pantalla:

1. En la sección **Números de teléfono** → clic en **Agregar número de teléfono**.
2. Ingresa el número del cliente y sigue el proceso de verificación (código por SMS o llamada).
3. Una vez verificado, el número aparece en la lista.
4. Clic sobre el número → copia el valor **Phone Number ID** (un número largo como `107842379123456`).
5. En la misma pantalla, bajo **Token de acceso** → clic en **Generar token** → copia el token.

> **Para producción**: en lugar del token temporal, crea un System User Token permanente:
> ve a **business.facebook.com** → **Usuarios** → **Usuarios del sistema** →
> crea usuario Admin → **Generar token** → permisos
> `whatsapp_business_messaging` + `whatsapp_business_management`.

---

## Paso 3 — Actualizar el tenant con los datos de Meta

1. Vuelve al dashboard → en la tabla de tenants → clic en el ícono de editar del cliente.
2. Pega el **Phone Number ID** del paso 2.
3. Pega el **wa_token** (access token) del paso 2.
4. Guarda.

---

## Paso 4 — Configurar el webhook override en Meta

> **Ruta exacta:** developers.facebook.com → tu app →
> barra lateral **WhatsApp** → **Configuración** →
> sección **Números de teléfono** → clic en el número del cliente →
> pestaña **Webhooks**

En esa pantalla verás la opción **"Anular webhooks de la app para este número"** (Override app webhooks):

1. Activa el toggle **Anular webhooks de la app**.
2. En **URL de devolución de llamada** pega la URL del webhook del paso 1:
   ```
   https://jestsolution.dev/webhook/<slug-del-cliente>
   ```
3. En **Token de verificación** pega el Verify Token del paso 1.
4. Clic en **Verificar y guardar**.
   - Meta hace una petición GET a la URL. Si el servidor está activo responde correctamente.
   - Si ves el mensaje **"¡Verificado!"** continúa.

---

## Paso 5 — Suscribir eventos para ese número

En la misma pestaña **Webhooks** del número:

1. Clic en **Administrar** (o **Editar suscripciones**).
2. Activa **`messages`** → imprescindible para recibir mensajes.
3. Activa **`message_deliveries`** → para confirmaciones de entrega (recomendado).
4. Clic en **Guardar**.

---

## Verificación final

Envía un mensaje de WhatsApp desde el número del cliente a sí mismo (o desde un número de prueba).
El bot debe responder con el menú de bienvenida.

Para ver los logs en tiempo real:
```bash
docker compose logs -f app | grep "<slug-del-cliente>"
```

---

## Referencia rápida por cliente

| Qué necesitas | Dónde lo obtienes | Dónde lo pegas |
|---------------|-------------------|----------------|
| `phone_number_id` | Meta → WhatsApp → Config. de la API → lista de números | Dashboard → Editar tenant |
| `wa_token` | Meta → WhatsApp → Config. de la API → Generar token | Dashboard → Editar tenant |
| `webhook_url` | Dashboard → modal al crear el tenant | Meta → Webhooks del número |
| `verify_token` | Lo defines tú al crear el tenant | Meta → Webhooks del número |

---

## Configuración única (solo la primera vez, ya hecha)

Estos pasos son de la plataforma, no de cada cliente:

- **Crear la Meta App** en developers.facebook.com → tipo Business → agregar producto WhatsApp
- **`META_APP_SECRET`** → Configuración básica → Secreto de la app → guardado en `.env`
- **Webhook principal de la app** (opcional si usas override por número)

---

## Errores frecuentes

| Error | Causa | Solución |
|-------|-------|---------|
| Verificación falla (403) | Verify Token no coincide | El token en Meta debe ser exactamente igual al del tenant en la BD |
| Bot no responde | `messages` no suscrito | Paso 5: activa el evento `messages` para ese número |
| `401` en mensajes entrantes | `wa_token` expirado | Regenera el token en Meta y actualiza el tenant en el dashboard |
| `Phone number not registered` | `phone_number_id` incorrecto | Cópialo de nuevo desde Meta → WhatsApp → Config. de la API |
