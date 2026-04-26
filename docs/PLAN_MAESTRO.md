# Plan Maestro — whatsapp-saas

**Fecha:** 2026-04-26
**Versión:** 1.0
**Autor:** Auditoría Claude

Este documento define dos fases de trabajo:

1. **FASE 1 — Production Readiness:** dejar el proyecto 100% funcional, testeado y desplegable. **Es bloqueante** antes de aceptar el primer cliente real.
2. **FASE 2 — Flow Engine Custom:** rediseñar el motor de conversación para que cada cliente pueda tener una secuencia de pasos diferente sin tocar código.

Las dos fases son **secuenciales**. No tiene sentido construir flujos custom sobre una base que aún no es estable.

---

## Resumen ejecutivo

| Fase | Objetivo | Duración estimada | Bloqueante |
|------|----------|-------------------|------------|
| **1.1 Tests críticos** | Cobertura de webhook, idempotencia, flow steps | 5 días | Sí |
| **1.2 Infra de producción** | docker-compose.prod, nginx, SSL, backups | 4 días | Sí |
| **1.3 Hardening operacional** | Idempotencia persistente, cola de notificaciones, monitoreo | 4 días | Sí |
| **1.4 Go-Live** | Deploy + cliente1 migrado | 2 días | — |
| **2.1 Diseño del Flow Engine declarativo** | Schema, interpreter, step types base | 5 días | — |
| **2.2 Migración del flujo actual** | Reescribir `sales_v1` en formato declarativo + tests de paridad | 4 días | — |
| **2.3 Templates y API admin** | Editor JSON + plantillas por tipo de negocio | 4 días | — |
| **2.4 Validación con cliente real** | Cliente2 con flujo distinto en producción | 3 días | — |

**Total realista:** 6-7 semanas de trabajo enfocado.

---

# FASE 1 — Production Readiness

## 1.1 Sprint de Tests Críticos (5 días)

### Objetivo
Cubrir las rutas que rompen silenciosamente y son imposibles de detectar a ojo: HMAC, deduplicación, flujo de venta completo.

### Tareas

#### T1.1.1 — Tests de `webhooks/verifier.js` (1 día)
**Archivos:** `tests/unit/webhooks/verifier.test.js` (nuevo)

Casos:
- HMAC válido con `META_APP_SECRET` correcto → `true`
- HMAC inválido (un byte cambiado) → `false`
- Header `x-hub-signature-256` ausente → `false`
- Header sin prefijo `sha256=` → `false`
- Body vacío → `false`
- Comparación con `timingSafeEqual` (no usar `===`)

**Criterio de aceptación:** 100% de cobertura de líneas en `verifier.js`. Test que confirme que no se usa comparación naive (revisar el código del test, no solo el resultado).

#### T1.1.2 — Tests de `webhooks/dispatcher.js` (1 día)
**Archivos:** `tests/unit/webhooks/dispatcher.test.js` (nuevo)

Casos:
- Mensaje nuevo → procesa y guarda ID
- Mismo mensaje recibido 2 veces → solo procesa una vez
- Tenant no existe (slug inválido) → log warning, no procesa
- Mensaje sin campo `id` → ignora (no procesa)
- Mensaje de tipo "status" (delivery receipt) → ignora

**Criterio:** Mocks de `tenantLoader`, `engine`, `stateManager`. Validar que `engine.processMessage` se llama exactamente N veces.

#### T1.1.3 — Tests de los steps del flow-engine (2 días)
**Archivos:**
- `tests/unit/flow-engine/menu.test.js`
- `tests/unit/flow-engine/catalog.test.js`
- `tests/unit/flow-engine/order.test.js`

Por cada step, cubrir:
- Input válido → transición correcta + mensaje correcto
- Input inválido → reprompt con mensaje de error
- Comando global (`menu`, `0`) → reset a MENU
- Estado inconsistente (campos faltantes en `session.data`) → fallback graceful

**Criterio:** Mock de `sender.js` y `notifier.js`. Cobertura ≥ 80% en cada handler.

#### T1.1.4 — Test de integración del webhook end-to-end (1 día)
**Archivos:** `tests/integration/webhook-flow.test.js` (nuevo)

Caso completo:
1. POST /webhook/demo-store con HMAC válido y mensaje "hola"
2. Verificar que el bot responde con menú
3. POST con "1" (catálogo)
4. POST con talla "S"
5. POST con presupuesto "$50.000"
6. Verificar que `sender.sendImage` se llamó con producto filtrado
7. Verificar que `session.step === CATALOG_SHOWING`

