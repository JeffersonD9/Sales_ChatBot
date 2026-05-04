# Auditoría Completa: whatsapp-saas
**Fecha:** 2026-05-04  
**Auditor:** Claude Sonnet 4.6  
**Commit auditado:** b238a46 (Integración IA - Haiku)

---

## VEREDICTO DE PRODUCCIÓN

### ⚠️ LISTO CON CONDICIONES

El código base es sólido y la arquitectura es correcta. Hay **3 issues que deben resolverse antes del primer deploy real** y 2 que deben resolverse antes de cargar tráfico real. Nada está roto estructuralmente, pero hay una vulnerabilidad de seguridad en la API de administración, un memory leak en producción bajo carga, y race conditions en el state manager que pueden producir pedidos duplicados.

**Lo que puede ir a producción YA:**
- Todo el flujo de conversación (flow engine + steps + state machine)
- Integración IA con Claude Haiku (`src/core/ai/aiHandler.js`)
- Autenticación JWT de tenants (`src/tenants/authMiddleware.js`)
- Verificación HMAC del webhook (`src/webhooks/verifier.js`) — ejemplar
- Schema de BD completo (4 migrations limpias)
- Docker multi-stage + docker-compose.prod.yml
- Nginx con headers OWASP + rate limiting + SSL
- Billing/suspensión automática (`src/billing/billingService.js`)
- Logging estructurado con Pino

**Lo que BLOQUEA el deploy (Fase 0 obligatoria):**
1. Timing attack en admin API key comparison (`src/admin/middleware.js:13`)
2. Memory leak en `dispatcher.js` — Set sin eviction crece indefinidamente bajo carga
3. Race condition en `state/manager.js` — mensajes simultáneos pueden corromper sesiones y duplicar pedidos

**Lo que es frágil y se romperá bajo carga:**
- `saveState` usa `setImmediate` async sin esperar — crash del proceso pierde el último estado
- `sessions` Map sin eviction — 10k usuarios activos × 1KB = 10MB (aceptable), pero con spam bots se dispara
- Redis down → rate limiting desactivado silenciosamente (tenant puede enviar spam ilimitado)
- Schema de productos (`products.sizes TEXT[]`) no es genérico — bloquea tiendas de zapatos, joyas, etc.

---

## PARTE 2 — AUDITORÍA TÉCNICA

### 2.1 Seguridad

| Severidad | Archivo:línea | Descripción | Fix recomendado |
|-----------|--------------|-------------|-----------------|
| **CRÍTICO** | `src/admin/middleware.js:13` | Comparación `key !== process.env.ADMIN_API_KEY` no es timing-safe. Permite ataques de timing para adivinar la key. | Reemplazar con `crypto.timingSafeEqual(Buffer.from(key\|\|''), Buffer.from(process.env.ADMIN_API_KEY\|\|''))` — mismo patrón que `verifier.js` |
| **ALTO** | `src/admin/router.js` (todo el router) | No hay rate limiting en `/admin/*`. Brute force de ADMIN_API_KEY sin fricción. | Agregar `express-rate-limit` o middleware Redis con ventana de 60s, máx 10 intentos |
| **ALTO** | `src/utils/crypto.js:30-45` | AES-256-CBC sin autenticación (no es AEAD). Vulnerable a bit-flipping y padding oracle attacks. | Migrar a AES-256-GCM (`createCipheriv` con `aes-256-gcm`) que incluye auth tag nativo |
| **ALTO** | `src/utils/crypto.js:43` | `encryptedText.split(':')` es frágil — si el ciphertext en hex incluye `:` se rompe el parse. | Usar Buffer.concat y longitud fija, o base64 sin delimitador |
| **MEDIO** | `src/tenants/authMiddleware.js:31-33` | Si Redis está down, rate limiting se desactiva silenciosamente. Un tenant puede enviar mensajes ilimitados. | Implementar fallback LRU en memoria (100 entradas, 60s TTL) |
| **MEDIO** | `migrations/002_tenant_whatsapp_config.sql:27,35` | `pgp_sym_encrypt()` sin especificar `cipher-algo=aes256` usa CAST5 por defecto (56-bit, débil). | Cambiar a `pgp_sym_encrypt(data, secret, 'cipher-algo=aes256')` |
| **BAJO** | `.env.prod` (archivo existe en disco) | Puede contener secrets reales. Verificar que esté en `.gitignore`. | `git check-ignore .env.prod`. Si no está ignorado, agregar y rotar secrets. |
| **BAJO** | `src/core/ai/aiHandler.js` | `logger.debug` puede loguear el system prompt (con catálogo del tenant) si `LOG_LEVEL=debug` en prod. | Asegurar `LOG_LEVEL=info` en producción |

