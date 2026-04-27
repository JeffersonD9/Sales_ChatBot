# Estado del Sprint de Producción

**Última actualización:** 2026-04-26
**Estado general:** En progreso — bloqueado por verificación de cuenta Meta

---

## Bloqueantes activos

| Bloqueante | Afecta | Qué hacer |
|------------|--------|-----------|
| Verificación de cuenta Meta | Tarea 1.5, todo el Día 4 | Esperar aprobación Meta (puede tardar 1-2 días hábiles) |
| VPS no provisionado | Tareas 2.4, 2.5 y Días 3-4 | Provisionar VPS en Hostinger una vez resuelta Meta |

---

## Progreso por tarea

### Día 1 — Validación local y secrets

| Tarea | Estado | Nota |
|-------|--------|------|
| 1.1 Generar secrets de producción | ✅ Hecho | Guardados en gestor de contraseñas |
| 1.2 Crear `.env.prod` local | ✅ Hecho | `META_APP_SECRET` pendiente de llenar |
| 1.3 Postgres + Redis + migrations | ✅ Hecho | 5 tablas creadas correctamente |
| 1.4 Tenant de prueba + webhook GET | ✅ Hecho | `test-local` responde challenge OK |
| 1.5 Smoke test HMAC | ⏸ Bloqueado | Necesita `META_APP_SECRET` real de Meta |
| 1.6 Cleanup local | ⏸ Pendiente | Hacer después de 1.5 |

### Día 2 — Infraestructura de producción

| Tarea | Estado | Nota |
|-------|--------|------|
| 2.1 Crear `docker-compose.prod.yml` | ✅ Hecho | Validado con `docker compose config` |
| 2.2 Reescribir `nginx/nginx.conf` | ✅ Hecho | Sintaxis OK, DOMINIO_PLACEHOLDER se reemplaza en Tarea 3.1 |
| 2.3 Crear `scripts/init-letsencrypt.sh` | ✅ Hecho | Listo para ejecutar en VPS |
| 2.4 Provisionar VPS | ⏸ Pendiente [USUARIO] | Docker, UFW, repo, `.env` con `chmod 600` |
| 2.5 Levantar stack en HTTP en VPS | ⏸ Pendiente [USUARIO] | Depende de 2.4 |

### Día 3 — SSL + Backups

| Tarea | Estado | Nota |
|-------|--------|------|
| 3.1 Activar SSL (Let's Encrypt) | ⏸ Pendiente | Depende de 2.5 + dominio apuntando al VPS |
| 3.2 Script de backup PostgreSQL | ⏸ Pendiente | Depende de 2.4 |
| 3.3 Cron diario de backup | ⏸ Pendiente | Depende de 3.2 |
| 3.4 Probar restore | ⏸ Pendiente | Depende de 3.2 |

### Día 4 — Onboarding Cliente1

| Tarea | Estado | Nota |
|-------|--------|------|
| 4.1 Crear tenant cliente1 | ⏸ Pendiente [USUARIO] | Necesita credenciales Meta del cliente |
| 4.2 Importar productos cliente1 | ⏸ Pendiente [USUARIO] | Necesita catálogo del cliente |
| 4.3 Registrar webhook en Meta | ⏸ Bloqueado | Necesita cuenta Meta verificada + VPS con SSL |
| 4.4 Smoke test end-to-end WhatsApp real | ⏸ Bloqueado | Depende de 4.3 |

### Día 5 — Buffer y documentación

| Tarea | Estado | Nota |
|-------|--------|------|
| 5.1 Monitoreo activo primeras 24h | ⏸ Pendiente | Después del go-live |
| 5.2 Onboarding clientes adicionales | ⏸ Pendiente | Ver `docs/ONBOARDING_CLIENTE.md` |
| 5.3 Crear `docs/RUNBOOK.md` | ⏸ Pendiente | |
| 5.4 Crear `docs/BACKLOG.md` | ⏸ Pendiente | |

---

## Qué se puede hacer AHORA (sin Meta ni VPS)

Estas tareas están listas para ejecutar en cualquier momento:

1. **Provisionar el VPS** (Tarea 2.4) — Solo necesita acceso SSH. No depende de Meta.
2. **Levantar stack en HTTP** (Tarea 2.5) — Una vez provisionado el VPS.
3. **Resolver dominio DNS** — Verificar que `bots.jesttech.com` apunte a la IP del VPS con `dig +short bots.jesttech.com`.

---

## Qué necesitás de Meta (en orden)

1. **`META_APP_SECRET`** — Para terminar la Tarea 1.5 y llenar el `.env.prod` / `.env` del VPS.
   - Está en: developers.facebook.com → tu App → Configuración básica → Secreto de la aplicación

2. **Cuenta verificada** — Para poder registrar webhooks y usar la API en producción.

3. **Por cada cliente:**
   - `Phone Number ID`
   - `Permanent Access Token`
   - (El cliente lo obtiene siguiendo `docs/ONBOARDING_CLIENTE.md` → Paso 1)

---

## Ruta crítica para go-live

```
Meta verificada
      ↓
Completar Tarea 1.5 (HMAC local) + 1.6 (cleanup)
      ↓
Provisionar VPS (Tarea 2.4)                ← se puede hacer en paralelo con Meta
      ↓
Stack en HTTP en VPS (Tarea 2.5)
      ↓
SSL con Let's Encrypt (Tarea 3.1)
      ↓
Backups + restore (Tareas 3.2-3.4)
      ↓
Onboarding Cliente1 (Tareas 4.1-4.4)
      ↓
Go-live ✅
```

---

## Archivos creados en este sprint

| Archivo | Propósito |
|---------|-----------|
| `.env.prod` | Variables de entorno de producción (no commiteado) |
| `docker-compose.prod.yml` | Stack de producción |
| `nginx/nginx.conf` | Proxy HTTPS con rate limiting y headers de seguridad |
| `scripts/init-letsencrypt.sh` | Bootstrap SSL con Let's Encrypt |
| `scripts/smoke-hmac.js` | Smoke test HMAC (crear en Tarea 1.5, borrar después) |
| `docs/CREAR_TENANT.md` | Guía para crear tenants |
| `docs/ONBOARDING_CLIENTE.md` | Proceso completo de onboarding por cliente |
| `docs/SPRINT_STATUS.md` | Este archivo |