**Criterio:** Usar `supertest` contra Express real. Mockear `sender` (Meta API) pero NO mockear el flow-engine. DB y Redis pueden ser mocks o testcontainers.

### Definition of Done — Sprint 1.1
- [ ] `npm test` pasa con ≥ 75% cobertura global
- [ ] `npm run test:unit` corre en < 10s
- [ ] CI configurado (GitHub Actions o similar) que falle si tests fallan
- [ ] Reporte de coverage en `coverage/` accesible

---

## 1.2 Sprint de Infra de Producción (4 días)

### Objetivo
Tener un `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` que funcione en una VPS limpia con SSL automático.

### Tareas

#### T1.2.1 — `docker-compose.prod.yml` completo (1 día)

Servicios:
- `app` (image desde `runner` stage del Dockerfile, sin volúmenes de código)
- `postgres` (con volumen persistente `pg_data`)
- `redis` (con volumen `redis_data` y `appendonly yes`)
- `nginx` (proxy HTTPS)
- `certbot` (renovación automática)

Cambios respecto a dev:
- **Sin** ports expuestos en `postgres` ni `redis` (solo red interna)
- App sin hot reload (`NODE_ENV=production`, `command: node src/server.js`)
- Restart policy `unless-stopped` en todos
- Logs limitados (`logging.options.max-size: 10m`, `max-file: 3`)
- Health checks robustos con `start_period`

**Archivo de referencia:** crear `docker-compose.prod.yml.example` documentado.

#### T1.2.2 — Nginx con SSL (1 día)
**Archivos:** `nginx/conf.d/saas.conf` (nuevo), `nginx/nginx.conf` (revisar)

Config:
- HTTP→HTTPS redirect en `:80` (excepto `/.well-known/acme-challenge/`)
- HTTPS en `:443` con cert de Let's Encrypt
- Proxy a `app:3000`
- Headers de seguridad: `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`
- Tamaño máximo de body 1MB (suficiente para webhooks de Meta)
- Timeout de 30s para upstream

#### T1.2.3 — Script de bootstrap SSL (0.5 día)
**Archivos:** `scripts/init-ssl.sh` (nuevo)

Script que:
1. Crea cert dummy si no existe (para que nginx levante)
2. Levanta nginx + certbot
3. Solicita cert real con `certbot certonly --webroot`
4. Reemplaza dummy con cert real
5. Reload nginx

Documentar comando único: `bash scripts/init-ssl.sh bots.jesttech.com admin@jesttech.com`.

#### T1.2.4 — Backups automáticos de PostgreSQL (1 día)
**Archivos:** `scripts/backup-db.sh`, `docker-compose.prod.yml` (servicio cron)

Estrategia:
- Servicio sidecar `db-backup` con cron diario a las 3 AM
- `pg_dump` comprimido con gzip
- Rotación: mantener últimos 7 días
- Path: `/backups/whatsapp-saas-YYYY-MM-DD.sql.gz`
- Volumen montado a `/var/backups/whatsapp-saas` en host
- Notificación al owner si falla (vía script que use el mismo `notifier`)

**Bonus:** documentar restore en `docs/DISASTER_RECOVERY.md`.

#### T1.2.5 — Documentación de despliegue (0.5 día)
**Archivos:** `docs/DEPLOY.md`

Contenido:
- Requisitos VPS (specs mínimos: 2GB RAM, 20GB SSD)
- Paso 1: clonar repo, copiar `.env.prod.example`, llenar secrets
- Paso 2: `bash scripts/init-ssl.sh ...`
- Paso 3: `docker compose -f ... up -d`
- Paso 4: `docker compose exec app npm run migrate`
- Paso 5: crear primer tenant con `scripts/create-tenant.js`
- Paso 6: registrar webhook URL en Meta Business
- Troubleshooting (logs, healthcheck, common errors)

### Definition of Done — Sprint 1.2
- [ ] Levantar todo en una VPS limpia toma < 30 min siguiendo `DEPLOY.md`
- [ ] `curl https://bots.jesttech.com/health` → 200
- [ ] Cert SSL válido (verificable con SSL Labs grade A+)
- [ ] Backup diario corre y crea archivo en `/var/backups/...`
- [ ] Restore probado al menos una vez en staging

---

## 1.3 Sprint de Hardening Operacional (4 días)

