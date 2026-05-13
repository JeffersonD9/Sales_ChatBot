'use strict';

/**
 * flows/custom/mayoristas/engine.js — Flujo para clientes mayoristas
 *
 * Activa con: bot_config.flow_type = "mayoristas"
 *
 * Diferencias respecto a sales_v1:
 *   - Menú orientado a pedidos por volumen (mínimos, listas de precio, despacho)
 *   - Sin filtro talla/presupuesto — el cliente maneja un catálogo de referencias
 *   - Solicitud de asesor es el CTA principal
 *   - AI disponible en plan premium para resolver dudas de referencias y precios
 */

const { STEP }                          = require('@whatsapp-saas/shared-utils');
const { extractInput }                  = require('../../../whatsapp/parser');
const { sendText, sendInteractiveList, sendInteractiveButtons } = require('../../../whatsapp/sender');
const { handleWithAI }                  = require('../../../ai/client');
const { check: checkEscalation }        = require('../../../../../ai-orchestrator/core/escalationDetector');

const PREMIUM_PLANS   = new Set(['premium', 'enterprise']);
const GLOBAL_RESET    = new Set(['menu', 'menú', 'inicio', 'hola', 'hi', 'start', '0']);

// ── Menú principal ────────────────────────────────────────────────────────

async function sendMainMenu(phone, session, tenant) {
  session.step        = STEP.MENU;
  const storeName     = tenant.bot_config?.business_name || tenant.name;
  const greeting      = session.data?.name
    ? `¡Hola de nuevo, ${session.data.name}! 👋`
    : `¡Hola! Bienvenido(a) a *${storeName}* 🏭`;

  await sendInteractiveList(
    phone,
    `${greeting}\n\nSoy tu asistente de ventas al por mayor. ¿En qué te ayudo?`,
    'Ver opciones',
    [
      {
        title: 'Menú mayorista',
        rows: [
          { id: 'MAY_CATALOGO',  title: '📋 Catálogo y precios',  description: 'Lista de referencias y precios por volumen' },
          { id: 'MAY_PEDIDO',    title: '📦 Hacer un pedido',      description: 'Inicia un pedido al por mayor' },
          { id: 'MAY_MINIMOS',   title: '📊 Mínimos y despacho',   description: 'Cantidades mínimas y tiempos de entrega' },
          { id: 'MAY_ASESOR',    title: '💬 Hablar con asesor',    description: 'Te conectamos con un ejecutivo' },
        ],
      },
    ],
    tenant
  );
}

// ── Dispatcher principal ──────────────────────────────────────────────────

