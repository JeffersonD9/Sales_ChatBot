# Backlog — Roadmap de escalabilidad

Todo lo que hace falta para seguir creciendo, ordenado por prioridad.
Abordar **una vez que el bot este generando ingresos**.

---

## P0 — Semanas 2-3 post go-live (estabilidad)

### Tests del flow-engine (steps menu / catalog / order)
Sin esto cualquier cambio al flujo puede romper la experiencia sin que nos demos cuenta.
Estimacion: 2 dias.

### Idempotencia persistente en Redis
Un reinicio del proceso durante un mensaje puede procesarlo dos veces.
Estimacion: 1 dia.

### Cola de notificaciones con reintentos
Si Meta API falla al notificar una venta al dueno, se pierde silenciosamente.
Estimacion: 1.5 dias.

---

## P1 — Mes 2 (calidad y observabilidad)

### Tests del parser y dispatcher
`src/core/whatsapp/parser.js` y `src/webhooks/dispatcher.js` sin cobertura.
Estimacion: 1 dia.

### Metricas Prometheus + Grafana
Ver volumen de mensajes, latencia y errores por tenant en tiempo real.
Estimacion: 1 dia.

### Cache bust atomico en configRepository
Condicion de carrera posible si dos requests actualizan config simultaneamente.
Estimacion: 0.5 dias.

### Script de renovacion masiva de billing
Cuando sube el precio o cambia el plan de varios clientes a la vez.
Estimacion: 0.5 dias.

---

## P2 — Mes 2-3 (producto)

### Flow Engine declarativo (FASE 2)
Soportar flujos distintos por cliente (lead capture, soporte, citas) sin tocar codigo.
Ver `docs/PLAN_MAESTRO.md` Fase 2.
Estimacion: 3-4 semanas.

### UI admin para gestion de tenants
Panel web para crear clientes, ver ordenes, actualizar productos y registrar pagos
sin usar psql ni CLI.
Estimacion: 1 semana.

### Dashboard de ventas por cliente
Resumen diario/semanal de ordenes y revenue por tenant.
Estimacion: 1 semana.

### Historial de pagos por tenant
Tabla `billing_history` que registra cada pago: fecha, monto, metodo, registrado por.
Util para facturacion y disputas.
Estimacion: 0.5 dias.

---

## P3 — Escalabilidad de base de datos (sharding progresivo)

Ver detalle completo en la seccion P3 existente del backlog.

**Cuando activar:** mas de 400-500 productos activos por tenant, o mas de 500 mensajes/dia.

**Tareas:**
- Connection router multi-shard en `db.js` (2-3 dias)
- Script `migrate-tenant-shard.js` para mover tenant entre DBs (1 dia)

El campo `db_shard` ya existe en la tabla `tenants` (migration 003). Todos los tenants
arrancan en `shard-01`. Cuando se migra uno: `UPDATE tenants SET db_shard = 'shard-02'`.

---

## P4 — Pasarela de pagos automatica

**Cuando activar:** mas de 5 clientes activos pagando manualmente.

### Integracion con Wompi (Colombia) o MercadoPago
Reemplaza el flujo manual de `mark-payment.js` por cobro automatico recurrente.

**Como funciona:**
1. Al crear un tenant, se crea una suscripcion recurrente en la pasarela
2. La pasarela cobra automaticamente cada mes
3. Un webhook de la pasarela notifica si el pago fue exitoso o fallo
4. El webhook llama `billingService.recordPayment()` o activa la suspension

**Pasarelas recomendadas para Colombia:**
- **Wompi** (Bancolombia) — mejor soporte local, PSE, tarjetas
- **MercadoPago** — mayor penetracion en Latam, links de pago faciles
- **Stripe** — mejor API pero mas friccion para clientes colombianos

**Archivos a crear:**
- `src/billing/wompiWebhook.js` — recibir eventos de pago
- `src/billing/wompiClient.js` — crear/cancelar suscripciones
- `migrations/005_billing_history.sql` — historial de transacciones

Estimacion: 3-4 dias.

---

## P5 — Infraestructura avanzada

### Multi-region / alta disponibilidad
Replicacion de PostgreSQL (primary + read replica) para tolerancia a fallos.
Estimacion: 2 dias.

### CDN para imagenes de productos
Las imagenes de productos hoy son URLs externas. Servir desde CDN propio
(Cloudflare R2 o similar) reduce dependencia de URLs de terceros y mejora velocidad.
Estimacion: 1 dia.

### Monitoreo de uptime y alertas
Configurar UptimeRobot o Betterstack para alertar si `/health` deja de responder.
Estimacion: 0.5 dias (configuracion, sin codigo).

### Backup offsite automatico
Los backups diarios hoy se guardan en el mismo VPS. Moverlos a S3 o similar.
Estimacion: 0.5 dias.

### Deploy automatico (CI/CD)
GitHub Actions que corre tests, construye imagen y hace deploy al VPS
cuando se hace push a main.
Estimacion: 1 dia.

---

## P6 — Crecimiento del producto

### Self-service onboarding
Panel donde el cliente mismo crea su cuenta, conecta su WhatsApp y configura su bot
sin intervension manual de Jefferson. Reduce tiempo de onboarding de dias a minutos.
Estimacion: 1-2 semanas.

### White-label
Opcion para que revendedores (agencias) ofrezcan el bot bajo su propia marca.
Requiere dominio personalizado por tenant y logo en las notificaciones.
Estimacion: 1 semana.

### Analytics de conversion por tenant
- Cuantos chats iniciaron vs cuantos terminaron en pedido
- Tasa de abandono por paso del flujo
- Productos mas consultados vs mas vendidos
Estimacion: 1 semana.

### Mensajes de campana (outbound)
Enviar mensajes masivos a clientes previos (reactivacion, ofertas).
Requiere aprobacion de Meta para templates de mensajes iniciados por empresa.
Estimacion: 1 semana.

### Soporte multi-idioma
Textos del bot configurables por idioma. Util para expandir a otros paises.
Estimacion: 3-4 dias.