### Objetivo
Cerrar los 3 problemas críticos que detecté en la auditoría: idempotencia volátil, cache bust no atómico, notificaciones fire-and-forget.

### Tareas

#### T1.3.1 — Idempotencia persistente en Redis (1 día)
**Archivos:** `src/webhooks/dispatcher.js`

Cambio:
```javascript
// Antes: const processedIds = new Set();
// Después:
async function isProcessed(redis, msgId) {
  const key = `webhook:processed:${msgId}`;
  const result = await redis.set(key, '1', 'EX', 86400, 'NX'); // NX = solo si no existe
  return result === null; // null si ya existía
}
```

Si Redis está caído: degradar a un `Map` en memoria con LRU de 10000 IDs (no dejar pasar duplicados, pero aceptar el riesgo de que un reinicio los olvide).

**Criterio:** test que demuestre que 2 mensajes con mismo ID en flight concurrente solo se procesan una vez.

#### T1.3.2 — Invalidación de cache antes de write en DB (0.5 día)
**Archivos:** `src/tenants/configRepository.js`

Patrón actual: write DB → bust Redis (si Redis falla, cache stale).
Patrón nuevo: bust Redis → write DB → bust Redis otra vez.

```javascript
async function saveConfig(tenantId, config) {
  const cacheKey = `tenant:config:${tenantId}`;
  await redis.del(cacheKey).catch(() => {}); // best-effort pre-bust
  await db.query('UPDATE tenant_whatsapp_config SET ...');
  await redis.del(cacheKey).catch(() => {}); // post-bust definitivo
}
```

Si entre los dos `del` un cliente lee, repuebla cache con valor viejo → el segundo `del` lo limpia.

**Criterio:** test que simule esa race condition con timing controlado.

#### T1.3.3 — Cola de reintentos para notificaciones al dueño (1.5 días)
**Archivos:**
- `src/notifications/queue.js` (nuevo)
- `src/notifications/notifier.js` (refactor)
- `migrations/003_notification_queue.sql` (nuevo)

Schema nuevo:
```sql
CREATE TABLE notification_queue (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,           -- 'sale', 'lead', 'advisor_request'
  payload     JSONB NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX idx_notif_pending ON notification_queue (next_run_at) WHERE status = 'pending';
```

Worker en `server.js`:
- Cada 30 segundos: `SELECT ... WHERE status='pending' AND next_run_at <= NOW() LIMIT 10 FOR UPDATE SKIP LOCKED`
- Procesar, en error: `attempts += 1`, `next_run_at = NOW() + interval` con backoff exponencial (30s, 2m, 10m, 1h, 6h)
- Después de 5 intentos: `status='failed'` y log a Sentry

**API que reemplaza fire-and-forget:**
```javascript
// Antes: setImmediate(() => notifier.notifySale(...))
// Después: await notificationQueue.enqueue(tenantId, 'sale', { order, customer })
```

**Criterio:** kill el proceso a media notificación y verificar que se reintenta al levantar.

#### T1.3.4 — Logging y métricas mínimas (1 día)
**Archivos:**
- `src/utils/metrics.js` (nuevo)
- `src/app.js` (endpoint `/metrics`)

Métricas (formato Prometheus):
- `whatsapp_messages_total{tenant, type, step}` — counter
- `whatsapp_response_duration_seconds{tenant, step}` — histogram
- `whatsapp_errors_total{tenant, error_type}` — counter
- `notification_queue_size{status}` — gauge

Logger:
- Asegurar que cada log tenga `tenantSlug`, `waFrom`, `messageId`
- Eliminar cualquier `console.log`/`console.error` directo (solo `logger.*`)
- En producción, log level `info` por defecto, `warn` si está saturado

**Criterio:** `curl https://bots.jesttech.com/metrics` devuelve formato Prometheus. Grafana opcional pero compatible.

### Definition of Done — Sprint 1.3
- [ ] Reinicio del servidor no causa procesamiento duplicado de mensajes recientes
- [ ] Notificaciones reintentadas hasta 5 veces con backoff
- [ ] Endpoint `/metrics` activo
- [ ] Logs estructurados con contexto en cada línea

---

## 1.4 Go-Live (2 días)

### Tareas

#### T1.4.1 — Deploy en staging (0.5 día)
- Levantar VPS de staging idéntica a producción
- Crear tenant `test-store` con productos de prueba
- Probar flujo completo con WhatsApp Business Test Number

