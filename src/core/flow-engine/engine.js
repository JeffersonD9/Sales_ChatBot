/**
 * core/flow-engine/engine.js — Orquestador del flujo de conversación
 *
 * Migrado de flowService.js. Cambios clave:
 *   - Recibe `tenant` y `notifier` como dependencias inyectadas
 *   - Sin imports de process.env
 *   - Comandos globales de reset siguen en la misma posición
 *
 * Responsabilidad única: enrutar mensajes al step handler correcto.
 * Toda la lógica de negocio sigue en steps/.
 */

const { STEP }                      = require('../../utils/constants');
const { extractInput }              = require('../whatsapp/parser');
const { sendText }                  = require('../whatsapp/sender');
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
const { handleWithAI }              = require('../ai/aiHandler');

const GLOBAL_RESET_CMDS = new Set(['menu', 'menú', 'inicio', 'hola', 'hi', 'start', '0']);

/**
 * Procesa un mensaje entrante y despacha al handler correcto.
 *
 * @param {string} phone      - Número del remitente (waFrom)
 * @param {object} rawMsg     - Mensaje crudo de Meta API
 * @param {object} session    - Estado actual de la conversación (mutable)
 * @param {object} tenant     - Configuración del tenant (wa_token, products, bot_config...)
 * @param {object} notifier   - Módulo de notificaciones al dueño
 */
async function processMessage(phone, rawMsg, session, tenant, notifier) {
  const { type, text, interactiveId } = extractInput(rawMsg);

  if (type === 'unsupported') {
    await sendText(phone, '📱 Solo proceso mensajes de texto y botones. Usa el menú principal:', tenant);
    await sendMainMenu(phone, session, tenant);
    return;
  }

  const txt = text.toLowerCase().trim();
  const id  = interactiveId;

  // Comando global → volver al menú desde cualquier punto
  if (GLOBAL_RESET_CMDS.has(txt)) {
    await sendMainMenu(phone, session, tenant);
    return;
  }

  switch (session.step) {
    case STEP.NEW:
    case STEP.MENU: {
      // Punto 1: si handleMenu no reconoce la entrada, intentar con IA
      const handled = await handleMenu(phone, session, txt, id, tenant, notifier);
      if (handled === false) {
        const aiReply = await handleWithAI(phone, text, session, tenant);
        if (aiReply) {
          await sendText(phone, aiReply, tenant);
        } else {
          await sendText(phone, '🤔 No entendí esa opción. Usa el menú:', tenant);
          await sendMainMenu(phone, session, tenant);
        }
      }
      break;
    }

    case STEP.CATALOG_TALLA:
      await handleTalla(phone, session, txt, tenant);
      break;

    case STEP.CATALOG_PRESUPUESTO:
      await handlePresupuesto(phone, session, txt, tenant, notifier);
      break;

    case STEP.CATALOG_SHOWING: {
      // Punto 2: si el cliente escribe algo que no es una decisión válida, intentar con IA
      const handled = await handleDecisionProducto(phone, session, txt, id, tenant, notifier);
      if (handled === false) {
        const aiReply = await handleWithAI(phone, text, session, tenant);
        if (aiReply) {
          await sendText(phone, aiReply, tenant);
        } else {
          await sendText(phone, '¿Qué decides? Usa los botones o escribe *sí*, *duda* o *no*.', tenant);
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

/**
 * Envía mensajes de reactivación a usuarios inactivos de un tenant.
 * Llamado desde server.js cada hora.
 *
 * @param {object} tenant
 * @param {Function} getActiveSessions - de core/state/manager.js
 * @param {Function} saveState         - de core/state/manager.js
 */
async function checkReactivations(tenant, getActiveSessions, saveState) {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const sessions      = getActiveSessions(tenant.slug);
  const storeName     = tenant.bot_config?.business_name || tenant.name;
  let count           = 0;

  for (const session of sessions) {
    const hadInteraction = session.step && session.step !== STEP.NEW;
    const isInactive     = session.lastActivity && session.lastActivity < thirtyDaysAgo;

    if (hadInteraction && isInactive && !session.reactivationSent) {
      try {
        await sendText(session.waFrom,
          `👋 ¡Hola! Han pasado 30 días desde tu última visita a *${storeName}*.\n\n` +
          `Tenemos novedades y ofertas especiales 🛍️\n\n` +
          `Escribe *Hola* para ver el catálogo actualizado.`,
          tenant
        );
        session.reactivationSent = true;
        await saveState(tenant.slug, session.waFrom, session);
        count++;
      } catch (err) {
        // No propagar errores de reactivación — continuar con el siguiente
      }
    }
  }

  return count;
}

module.exports = { processMessage, checkReactivations };
