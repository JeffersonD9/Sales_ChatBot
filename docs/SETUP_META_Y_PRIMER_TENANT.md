# Setup Meta + Primer Tenant + Test del Flujo

---

## Qué vas a hacer

1. Crear una app en Meta y conseguir las credenciales de WhatsApp
2. Levantar el entorno local con Docker
3. Crear el tenant desde el panel web
4. Registrar el webhook en Meta
5. Enviar el primer mensaje y ver el bot responder

---

## PASO 1 — Credenciales de Meta (qué son y dónde están)

Vas a necesitar 4 datos de Meta. Acá te explico qué es cada uno:

---

### 1.1 Crear la app en Meta

1. Entra a [developers.facebook.com](https://developers.facebook.com)
2. **"Mis apps"** → **"Crear app"**
3. Tipo: **Business** → siguiente
4. Ponle cualquier nombre, ej: `JestTech Bot`
5. Asocia tu cuenta de Meta Business → Crear

---

### 1.2 Agregar WhatsApp a la app

1. En el dashboard de tu app → **"Agregar producto"** → **WhatsApp** → Configurar
2. Esto abre la sección **WhatsApp > Configuración de la API**

Quédate en esa pantalla, de ahí sacas los datos de abajo.

---

### Los 4 datos que necesitas

**`wa_token` — Token de acceso a la API de WhatsApp**

> Es la contraseña que usa el bot para enviar mensajes a tus clientes.
> Sin este token, el bot no puede enviar nada.

Dónde está: **WhatsApp > Configuración de la API** → campo **"Token de acceso temporal"** → copiar.

> El token temporal dura 24 horas. Para producción se usa un token permanente
> (System User), pero para el primer test el temporal funciona.

---

**`phone_number_id` — ID del número de WhatsApp**

> No es el número de teléfono visible (+57 ...). Es el ID interno que Meta
> usa para identificar el número al que van los mensajes.

Dónde está: misma pantalla → sección **"De"** → debajo del número aparece el ID numérico. Ej: `123456789012345`

---

**`verify_token` — Token de verificación del webhook**

> Es un string que **tú inventas**. Meta lo usa para verificar que el webhook
> que le das pertenece a tu servidor. Puede ser cualquier texto, solo tienes
> que usar el mismo en Meta y en el panel.

Ejemplo: `mi_bot_secreto_2026`

> No tiene que venir de ningún lado. Solo escríbelo, recuérdalo y úsalo igual en los dos lados.

---

**`app_secret` — Secreto de la app Meta**

> Con este dato el servidor verifica que cada mensaje que llega realmente
> viene de Meta y no de alguien haciéndose pasar por Meta (firma HMAC-SHA256).

Dónde está: en el panel de Meta → **Configuración** (ícono de engranaje, menú izquierdo) → **Básica** → **"Secreto de la aplicación"** → Mostrar → copiar.

---

## PASO 2 — Levantar el entorno local

### 2.1 Configurar variables de entorno

```bash
cp .env.dev.example .env
```

Abre `.env` y edita estas líneas:

```env
DEMO_MODE=false

META_APP_SECRET=pega_aqui_el_app_secret_de_meta

# Genera estas 3 claves con los comandos de abajo
ENCRYPTION_KEY=
APP_SECRET=
JWT_SECRET=

# Pon la clave que quieras para entrar al panel admin
ADMIN_API_KEY=clave-admin-2026
```

**Generar las claves de seguridad** (corre cada línea y pega el resultado en el `.env`):

```bash
# ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# APP_SECRET
node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"

# JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2.2 Levantar Docker

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### 2.3 Correr las migrations (solo la primera vez)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app npm run migrate
```

### 2.4 Verificar que todo levantó

```bash
curl http://localhost:3000/health
# Respuesta esperada: { "ok": true }
```

---

## PASO 3 — Exponer localhost con ngrok

Meta necesita una URL pública HTTPS para enviarte los mensajes. En local usamos ngrok:

```bash
ngrok http 3000
```

Verás algo así:
```
Forwarding   https://abc123.ngrok-free.app → http://localhost:3000
```

Copia esa URL. La necesitas en el paso siguiente.

> Cada vez que reinicias ngrok la URL cambia y hay que actualizarla en Meta.
> En producción usas tu dominio fijo y esto no pasa.

---

## PASO 4 — Crear el tenant desde el panel

1. Abre el panel: **http://localhost:3000/panel-ui/**
2. Inicia sesión con tu usuario admin
3. Ve a la pestaña **"Tenants"** → clic **"Nuevo tenant"**
4. Llena el formulario con los datos de Meta:

| Campo | Qué poner |
|-------|-----------|
| Nombre del negocio | El nombre de tu cliente, ej: `Mi Tienda` |
| WhatsApp Token | El `wa_token` que copiaste en el Paso 1 |
| Phone Number ID | El `phone_number_id` del Paso 1 |
| Verify Token | El string que inventaste en el Paso 1, ej: `mi_bot_secreto_2026` |
| Teléfono del dueño | Tu número en formato internacional sin `+`, ej: `573001234567` |

5. Clic **"Crear tenant"**

El slug se genera automáticamente desde el nombre. Si el nombre es `Mi Tienda`, el slug queda `mi-tienda` y la URL del webhook será `/webhook/mi-tienda`.

---

## PASO 5 — Registrar el webhook en Meta

### 5.1 Ir a webhooks

En Meta: **WhatsApp > Configuración de la API** → sección **"Webhook"** → **"Configurar"**

### 5.2 Llenar los campos

- **URL de callback:**
  ```
  https://abc123.ngrok-free.app/webhook/mi-tienda
  ```
  *(URL de ngrok + `/webhook/` + el slug que te generó el panel)*

- **Token de verificación:**
  ```
  mi_bot_secreto_2026
  ```
  *(el mismo verify token que pusiste en el panel)*

### 5.3 Verificar y guardar

Clic **"Verificar y guardar"**. Meta hace un GET a tu servidor para confirmar el webhook. Si todo está bien aparece ✓ verde.

Si falla, revisa:
- Que ngrok esté corriendo
- Que la URL tenga el slug correcto
- Que el verify token sea exactamente igual en los dos lados

### 5.4 Activar mensajes entrantes

En la misma pantalla → **"Campos del webhook"** → activar `messages` ✓

Sin esto Meta no te reenvía los mensajes que llegan al número.

---

## PASO 6 — Primer test

### 6.1 Agregar tu número como número de prueba

En Meta: **WhatsApp > Configuración de la API** → campo **"A"** → **"Administrar lista de números de teléfono"** → agrega tu número personal.

Solo los números en esta lista pueden recibir mensajes del número de prueba de Meta.

### 6.2 Enviarle un mensaje al bot

Desde tu WhatsApp personal, escríbele al número de prueba de Meta. Ej: `hola`

### 6.3 Ver los logs

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f app
```

Si todo funciona verás:
```
[webhook] POST /webhook/mi-tienda  phone=573001234567
[engine]  step=NEW → enviando menú principal
[sender]  200 OK → 573001234567
```

Y en tu WhatsApp recibirás el menú principal del bot.

---

## Troubleshooting

| Error | Causa | Solución |
|-------|-------|----------|
| Meta: "Token de verificación no coincide" | El verify token en el panel ≠ el de Meta | Editar el tenant en el panel y corregir el verify token |
| El bot no responde | `META_APP_SECRET` incorrecto | Comparar el `.env` con el App Secret en Meta > Configuración > Básica |
| `401` al enviar mensaje | `wa_token` expirado (dura 24h) | Generar nuevo token en Meta y editar el tenant en el panel |
| ngrok 502 | La app no está corriendo | Ver `docker ... logs app` |
| `tenant not found` en logs | El slug en la URL no existe | Verificar el slug exacto en el panel y usarlo en la URL del webhook |

---

## Comandos útiles

```bash
alias dcdev="docker compose -f docker-compose.yml -f docker-compose.dev.yml"

dcdev logs -f app          # ver logs en vivo
dcdev up -d --build app    # reiniciar la app tras cambios
dcdev down                 # apagar todo
dcdev down -v              # apagar + borrar DB (reset total)
```