#### T1.4.2 — Migrar cliente1 a la nueva BD (1 día)
- Exportar `conversations.json` del proyecto viejo (cliente1-tienda-ropa)
- Script `scripts/migrate-cliente1.js` que:
  1. Crea tenant en la nueva BD
  2. Importa productos desde `products.json`
  3. (Opcional) Importa sesiones activas con `created_at` correcto
- Cambiar webhook en Meta Business al nuevo dominio
- Monitorear primeras 24h con alertas activas

#### T1.4.3 — Runbook operacional (0.5 día)
**Archivos:** `docs/RUNBOOK.md`

Procedimientos:
- Cómo agregar un nuevo tenant
- Cómo rotar `wa_token`
- Cómo investigar "el bot no responde"
- Cómo restaurar de backup
- Cómo escalar (vertical, horizontal cuando llegue el momento)

### Checklist de Go-Live (no avanzar si falta uno)

#### Seguridad
- [ ] `.env.prod` con todas las claves rotadas (no las de dev)
- [ ] `META_APP_SECRET` configurado y verificado contra webhook real
- [ ] `ENCRYPTION_KEY`, `APP_SECRET`, `JWT_SECRET`, `ADMIN_API_KEY` generados con `openssl rand`
- [ ] HTTPS funcionando con cert válido > 30 días
- [ ] Headers de seguridad configurados en nginx
- [ ] No hay secrets en el repo (verificar con `git secrets` o similar)

#### Operación
- [ ] `npm test` verde
- [ ] Cobertura ≥ 75%
- [ ] Backup diario corriendo y verificado
- [ ] Procedimiento de restore probado
- [ ] Logs estructurados y rotando
- [ ] `/health` y `/metrics` accesibles

#### Negocio
- [ ] cliente1 migrado y funcional
- [ ] Owner phone verificado recibe notificaciones
- [ ] Webhook registrado en Meta Business
- [ ] Mínimo 10 mensajes de prueba enviados sin errores

---

# FASE 2 — Flow Engine Custom

## 2.1 Análisis del problema

### El estado actual no escala

Hoy `engine.js` es un `switch (session.step)` hardcodeado. Si el cliente2 quiere:
- Saltarse el paso de presupuesto
- Pedir email después del nombre y antes de la dirección
- Tener un flujo de soporte técnico en vez de ventas
- Agregar un paso de captación de lead antes del menú

…hay que **modificar `engine.js`** y agregar nuevos `STEP` al enum. Eso significa:
- Cada cliente nuevo es un branch del código.
- Imposible de mantener cuando haya 10 clientes.
- Cualquier cambio rompe a todos los demás.

### Lo que necesitamos

Que la **secuencia de pasos viva en datos**, no en código. El cliente (o un admin) debe poder:
1. Definir su flujo en un JSON/YAML.
2. Agregar/quitar/reordenar pasos sin tocar código.
3. Reutilizar componentes (step types) que ya tenemos: pedir texto, mostrar menú, mostrar catálogo, confirmar, escalar a humano.

Esto es un **state machine declarativo** con un **interpreter** genérico.

---

## 2.2 Arquitectura propuesta

### Concepto: Flow as Data

```
┌────────────────────────────────────────────────────┐
│ tenant.bot_config.flow_definition (JSONB en DB)    │
│ ┌────────────────────────────────────────────────┐ │
│ │ {                                              │ │
│ │   "id": "ventas-ropa-v1",                      │ │
│ │   "initial": "menu",                           │ │
│ │   "states": {                                  │ │
│ │     "menu": { type: "menu", ... },             │ │
│ │     "ask_size": { type: "input", ... },        │ │
│ │     "show_products": { type: "catalog", ... }  │ │
│ │   }                                            │ │
│ │ }                                              │ │
│ └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│ Flow Interpreter (engine.js v2)                    │
│ - Carga flow_definition del tenant                 │
│ - Lee session.step                                 │
│ - Encuentra el state actual                        │
│ - Ejecuta el handler correspondiente al `type`     │
│ - Calcula próximo state según transitions          │
└────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│ Step Type Registry (componentes reutilizables)     │
│ - menu       → muestra opciones, espera selección  │
│ - input      → pide texto, valida, guarda          │
│ - catalog    → filtra productos, muestra hasta 3   │
│ - confirm    → yes/no                              │
│ - notify     → notifica al dueño                   │
│ - escalate   → escala a humano                     │
│ - api_call   → llama a un endpoint externo (futuro)│
└────────────────────────────────────────────────────┘
```

### Por qué este diseño