async function processMessage(phone, rawMsg, session, tenant, notifier) {
  const parsed = extractInput(rawMsg);
  let { type, text, interactiveId } = parsed;
  const isPremium = PREMIUM_PLANS.has(tenant.plan);

  if (type === 'audio' || type === 'image' || type === 'unsupported') {
    await sendText(phone, '📱 Solo proceso mensajes de texto y botones. Usa el menú principal:', tenant);
    await sendMainMenu(phone, session, tenant);
    return;
  }

  const txt = text.toLowerCase().trim();
  const id  = interactiveId;

  if (GLOBAL_RESET.has(txt)) {
    await sendMainMenu(phone, session, tenant);
    return;
  }

  // ── Menú / estado inicial ─────────────────────────────────────────────
  if (session.step === STEP.NEW || session.step === STEP.MENU) {
    const opt = id || txt;

    if (opt === 'MAY_CATALOGO' || txt.includes('catálog') || txt.includes('precio') || txt === '1') {
      await sendText(phone,
        `📋 *Catálogo mayorista*\n\n` +
        `Para recibir nuestra lista de precios actualizada con referencias y ` +
        `precios por volumen, escríbenos tu correo o pídele a un asesor que te la envíe.\n\n` +
        `También puedes escribir *asesor* para que un ejecutivo te atienda de inmediato.`,
        tenant
      );
      session.step = STEP.MENU;
      return;
    }

    if (opt === 'MAY_PEDIDO' || txt.includes('pedido') || txt.includes('orden') || txt === '2') {
      session.step = STEP.ORDER_NAME;
      await sendText(phone,
        `📦 Vamos a registrar tu pedido.\n\n*¿Cuál es tu nombre o razón social?*`,
        tenant
      );
      return;
    }

    if (opt === 'MAY_MINIMOS' || txt.includes('mínimo') || txt.includes('minimo') || txt.includes('despacho') || txt === '3') {
      await sendText(phone,
        `📊 *Condiciones mayoristas:*\n\n` +
        `• Pedido mínimo: *12 unidades* por referencia\n` +
        `• Despacho: lunes y jueves cada semana\n` +
        `• Tiempo de entrega: 2–5 días hábiles a nivel nacional\n` +
        `• Pago: transferencia anticipada o contraentrega con cupo aprobado\n\n` +
        `¿Tienes alguna pregunta? Escribe *asesor* para hablar con nosotros.`,
        tenant
      );
      session.step = STEP.MENU;
      return;
    }

    if (opt === 'MAY_ASESOR' || txt.includes('asesor') || txt.includes('ejecutivo') || txt.includes('persona') || txt === '4') {
      await sendText(phone,
        `✅ Perfecto, avisaré a un ejecutivo de cuenta.\n\n` +
        `Te contactarán en breve en horario comercial (Lun–Vie 8am–6pm). 🕘`,
        tenant
      );
      setImmediate(() => notifier.notifyAdvisorRequest(phone, tenant));
      session.step = STEP.MENU;
      return;
    }

    // Input libre — intentar con AI si es premium, sino guiar al menú
    if (isPremium) {
      const aiReply = await handleWithAI(phone, text, session, tenant);
      if (aiReply) {
        await sendText(phone, aiReply, tenant);
        const escalationMsg = await checkEscalation(tenant, session, phone, text);
        if (escalationMsg) await sendText(phone, escalationMsg, tenant);
      } else {
        await sendText(phone, '🤔 No entendí esa opción. Usa el menú:', tenant);
        await sendMainMenu(phone, session, tenant);
      }
    } else {
      await sendText(phone,
        '¡Mmm, no entendí lo que me escribiste! 😊\n\n' +
        'Escoge una de las opciones del menú para que pueda ayudarte 👇',
        tenant
      );
      await sendMainMenu(phone, session, tenant);
    }
    return;
  }

  // ── ORDER_NAME: nombre/razón social ──────────────────────────────────
  if (session.step === STEP.ORDER_NAME) {
    if (txt.length < 3) {
      await sendText(phone, 'Por favor escribe tu nombre completo o razón social:', tenant);
      return;
    }
    session.data.name = text.trim();
    session.step      = STEP.ORDER_ADDRESS;
    await sendText(phone,
      `Gracias, *${session.data.name}* 😊\n\n` +
      `*¿Cuál es la dirección de entrega?*\n_Ciudad, departamento_`,
      tenant
    );
    return;
  }

  // ── ORDER_ADDRESS: dirección ──────────────────────────────────────────
  if (session.step === STEP.ORDER_ADDRESS) {
    if (txt.length < 5) {
      await sendText(phone, 'Por favor escribe la dirección completa (ciudad, barrio, departamento):', tenant);
      return;
    }
    session.data.address = text.trim();
    session.step         = STEP.ORDER_PAYMENT;
    await sendInteractiveButtons(phone,
      `📍 Dirección anotada.\n\n*¿Cómo va a pagar?*`,
      [
        { id: 'PAY_TRANSFERENCIA', title: '🏦 Transferencia'      },
        { id: 'PAY_CONTRAENTREGA', title: '💵 Contraentrega (cupo)' },
        { id: 'PAY_CREDITO',       title: '📝 Crédito aprobado'   },
      ],
      tenant
    );
    return;
  }

  // ── ORDER_PAYMENT: confirmar y notificar ──────────────────────────────
  if (session.step === STEP.ORDER_PAYMENT) {
    const paymentMap = {
      PAY_TRANSFERENCIA: 'Transferencia bancaria',
      PAY_CONTRAENTREGA: 'Contraentrega con cupo',
      PAY_CREDITO:       'Crédito aprobado',
    };
    session.data.payment = paymentMap[id] || text.trim();

    await sendText(phone,
      `✅ *Solicitud de pedido registrada*\n\n` +
      `👤 Cliente: ${session.data.name}\n` +
      `📍 Dirección: ${session.data.address}\n` +
      `💳 Pago: ${session.data.payment}\n\n` +
      `Un ejecutivo confirmará las referencias, cantidades y fecha de despacho. ` +
      `Te contactaremos en horario comercial. 📲`,
      tenant
    );

    setImmediate(() => notifier.notifySale(phone, session.data, tenant));

    const name       = session.data.name;
    session.data     = { name };
    session.step     = STEP.MENU;

    await sendText(phone, '¿Hay algo más en lo que te pueda ayudar? Escribe *menú*. 😊', tenant);
    return;
  }

  // Fallback general
  await sendMainMenu(phone, session, tenant);
}

module.exports = { processMessage };
