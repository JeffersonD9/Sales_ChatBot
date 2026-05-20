# WhatsApp Business API — Guía técnica anti-ban v2
> **Stack:** 360dialog · WhatsApp Business API oficial · CRM · Agente IA · Campañas
> **Versión:** 2.0 · Mayo 2026 · Uso interno SaaS

---

## Índice

1. [Cómo funciona el sistema de scoring de Meta](#1-cómo-funciona-el-sistema-de-scoring-de-meta)
2. [Causas de baneos y restricciones](#2-causas-de-baneos-y-restricciones)
3. [Comportamientos que Meta detecta como spam](#3-comportamientos-que-meta-detecta-como-spam)
4. [Errores críticos de SaaS, bots y CRMs](#4-errores-críticos-de-saas-bots-y-crms)
5. [Estrategias anti-ban por tipo de flujo](#5-estrategias-anti-ban-por-tipo-de-flujo)
6. [Warm-up, tiers y escalado de volumen](#6-warm-up-tiers-y-escalado-de-volumen)
7. [Métricas y quality rating](#7-métricas-y-quality-rating)
8. [Manejo de incidentes: suspensión, ban y degradación](#8-manejo-de-incidentes-suspensión-ban-y-degradación)
9. [Decisión: reutilizar, recuperar o reemplazar número](#9-decisión-reutilizar-recuperar-o-reemplazar-número)
10. [Riesgos de infraestructura y contenido](#10-riesgos-de-infraestructura-y-contenido)
11. [Arquitectura anti-ban para SaaS](#11-arquitectura-anti-ban-para-saas)
12. [Referencia de errores de la API](#12-referencia-de-errores-de-la-api)
13. [Implementación técnica: código de producción](#13-implementación-técnica-código-de-producción)
14. [Restaurante / comidas rápidas: guía específica](#14-restaurante--comidas-rápidas-guía-específica)

---

## 1. Cómo funciona el sistema de scoring de Meta

Entender el sistema es la base de cualquier estrategia anti-ban. Meta no toma decisiones manuales en tiempo real; opera con un sistema automatizado de scoring multidimensional.

### Tres capas de evaluación

```
CAPA 1 — PHONE QUALITY RATING (en tiempo real, rolling 7 días)
  └── Señales: bloqueos, reportes, opt-outs, engagement
  └── Estados: Green → Yellow → Red → Disabled

CAPA 2 — TEMPLATE QUALITY (por template, rolling 7 días)
  └── Señales: reportes sobre ese template específico, bloqueos post-recepción
  └── Estados: Active → Paused → Disabled

CAPA 3 — BUSINESS MANAGER HEALTH (agregado de cuenta)
  └── Señales: historial de violaciones, número de números degradados
  └── Consecuencia: puede afectar aprobación de nuevos templates y números
```

### Ventana de evaluación

- **Phone quality rating:** ventana deslizante de **7 días**.
- **Template quality:** ventana deslizante de **7 días** por template.
- **Tier de mensajes:** ventana de **7 días** para avance automático.
- **Cooldown post-ban temporal:** **24–72 horas** antes de poder apelar.

> Las acciones de hoy afectan tu rating durante 7 días completos. Una campaña agresiva del lunes todavía pesa el domingo siguiente.

---

## 2. Causas de baneos y restricciones

### Causas directas con umbrales conocidos

| Señal | Umbral de degradación | Umbral crítico |
|---|---|---|
| Tasa de bloqueos | > 1% en 24h | > 2% → revisión automática |
| Tasa de reportes | > 0.3% → Yellow | > 0.5% → Red / Disabled |
| Opt-outs explícitos | > 1% | > 2% |
| Mensajes sin opt-in | Cualquier volumen detectado | Inmediato |
| Ráfaga de volumen sin warm-up | 5× el promedio diario | 10× → revisión automática |
| Template fuera de contexto | Detectado por ML | Pausa del template |
| Marketing fuera de ventana 24h sin template aprobado | Primera ocurrencia | Reincidencia → restricción |

### Causas indirectas (las más ignoradas en SaaS)

**Bajo engagement sostenido:**
- Envías 10,000 mensajes en 7 días, recibes 200 respuestas (2%). Meta lo interpreta como distribución de spam. El ratio mínimo saludable es 8–10%.

**Número con historial personal previo:**
- Un SIM antes registrado en WhatsApp personal y con historial de bloqueos arrastra esas señales al registro de Business API. Meta no resetea el historial cuando cambia de cuenta personal a Business API.

**Correlación de Business Manager:**
- Si 3 de tus 5 números en el mismo BM son degradados en 30 días, Meta puede aplicar restricciones preventivas al BM completo, incluyendo números sanos.

**Links a dominios nuevos o flaggeados:**
- Dominio < 30 días de antigüedad en un template → señal de phishing.
- Dominio previamente reportado en otros canales de Meta → herencia de mala reputación.

**Inconsistencia entre display name y contenido:**
- El nombre del negocio registrado en el BM no coincide con la marca en los mensajes → señal de suplantación.

---

## 3. Comportamientos que Meta detecta como spam

### Detección de automatización riesgosa

| Comportamiento | Señal que genera | Solución |
|---|---|---|
| Delay exacto entre mensajes (ej. siempre 2,000ms) | Patrón de bot | Delay aleatorio 800–3,000ms |
| Mismo mensaje a 1,000 usuarios en < 30 minutos | Blast masivo | Distribuir en ventanas de 4h+ |
| 0 respuestas entrantes sobre 500 enviados | Ratio spam | Segmentar mejor, warm-up primero |
| Variables `{{1}}` = mismo texto para todos | Evasión de review | Personalización real por usuario |
| Envíos entre 11pm–7am hora local | Spam nocturno | Scheduler con TZ del destinatario |
| Número nuevo (< 7 días) enviando > 500/día | Cuenta quemada nueva | Respetar warm-up estricto |
| Mismo link en > 200 mensajes en 1 hora | Spam de URL | Acortar + UTM únicos por usuario |
| Mensajes reenviados (forwarded) en masa | Contenido viral no orgánico | Crear contenido propio siempre |

### Señales de contenido penalizado

```
PALABRAS/FRASES CON ALTO RIESGO EN TEMPLATES:
✗ GRATIS / FREE / GRATUITO (mayúsculas)
✗ ¡¡¡OFERTA!!! (exclamaciones múltiples)
✗ ÚLTIMAS HORAS / SOLO HOY
✗ HAGA CLIC AQUÍ / CLICK AQUÍ
✗ 100% GARANTIZADO
✗ GANA DINERO / INGRESO EXTRA
✗ Instrucciones para darse de baja enterradas o ausentes

ESTRUCTURA QUE FUNCIONA:
✓ Saludo personalizado con nombre real
✓ Contexto de la relación (tu último pedido, tu cuenta)
✓ Oferta específica con valor claro
✓ CTA simple y conversacional ("Responde SÍ", "Escríbenos")
✓ Opción de respuesta o botón de quick reply visible
```

---

## 4. Errores críticos de SaaS, bots y CRMs

### Error 1 — Opt-in implícito o heredado

**Problema:** Importar base de datos de otro canal (email, formulario de contacto, punto de venta) y asumir que el opt-in aplica para WhatsApp.

**Consecuencia:** Alta tasa de reportes en primeras campañas porque el usuario no recuerda o no autorizó ese canal específicamente.

**Solución correcta:**
```
Opt-in válido para WhatsApp Business API debe ser:
1. Explícito: checkbox o botón con mención específica de WhatsApp
2. Granular: separado del opt-in de email y SMS
3. Documentado: timestamp + IP + fuente + texto exacto del consent
4. Reversible: opt-out debe funcionar inmediatamente

Ejemplo de texto de opt-in válido:
"Acepto recibir mensajes de [Marca] por WhatsApp con información
sobre mis pedidos, novedades y promociones. Puedo darme de baja
en cualquier momento respondiendo STOP."
```

### Error 2 — Rate limiting inexistente o fijo

**Problema:** Enviar la cola completa en paralelo, o con delay fijo (cada 1s exacto).

**Consecuencia:** Ráfaga detectada como bot masivo + posible HTTP 429 de 360dialog que si no se maneja bien duplica envíos en el retry.

**Solución:** Ver implementación completa en sección 13.

### Error 3 — Un solo número para todos los casos de uso

**Problema:** El mismo número recibe mensajes de soporte (alta respuesta, buen engagement) y envía campañas de marketing (menor respuesta, mayor reporte). El quality rating es promediado, pero el daño de campañas arrastra al número completo.

**Consecuencia:** Un número quemado por campañas agresivas deja sin canal de soporte a toda la operación.

**Solución:** Segregación estricta por función (ver sección 11).

### Error 4 — No procesar opt-outs en tiempo real

**Problema:** El usuario responde "Ya no me escribas" o "BAJA" y el bot no lo detecta. Le siguen llegando mensajes. El usuario reporta. Cada reporte pesa 10× más que un bloqueo en el scoring de Meta.

**Solución:**
```javascript
// Lista de keywords de opt-out multiidioma
const OPT_OUT_KEYWORDS = [
  // Español
  'stop', 'baja', 'cancelar', 'no más', 'no quiero', 'eliminar',
  'no me escribas', 'no me mandes', 'quitar', 'salir', 'dejar',
  // Inglés
  'unsubscribe', 'remove', 'opt out', 'optout',
  // Portugués
  'parar', 'cancelar', 'remover'
];

async function handleIncomingMessage(msg) {
  const text = msg.text?.body?.toLowerCase().trim() || '';
  const isOptOut = OPT_OUT_KEYWORDS.some(kw => text.includes(kw));
  
  if (isOptOut) {
    await suppressionList.add(msg.from);          // Inmediato
    await crm.updateOptOut(msg.from, Date.now()); // Persistente
    await sendOptOutConfirmation(msg.from);       // Confirmar al usuario
    return; // No procesar más
  }
  // ... resto del handler
}
```

### Error 5 — Templates rechazados reutilizados con cambios mínimos

**Problema:** Meta rechaza un template. El desarrollador cambia 2 palabras y lo reenvía. Meta detecta el patrón (misma estructura, misma cuenta, similar contenido) y rechaza más rápido, a veces con penalización sobre la cuenta.

**Regla:** Si un template es rechazado, rediseñar completamente la propuesta de valor, no solo la redacción.

### Error 6 — Sin circuit breaker en el agente IA

**Problema:** El agente IA entra en loop, envía múltiples mensajes sin respuesta del usuario, o falla y reintenta indefinidamente generando spam involuntario al mismo número.

**Solución:**
```javascript
class ConversationGuard {
  constructor(maxMessagesWithoutReply = 3, cooldownHours = 24) {
    this.maxOutbound = maxMessagesWithoutReply;
    this.cooldown = cooldownHours * 3600 * 1000;
  }

  async canSend(phoneNumber) {
    const state = await this.getState(phoneNumber);
    
    // Bloquear si excede mensajes sin respuesta
    if (state.outboundWithoutReply >= this.maxOutbound) {
      const elapsed = Date.now() - state.lastOutbound;
      if (elapsed < this.cooldown) return false;
      await this.resetCounter(phoneNumber); // Reset tras cooldown
    }
    return true;
  }
}
```

### Error 7 — No monitorear quality rating proactivamente

**Problema:** El quality rating baja a Yellow silenciosamente. Nadie lo ve. Continúan las campañas. Baja a Red. Se suspende el número. Pérdida total de operación.

**Solución:** Webhook de calidad + alertas automatizadas (ver sección 13).

### Error 8 — Horarios sin respetar zona horaria del destinatario

**Problema:** Se programa una campaña a las 10am hora del servidor (Colombia), pero hay usuarios en México, España o Argentina. Algunos reciben el mensaje a las 2am. Bloquean.

**Solución:**
```javascript
function isWithinSendWindow(recipientPhone, windowStart = 9, windowEnd = 20) {
  // Inferir TZ por prefijo de país del número
  const countryCode = getCountryCode(recipientPhone);
  const tz = COUNTRY_TIMEZONE_MAP[countryCode] || 'America/Bogota';
  const localHour = new Date().toLocaleString('en-US', {
    timeZone: tz, hour: 'numeric', hour12: false
  });
  return parseInt(localHour) >= windowStart && parseInt(localHour) < windowEnd;
}
```

---

## 5. Estrategias anti-ban por tipo de flujo

### Bots de ventas

**Reglas de oro:**
1. Nunca iniciar con un template de ventas directo. El primer mensaje siempre es una bienvenida o consulta ("¿En qué podemos ayudarte?").
2. Máximo 3 mensajes salientes consecutivos sin respuesta del usuario, luego silencio de 24h.
3. Siempre ofrecer salida humana visible: "💬 Hablar con un asesor" como botón o texto.
4. Delay entre mensajes del bot: 1,200–4,000ms con variación aleatoria. Simular tiempo de escritura.
5. Si el usuario repite la misma intención 2 veces sin ser resuelto: escalar a humano automáticamente.
6. Log completo de cada sesión. Si Meta audita, necesitas demostrar el flujo real de la conversación.

**Flujo recomendado para bot de ventas:**
```
[Usuario inicia] ──→ Bot saluda + muestra opciones (template o mensaje libre)
                          │
              ┌───────────┴───────────┐
         Elige opción            No responde en 24h
              │                       │
         Bot asiste              Silencio total
              │                  (no reactivar con
    ┌─────────┴──────────┐        marketing sin template)
  Resuelto           No resuelto
    │                    │
  Cierre +          → Humano
  CSAT request       (transferencia limpia con contexto)
```

### Campañas promocionales

**Checklist pre-envío:**
- [ ] Opt-in verificado con fecha ≤ 90 días (campaña fría) o ≤ 180 días (con interacción reciente)
- [ ] Template aprobado con quality rating > 70% en Meta
- [ ] Segmento activo: respondió algo en los últimos 30 días
- [ ] Personalización real: al menos nombre + 1 dato contextual (último pedido, producto favorito)
- [ ] Horario: 9am–8pm hora local del destinatario
- [ ] Volumen ≤ 50% del límite diario del tier actual
- [ ] Rate limiter activo con delay aleatorio
- [ ] Monitoring de bloqueo/reporte en tiempo real activo
- [ ] Circuit breaker definido: si bloqueo rate > 1%, pausar automáticamente

**Frecuencia máxima por segmento:**

| Segmento | Frecuencia máxima | Nota |
|---|---|---|
| Activos (compró en 30 días) | 2 campañas/semana | Mantener valor alto en mensajes |
| Semi-activos (30–90 días) | 1 campaña/semana | Templates con oferta concreta |
| Inactivos (90–180 días) | 1 campaña de reactivación/mes | Solo template de win-back |
| Fríos (> 180 días) | No enviar | Riesgo muy alto |

### Automatizaciones transaccionales

Las automatizaciones transaccionales (confirmaciones de pedido, alertas de entrega, recordatorios de cita) tienen el menor riesgo de ban si están bien configuradas.

**Reglas:**
- Usar siempre templates de categoría `TRANSACTIONAL` o `UTILITY`, no `MARKETING`.
- El contenido debe ser directamente relevante a una acción que el usuario tomó.
- No incluir mensajes de cross-sell o upsell dentro de templates transaccionales (Meta lo detecta y puede cambiar la categoría automáticamente, cobrándote más y bajando el rating).
- Máximo 5 mensajes transaccionales al mismo número en 24h.

### Mensajes masivos (blasts)

**Arquitectura de blast segura:**
```
Total campaña: 10,000 mensajes
│
├── Dividir en lotes de 500 por número
├── 4 números disponibles = 4 lotes paralelos de 2,500 c/u
├── Cada número envía a 60 msgs/min máximo
├── Duración total: ~42 minutos por número
└── Horario de envío: ventana de 9am–1pm + 3pm–7pm (evitar almuerzo pico)
```

**Nunca:**
- Enviar el mismo mensaje exacto a todos. Usar variables para diferenciar mínimo nombre + ciudad.
- Enviar desde un solo número cuando el volumen supera 500 mensajes.
- Programar blasts sin monitoring activo.

### Templates — guía de creación

**Estructura de template de alto rendimiento:**
```
[HEADER OPCIONAL] — Imagen del producto o texto corto
[BODY]
- Línea 1: Saludo personalizado con {{nombre}}
- Línea 2: Contexto relevante (tu pedido, tu cuenta, tu historial)
- Línea 3: La oferta o información con valor claro
- Línea 4: CTA conversacional, no agresivo

[FOOTER OPCIONAL] — Nombre de marca + instrucción opt-out
[BOTONES OPCIONALES] — Máximo 3, preferir Quick Reply sobre URL
```

**Palabras y frases seguras para CTA:**
- "Responde SÍ para confirmar"
- "¿Te gustaría verlo?"
- "Escríbenos si te interesa"
- "¿Lo pedimos para hoy?"

**Palabras y frases a evitar:**
- "¡Compra AHORA!"
- "OFERTA EXCLUSIVA POR TIEMPO LIMITADO"
- "No pierdas esta oportunidad"
- "Haz clic aquí" (en mayúsculas)

### Flujos de agente IA — reglas específicas

**Gestión de contexto:**
- El agente debe recordar todo lo dicho en la sesión. No preguntar datos ya dados.
- Si el usuario cambia de tema abruptamente, aceptar el cambio en lugar de forzar el flujo anterior.
- Detectar señales de frustración: mayúsculas, "NO ENTIENDES", repetición, puntos suspensivos + nada.

**Límites de contenido del agente:**
- No prometer descuentos no autorizados.
- No dar tiempos de entrega sin validar disponibilidad real.
- No hacer afirmaciones sobre disponibilidad de stock sin consultar el sistema.
- Cada promesa incumplida genera reclamaciones → reportes → degradación de quality.

**Escalada humana obligatoria:**
```javascript
const ESCALATION_TRIGGERS = [
  'mismos_mensajes_sin_resolver >= 2',     // Loop detectado
  'sentiment_score < -0.6',                 // Frustración alta
  'contains_complaint_keywords',            // "queja", "reclamo", "horrible"
  'outbound_without_reply >= 3',            // Silencio del usuario
  'session_duration > 15_minutes',          // Conversación muy larga
  'explicitly_asks_for_human'               // "quiero hablar con una persona"
];
```

---

## 6. Warm-up, tiers y escalado de volumen

### Protocolo de warm-up

El warm-up no es opcional. Es el proceso de construir historial positivo antes de escalar.

**Fase 1 — Semanas 1–2 (Establecer reputación):**

| Día | Mensajes/día | Mensajes/hora | Segmento |
|---|---|---|---|
| 1–3 | 50–100 | 10 | Tus mejores clientes (top 50 por frecuencia) |
| 4–7 | 100–250 | 20 | Clientes activos últimos 14 días |
| 8–14 | 250–500 | 40 | Activos últimos 30 días |

**Fase 2 — Semanas 3–4 (Consolidación):**

| Día | Mensajes/día | Mensajes/hora | Condición |
|---|---|---|---|
| 15–21 | 500–1,000 | 70 | Solo si quality = Green |
| 22–30 | 1,000–2,500 | 120 | Solo si quality = Green y respuesta > 12% |

**Fase 3 — Mes 2+ (Escalado):**
- Escalar solo si quality se mantuvo Green durante toda la semana anterior.
- Regla del doble: máximo 2× el volumen del día anterior.
- Nunca escalar el día después de una caída de quality, aunque haya vuelto a Green.

### Sistema de tiers de Meta

| Tier | Conversaciones únicas/24h | Cómo avanzar | Tiempo típico |
|---|---|---|---|
| Tier 1 | 1,000 | Iniciar 2,000 conv. en 7 días con quality ≥ Yellow | 2–4 semanas |
| Tier 2 | 10,000 | Iniciar 20,000 conv. en 7 días con quality ≥ Yellow | 4–8 semanas |
| Tier 3 | 100,000 | Iniciar 200,000 conv. en 7 días con quality ≥ Yellow | Variable |
| Tier 4 | Sin límite | Aprobación manual de Meta | Por solicitud |

> **Importante:** el avance de tier es automático pero puede retroceder. Si quality cae a Red, puedes bajar un tier. La recuperación del tier requiere volver a cumplir las condiciones.

### Reglas de escalado seguro

1. Nunca superar el **80% del límite diario del tier** en un solo día.
2. Si quality baja a Yellow: **reducir volumen un 40%** ese día, no esperar.
3. Si quality baja a Red: **pausar todo marketing** inmediatamente, solo transaccionales.
4. Escalar por segmento, no en masa: añade el siguiente segmento más activo gradualmente.
5. Esperar **7 días completos** de quality Green antes de retomar el escalado después de una caída.

---

## 7. Métricas y quality rating

### Dashboard de métricas críticas

| Métrica | Fórmula | Saludable | Alerta | Crítico |
|---|---|---|---|---|
| Block rate | Bloqueos / mensajes enviados | < 0.5% | 0.5–1% | > 1% |
| Report rate | Reportes / mensajes enviados | < 0.2% | 0.2–0.4% | > 0.5% |
| Opt-out rate | Opt-outs / mensajes enviados | < 0.3% | 0.3–0.8% | > 1% |
| Response rate | Respuestas / mensajes enviados | > 15% | 8–15% | < 8% |
| Read rate | Leídos / mensajes enviados | > 70% | 50–70% | < 50% |
| Resolution rate | Resueltos sin humano / total conv. | > 60% | 40–60% | < 40% |
| CSAT implícito | Conversaciones positivas / total | > 80% | 60–80% | < 60% |

### Cómo afectan las métricas al quality rating

**Alto impacto negativo (1 evento = mucho daño):**
- Reporte explícito ("Report") del usuario: penalización alta, 7 días de ventana.
- Bloqueo inmediato después de recibir mensaje: señal de contenido no deseado.
- Opt-out no procesado seguido de más mensajes: abuso.

**Impacto negativo acumulativo:**
- Mensajes enviados sin respuesta durante varios días.
- Read rate cayendo semana a semana (audiencia desenganchada).
- Opt-outs frecuentes de un mismo template específico.

**Alto impacto positivo:**
- Respuesta del usuario en < 5 minutos tras recibir el mensaje.
- Conversación completada con resolución (pedido hecho, pregunta respondida).
- CTR en botones de quick reply (señal de contenido relevante).
- Sesiones de > 3 intercambios (conversación genuina).

### Monitoreo de quality en tiempo real

```
Fuentes de datos:
1. Meta Business Suite → Phone Numbers → Quality Rating (manual)
2. 360dialog Dashboard → Channel Quality (manual)
3. 360dialog Webhook → evento phone_number_quality_update (automático ✓)
4. API de 360dialog: GET /v1/configs/webhook → quality_update event

Frecuencia de revisión recomendada:
- Webhook: en tiempo real (inmediato)
- Dashboard: diario durante warm-up, 3x/semana en operación normal
- Reporte semanal: cada lunes revisar la semana anterior
```

---

## 8. Manejo de incidentes: suspensión, ban y degradación

### Niveles de incidente

```
NIVEL 1 — Quality Yellow (degradación leve)
  Síntomas: quality rating amarillo en Meta Business Suite
  Impacto: límites de messaging reducidos automáticamente
  Acción: reducir volumen 40%, revisar últimas campañas, pausar segmentos fríos
  Tiempo de resolución esperado: 3–7 días si se corrigen causas

NIVEL 2 — Quality Red (degradación crítica)
  Síntomas: quality rating rojo, pueden aparecer errores 131049
  Impacto: límites muy reducidos, templates pueden pausarse
  Acción: PARAR todo marketing, solo transaccionales, auditoría completa
  Tiempo de resolución esperado: 7–14 días mínimo

NIVEL 3 — Número Flagged (advertencia)
  Síntomas: notificación en Business Manager, webhook de FLAGGED
  Impacto: posible pausa de templates, reducción de tier
  Acción: igual que Nivel 2 + preparar documentación para posible appeal
  Tiempo de resolución: variable, puede requerir appeal

NIVEL 4 — Número Disabled (ban)
  Síntomas: API devuelve error 131031, webhook DISABLED
  Impacto: número completamente bloqueado para envío
  Acción: appeal formal + evaluación de número de reemplazo
  Tiempo de resolución: 3–14 días si el appeal es exitoso
```

### Protocolo de respuesta a incidentes

**Incidente Nivel 1–2 (Yellow/Red):**
1. Pausar todas las campañas de marketing del número afectado (< 15 minutos).
2. Revisar los últimos 7 días de mensajes enviados: identificar campañas con block/report rate alto.
3. Pausar templates con mayor tasa de reporte.
4. Depurar la base de datos: eliminar usuarios sin respuesta en > 60 días.
5. Reducir volumen diario al 30% del máximo.
6. Monitorear quality diariamente.
7. Escalar gradualmente solo cuando quality vuelva a Green por 7 días consecutivos.

**Incidente Nivel 3–4 (Flagged/Disabled):**
1. Detener absolutamente todos los envíos del número (< 5 minutos).
2. Documentar: últimas 48h de envíos, templates usados, tasas de reporte, opt-ins de la base.
3. Activar número de contingencia si existe.
4. Preparar appeal con: descripción del caso de uso legítimo, evidencia de opt-ins, métricas de engagement positivo, plan de corrección específico.
5. Presentar appeal en: **business.facebook.com → Account Quality**.
6. Esperar respuesta (3–14 días hábiles). No intentar reenviar con el mismo número mientras dura el proceso.

### Plantilla de appeal efectivo

```
ESTRUCTURA DE APPEAL (en inglés, aumenta éxito):

Subject: Appeal for WhatsApp Business Account Restriction - [Phone Number]

1. BUSINESS DESCRIPTION (2–3 líneas)
"[Nombre] is a [tipo de negocio] serving [N] customers in [país].
We use WhatsApp Business API exclusively for [soporte/pedidos/notificaciones]."

2. REASON FOR CONTACT (específico)
"Our number [+57...] was flagged on [fecha]. We believe this occurred
due to [razón específica: a campaign that reached users who had opted in
via our website but had not engaged recently]."

3. CORRECTIVE ACTIONS TAKEN
- Removed [N] inactive users from our database
- Implemented double opt-in verification
- Reduced campaign frequency from [X] to [Y] per week
- Added real-time opt-out processing
- Increased personalization in all templates

4. OPT-IN EVIDENCE
"We have opt-in records with timestamps for all [N] contacts.
Available for review upon request."

5. COMMITMENT
"We are committed to providing value to our users and complying
with WhatsApp Business Policy."
```

---

## 9. Decisión: reutilizar, recuperar o reemplazar número

### Árbol de decisión

```
¿El número está activo pero con quality degradada?
│
├── Yellow → Pausa + corrección + recuperación gradual (NO cambiar)
└── Red → Pausa total 2 semanas + auditoría + recuperación (evaluar antes de cambiar)

¿El número fue Flagged (advertencia formal)?
│
├── Primera vez → Appeal + corrección + recuperación posible
└── Segunda vez en 6 meses → Evaluar seriamente el reemplazo

¿El número fue Disabled (ban)?
│
├── ¿Tienes el número (portabilidad)? 
│   ├── Sí → Appeal obligatorio antes de cualquier acción
│   └── No → Nuevo número + warm-up desde cero
├── ¿El appeal fue aprobado? 
│   ├── Sí → Reactivar con volumen reducido + monitoreo intensivo
│   └── No → Número nuevo + evaluar si mismo BM o nuevo BM
└── ¿Tiene historial de múltiples bans? → Número nuevo siempre
```

### Cuándo hacer appeal vs cuándo no

**Hacer appeal cuando:**
- El ban fue por quality (no por policy violation de contenido).
- Es el primer ban del número.
- Tienes evidencia sólida de opt-ins legítimos.
- El volumen enviado no era masivamente abusivo.
- Tienes un plan de corrección real y documentado.

**No hacer appeal (o esperar que sea rechazado) cuando:**
- Ya rechazaron el appeal anterior para ese mismo número.
- El ban fue por violación explícita de política de contenido (spam, phishing, contenido prohibido).
- El número tiene 2+ bans en menos de 6 meses.
- No tienes documentación de opt-ins.

### ¿Cambiar de Business Manager?

**Lo que cambia al usar otro BM:**
- Historial de la cuenta y activos publicitarios.
- Velocidad de aprobación de templates (BM nuevo = revisión más estricta).
- Posibles restricciones adicionales si el BM es nuevo (Meta es más cauteloso con BMs nuevos).

**Lo que NO cambia:**
- El historial del número de teléfono (Meta lo cruza por número, no por BM).
- Las restricciones sobre ese número específico.

**Cuándo tiene sentido otro BM:**
- Separar completamente dos líneas de negocio distintas con números distintos.
- Después de un incidente muy grave que afectó el health del BM completo.
- Nunca para intentar evadir restricciones sobre un número baneado.

---

## 10. Riesgos de infraestructura y contenido

### Números reciclados y SIMs usadas

**Riesgo nivel: ALTO**

Una SIM previamente usada en WhatsApp (personal o de otro negocio) puede tener:
- Bloqueos previos de otros usuarios.
- Asociación con cuentas reportadas.
- Historial de violaciones de política de otra persona u organización.

Meta no resetea el historial cuando el número migra a Business API. El número arrastra todo su pasado.

**Señales de que tienes un número con historial malo:**
- Quality Rating Yellow o Red desde el primer día sin haber enviado nada.
- Templates rechazados inusualmente rápido.
- Límite de mensajes ya reducido desde el inicio.
- Errores 131049 o 131031 inmediatamente al intentar enviar.

**Regla:** Usar siempre números nuevos directamente de operadoras. Si es imposible verificar el historial, hacer un warm-up ultra conservador (50 mensajes/día la primera semana) y monitorear quality antes de escalar.

### Dominios nuevos en templates

**Riesgo nivel: MEDIO-ALTO**

Un dominio registrado hace menos de 30 días en un link de template activa heurísticas de phishing en los sistemas de Meta y potencialmente en los dispositivos de los usuarios.

**Regla:** Mínimo 6 meses de antigüedad del dominio antes de usarlo en templates. Si el dominio es nuevo, usar un dominio establecido como redirect o acortador propio con dominio antiguo.

### Demasiados links

**Riesgo nivel: MEDIO**

- Más de 1 link por mensaje = señal de spam.
- El mismo link (sin variación) enviado a cientos de usuarios en minutos = detección de URL spam.

**Solución:**
- Máximo 1 link por mensaje.
- Usar parámetros UTM únicos por usuario: `?utm_source=whatsapp&utm_medium=campaign&uid={{user_id}}` — la URL es técnicamente diferente para cada destinatario.
- Considerar botones de URL en templates en lugar de links en el cuerpo del mensaje.

### Campañas agresivas

**Riesgo nivel: ALTO**

El tono importa tanto como el contenido. Mensajes con lenguaje de urgencia artificial, descuentos muy elevados presentados agresivamente o CTA directivos generan altas tasas de reporte incluso cuando el producto es completamente legítimo.

**El problema es de expectativa:** si el usuario no esperaba ese mensaje con ese tono, lo reporta aunque técnicamente le dio opt-in.

**Solución:** Piensa en cada mensaje de WhatsApp como un mensaje de un amigo que trabaja en la empresa, no como un banner publicitario. Conversacional > Publicitario.

---

## 11. Arquitectura anti-ban para SaaS

### Stack recomendado

```
┌─────────────────────────────────────────────────────────────┐
│  CAPA 1 — DATOS E IDENTIDAD                                 │
│                                                             │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐ │
│  │ CRM          │  │ Opt-in store  │  │ Suppression list │ │
│  │ (Contactos,  │  │ (Timestamp,   │  │ (Opt-outs,       │ │
│  │  historial,  │  │  fuente,      │  │  baneados,       │ │
│  │  segmentos)  │  │  consent text)│  │  inválidos)      │ │
│  └──────────────┘  └───────────────┘  └──────────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │ Trigger / Campaña
┌──────────────────────────────▼──────────────────────────────┐
│  CAPA 2 — LÓGICA Y AGENTE IA                                │
│                                                             │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐ │
│  │ IA Sales     │  │ Flow engine   │  │ Human handoff    │ │
│  │ Agent        │  │ (Ventas,      │  │ (CRM ticket +    │ │
│  │ (NLP + ctx)  │  │  soporte,     │  │  notif. asesor)  │ │
│  │              │  │  pedidos)     │  │                  │ │
│  └──────────────┘  └───────────────┘  └──────────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │ Mensajes a enviar
┌──────────────────────────────▼──────────────────────────────┐
│  CAPA 3 — CONTROL DE ENVÍO (crítica para anti-ban)          │
│                                                             │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐ │
│  │ Queue        │  │ Rate limiter  │  │ Scheduler        │ │
│  │ (Redis/Bull) │  │ (por número,  │  │ (TZ-aware,       │ │
│  │              │  │  adaptativo)  │  │  ventana 9–20h)  │ │
│  └──────────────┘  └───────────────┘  └──────────────────┘ │
│                                                             │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐ │
│  │ Número A     │  │ Número B      │  │ Número C         │ │
│  │ Transacc.    │  │ Marketing     │  │ Soporte          │ │
│  └──────────────┘  └───────────────┘  └──────────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │ API calls
┌──────────────────────────────▼──────────────────────────────┐
│  CAPA 4 — 360DIALOG                                         │
│                                                             │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐ │
│  │ Send API     │  │ Template mgr  │  │ Webhook ingest   │ │
│  │              │  │               │  │ (quality, msgs,  │ │
│  │              │  │               │  │  status, errors) │ │
│  └──────────────┘  └───────────────┘  └──────────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  CAPA 5 — META / WHATSAPP                                   │
│  Quality rating · Tier limits · Template review · Phone DB  │
└─────────────────────────────────────────────────────────────┘
```

### Segregación de números

| Número | Función | Tipo mensajes | Riesgo | Volumen típico |
|---|---|---|---|---|
| `+57_A` | Transaccional | Confirmaciones, alertas, notificaciones | Bajo | 500–5,000/día |
| `+57_B` | Marketing | Campañas, promociones, combos | Alto | 200–2,000/día (controlado) |
| `+57_C` | Soporte | Atención, quejas, bot de ventas reactivo | Bajo-Medio | Reactivo |
| `+57_D` | Bot outbound | Iniciativas de ventas, follow-ups | Medio | 100–500/día |

> **Regla crítica:** si `+57_B` (marketing) es degradado por una campaña agresiva, los otros números siguen operando normalmente. Nunca pongas en riesgo el número de soporte o transaccional con campañas.

### Queue configuration (BullMQ / Redis)

```typescript
import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis({ host: 'localhost', port: 6379 });

// Una queue por número de teléfono
function createPhoneQueue(phoneNumberId: string) {
  return new Queue(`whatsapp:${phoneNumberId}`, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 500,
    }
  });
}

// Worker con rate limiting integrado
function createWorker(phoneNumberId: string, tier: 1 | 2 | 3) {
  const ratePerMinute = { 1: 60, 2: 200, 3: 500 }[tier];
  
  return new Worker(
    `whatsapp:${phoneNumberId}`,
    async (job) => {
      // Delay aleatorio antes de cada envío
      const delay = Math.floor(Math.random() * (3000 - 800) + 800);
      await sleep(delay);
      return send360dialogMessage(phoneNumberId, job.data);
    },
    {
      connection,
      concurrency: 1, // Secuencial por número, nunca paralelo
      limiter: {
        max: ratePerMinute,
        duration: 60_000, // Por minuto
      }
    }
  );
}
```

### Webhook handler completo

```typescript
interface QualityUpdate {
  display_phone_number: string;
  event: 'FLAGGED' | 'RESTRICTED' | 'FUNCTIONAL' | 'BANNED';
  current_limit: string;
}

app.post('/webhook/360dialog', async (req, res) => {
  const body = req.body;
  
  // Mensajes entrantes (respuestas de usuarios)
  if (body.messages) {
    for (const msg of body.messages) {
      await handleIncomingMessage(msg);
      await updateEngagementMetrics(msg.from, 'response_received');
    }
  }
  
  // Estados de entrega
  if (body.statuses) {
    for (const status of body.statuses) {
      
      // Cambio de quality rating del número
      if (status.type === 'phone_number_quality_update') {
        const update = status as QualityUpdate;
        await handleQualityChange(update);
      }
      
      // Estado del mensaje individual
      if (['sent', 'delivered', 'read', 'failed'].includes(status.status)) {
        await updateMessageStatus(status.id, status.status);
        
        if (status.status === 'failed') {
          await handleSendError(status.errors?.[0]);
        }
      }
    }
  }
  
  res.sendStatus(200);
});

async function handleQualityChange(update: QualityUpdate) {
  const { display_phone_number, event } = update;
  
  const actions = {
    'FLAGGED': async () => {
      await pauseAllCampaigns(display_phone_number);
      await alertOpsTeam(`🟡 Número ${display_phone_number} FLAGGED`);
      await logIncident(display_phone_number, 'FLAGGED', 'LEVEL_3');
    },
    'RESTRICTED': async () => {
      await pauseAllCampaigns(display_phone_number);
      await alertOpsTeam(`🔴 Número ${display_phone_number} RESTRICTED`);
      await logIncident(display_phone_number, 'RESTRICTED', 'LEVEL_2');
    },
    'BANNED': async () => {
      await pauseAllCampaigns(display_phone_number);
      await activateContingencyNumber();
      await alertOpsTeam(`🚫 Número ${display_phone_number} BANNED — contingencia activada`);
      await logIncident(display_phone_number, 'BANNED', 'LEVEL_4');
    },
    'FUNCTIONAL': async () => {
      await logIncident(display_phone_number, 'FUNCTIONAL', 'RESOLVED');
      // No reactivar automáticamente. Requiere revisión manual.
    }
  };
  
  await actions[event]?.();
}
```

---

## 12. Referencia de errores de la API

### Errores más comunes y su manejo correcto

| Código | Nombre | Causa | Acción recomendada |
|---|---|---|---|
| `130429` | Rate limit hit | Superaste el límite de mensajes del tier | Pausar 60s, reducir rate 30%, reintentar |
| `131031` | Account restricted | Número baneado o restringido | Detener todo, iniciar proceso de appeal |
| `131047` | Re-engagement message not allowed | Intentar mensaje fuera de ventana 24h sin template | Usar template de marketing aprobado |
| `131048` | Spam rate limit hit | Tasa de spam detectada | Pausar 24h, revisar segmentación |
| `131049` | Message quality | Quality del número degradada | Reducir volumen, revisar templates |
| `131051` | Unsupported message type | Tipo de mensaje no soportado para ese número | Revisar capabilities del número |
| `132000` | Template not found | Template ID incorrecto o no aprobado | Verificar template ID en 360dialog |
| `132001` | Template hydration error | Variables del template incorrectas | Validar estructura de variables |
| `132007` | Template parameters missing | Faltan parámetros requeridos | Revisar cantidad de variables del template |
| `80007` | Account not found | WABA ID o Phone ID incorrecto | Verificar credenciales en 360dialog |

### Manejo de errores en código

```typescript
async function handleSendError(error: { code: number; title: string }) {
  const { code } = error;
  
  // Rate limit — backoff exponencial
  if (code === 130429) {
    await currentQueue.pause();
    await sleep(60_000);
    currentRate = Math.max(20, currentRate * 0.7);
    await currentQueue.resume();
    return;
  }
  
  // Número restringido o baneado — detener todo
  if ([131031, 131048].includes(code)) {
    await pauseAllOperations();
    await alertOpsTeam(`CRÍTICO: Error ${code} — operaciones detenidas`);
    return;
  }
  
  // Quality degradada — reducir volumen
  if (code === 131049) {
    currentRate = Math.max(30, currentRate * 0.6);
    await alertOpsTeam(`WARNING: Quality degradada — rate reducido a ${currentRate}/min`);
    return;
  }
  
  // Errores de template — no reintentar, loggear para revisión
  if ([132000, 132001, 132007].includes(code)) {
    await logTemplateError(error);
    return; // No reintentar
  }
  
  // Error genérico — reintentar con backoff
  throw new Error(`Send error ${code}: ${error.title}`);
}
```

---

## 13. Implementación técnica: código de producción

### Rate limiter adaptativo completo

```typescript
class AdaptiveRateLimiter {
  private currentRate: number;
  private blockRateWindow: number[] = [];
  private readonly minRate = 10;
  
  constructor(
    private phoneNumberId: string,
    private tier: 1 | 2 | 3 = 1
  ) {
    const maxRates = { 1: 60, 2: 200, 3: 500 };
    this.currentRate = maxRates[tier] * 0.8; // Arrancar al 80%
  }

  // Llamar después de cada envío con el resultado
  async recordResult(blocked: boolean) {
    this.blockRateWindow.push(blocked ? 1 : 0);
    
    // Ventana deslizante de los últimos 100 envíos
    if (this.blockRateWindow.length > 100) {
      this.blockRateWindow.shift();
    }
    
    const blockRate = this.blockRateWindow.reduce((a, b) => a + b, 0) / 
                      this.blockRateWindow.length;
    
    // Si block rate sube, reducir velocidad proporcionalmente
    if (blockRate > 0.02) {       // > 2%
      this.currentRate = Math.max(this.minRate, this.currentRate * 0.5);
      await this.alert('block_rate_critical', blockRate);
    } else if (blockRate > 0.01) { // > 1%
      this.currentRate = Math.max(this.minRate, this.currentRate * 0.75);
      await this.alert('block_rate_warning', blockRate);
    } else if (blockRate < 0.005 && this.blockRateWindow.length >= 50) {
      // Si el block rate es muy bajo, recuperar velocidad gradualmente
      const maxRate = { 1: 60, 2: 200, 3: 500 }[this.tier];
      this.currentRate = Math.min(maxRate, this.currentRate * 1.05);
    }
  }

  getDelay(): number {
    // ms entre mensajes basado en el rate actual + jitter
    const baseDelay = (60_000 / this.currentRate);
    const jitter = baseDelay * 0.3 * (Math.random() * 2 - 1); // ±30%
    return Math.max(800, baseDelay + jitter);
  }
  
  private async alert(type: string, value: number) {
    console.warn(`[RateLimiter] ${this.phoneNumberId}: ${type} = ${(value * 100).toFixed(2)}% | rate → ${this.currentRate}/min`);
    // Enviar a tu sistema de alertas (Slack, PagerDuty, etc.)
  }
}
```

### Suppression list con TTL

```typescript
class SuppressionList {
  private redis: Redis;
  private readonly KEY_PREFIX = 'suppress:wa:';
  
  // TTL por tipo de supresión
  private readonly TTL = {
    opt_out: 0,           // Permanente (sin TTL)
    spam_complaint: 0,    // Permanente
    bounced: 30 * 86400,  // 30 días
    cooling: 7 * 86400,   // 7 días (enfriamiento voluntario)
  };
  
  async add(phone: string, reason: keyof typeof this.TTL) {
    const key = this.KEY_PREFIX + phone;
    const ttl = this.TTL[reason];
    
    if (ttl === 0) {
      await this.redis.set(key, reason); // Sin TTL = permanente
    } else {
      await this.redis.setex(key, ttl, reason);
    }
    
    await this.logSuppressionEvent(phone, reason);
  }
  
  async isSuppressed(phone: string): Promise<boolean> {
    return (await this.redis.exists(this.KEY_PREFIX + phone)) === 1;
  }
  
  async checkBeforeSend(phones: string[]): Promise<string[]> {
    // Filtrar masivamente antes de encolar
    const pipeline = this.redis.pipeline();
    phones.forEach(p => pipeline.exists(this.KEY_PREFIX + p));
    const results = await pipeline.exec();
    return phones.filter((_, i) => results![i][1] === 0);
  }
}
```

### Scheduler con zona horaria

```typescript
import { getTimezone } from 'countries-and-timezones';

const COUNTRY_CODE_MAP: Record<string, string> = {
  '57': 'CO',  '52': 'MX',  '54': 'AR',  '55': 'BR',
  '51': 'PE',  '56': 'CL',  '58': 'VE',  '593': 'EC',
  '34': 'ES',  '1': 'US',
};

class TZAwareScheduler {
  canSendToNumber(phone: string, windowStart = 9, windowEnd = 20): boolean {
    const countryCode = this.getCountryCode(phone);
    const country = COUNTRY_CODE_MAP[countryCode];
    if (!country) return true; // Si no se puede inferir, asumir OK
    
    const tzData = getTimezone(country);
    if (!tzData) return true;
    
    const localHour = new Date().toLocaleString('en-US', {
      timeZone: tzData.name,
      hour: 'numeric',
      hour12: false
    });
    
    const hour = parseInt(localHour);
    return hour >= windowStart && hour < windowEnd;
  }
  
  private getCountryCode(phone: string): string {
    // Normalizar número y extraer código de país
    const normalized = phone.replace(/\D/g, '');
    // Probar desde el código más largo (3 dígitos) al más corto (1 dígito)
    for (const len of [3, 2, 1]) {
      const code = normalized.substring(0, len);
      if (COUNTRY_CODE_MAP[code]) return code;
    }
    return '57'; // Default Colombia
  }
}
```

---

## 14. Restaurante / comidas rápidas: guía específica

### Caso de uso: hamburguesas, carne asada, combos, domicilios

#### Arquitectura de números para restaurante

| Número | Nombre en BM | Función | Volumen diario |
|---|---|---|---|
| `+57_pedidos` | "[Marca] Pedidos" | Confirmaciones, estados, calificaciones | 100–1,000 |
| `+57_promos` | "[Marca] Promos" | Combos semanales, ofertas especiales | 200–2,000 (2×/semana) |
| `+57_soporte` | "[Marca] Soporte" | Quejas, cambios, domicilio tardío | Reactivo |

#### Templates aprobados — biblioteca completa

**1. Template: confirmación de pedido (transaccional)**
```
Categoría: UTILITY
Nombre: order_confirmation_v1

Hola {{1}}, tu pedido está confirmado 🎉
📋 Pedido #{{2}}
🍔 {{3}}
💰 Total: ${{4}}
⏱️ Listo en: {{5}} minutos

¿Algún cambio o nota especial? Escríbenos aquí.
```

**2. Template: pedido en camino (transaccional)**
```
Categoría: UTILITY
Nombre: order_on_the_way_v1

{{1}}, tu pedido #{{2}} está en camino 🛵
📍 Domiciliario: {{3}}
⏱️ Llega en aproximadamente {{4}} minutos

¿Tienes alguna indicación de entrega?
```

**3. Template: solicitud de calificación (transaccional)**
```
Categoría: UTILITY
Nombre: order_rating_request_v1

{{1}}, ¿cómo estuvo tu pedido #{{2}}? 🙌
Nos ayuda mucho saber tu opinión.

[Botón: ⭐ Calificar] [Botón: 📞 Tuve un problema]
```

**4. Template: combo semanal (marketing)**
```
Categoría: MARKETING
Nombre: weekly_combo_v1
Header: Imagen del combo

{{1}}, esta semana te tenemos algo especial 👀
🍔 {{2}}
💥 Precio especial: ${{3}}
📅 Válido {{4}}

¿Lo pedimos? 👇
[Botón: ✅ Sí, lo quiero] [Botón: 📋 Ver menú completo]
```

**5. Template: reactivación de cliente inactivo (marketing)**
```
Categoría: MARKETING
Nombre: winback_v1

{{1}}, hace rato no te vemos 🥺
La última vez pediste {{2}} y quedó delicioso.
Esta semana tenemos {{3}} que te puede gustar.

¿Volvemos a lo bueno? 🔥
[Botón: 🍔 Pedir ahora] [Botón: ❌ No gracias]
```

**6. Template: oferta de cumpleaños (marketing)**
```
Categoría: MARKETING
Nombre: birthday_offer_v1

¡Feliz cumpleaños {{1}}! 🎂
En [Marca] queremos celebrar contigo.
Hoy tienes {{2}} de regalo en tu próximo pedido.

¿Lo usamos hoy?
[Botón: 🎁 Reclamar regalo]
```

#### Flujo completo del agente IA para pedidos

```
PASO 1 — ENTRADA (usuario escribe por primera vez)
  Bot: "¡Hola {{nombre}}! Soy el asistente de [Marca] 🍔
        ¿Qué se te antoja hoy?"
        [Botón: 📋 Ver menú] [Botón: 🔥 Combos del día] [Botón: ♻️ Repetir último pedido]

PASO 2 — SELECCIÓN
  Si elige menú → Bot muestra categorías → Usuario elige → Bot muestra items
  Si elige combo → Bot muestra combos disponibles con precio
  Si elige repetir → Bot muestra último pedido con opción de confirmar directo

PASO 3 — PERSONALIZACIÓN
  Bot: "¿Algo especial en tu {{producto}}?"
        [Botón: Sin cebolla] [Botón: Extra salsa] [Botón: Así está perfecto]

PASO 4 — DIRECCIÓN Y DATOS
  Si nuevo cliente:
    Bot: "¿A dónde te lo llevamos? Escríbenos la dirección completa."
  Si cliente recurrente:
    Bot: "¿Llevamos a {{dirección guardada}}?"
        [Botón: ✅ Sí, esa dirección] [Botón: 📍 Otra dirección]

PASO 5 — CONFIRMACIÓN Y PAGO
  Bot: "Resumen de tu pedido:
        🍔 {{items}}
        📍 {{dirección}}
        💰 Total: ${{total}}
        ⏱️ Tiempo estimado: {{tiempo}} min
        
        ¿Confirmamos?"
        [Botón: ✅ Confirmar] [Botón: ✏️ Modificar]

PASO 6 — POST-CONFIRMACIÓN
  → Bot registra en sistema
  → Envía template transaccional de confirmación
  → 5 min antes de llegada: envía template "en camino"
  → 10 min después de entrega estimada: envía template de calificación

PASO 7 — ESCALADA
  Triggers de escalada a humano:
  - Usuario dice "queja", "tardó mucho", "llegó frío", "equivocado"
  - Pago no procesado después de 2 intentos
  - Dirección no reconocida por el sistema
  - Usuario pregunta por descuento especial no disponible en el bot
```

#### Calendario de campañas semanal para restaurante

| Día | Hora | Campaña | Template | Segmento | Mensaje |
|---|---|---|---|---|---|
| Lunes | 11:30am | Combo inicio de semana | `weekly_combo_v1` | Activos últimos 30 días | Combo lunes especial |
| Miércoles | 12:00pm | Promo mitad de semana | `weekly_combo_v1` | Activos últimos 14 días | Descuento de miércoles |
| Viernes | 5:00pm | Especial fin de semana | `weekly_combo_v1` | Todos los activos | Combo viernes noche |
| Domingo | 11:00am | Menú del domingo | `weekly_combo_v1` | Clientes frecuentes (3+ pedidos) | Almuerzo especial de domingo |
| Cumpleaños | 9:00am | Regalo cumpleaños | `birthday_offer_v1` | Cumpleañeros del día | Oferta personalizada |
| Reactivación | Martes 10am | Win-back | `winback_v1` | Inactivos 45–90 días | Última vez pidió X |

> **Máximo recomendado:** no más de 3 campañas a la misma persona en una semana. Filtrar duplicados entre segmentos.

#### KPIs para restaurante en WhatsApp

| KPI | Fórmula | Excelente | Bueno | Alerta |
|---|---|---|---|---|
| Tasa de respuesta a campañas | Respuestas / enviados | > 20% | 12–20% | < 8% |
| Tasa de conversión a pedido | Pedidos / respuestas | > 30% | 15–30% | < 10% |
| Ticket promedio WhatsApp vs otros canales | Ticket WA / ticket otro canal | > 1.2× | 1× | < 0.8× |
| Tiempo de cierre de pedido | Desde primer mensaje a confirmación | < 4 min | 4–10 min | > 15 min |
| Tasa de repetición | Clientes que vuelven en 30 días | > 40% | 25–40% | < 20% |
| Block rate campaña | Bloqueos / enviados | < 0.3% | 0.3–0.7% | > 1% |
| CSAT calificación pedido | Puntuación promedio (1–5) | > 4.5 | 4–4.5 | < 3.5 |

#### Buenas prácticas específicas para restaurante

**Horarios de mayor conversión:**
- Almuerzo: 11:15am–12:30pm (enviar 15–20 min antes del pico de decisión)
- Cena: 5:30pm–7:00pm (enviar antes de que decidan qué pedir)
- Fin de semana: sábado y domingo 10:30am–12:00pm (almuerzos familiares)

**Evitar siempre:**
- Enviar mensajes de comida entre 2pm–4pm (digestión, baja conversión, más reportes).
- Enviar campañas después de las 8pm (interfiere con el descanso, alta tasa de bloqueo).
- Enviar el mismo combo 2 semanas seguidas (baja el CTR y sube los opt-outs).

**Templates con imagen (media templates):**
- Un template con imagen del producto tiene 35–50% más CTR que texto solo.
- Usar imágenes de alta calidad (mínimo 800×800px, < 5MB, JPG o PNG).
- Actualizar la imagen cada 2–3 semanas para mantener frescura.
- La imagen debe mostrar el producto específico del template, no una imagen genérica de la marca.

**Personalización avanzada para restaurante:**
```
Variables que debes tener en el CRM por cliente:
- {{nombre}}           → Personalización básica
- {{ultimo_pedido}}    → "La última vez pediste..."
- {{producto_favorito}} → Inferido de historial de pedidos
- {{frecuencia}}       → Cliente frecuente / nuevo / inactivo
- {{descuento_acum}}   → Si tienes sistema de puntos/acumulados
- {{dia_cumple}}       → Para template de cumpleaños
```

---

## Checklist operacional semanal

### Cada lunes

- [ ] Revisar quality rating de todos los números en Meta Business Suite
- [ ] Revisar block rate y report rate de la semana anterior por número
- [ ] Revisar template quality en Meta Business Suite
- [ ] Depurar base: marcar como "cooling" usuarios que bloquearon la semana pasada
- [ ] Planificar campañas de la semana con volumen calculado (≤ 50% del tier)
- [ ] Verificar que suppression list está sincronizada con el CRM

### Antes de cada campaña

- [ ] Filtrar suppression list de la base de envío
- [ ] Verificar opt-in con fecha reciente (≤ 90 días para inactivos)
- [ ] Confirmar que el template tiene quality score verde en Meta
- [ ] Calcular el volumen y verificar que no excede el 50% del tier diario
- [ ] Confirmar que el scheduler respeta TZ del destinatario
- [ ] Activar monitoring en tiempo real durante el envío
- [ ] Definir umbral de pausa automática (si block rate > 1%, detener)

### Después de cada campaña

- [ ] Registrar métricas en dashboard: enviados, entregados, leídos, respondidos, bloqueados
- [ ] Actualizar CRM con nuevos opt-outs y bloqueos
- [ ] Revisar quality rating del número de campaña
- [ ] Evaluar si el template se puede mejorar para la próxima vez

---

## Recursos oficiales

| Recurso | URL |
|---|---|
| Políticas de Mensajería de Meta | [developers.facebook.com/docs/whatsapp/overview/business-messaging-policy](https://developers.facebook.com/docs/whatsapp/overview/business-messaging-policy) |
| Límites de mensajes y tiers | [developers.facebook.com/docs/whatsapp/messaging-limits](https://developers.facebook.com/docs/whatsapp/messaging-limits) |
| 360dialog Docs — Calidad del canal | [docs.360dialog.com/whatsapp-api/whatsapp-api/quality](https://docs.360dialog.com/whatsapp-api/whatsapp-api/quality) |
| Meta Account Quality Dashboard | [business.facebook.com/accountquality](https://business.facebook.com/accountquality) |
| Guía de templates de Meta | [developers.facebook.com/docs/whatsapp/message-templates/guidelines](https://developers.facebook.com/docs/whatsapp/message-templates/guidelines) |
| Códigos de error de WhatsApp API | [developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes) |
| 360dialog API Reference | [docs.360dialog.com](https://docs.360dialog.com) |

---

*Versión 2.0 — Mayo 2026 — Uso interno SaaS*
*Reemplaza a v1.0 del mismo documento.*