1. **Composición sobre herencia.** Cada step es una pieza Lego. El cliente arma su flujo combinándolas.
2. **Templates reutilizables.** Definimos 3-4 plantillas (`sales`, `support`, `lead-capture`, `appointments`) y cada cliente parte de una.
3. **Sin deploy para cambios.** Cambiar el flujo es un `UPDATE` en la BD. El loader bustea cache y todos los mensajes nuevos usan la nueva versión.
4. **Versionado nativo.** Cada flow tiene `id` (ej: `ventas-ropa-v1`, `v2`). Si v2 falla, rollback = volver a v1 con un UPDATE.
5. **Validación previa.** Schema Zod del `flow_definition` se valida al guardar — si está malformado no se persiste.

---

## 2.3 Diseño técnico detallado

### 2.3.1 Schema del Flow Definition

```typescript
type FlowDefinition = {
  id: string;                    // ej: "ventas-ropa-v1"
  version: number;               // ej: 1
  initial: string;               // nombre del state inicial
  globals: {
    reset_keywords: string[];    // ["menu", "0", "inicio"]
    fallback_message?: string;
    escalation?: {
      keywords: string[];
      message: string;
    };
  };
  states: Record<string, State>;
};

type State =
  | MenuState
  | InputState
  | CatalogState
  | ConfirmState
  | NotifyState
  | EscalateState
  | EndState;

type MenuState = {
  type: "menu";
  message: string;               // soporta {{variables}} de session.data
  options: Array<{
    id: string;                  // "1", "2", o keyword
    label: string;
    next: string;                // nombre del próximo state
  }>;
  on_invalid?: { message: string }; // qué decir si input no matchea
};

type InputState = {
  type: "input";
  prompt: string;
  save_as: string;               // session.data[save_as] = input
  validate?: {
    type: "text" | "phone" | "email" | "number" | "regex";
    pattern?: string;            // para "regex"
    min_length?: number;
    max_length?: number;
    error_message?: string;
  };
  next: string | { conditions: Transition[] };
};

type CatalogState = {
  type: "catalog";
  filter_by: string[];           // ["talla", "budget"] — keys de session.data
  message_before?: string;
  message_no_results?: string;
  next: string;                  // a dónde ir cuando elijan producto
};

type ConfirmState = {
  type: "confirm";
  message: string;
  on_yes: string;                // próximo state
  on_no: string;
};

type NotifyState = {
  type: "notify";
  channel: "owner_whatsapp" | "owner_email" | "webhook";
  template: string;              // soporta {{variables}}
  next: string;                  // sigue procesando
};

type EscalateState = {
  type: "escalate";
  message: string;
  notify_owner: boolean;
  next?: string;                 // opcional: continuar después de escalar
};

type EndState = {
  type: "end";
  message: string;
  reset: boolean;                // si true, limpia session.data
};

// Transiciones condicionales
type Transition = {
  if: { field: string; op: "eq" | "neq" | "in" | "exists"; value?: any };
  goto: string;
};
```

### 2.3.2 Ejemplo concreto: el flujo actual `ventas-ropa-v1` portado

