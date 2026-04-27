# Onboarding de un nuevo cliente

Proceso completo para incorporar un cliente a la plataforma. Aplica igual para el cliente 1, 2, N.

---

## Resumen del flujo

```
1. Cliente prepara su número y cuenta Meta     [CLIENTE hace esto]
2. Cliente te pasa sus credenciales            [CLIENTE → vos]
3. Vos creás el tenant en la DB               [Vos]
4. Vos importás su catálogo de productos      [Vos]
5. Cliente registra el webhook en Meta         [CLIENTE con tu ayuda]
6. Smoke test con WhatsApp real               [Ambos]
```

---

## Paso 1 — El cliente prepara su cuenta Meta

> Esto lo hace el cliente. Le mandás estas instrucciones.

### 1.1 Crear cuenta Meta Business

Si no tiene:
1. Ir a [business.facebook.com](https://business.facebook.com)
2. Crear cuenta de empresa con nombre del negocio

### 1.2 Registrar número de WhatsApp en Meta

1. En Meta Business Suite → **WhatsApp Manager**
2. Click en **"Agregar número de teléfono"**
3. Ingresar el número físico del negocio (el que van a usar para el bot)
4. Verificar con el código SMS/llamada
5. Esperar aprobación de Meta (puede tardar de minutos a 48h)

> **Requisitos del número:**
> - Puede ser celular o fijo
> - No puede estar activo en WhatsApp personal/Business app al mismo tiempo
> - Hay que desvincularlo de WhatsApp antes de registrarlo en la API

### 1.3 Obtener las credenciales

Una vez el número esté aprobado, el cliente necesita obtener:

**Desde Meta for Developers ([developers.facebook.com](https://developers.facebook.com)) → su app → WhatsApp → API Setup:**

| Credencial | Dónde encontrarla | Ejemplo |
|------------|-------------------|---------|
| `Phone Number ID` | Sección "From" del API Setup | `123456789012345` |
| `WhatsApp Business Account ID` | Mismo panel | `987654321098765` |
| `Permanent Access Token` | Ver paso 1.4 abajo | `EAAxxxxxxxxxxxxx` |

### 1.4 Generar Permanent Access Token

> El token temporal de 24h **no sirve**. Hay que generar uno permanente.

1. Ir a [business.facebook.com](https://business.facebook.com) → Configuración → Usuarios del sistema
2. Crear un **Usuario del sistema** (rol: Administrador)
3. Asignarle el activo: la WABA del negocio (con permisos `whatsapp_business_messaging` y `whatsapp_business_management`)
4. Generar token → seleccionar la Meta App de Jest Tech → permisos: `whatsapp_business_messaging`, `whatsapp_business_management`
5. Copiar el token → **no expira**

### 1.5 Qué te manda el cliente

El cliente te tiene que pasar:

```
Nombre del negocio:   Boutique Ana
Slug deseado:         boutique-ana        (vos lo decidís si el cliente no sabe)
Phone Number ID:      123456789012345
Permanent Token:      EAAxxxxxxxxxxxxx
Teléfono del dueño:   573001234567        (para notificaciones de ventas)
Email del dueño:      ana@ejemplo.com     (opcional)
Ciudad:               Bucaramanga
Horario:              Lun-Sáb 9am-7pm
```

---

## Paso 2 — Vos creás el tenant

> Ejecutar en el VPS.

```bash
cd ~/apps/whatsapp-saas

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

> **`verify-token`:** inventalo vos, cualquier string sin espacios. Anótalo — lo necesitás en el Paso 4.

**Verificar:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "SELECT slug, name, status, owner_phone FROM tenants WHERE slug='boutique-ana';"
```

Debe aparecer con `status = active`.

---

## Paso 3 — Importar catálogo de productos

> Ver formato en `scripts/products-template.csv` o usar JSON directamente.

### Formato JSON

```json
[
  {
    "name": "Vestido Floral Verano",
    "description": "Vestido midi con estampado floral, tela liviana.",
    "price": 85000,
    "sizes": ["S", "M", "L"],
    "image_url": "https://...",
    "category": "vestidos",
    "stock": true
  }
]
```

### Importar

```bash
# Desde local, copiar el archivo al VPS
scp productos-boutique-ana.json USUARIO@IP_VPS:~/apps/whatsapp-saas/data/

# En el VPS
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app \
  node scripts/import-products.js \
    --slug=boutique-ana \
    --file=data/productos-boutique-ana.json
```

**Verificar:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "SELECT COUNT(*) FROM products p
      JOIN tenants t ON p.tenant_id = t.id
      WHERE t.slug='boutique-ana';"
```

---

## Paso 4 — Cliente registra el webhook en Meta

> Esto lo hace el cliente en su panel de Meta, con tu ayuda si es necesario.

1. Ir a [developers.facebook.com](https://developers.facebook.com) → su App → WhatsApp → Configuración
2. En **"Webhook"** → click **"Editar"**:
   - **Callback URL:** `https://bots.jesttech.com/webhook/boutique-ana`
   - **Verify token:** el `verify-token` que usaste en el Paso 2
3. Click **"Verificar y guardar"** → Meta hace un GET al endpoint, debe responder con el challenge
4. En **"Campos del webhook"** → suscribirse a `messages`

**Qué debe pasar:**
- Meta hace `GET /webhook/boutique-ana?hub.mode=subscribe&hub.verify_token=...&hub.challenge=xxx`
- Tu servidor responde `xxx`
- Meta muestra "Verificado ✅"

**Si falla la verificación:**
```bash
# Probar manualmente desde local
curl "https://bots.jesttech.com/webhook/boutique-ana?hub.mode=subscribe&hub.verify_token=ana_verify_2026_xxxx&hub.challenge=test123"
# Debe responder: test123

# Ver logs del servidor mientras Meta hace la verificación
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f app | grep boutique-ana
```

---

## Paso 5 — Smoke test con WhatsApp real

> Usar un teléfono distinto al del dueño.

Enviar estos mensajes al número del cliente y verificar respuestas:

| # | Mensaje | Respuesta esperada |
|---|---------|-------------------|
| 1 | `hola` | Menú principal con opciones |
| 2 | `1` | Pregunta por talla |
| 3 | `M` | Pregunta por presupuesto |
| 4 | `100000` | Hasta 3 productos con precio |
| 5 | (elegir un producto) | Pide nombre |
| 6 | `Pedro Pérez` | Pide dirección |
| 7 | `Calle 123 #45-67` | Pide método de pago |
| 8 | `Nequi` | Confirma pedido |
| 9 | `menu` | Vuelve al menú |

**El dueño debe recibir notificación en su WhatsApp cuando se complete el pedido.**

**Verificar en DB:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas -c "
    SELECT customer_name, total, status, created_at FROM orders
    WHERE tenant_id = (SELECT id FROM tenants WHERE slug='boutique-ana')
    ORDER BY created_at DESC LIMIT 5;
  "
```

---

## Checklist de cierre por cliente

- [ ] Tenant creado y `status = active` en DB
- [ ] Productos importados (verificar conteo)
- [ ] Webhook verificado en Meta (status verde en el panel)
- [ ] Smoke test completo sin errores
- [ ] Dueño recibió notificación de la orden de prueba
- [ ] Orden registrada en tabla `orders`

---

## Operaciones post-onboarding

### Actualizar productos

```bash
# Subir nuevo JSON al VPS
scp productos-nuevos.json USUARIO@IP_VPS:~/apps/whatsapp-saas/data/

# Importar (flag --replace sobrescribe todo el catálogo)
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app \
  node scripts/import-products.js --slug=boutique-ana --file=data/productos-nuevos.json --replace
```

### Pausar cliente (sin borrar datos)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "UPDATE tenants SET status='inactive' WHERE slug='boutique-ana';"
```

### Reactivar cliente

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas \
  -c "UPDATE tenants SET status='active' WHERE slug='boutique-ana';"
```

### Ver órdenes recientes de un cliente

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  psql -U app -d whatsapp_saas -c "
    SELECT created_at, customer_name, total, status FROM orders
    WHERE tenant_id = (SELECT id FROM tenants WHERE slug='boutique-ana')
    ORDER BY created_at DESC LIMIT 20;
  "
```

---

## Datos que pedirle a cada cliente (template de correo)

```
Hola [nombre],

Para configurar tu bot de WhatsApp necesito los siguientes datos:

1. Nombre del negocio (como quieres que aparezca en los mensajes)
2. Ciudad
3. Horario de atención (ej: Lun-Sáb 9am-7pm)
4. Teléfono del dueño para recibir notificaciones de ventas (con código de país, ej: 573001234567)
5. Email del dueño (opcional)
6. Desde Meta Business:
   - Phone Number ID
   - Permanent Access Token
7. Catálogo de productos en Excel o con fotos (nombre, descripción, precio, tallas disponibles)

Si necesitas ayuda para obtener el Phone Number ID y el token, avísame y te guío paso a paso.

Saludos,
Jefferson — Jest Tech Solutions
```
