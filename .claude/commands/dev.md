# /dev — Desarrollo con documentación obligatoria

Eres un asistente de desarrollo para el proyecto **whatsapp-saas** (plataforma SaaS multi-tenant de bots de ventas WhatsApp). Tu trabajo es implementar lo que se pide Y documentar todo como parte del mismo proceso, no como paso opcional al final.

## Tarea

$ARGUMENTS

---

## Protocolo obligatorio — NO se puede saltar ningún paso

### FASE 1 — Entender antes de tocar código

Antes de escribir una sola línea de código:

1. Lee `CLAUDE.md` para entender el contexto actual del proyecto.
2. Lee los archivos relevantes a la tarea (usa Glob/Grep para encontrarlos si no los conoces).
3. Escribe en 2-3 oraciones qué vas a hacer y por qué, incluyendo qué archivos vas a tocar.
4. Si la tarea implica una decisión de arquitectura (nueva tabla, nuevo endpoint, nuevo servicio), descríbela explícitamente y espera confirmación del usuario antes de proceder.

### FASE 2 — Implementar

Implementa la tarea. Reglas durante la implementación:

- **Un archivo a la vez**: no hagas cambios en 5 archivos simultáneamente sin explicar el hilo.
- **Sin sobre-ingeniería**: solo lo que la tarea requiere, sin abstracciones "por si acaso".
- **Sin comentarios de código** que expliquen el "qué" (los nombres ya lo hacen). Solo comenta el "por qué" cuando sea no obvio.
- Si encuentras deuda técnica al pasar, **menciónala pero no la arregles** a menos que el usuario lo apruebe.

### FASE 3 — Documentación (OBLIGATORIA, no opcional)

Después de cada cambio de código, actualiza la documentación **en el mismo turno**. No termines sin completar esto.

#### 3a. `CLAUDE.md` — actualizar si cambia cualquiera de estos:
- Lista de archivos clave (nueva ruta, nuevo servicio, nuevo script)
- Comandos disponibles (nuevo npm script, nuevo comando Docker)
- Variables de entorno (nueva variable, nuevo comportamiento)
- Estado del proyecto (tabla de pendientes/completados)
- Schema de BD (nueva tabla, nueva columna relevante)
- Flujos de la arquitectura (nuevo endpoint, nuevo paso en el flujo)

#### 3b. `ARCHITECTURE.md` — actualizar si cambia cualquiera de estos:
- El flujo de un mensaje entrante (nuevo middleware, nuevo paso)
- La máquina de estados (nuevo STEP)
- Las capas de datos (nueva capa, nuevo TTL)
- Las tres APIs del servidor (nuevo router, nuevo endpoint)
- La sección de infraestructura Docker (nuevo stage, nuevo servicio)
- El mapa de archivos → responsabilidad

#### 3c. Migrations SQL — si hay cambios de BD:
- Crear un nuevo archivo `migrations/00N_descripcion.sql`
- Actualizar la tabla de schema en `CLAUDE.md`

#### 3d. `.env.example` y `.env.dev.example` — si hay nuevas variables de entorno:
- Agregar la variable con su comentario explicativo en ambos archivos

### FASE 4 — Resumen final

Al terminar, escribe un resumen con este formato exacto:

```
## Qué se hizo
- [lista de cambios de código]

## Qué se documentó
- [lista de archivos de doc actualizados y qué sección]

## Pendiente / próximos pasos
- [si hay algo que quedó fuera de scope, mencionarlo aquí]
```

---

## Reglas de calidad del código

- **Seguridad primero**: nunca loguear tokens, passwords, ni datos personales.
- **Multi-tenant siempre**: toda nueva función que toque datos debe recibir `tenantSlug` o `tenantId` como parámetro. Nunca leer de `process.env` lo que debería venir del objeto `tenant`.
- **Sin romper el flujo existente**: si cambias un handler del flow-engine, verifica que los steps adyacentes siguen funcionando.
- **Tests**: si existe un test del módulo que modificaste, actualízalo. Si el módulo es nuevo y es lógica de negocio, crea el test unitario.

## Contexto del proyecto

- Código en `src/` — ver `CLAUDE.md` para el mapa completo de archivos
- Entorno dev: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`
- Flow principal: `POST /webhook/:slug → dispatcher.js → engine.js → steps/*.js → sender.js`
- Estado de conversación: `core/state/manager.js` (RAM + PostgreSQL)
- Config del tenant: `tenants/loader.js` (RAM 5min) → `tenants/repository.js` (PostgreSQL)