```json
{
  "id": "ventas-ropa-v1",
  "version": 1,
  "initial": "menu",
  "globals": {
    "reset_keywords": ["menu", "menú", "inicio", "hola", "0"],
    "escalation": {
      "keywords": ["asesor", "humano", "ayuda"],
      "message": "Te conecto con un asesor. En breve te contactarán."
    }
  },
  "states": {
    "menu": {
      "type": "menu",
      "message": "{{greeting}}\n\n1. Ver catálogo\n2. Consultar pedido\n3. Hablar con asesor",
      "options": [
        { "id": "1", "label": "Catálogo", "next": "ask_size" },
        { "id": "2", "label": "Mi pedido", "next": "check_order" },
        { "id": "3", "label": "Asesor", "next": "escalate_advisor" }
      ],
      "on_invalid": { "message": "Por favor responde con 1, 2 o 3." }
    },
    "ask_size": {
      "type": "input",
      "prompt": "¿Qué talla buscas? (S, M, L, XL)",
      "save_as": "talla",
      "validate": {
        "type": "regex",
        "pattern": "^(S|M|L|XL|XS)$",
        "error_message": "Talla inválida. Usa S, M, L, XL o XS."
      },
      "next": "ask_budget"
    },
    "ask_budget": {
      "type": "input",
      "prompt": "¿Cuál es tu presupuesto?",
      "save_as": "budget",
      "validate": { "type": "number", "min_length": 1 },
      "next": "show_catalog"
    },
    "show_catalog": {
      "type": "catalog",
      "filter_by": ["talla", "budget"],
      "message_before": "Estas son nuestras opciones para ti:",
      "message_no_results": "No tenemos productos en ese rango. ¿Quieres ver alternativas?",
      "next": "ask_name"
    },
    "ask_name": {
      "type": "input",
      "prompt": "¡Excelente elección! ¿Cuál es tu nombre completo?",
      "save_as": "customer_name",
      "validate": { "type": "text", "min_length": 3 },
      "next": "ask_address"
    },
    "ask_address": {
      "type": "input",
      "prompt": "¿Dirección de envío?",
      "save_as": "address",
      "validate": { "type": "text", "min_length": 10 },
      "next": "ask_payment"
    },
    "ask_payment": {
      "type": "input",
      "prompt": "Método de pago: 1) Nequi  2) Contraentrega",
      "save_as": "payment",
      "next": "notify_sale"
    },
    "notify_sale": {
      "type": "notify",
      "channel": "owner_whatsapp",
      "template": "🛍️ Nueva venta\nCliente: {{customer_name}}\nProducto: {{selected_product}}\nDirección: {{address}}\nPago: {{payment}}",
      "next": "order_done"
    },
    "order_done": {
      "type": "end",
      "message": "¡Pedido confirmado! Te contactaremos en breve. Escribe *menu* para volver al inicio.",
      "reset": true
    },
    "check_order": {
      "type": "input",
      "prompt": "¿Cuál es tu número de pedido?",
      "save_as": "order_number",
      "next": "menu"
    },
    "escalate_advisor": {
      "type": "escalate",
      "message": "Un asesor te contactará en breve.",
      "notify_owner": true
    }
  }
}
```

**Cliente2 con flujo distinto** (ej: solo captación de leads, sin venta directa):

```json
{
  "id": "lead-capture-v1",
  "initial": "welcome",
  "states": {
    "welcome": {
      "type": "input",
      "prompt": "¡Hola! ¿Cómo te llamas?",
      "save_as": "customer_name",
      "next": "ask_interest"
    },
    "ask_interest": {
      "type": "menu",
      "message": "{{customer_name}}, ¿qué te interesa?",
      "options": [
        { "id": "1", "label": "Cotización", "next": "ask_phone" },
        { "id": "2", "label": "Información", "next": "send_info" }
      ]
    },
    "ask_phone": {
      "type": "input",
      "prompt": "Déjame tu teléfono y un asesor te llama:",
      "save_as": "phone",
      "validate": { "type": "phone" },
      "next": "notify_lead"
    },
    "notify_lead": {
      "type": "notify",
      "channel": "owner_whatsapp",
      "template": "📋 Nuevo lead: {{customer_name}} - {{phone}}",
      "next": "thanks"
    },
    "thanks": {
      "type": "end",
      "message": "¡Gracias! Te contactaremos pronto.",
      "reset": true
    }
  }
}
```

**Cero líneas de código nuevas** para soportar este segundo cliente.

### 2.3.3 Componentes a construir

#### A) Step Type Registry (`src/core/flow-engine/step-types/`)
Cada step type es un módulo con la firma:

```javascript
// src/core/flow-engine/step-types/menu.js
module.exports = {
  type: 'menu',
  schema: zodSchema,                                    // valida la config del state
  async handle(ctx) {
    // ctx = { phone, session, tenant, input, state, services }
    // services = { sender, notifier, queue, catalog }
    // return: { next: 'state_name' } | { stay: true }
  },
  async render(ctx) {
    // se llama al ENTRAR a este state (mostrar prompt/menu/catálogo)
  }
};
```

Ventajas:
- Cada type es testeable de forma aislada (test unitario por type)
- Agregar un nuevo type es una sola PR (`api_call`, `delay`, `random_pick`...)
- El registry los carga automáticamente con un `require.context` o glob

#### B) Interpreter (`src/core/flow-engine/interpreter.js`)
Reemplaza el actual `engine.js`:

```javascript
async function processMessage(phone, rawMsg, session, tenant, services) {
  const flow = tenant.flow_definition;
  const input = extractInput(rawMsg);

  // Globals: reset y escalation
  if (flow.globals.reset_keywords.includes(input.text.toLowerCase())) {
    session.step = flow.initial;
    session.data = {};
    return await renderState(phone, session, tenant, services);
  }

  const state = flow.states[session.step] || flow.states[flow.initial];
  const stepType = registry.get(state.type);

  const result = await stepType.handle({
    phone, session, tenant, input, state, services
  });

  if (result.next) {
    session.step = result.next;
    await renderState(phone, session, tenant, services);
  }
}
```