**Lo que está bien implementado (seguridad):**
- HMAC-SHA256 con `timingSafeEqual` en `verifier.js:55-57` — correcto y ejemplar
- rawBody capturado antes del JSON parser (`app.js:29`) — correcto
- SQL parameterizado en todos los repositorios — sin inyección SQL
- RLS en `tenant_whatsapp_config` con `SET LOCAL app.current_tenant_id` — correcto
- UUID primary keys — sin enumeración de IDs
- Regex validation en slugs: `^[a-z0-9-]+$`
- Zod schema en `botConfigSchema.js` con límites de longitud

---

### 2.2 Integración de IA

**Existe código de IA: SÍ — `src/core/ai/aiHandler.js` (102 líneas)**

#### Estado actual de aiHandler.js

```
Modelo:       claude-haiku-4-5-20251001
Historial:    MAX_HISTORY = 6 (3 turnos completos user+assistant)
Almacenado:   session.data.aiHistory (JSONB en PostgreSQL)
Prompt cache: cache_control: { type: 'ephemeral' } en system content
Fallback:     retorna null si API cae, AI_ENABLED=false, o sin key
Toggle:       process.env.AI_ENABLED=true/false
```

#### Cómo se activa en el flujo

En `engine.js` la IA actúa como **fallback de último recurso** — no como handler primario:
- Línea ~65: cuando `handleMenu` retorna `false` (input no reconocido en menú)
- Línea ~89: cuando `handleDecisionProducto` retorna `false` (respuesta inesperada)

El bot usa el flujo rígido de steps cuando puede, y solo pide ayuda a la IA cuando no sabe qué hacer. Diseño conservador pero funcional.

#### Lo que falta para que sea vendible como "Plan IA"

| Qué falta | Archivo a crear/modificar | Propósito |
|-----------|--------------------------|-----------|
| System prompt personalizable por tenant | `src/utils/botConfigSchema.js` + `src/core/ai/aiHandler.js` | Cada tienda define su personalidad, restricciones, idioma |
| Cache bust cuando cambia el catálogo | `src/admin/router.js` + `src/tenants/loader.js` | Hoy la IA usa el catálogo viejo hasta 5min después de actualizar |
| Límite de caracteres en historial | `src/core/ai/aiHandler.js` | Sin límite — usuario malicioso puede llenar el historial |
| Limpieza de historial post-pedido | `src/core/flow-engine/steps/order.js` | El historial se acumula entre transacciones distintas |
| Métricas de uso IA | nuevo `src/core/ai/aiMetrics.js` | Para cobrar el plan IA: contar llamadas por tenant por mes |
| Tool use / function calling | `src/core/ai/aiHandler.js` | IA llama a `filterProducts()` directamente — más preciso, menos tokens |

#### Recomendación de modelo

**Claude Haiku (actual) es la elección correcta:**
- Latencia: ~500ms vs ~2s de Sonnet — crítico en conversación WhatsApp
- Costo: ~25x más barato que Sonnet — márgenes rentables
- Prompt caching ya implementado — el system prompt se cachea, solo mensajes nuevos cuestan tokens completos

---

### 2.3 Calidad del código y arquitectura

**Código duplicado:** Ninguno significativo. La separación en capas está bien respetada.

**No hay archivos basura:** Sin huérfanos, sin legacy, sin directorios vacíos.

#### Race conditions en state/manager.js

**RC1 — saveState async** (`src/core/state/manager.js:103-141`):
```javascript
sessions.set(key, session);        // L1 actualizado síncronamente
setImmediate(async () => {
  await query('INSERT ... ON CONFLICT DO UPDATE ...');  // L2 en background
});
```
Escenario de fallo: crash del proceso entre el `set` de L1 y el `query` de L2 → el siguiente mensaje rehidrata estado desactualizado de DB → usuario repite steps ya completados.

**RC2 — getState concurrent** (`src/core/state/manager.js:50-91`):
Dos mensajes del mismo usuario en ~1ms pasan el cache miss simultáneamente → dos queries a DB → el segundo sobrescribe al primero en L1.

**Fix:** Cambiar `saveState` a `await query(...)` (sin setImmediate). Performance hit: ~2ms adicionales por mensaje — aceptable.

#### Memory leak en dispatcher.js

```javascript
const processedIds = new Set();
setTimeout(() => processedIds.delete(msgId), PROCESSED_TTL); // TTL = 24h
```
Con 10 msg/segundo → 864,000 IDs/día → ~86MB de RAM solo para deduplicación en un VPS de 2GB.

**Fix:** Reemplazar `Set` + `setTimeout` con `lru-cache` (max 10,000 elementos).

#### Tenant loader cache stale

`src/tenants/loader.js` cachea productos en RAM por 5min. Si admin actualiza productos, la IA muestra el catálogo viejo durante 5 minutos. Redis cache se invalida pero L1 RAM no.

