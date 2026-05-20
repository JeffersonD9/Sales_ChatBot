# JestSolution Dashboard

Panel de administraciÃ³n interna para la plataforma WhatsApp SaaS multi-tenant.  
Construido con **Next.js 15 Â· Drizzle ORM Â· PostgreSQL Â· Tailwind v4**.

---

## Ãndice

1. [Requisitos](#requisitos)
2. [ConfiguraciÃ³n inicial](#configuraciÃ³n-inicial)
3. [Levantar en desarrollo](#levantar-en-desarrollo)
4. [Credenciales de prueba](#credenciales-de-prueba)
5. [GestiÃ³n de usuarios admin](#gestiÃ³n-de-usuarios-admin)
6. [Vistas disponibles](#vistas-disponibles)
7. [Build de la imagen Docker](#build-de-la-imagen-docker)
8. [Deploy a producciÃ³n](#deploy-a-producciÃ³n)

---

## Requisitos

| Herramienta | VersiÃ³n mÃ­nima |
|-------------|---------------|
| Node.js     | 20.x          |
| pnpm        | 9.x           |
| Docker Desktop | 4.x        |
| Bot WhatsApp corriendo | (`docker-compose.dev.yml` del repo `whatsapp-saas`) |

---

## ConfiguraciÃ³n inicial

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

**Variables crÃ­ticas:**

```dotenv
NODE_ENV=development
PORT=3001

NEXT_PUBLIC_APP_URL=http://localhost:3001

# IMPORTANTE en Windows: el postgres local ocupa el puerto 5432.
# El bot expone el DB tambiÃ©n en el puerto 5433 para el dashboard.
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

### 3. Verificar que el bot estÃ¡ corriendo

Desde el directorio `whatsapp-saas/`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Confirmar que el DB estÃ¡ sano:

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

> Next.js detecta automÃ¡ticamente el puerto 3001 si el 3000 estÃ¡ ocupado por el bot.

---

## Credenciales de prueba

| Usuario      | ContraseÃ±a          | Rol          |
|-------------|---------------------|--------------|
| `jefferson`  | (tu contraseÃ±a original) | superadmin |
| `migueltest` | `MiguelDev2026#!`   | superadmin   |

---

## GestiÃ³n de usuarios admin

### Crear un nuevo usuario (script CLI)

```bash
ADMIN_USERNAME=nuevo_user \
ADMIN_EMAIL=nuevo@jestsolution.tech \
ADMIN_PASSWORD=ContraseÃ±aSegura2026 \
pnpm admin:create
```

> La contraseÃ±a debe tener **mÃ­nimo 12 caracteres**.
> El script siempre crea con rol `superadmin`. Para roles `admin` o `viewer`,
> usar el botÃ³n **"Nuevo usuario"** desde la vista `/admin-users` del panel.

### Roles disponibles

| Rol          | Permisos |
|-------------|----------|
| `superadmin` | Acceso total: puede crear/desactivar usuarios admin |
| `admin`      | GestiÃ³n de tenants, Ã³rdenes y sesiones |
| `viewer`     | Solo lectura â€” no puede modificar estados |

---

## Vistas disponibles

### `/` â€” Dashboard
MÃ©tricas globales en tiempo real:
- Total de tenants (activos / trial / suspendidos)
- Ã“rdenes de los Ãºltimos 7 y 30 dÃ­as
- Ingresos acumulados (Ã³rdenes entregadas)
- Sesiones activas (Ãºltima hora) y nuevas (Ãºltimas 24 h)
- Tabla de las 8 Ã³rdenes mÃ¡s recientes

### `/tenants` â€” Tenants
Lista paginada con bÃºsqueda y filtros. Acciones por fila: ver detalle, editar, suspender/activar.

### `/tenants/[slug]` â€” Detalle de tenant
- MÃ©tricas del tenant (productos, sesiones, Ã³rdenes, ingresos)
- Info de contacto y facturaciÃ³n
- ConfiguraciÃ³n WhatsApp (Phone Number ID, Verify Token, estado Meta Live)
- URL del webhook lista para copiar y pegar en Meta Developer Console
- Formulario de ediciÃ³n inline

### `/orders` â€” Ã“rdenes
Lista global de Ã³rdenes con filtro por estado y tenant. Cambio de estado directo desde la tabla (dropdown por fila).

**Estados:** Pendiente â†’ Confirmado â†’ Enviado â†’ Entregado / Cancelado

### `/sessions` â€” Sesiones
Lista de conversaciones del bot. Click en el nÃºmero de telÃ©fono abre el historial completo.

### `/sessions/[tenant_slug]/[phone]` â€” ConversaciÃ³n
Vista tipo chat bubble con todos los mensajes (inbound/outbound) de la sesiÃ³n. Muestra paso actual del estado del bot.

### `/admin-users` â€” Usuarios Admin
GestiÃ³n de cuentas con acceso al panel. Solo visible para `superadmin`. Permite crear usuarios con formulario modal y activar/desactivar cuentas existentes.

---

## Build de la imagen Docker

```bash
# Desde la carpeta Dashboard/
docker build -t jestsolution/dashboard:latest .
```

El Dockerfile usa 3 stages:
- `deps` â€” instala dependencias con pnpm
- `builder` â€” compila Next.js con `SKIP_ENV_VALIDATION=1`
- `runner` â€” imagen Alpine mÃ­nima corriendo como usuario no-root

Para verificar que la imagen es vÃ¡lida localmente:

```bash
# Levantar con docker-compose.dev.yml (construye y corre)
docker compose -f docker-compose.dev.yml up --build

# Verificar health
curl http://localhost:3001/api/health
# â†’ {"status":"ok","ts":...}
```

---

## Deploy a producciÃ³n

Ver **[DEPLOY.md](./DEPLOY.md)** para la guÃ­a completa con:
- DNS en Hostinger (subdominios `admin.` y `bot.`)
- ConfiguraciÃ³n de Nginx con SSL (Certbot)
- Permisos de DB (`scripts/setup-db-permissions.sql`)
- Variables de entorno de producciÃ³n
- Comandos de actualizaciÃ³n
