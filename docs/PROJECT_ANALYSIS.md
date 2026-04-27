# Análisis del proyecto — Código muerto y limpieza

**Fecha:** 2026-04-26
**Estado:** Pendiente de ejecutar

Todo lo listado acá fue verificado manualmente. Nada en la sección "Eliminar" rompe el flujo del bot.

---

## ELIMINAR (sin riesgo, verificado)

### 1. Directorio fantasma `nginx/nginx.conf;C/`

Directorio vacío creado por un artefacto de Windows al editar el archivo.
No contiene nada.

```bash
rm -rf "nginx/nginx.conf;C"
```

---

### 2. Función muerta `initializeBotForTenant` — `src/core/botService.js:25`

Se define, se exporta en línea 76, pero **nunca se llama desde ningún otro archivo**.
La lógica que hace (validar que el bot esté activo) ya la hace `handleIncomingMessage` directamente.

```bash
# Verificar que no se usa
grep -rn "initializeBotForTenant" src/
# Solo aparece en botService.js — confirma que es código muerto
```

**Qué borrar en `src/core/botService.js`:**
- Líneas 25–31: el cuerpo de la función
- En `module.exports` (línea 76): quitar `initializeBotForTenant` del objeto exportado

---

### 3. Función muerta `truncate` — `src/utils/formatters.js:25`

Se define y se exporta, pero **nunca se importa ni llama desde ningún archivo**.

```bash
grep -rn "truncate" src/
# Solo aparece en formatters.js — confirma que es código muerto
```

**Qué borrar en `src/utils/formatters.js`:**
- Líneas 25–28: el cuerpo de la función
- En `module.exports` (línea 30): quitar `truncate` del objeto exportado

---

## BUG CORREGIDO EN ESTE SPRINT

### `src/webhooks/router.js` — HMAC verificado después de responder 200

El router respondía `200` antes de verificar la firma, lo que significa que
cualquier request falso recibía `200` y solo era ignorado silenciosamente.

**Fix aplicado (2026-04-26):** la verificación HMAC ahora ocurre antes de responder.
Requests con firma inválida reciben `401`. Confirmado por smoke test (3/3 tests pasan).

---

## MANTENER (descartados como basura)

| Archivo | Por qué se queda |
|---------|-----------------|
| `.env.example` | Template de producción para el VPS |
| `.env.dev.example` | Template de desarrollo |
| `scripts/products-template.csv` | Template para importar catálogos de clientes |
| `docker-compose.yml` + overrides | Base + dev + prod, cada uno tiene su rol |
| `nginx/nginx.conf` | Config de producción actualizada |

---

## TESTS FALTANTES (backlog, no bloquean producción)

El único test existente es `tests/unit/tenants/configRepository.test.js`.
Módulos sin cobertura que deberían tenerla:

| Módulo | Por qué importa |
|--------|----------------|
| `src/webhooks/verifier.js` | **Crítico** — si se rompe, todos los webhooks fallan o se vuelven inseguros |
| `src/core/catalog.js` | Lógica pura, fácil de testear |
| `src/utils/formatters.js` | Lógica pura, fácil de testear |
| `src/core/whatsapp/parser.js` | Parsea los mensajes entrantes de Meta |
| `src/notifications/notifier.js` | Notificaciones de ventas al dueño |

Estos van al backlog. Ver `docs/BACKLOG.md`.

---

## ARCHIVOS SIN COMMITEAR (pendiente antes del deploy)

```bash
git status
```

Archivos nuevos que deben estar en git:

| Archivo | Commitear? |
|---------|-----------|
| `docker-compose.prod.yml` | ✅ Sí |
| `nginx/nginx.conf` | ✅ Sí (actualizado) |
| `scripts/init-letsencrypt.sh` | ✅ Sí |
| `src/webhooks/router.js` | ✅ Sí (fix HMAC) |
| `docs/CREAR_TENANT.md` | ✅ Sí |
| `docs/ONBOARDING_CLIENTE.md` | ✅ Sí |
| `docs/SPRINT_PRODUCCION.md` | ✅ Sí |
| `docs/SPRINT_STATUS.md` | ✅ Sí |
| `docs/PROJECT_ANALYSIS.md` | ✅ Sí (este archivo) |
| `.gitignore` | ✅ Sí (se agregaron .env.prod y .env.dev.backup) |
| `.env.prod` | ❌ No (credenciales) |

---

## Comandos para ejecutar la limpieza

```bash
# 1. Borrar directorio basura
rm -rf "nginx/nginx.conf;C"

# 2. Abrir botService.js y borrar initializeBotForTenant (líneas 25-31 + del exports)
# 3. Abrir formatters.js y borrar truncate (líneas 25-28 + del exports)

# 4. Commitear todo lo pendiente
git add docker-compose.prod.yml nginx/nginx.conf scripts/init-letsencrypt.sh \
        src/webhooks/router.js .gitignore \
        docs/CREAR_TENANT.md docs/ONBOARDING_CLIENTE.md \
        docs/SPRINT_PRODUCCION.md docs/SPRINT_STATUS.md docs/PROJECT_ANALYSIS.md

git commit -m "feat: infra producción + fix HMAC verifier + docs operacionales"
```