#### C) Schema Validator (`src/utils/flowSchema.js`)
Zod schema para validar `flow_definition` antes de persistir.

Reglas:
- Cada `next` debe apuntar a un state existente.
- `initial` debe existir en `states`.
- Al menos un state tipo `end` (no son obligatorios pero recomendado).
- No ciclos infinitos sin escapatoria (warning, no error).

#### D) Migración de DB

```sql
-- migrations/004_flow_definitions.sql
ALTER TABLE tenant_whatsapp_config
  ADD COLUMN flow_definition JSONB,
  ADD COLUMN flow_template TEXT;        -- ej: 'ventas-ropa-v1', referencia a un template

CREATE INDEX idx_flow_template ON tenant_whatsapp_config (flow_template);
```

Templates predefinidos viven en `src/flows/templates/*.json` (en código, versionados con git).
Tenant puede:
- Apuntar a un template (`flow_template = 'ventas-ropa-v1'`) → usa el JSON del repo
- Definir su propio override en `flow_definition` (gana sobre el template)

---

## 2.4 Plan de implementación FASE 2

### Sprint 2.1 — Core del Flow Engine (5 días)

#### T2.1.1 — Schema y validación (1 día)
- Crear `src/utils/flowSchema.js` con Zod
- Tests unitarios del schema (válido, inválido, edge cases)
- Validador de integridad referencial (todos los `next` resuelven)

#### T2.1.2 — Step Type Registry (1 día)
- `src/core/flow-engine/step-types/index.js` — autoloader
- Interface base que cada type debe cumplir
- Mock type para testing

#### T2.1.3 — Implementar 6 step types base (2 días)
Por orden de prioridad:
1. `menu` — opciones numeradas
2. `input` — texto con validación
3. `end` — mensaje final + reset
4. `notify` — encolar notificación
5. `escalate` — escalar a humano
6. `confirm` — yes/no

Cada uno con su test unitario.

#### T2.1.4 — Interpreter (1 día)
- `src/core/flow-engine/interpreter.js`
- Reemplazar `engine.js` (mantener export `processMessage` con misma firma)
- Soporte para variables `{{xxx}}` en mensajes (templating mínimo)
- Tests del interpreter con flow de prueba

### Sprint 2.2 — Migración del flujo actual (4 días)

#### T2.2.1 — Catalog step type (1 día)
Este es el más complejo porque tiene sub-flujo (showing → selecting → objection → alternatives). Hay dos opciones:
- **A) Step type complejo:** un solo step type `catalog` que internamente maneja sub-states
- **B) Múltiples states:** `show_catalog`, `handle_decision`, `handle_objection` como states separados en el flow

Recomiendo **B** por consistencia. Pero requiere más states en el JSON.

#### T2.2.2 — Portar `sales_v1` a JSON (1 día)
- Escribir `src/flows/templates/ventas-ropa-v1.json`
- Verificar que todos los pasos del switch original tienen su equivalente

#### T2.2.3 — Tests de paridad (1.5 días)
- Tomar los tests del Sprint 1.1 (T1.1.3)
- Reescribir usando el interpreter v2 con `ventas-ropa-v1.json`
- Asegurar mismo comportamiento exacto (mismos mensajes, mismas transiciones)

#### T2.2.4 — Feature flag y rollout gradual (0.5 día)
- Variable `FLOW_ENGINE_VERSION=v1|v2` en config del tenant
- Tenants con `v1` siguen usando `engine.js` viejo
- cliente1 se migra a v2 después de validar en staging

### Sprint 2.3 — Templates y API admin (4 días)

#### T2.3.1 — 3 templates base (1.5 días)
- `ventas-ropa-v1.json` (ya existe del sprint anterior)
- `lead-capture-v1.json` (captación simple)
- `appointments-v1.json` (agendar cita: nombre → servicio → fecha → confirmar)

Cada template documentado en `docs/flows/<id>.md`.

#### T2.3.2 — API REST de gestión de flows (1.5 días)
**Archivos:** `src/admin/flowsRouter.js`

