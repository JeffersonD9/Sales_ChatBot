'use strict';

/**
 * flows/sales-v1/engine.js — Flujo de ventas retail (catálogo + pedidos)
 *
 * Uso: registrado en flows/index.js como 'sales_v1' (default).
 * Soporta tenants de ropa/retail con catálogo filtrable por talla y presupuesto.
 */

const { STEP }                      = require('@whatsapp-saas/shared-utils');
const { extractInput }              = require('../../whatsapp/parser');
const { sendText, sendInteractiveButtons } = require('../../whatsapp/sender');
const { sendMainMenu, handleMenu }  = require('./steps/menu');
const {
  handleTalla,
  handlePresupuesto,
  handleDecisionProducto,
  handleProductSelection,
  handleObjecion,
  handleAlternativas,
} = require('./steps/catalog');
const {
  handleOrderName,
  handleOrderAddress,
  handleOrderPayment,
  handleCheckOrder,
} = require('./steps/order');
const { handleWithAI }              = require('../../ai/client');
const { transcribe, FALLBACK_MSG: AUDIO_FALLBACK } = require('../../../../ai-orchestrator/core/audioTranscriber');
const { analyze,    FALLBACK_MSG: IMAGE_FALLBACK } = require('../../../../ai-orchestrator/core/imageAnalyzer');
const { check: checkEscalation }    = require('../../../../ai-orchestrator/core/escalationDetector');

const PREMIUM_PLANS = new Set(['premium', 'enterprise']);

const GLOBAL_RESET_CMDS = new Set(['menu', 'menú', 'inicio', 'hola', 'hi', 'start', '0']);

async function processMessage(phone, rawMsg, session, tenant, notifier) {
  const parsed  = extractInput(rawMsg);
  let { type, text, interactiveId } = parsed;
  const isPremium = PREMIUM_PLANS.has(tenant.plan);

  // ── Audio: transcribir con Whisper y continuar como texto ──────────────────
  if (type === 'audio') {
    if (!isPremium) {
      await sendText(phone, '📱 Solo proceso mensajes de texto y botones. Usa el menú principal:', tenant);
      await sendMainMenu(phone, session, tenant);
      return;
    }
    const transcript = await transcribe(tenant, parsed.mediaId);
    if (!transcript) {
      await sendText(phone, AUDIO_FALLBACK, tenant);
      return;
    }
    type = 'text';
    text = transcript;
  }

  // ── Imagen: analizar con Claude Vision y derivar al AI handler ─────────────
  if (type === 'image') {
    if (!isPremium) {
      await sendText(phone, '📱 Solo proceso mensajes de texto y botones. Usa el menú principal:', tenant);
      await sendMainMenu(phone, session, tenant);
      return;
    }
    const description = await analyze(tenant, parsed.mediaId, parsed.mimeType);
    if (!description) {
      await sendText(phone, IMAGE_FALLBACK, tenant);
      return;
    }
    const aiText  = `[El cliente envió una foto de un producto similar:] ${description}`;
    const aiReply = await handleWithAI(phone, aiText, session, tenant);
    await sendText(phone, aiReply || IMAGE_FALLBACK, tenant);
    return;
  }

  if (type === 'unsupported') {
    await sendText(phone, '📱 Solo proceso mensajes de texto y botones. Usa el menú principal:', tenant);
    await sendMainMenu(phone, session, tenant);
    return;
  }

  const txt = text.toLowerCase().trim();
  const id  = interactiveId;

  if (GLOBAL_RESET_CMDS.has(txt)) {
    await sendMainMenu(phone, session, tenant);
    return;
  }

  switch (session.step) {
    case STEP.NEW:
    case STEP.MENU: {
      const handled = await handleMenu(phone, session, txt, id, tenant, notifier);
      if (handled === false) {
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
      }
      break;
    }

    case STEP.CATALOG_TALLA:
      await handleTalla(phone, session, txt, id, tenant);
      break;

    case STEP.CATALOG_PRESUPUESTO:
      await handlePresupuesto(phone, session, txt, tenant, notifier);
      break;

    case STEP.CATALOG_SHOWING: {
      const handled = await handleDecisionProducto(phone, session, txt, id, tenant, notifier);
      if (handled === false) {
        if (isPremium) {
          const aiReply = await handleWithAI(phone, text, session, tenant);
          if (aiReply) {
            await sendText(phone, aiReply, tenant);
            const escalationMsg = await checkEscalation(tenant, session, phone, text);
            if (escalationMsg) await sendText(phone, escalationMsg, tenant);
          } else {
            await sendText(phone, '¿Qué decides? Usa los botones o escribe *sí*, *duda* o *no*.', tenant);
          }
        } else {
          await sendInteractiveButtons(
            phone,
            '¡No entendí bien lo que me dijiste! 😅\n\n¿Qué quieres hacer con el producto que te mostré?',
            [
              { id: 'DEC_SI',   title: '✅ Sí, lo aparto'    },
              { id: 'DEC_DUDA', title: '🤔 Tengo una duda'   },
              { id: 'DEC_NO',   title: '❌ No me convenció'  },
            ],
            tenant
          );
        }
      }
      break;
    }

    case STEP.CATALOG_SELECTING:
      await handleProductSelection(phone, session, txt, tenant);
      break;

    case STEP.CATALOG_OBJECTION:
      await handleObjecion(phone, session, txt, id, tenant);
      break;

    case STEP.CATALOG_ALTERNATIVES:
      await handleAlternativas(phone, session, txt, id, tenant, notifier);
      break;

    case STEP.ORDER_NAME:
      await handleOrderName(phone, session, txt, tenant);
      break;

    case STEP.ORDER_ADDRESS:
      await handleOrderAddress(phone, session, txt, tenant);
      break;

    case STEP.ORDER_PAYMENT:
      await handleOrderPayment(phone, session, txt, tenant, notifier);
      break;

    case STEP.CHECK_ORDER:
      await handleCheckOrder(phone, session, txt, tenant);
      break;

    default:
      await sendMainMenu(phone, session, tenant);
  }
}

module.exports = { processMessage };
