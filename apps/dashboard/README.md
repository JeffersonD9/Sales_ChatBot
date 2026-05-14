# JestSolution Dashboard

Panel de administración interna para la plataforma WhatsApp SaaS multi-tenant.  
Construido con **Next.js 15 · Drizzle ORM · PostgreSQL · Tailwind v4**.

---

## Índice

1. [Requisitos](#requisitos)
2. [Configuración inicial](#configuración-inicial)
3. [Levantar en desarrollo](#levantar-en-desarrollo)
4. [Credenciales de prueba](#credenciales-de-prueba)
5. [Gestión de usuarios admin](#gestión-de-usuarios-admin)
6. [Vistas disponibles](#vistas-disponibles)
7. [Build de la imagen Docker](#build-de-la-imagen-docker)
8. [Deploy a producción](#deploy-a-producción)

---

## Requisitos

| Herramienta | Versión mínima |
|-------------|---------------|
| Node.js     | 20.x          |
| pnpm        | 9.x           |
| Docker Desktop | 4.x        |
| Bot WhatsApp corriendo | (`docker-compose.dev.yml` del repo `whatsapp-saas`) |

---

## Configuración inicial

### 1. Instalar dependencias

```bash
cd Dashboard
pnpm install
```

### 2. Archivo `.env`

Copiar el ejemplo y completar los valores:

```bash
cp .env.example .env
```

**Variables críticas:**

```dotenv
NODE_ENV=development
PORT=3001

NEXT_PUBLIC_APP_URL=http://localhost:3001

# IMPORTANTE en Windows: el postgres local ocupa el puerto 5432.
# El bot expone el DB también en el puerto 5433 para el dashboard.
# Verificar que docker-compose.dev.yml del bot tenga "5433:5432" en postgres.
DATABASE_URL=postgresql://app:devpassword@localhost:5433/whatsapp_saas

# Generar con: openssl rand -hex 32
AUTH_SECRET=<reemplazar con un valor real>

SESSION_TTL_SECONDS=28800
ALLOWED_IPS=
PANEL_DOMAIN=localhost:3001
BOT_DOMAIN=localhost:3000
```

> **Nota sobre el puerto 5433:** En Windows, si hay un PostgreSQL local instalado
> (por ejemplo con pgAdmin o como dependencia de otro programa), ocupa el puerto 5432
> antes que Docker. El `docker-compose.dev.yml` del bot tiene mapeado `5433:5432`
> como puerto alternativo para el dashboard. El bot sigue usando `postgres:5432`
> internamente sin conflicto.

### 3. Verificar que el bot está corriendo

Desde el directorio `whatsapp-saas/`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Confirmar que el DB está sano:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
# whatsapp-saas-db debe mostrar (healthy)
```

---

## Levantar en desarrollo

```bash
pnpm dev
```

Abre **http://localhost:3001** en el navegador.

> Next.js detecta automáticamente el puerto 3001 si el 3000 está ocupado por el bot.

---

## Credenciales de prueba

| Usuario      | Contraseña          | Rol          |
|-------------|---------------------|--------------|
| `jefferson`  | (tu contraseña original) | superadmin |
| `migueltest` | `MiguelDev2026#!`   | superadmin   |

---

## Gestión de usuarios admin

### Crear un nuevo usuario (script CLI)

```bash
ADMIN_USERNAME=nuevo_user \
ADMIN_EMAIL=nuevo@jestsolution.dev \
ADMIN_PASSWORD=ContraseñaSegura2026 \
pnpm admin:create
```

> La contraseña debe tener **mínimo 12 caracteres**.
> El script siempre crea con rol `superadmin`. Para roles `admin` o `viewer`,
> usar el botón **"Nuevo usuario"** desde la vista `/admin-users` del panel.

### Roles disponibles

| Rol          | Permisos |
|-------------|----------|
| `superadmin` | Acceso total: puede crear/desactivar usuarios admin |
| `admin`      | Gestión de tenants, órdenes y sesiones |
| `viewer`     | Solo lectura — no puede modificar estados |

---

## Vistas disponibles

### `/` — Dashboard
Métricas globales en tiempo real:
- Total de tenants (activos / trial / suspendidos)
- Órdenes de los últimos 7 y 30 días
- Ingresos acumulados (órdenes entregadas)
- Sesiones activas (última hora) y nuevas (últimas 24 h)
- Tabla de las 8 órdenes más recientes

### `/tenants` — Tenants
Lista paginada con búsqueda y filtros. Acciones por fila: ver detalle, editar, suspender/activar.

### `/tenants/[slug]` — Detalle de tenant
- Métricas del tenant (productos, sesiones, órdenes, ingresos)
- Info de contacto y facturación
- Configuración WhatsApp (Phone Number ID, Verify Token, estado Meta Live)
- URL del webhook lista para copiar y pegar en Meta Developer Console
- Formulario de edición inline

### `/orders` — Órdenes
Lista global de órdenes con filtro por estado y tenant. Cambio de estado directo desde la tabla (dropdown por fila).

**Estados:** Pendiente → Confirmado → Enviado → Entregado / Cancelado

### `/sessions` — Sesiones
Lista de conversaciones del bot. Click en el número de teléfono abre el historial completo.

### `/sessions/[tenant_slug]/[phone]` — Conversación
Vista tipo chat bubble con todos los mensajes (inbound/outbound) de la sesión. Muestra paso actual del estado del bot.

### `/admin-users` — Usuarios Admin
Gestión de cuentas con acceso al panel. Solo visible para `superadmin`. Permite crear usuarios con formulario modal y activar/desactivar cuentas existentes.

---

## Build de la imagen Docker

```bash
# Desde la carpeta Dashboard/
docker build -t jestsolution/dashboard:latest .
```

El Dockerfile usa 3 stages:
- `deps` — instala dependencias con pnpm
- `builder` — compila Next.js con `SKIP_ENV_VALIDATION=1`
- `runner` — imagen Alpine mínima corriendo como usuario no-root

Para verificar que la imagen es válida localmente:

```bash
# Levantar con docker-compose.dev.yml (construye y corre)
docker compose -f docker-compose.dev.yml up --build

# Verificar health
curl http://localhost:3001/api/health
# → {"status":"ok","ts":...}
```

---

## Deploy a producción

Ver **[DEPLOY.md](./DEPLOY.md)** para la guía completa con:
- DNS en Hostinger (subdominios `admin.` y `bot.`)
- Configuración de Nginx con SSL (Certbot)
- Permisos de DB (`scripts/setup-db-permissions.sql`)
- Variables de entorno de producción
- Comandos de actualización