Endpoints (auth con `ADMIN_API_KEY`):
- `GET /admin/flows/templates` — lista templates disponibles
- `GET /admin/tenants/:slug/flow` — flow actual del tenant
- `PUT /admin/tenants/:slug/flow` — actualizar flow (valida con Zod)
- `POST /admin/tenants/:slug/flow/from-template` — clonar un template y asignarlo

Todos con validación previa antes de persistir.

#### T2.3.3 — UI mínima de edición (1 día) — opcional
**Archivos:** `demo/flow-editor.html`

Editor JSON con:
- Syntax highlighting (Monaco editor o CodeMirror)
- Botón "Validate" que llama al endpoint
- Botón "Save" que pushea a `PUT /admin/tenants/:slug/flow`
- Lista de templates a la izquierda

No es prioridad — un admin técnico puede usar Postman/curl.

### Sprint 2.4 — Validación con cliente real (3 días)

#### T2.4.1 — Cliente2 con `lead-capture-v1` (1 día)
- Crear tenant `cliente2-leads` con el template
- Customizar mensajes con su negocio
- Probar end-to-end en staging

#### T2.4.2 — Migrar cliente1 a v2 (1 día)
- Cambiar `flow_engine_version` a `v2`
- Monitorear 24h
- Si todo OK, deprecar el `engine.js` viejo

#### T2.4.3 — Documentación final (1 día)
**Archivos:** `docs/FLOWS.md`

Contenido:
- Cómo crear un flow desde cero
- Referencia de cada step type con ejemplos
- Templates disponibles y cuándo usar cada uno
- Best practices (ej: siempre tener un state `end`, siempre permitir reset)
- Troubleshooting

### Definition of Done — FASE 2
- [ ] cliente1 funcionando con flow declarativo (sin regresiones)
- [ ] cliente2 con flujo distinto funcionando en producción
- [ ] 3 templates documentados y testeados
- [ ] API admin para gestionar flows (con autenticación)
- [ ] Schema Zod valida flow definitions
- [ ] Cobertura del flow-engine ≥ 85%
- [ ] Documentación `docs/FLOWS.md` completa

---

## 3. Tabla de dependencias

```
T1.1.x (tests)  ────┐
                    ├──► T1.4 (Go-Live)
T1.2.x (infra)  ────┤
                    │
T1.3.x (hardening) ─┘

T1.4 (Go-Live) ────► T2.1 (Flow Engine core)
                       │
                       ▼
                     T2.2 (migración)
                       │
                       ▼
                     T2.3 (templates + API)
                       │
                       ▼
                     T2.4 (cliente2 real)
```

**No empezar T2.x hasta que T1.4 esté completo.**

---

## 4. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Tests del flow-engine descubren bugs profundos | Media | Alto | Time-box: si toma > 3 días, refactor primero |
| Migración de cliente1 rompe conversaciones activas | Baja | Alto | Hacer en horario de bajo tráfico + feature flag para rollback |
| Schema del flow_definition queda corto | Media | Medio | Versionar el schema desde día 1 (`schema_version: 1`) |
| Step type `catalog` es muy complejo de portar | Alta | Medio | Empezar con cliente2 (lead-capture, sin catálogo) y portar cliente1 al final |
| SSL/certbot falla en VPS | Media | Alto | Testear el script en una VPS limpia antes del go-live |
| pgcrypto causa lentitud en queries grandes | Baja | Medio | Indexar por `tenant_id`, no encriptar campos consultables |

---

## 5. Métricas de éxito

### Fase 1
- 0 incidentes de seguridad en webhook (HMAC bypass)
- 0 mensajes duplicados procesados
- < 1% de notificaciones perdidas
- Backup diario corre 7/7 días la primera semana
- < 500ms p95 de latencia de respuesta del bot

### Fase 2
- Onboarding de un nuevo cliente con flow distinto: < 1 hora (vs ~1 semana de código actual)
- Cobertura de tests del flow-engine ≥ 85%
- 0 regresiones en cliente1 después de migrar a v2
- Al menos 2 clientes con flujos diferentes en producción

---

## 6. Próximos pasos inmediatos

Cuando aprueben este plan:

1. **Crear branch `phase-1-prod-readiness`** desde main.
2. **Empezar con T1.1.1** (tests del verifier) — es el más aislado y rinde rápido.
3. Después de cada sprint, mergear a main y desplegar a staging.
4. **No tocar Fase 2** hasta que el checklist de Go-Live esté 100%.

Cualquier desviación de este plan se documenta en un ADR (`docs/adr/NNN-titulo.md`) explicando el porqué.
