# Backlog post-produccion

Abordar **una vez que el bot este generando ingresos**. Ordenado por impacto.

---

## P0 — Semanas 2-3 post go-live

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

## P1 — Mes 2

### Tests del parser y dispatcher
`src/core/whatsapp/parser.js` y `src/webhooks/dispatcher.js` sin cobertura.
Estimacion: 1 dia.

### Metricas Prometheus + Grafana
Ver volumen de mensajes, latencia y errores por tenant en tiempo real.
Estimacion: 1 dia.

### Cache bust atomico en configRepository
Condicion de carrera posible si dos requests actualizan config simultaneamente.
Estimacion: 0.5 dias.

---

## P2 — Mes 2-3

### Flow Engine declarativo (FASE 2)
Soportar flujos distintos por cliente (lead capture, soporte, citas) sin tocar codigo.
Ver `docs/PLAN_MAESTRO.md` Fase 2.
Estimacion: 3-4 semanas.

### UI admin para gestion de tenants
Panel web para crear clientes, ver ordenes y actualizar productos sin usar psql.
Estimacion: 1 semana.

### Dashboard de ventas por cliente
Resumen diario/semanal de ordenes y revenue por tenant.
Estimacion: 1 semana.
