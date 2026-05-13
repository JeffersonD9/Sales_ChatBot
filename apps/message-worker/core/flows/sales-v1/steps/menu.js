/**
 * steps/menu.js — Menú principal y bienvenida
 */

const { STEP }                                                  = require('@whatsapp-saas/shared-utils');
const { sendText, sendInteractiveList, sendInteractiveButtons } = require('../../../whatsapp/sender');
const { getStoreInfo, getOffers }                               = require('../../../catalog');

async function sendMainMenu(phone, session, tenant) {
  session.step = STEP.MENU;
  const store  = getStoreInfo(tenant);

  const greeting = session.data?.name
    ? `¡Hola de nuevo, ${session.data.name}! 👋`
    : `¡Hola! Bienvenido(a) a *${store.name}* 👗`;

  await sendInteractiveList(
    phone,
    `${greeting}\n\nSoy tu asistente virtual de moda. ¿En qué te puedo ayudar hoy?`,
    'Ver opciones',
    [
      {
        title: 'Menú principal',
        rows: [
          { id: 'OPT_CATALOGO', title: '👗 Ver Catálogo',      description: 'Encuentra tu outfit perfecto' },
          { id: 'OPT_PEDIDO',   title: '📦 Consultar Pedido',  description: 'Revisa el estado de tu pedido' },
          { id: 'OPT_OFERTAS',  title: '🔥 Ofertas del Día',    description: 'Promociones exclusivas de hoy' },
          { id: 'OPT_ASESOR',   title: '💬 Hablar con Asesor', description: 'Te conectamos con una persona' },
        ],
      },
    ],
    tenant
  );
}

async function handleMenu(phone, session, txt, id, tenant, notifier) {
  const opt = id || txt;

  if (opt === 'OPT_CATALOGO' || txt.includes('catálog') || txt.includes('catalogo') || txt.includes('ver') || txt === '1') {
    session.step = STEP.CATALOG_TALLA;
    await sendInteractiveButtons(
      phone,
      '¡Perfecto! Vamos a encontrar algo que te encante 👗\n\n*¿Cuál es tu talla?*',
      [
        { id: 'TALLA_S',  title: '🔹 S / Pequeña' },
        { id: 'TALLA_M',  title: '🔸 M / Mediana' },
        { id: 'TALLA_L',  title: '🔶 L / Grande'   },
      ],
      tenant
    );
    return;
  }

  if (opt === 'OPT_PEDIDO' || txt.includes('pedido') || txt.includes('order') || txt === '2') {
    session.step = STEP.CHECK_ORDER;
    await sendText(phone, '📦 Cuéntame el número de tu pedido o el nombre con que lo hiciste y lo reviso de inmediato.', tenant);
    return;
  }

  if (opt === 'OPT_OFERTAS' || txt.includes('oferta') || txt.includes('promo') || txt === '3') {
    const offers = getOffers(tenant);
    if (offers.length > 0) {
      await sendText(phone, offers[0].text, tenant);
    } else {
      await sendText(phone, '🔥 Hoy tenemos descuentos especiales. Escríbenos para conocer los detalles.', tenant);
    }
    await sendText(phone, '\n¿Te interesa? Escribe *catálogo* para ver más o *menú* para volver. 😊', tenant);
    session.step = STEP.MENU;
    return;
  }

  if (opt === 'OPT_ASESOR' || txt.includes('asesor') || txt.includes('persona') || txt.includes('humano') || txt === '4') {
    const store = getStoreInfo(tenant);
    await sendText(phone,
      `✅ Entendido. Ya avisé a nuestro equipo.\n\n` +
      `Te contactaremos pronto. Horario: ${store.schedule}. 🕘`,
      tenant
    );
    setImmediate(() => notifier.notifyAdvisorRequest(phone, tenant));
    session.step = STEP.MENU;
    return;
  }

  return false;
}

module.exports = { sendMainMenu, handleMenu };