#### Error handling silencioso

- `src/utils/crypto.js:44-47`: `decrypt()` retorna `''` sin loguear — wa_tokens mal desencriptados causan 401 en Meta API que parecen bugs de red.
- `src/core/ai/aiHandler.js`: retorna `null` silenciosamente — correcto para degradación, pero el `logger.warn` debería incluir el error específico.

---

### 2.4 Tests

**Coverage actual: 46 tests en 4 suites**

| Suite | Tests | Qué cubre | Calidad |
|-------|-------|-----------|---------|
| `verifier.test.js` | 7 | HMAC válido/inválido, timing-safe, casos edge | Excelente |
| `catalog.test.js` | 25 | filterProducts por talla/presupuesto | Bueno |
| `formatters.test.js` | 14 | formatPrice, formatPhone, capitalizeName | Básico |
| `configRepository.test.js` | 11 | Cache Redis hit/miss, Zod validation, degradación | Bueno |

**Paths críticos SIN test (riesgo en producción):**

| Path crítico | Riesgo |
|-------------|--------|
| `src/admin/middleware.js` | Admin endpoint sin cobertura |
| `src/core/state/manager.js` | Cross-tenant data leak sin detectar |
| `src/core/flow-engine/engine.js` | Regresiones en flujo de ventas sin detectar |
| `src/webhooks/dispatcher.js` | Pedidos duplicados sin detectar |
| `src/core/ai/aiHandler.js` | Fallos silenciosos de IA |
| `src/utils/crypto.js` | Tokens encriptados incorrectamente |

**Los mocks son fieles:** `jest.mock('../../db')` y `jest.mock('../../redis')` replican el contrato real.

---

### 2.5 Infraestructura Docker

**Dockerfile (multi-stage):** Correcto y bien optimizado.
- `base` → `dev` (nodemon) → `deps` (prod deps only) → `runner` (non-root botuser)
- Node 20-alpine, HEALTHCHECK cada 30s

**docker-compose.prod.yml:** Existe y está casi completo — nginx + certbot, Redis persistente, puertos internos, logging rotado.

**Qué falta para ser 100% production-ready:**
1. Script `init-letsencrypt.sh` para el primer bootstrap de SSL (no existe en el repo)
2. Docker secrets o secret manager — hoy env vars se pasan directo al container
3. Script de backup automático de PostgreSQL

---

## PARTE 3 — ESTRATEGIA: DB vs GOOGLE SHEETS

### Situación actual (PostgreSQL)

El schema `products.sizes TEXT[]` **no es genérico** — sirve para ropa pero no para zapatos (número 38-45), joyería (metal, piedra, peso) o electrónica.

¿Cómo actualiza productos el dueño hoy? Solo con SSH al VPS o Postman. **No usable sin interfaz.**

**Fix de schema necesario:**
```sql
ALTER TABLE products ADD COLUMN attributes JSONB DEFAULT '{}';
-- sizes[] se mantiene por backward compat, se depreca a largo plazo
```

### Google Sheets — análisis

**Ventajas reales:** Edición desde celular, colaboración con empleados, sin conocimiento técnico.

**Mejor arquitectura de sync:** Botón "Actualizar catálogo" en dashboard → sync manual on demand (opción polling o webhook son más complejas sin ventaja real para el primer cliente).

**Riesgos:** OAuth 2.0 por tenant es 3-5 días de implementación solo de autenticación. Google API rate limits: 100 req/100s.

### Recomendación: estrategia híbrida en dos fases

**Fase inmediata:** Admin dashboard web mínimo (HTML vanilla + fetch, servido desde Express, autenticado con ADMIN_API_KEY). Resuelve el 80% del problema con 20% del esfuerzo. El dueño edita desde el browser.

**Fase posterior:** Agregar Google Sheets como canal alternativo opcional. La BD sigue siendo la fuente de verdad.

**Justificación:** Dashboard = 1-2 días. Google Sheets OAuth = 3-5 días solo de auth. La tienda de ropa necesita el plan de IA ahora, no en 2 semanas.

---

## PARTE 4 — PLAN DE ACCIÓN PRIORIZADO

### Fase 0 — Bloqueantes de producción

| # | Archivo | Cambio | Complejidad |
|---|---------|--------|-------------|
| 0.1 | `src/admin/middleware.js:13` | Reemplazar `!==` por `crypto.timingSafeEqual` | **S** |
| 0.2 | `src/webhooks/dispatcher.js` | Reemplazar `Set` + `setTimeout` por `lru-cache` (max 10k) | **S** |
| 0.3 | `src/core/state/manager.js` | `saveState` → `await query(...)` sin setImmediate + mutex en getState | **M** |
| 0.4 | `src/utils/crypto.js` | Migrar AES-256-CBC → AES-256-GCM + script one-time de re-encriptación | **M** |
| 0.5 | `src/admin/router.js` | Rate limiting en `/admin/*` | **S** |
| 0.6 | `.gitignore` | Verificar que `.env.prod` y `.env` están ignorados; rotar secrets si hay duda | **S** |

### Fase 1 — Plan de IA (para el cliente de ropa)

| # | Archivo | Cambio | Complejidad |
|---|---------|--------|-------------|
| 1.1 | `src/utils/botConfigSchema.js` | Campo `ai_system_prompt` opcional (1-2000 chars) en schema Zod | **S** |
| 1.2 | `src/core/ai/aiHandler.js` | System prompt personalizable + límite 500 chars/mensaje + limpiar historial post-pedido | **S** |
| 1.3 | `src/core/ai/aiMetrics.js` (NUEVO) | Contador de llamadas IA por tenant por mes en Redis | **S** |
| 1.4 | `src/admin/router.js` | `GET /admin/tenants/:slug/ai-usage` → `{ calls_this_month, cost_estimate }` | **S** |
| 1.5 | `src/tenants/loader.js` | Invalidar L1 RAM cache al actualizar productos desde admin | **S** |
| 1.6 | `src/core/ai/aiHandler.js` | `logger.info({ tenantSlug, tokensUsed, cacheHit }, 'ai_call')` | **S** |
| 1.7 | `tests/unit/core/aiHandler.test.js` (NUEVO) | Tests: IA disabled, API error → null, historial, respuesta exitosa | **M** |

### Fase 2 — Catálogo genérico + Admin UI

| # | Archivo | Cambio | Complejidad |
|---|---------|--------|-------------|
| 2.1 | `migrations/005_products_attributes.sql` (NUEVO) | `ALTER TABLE products ADD COLUMN attributes JSONB DEFAULT '{}'` | **S** |
| 2.2 | `src/tenants/repository.js` | Incluir `attributes` en SELECT/UPDATE de productos | **S** |
| 2.3 | `src/core/catalog.js` | Filtrar por `attributes` además de `sizes`, backward compat | **M** |
| 2.4 | `scripts/import-products.js` | Soportar columna `atributos` en CSV → JSONB | **S** |
| 2.5 | `public/admin/` (NUEVO directorio) | Admin dashboard HTML: tabla editable de productos, autenticado con ADMIN_API_KEY | **M** |
| 2.6 | `src/app.js` | Servir `public/admin/` como estáticos en `/admin-ui` | **S** |

### Fase 3 — Hardening (puede esperar, no ignorar)

| # | Archivo | Cambio | Complejidad |
|---|---------|--------|-------------|
| 3.1 | `tests/unit/core/stateManager.test.js` (NUEVO) | Aislamiento multitenant, concurrent messages | **M** |
| 3.2 | `tests/unit/admin/middleware.test.js` (NUEVO) | Timing-safe comparison, rate limiting | **S** |
| 3.3 | `tests/unit/core/flowEngine.test.js` (NUEVO) | Flujo completo: NEW → MENU → CATALOG → ORDER | **L** |
| 3.4 | `tests/integration/webhook.test.js` (NUEVO) | Integration test con supertest + HMAC válido | **L** |
| 3.5 | `src/utils/crypto.js` | Log en `decrypt()` cuando retorna `''` (hoy silencioso) | **S** |
| 3.6 | `scripts/backup-db.sh` (NUEVO) | pg_dump automático + upload a storage | **S** |
| 3.7 | `src/metrics.js` (NUEVO) | Endpoint `/metrics` Prometheus: active_sessions, ai_calls_total | **M** |
| 3.8 | `docker-compose.prod.yml` | Script `init-letsencrypt.sh` para bootstrap SSL | **S** |

---

## RESUMEN EJECUTIVO

El proyecto es un SaaS bien construido. Arquitectura multi-tenant correcta, código limpio, seguridad general buena (HMAC timing-safe, SQL parameterizado, RLS, JWT, Zod). **La IA ya está implementada** con Haiku, prompt caching y degradación graceful.

Los problemas son concretos y corregibles en 1-2 días:

| Problema | Tiempo estimado de fix |
|---------|----------------------|
| Timing attack en admin middleware | 5 minutos |
| Memory leak en dispatcher | 30 minutos |
| Race condition en state manager | 2-4 horas |
| Schema de productos no genérico | 1 migration + 2 horas |
| Sin admin UI para dueños | 1-2 días |

Para "vender el plan de IA" falta: métricas de uso por tenant, system prompt personalizable, cache bust al actualizar catálogo.

**Orden recomendado:** Fase 0 → Fase 1 → Deploy → Fase 2 → Fase 3
