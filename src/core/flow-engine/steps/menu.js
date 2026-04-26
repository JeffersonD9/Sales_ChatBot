/**
 * steps/menu.js — Menú principal y bienvenida
 *
 * Migrado de menuHandler.js. Cambios clave:
 *   - Recibe `tenant` como parámetro (no lee process.env)
 *   - Sender recibe `tenant` como último argumento
 *   - getStoreInfo/getOffers reciben `tenant`
 *   - notifyAdvisorRequest recibe `tenant`
 */

const { STEP }                                                  = require('../../../utils/constants');
const { sendText, sendInteractiveList, sendInteractiveButtons } = require('../../whatsapp/sender');
const { getStoreInfo, getOffers }                               = require('../../catalog');

async function sendMainMenu(phone, session, tenant) {
  session.step = STEP.MENU;
  const store  = getStoreInfo(tenant);

  const greeting = session.data?.name
    ? `\u00a1Hola de nuevo, ${session.data.name}! \uD83D\uDC4B`
    : `\u00a1Hola! Bienvenido(a) a *${store.name}* \uD83D\uDC57`;

  await sendInteractiveList(
    phone,
    `${greeting}\n\nSoy tu asistente virtual de moda. \u00bfEn qu\u00e9 te puedo ayudar hoy?`,
    'Ver opciones',
    [
      {
        title: 'Men\u00fa principal',
        rows: [
          { id: 'OPT_CATALOGO', title: '\uD83D\uDC57 Ver Cat\u00e1logo',      description: 'Encuentra tu outfit perfecto' },
          { id: 'OPT_PEDIDO',   title: '\uD83D\uDCE6 Consultar Pedido',  description: 'Revisa el estado de tu pedido' },
          { id: 'OPT_OFERTAS',  title: '\uD83D\uDD25 Ofertas del D\u00eda',    description: 'Promociones exclusivas de hoy' },
          { id: 'OPT_ASESOR',   title: '\uD83D\uDCAC Hablar con Asesor', description: 'Te conectamos con una persona' },
        ],
      },
    ],
    tenant
  );
}

async function handleMenu(phone, session, txt, id, tenant, notifier) {
  const opt = id || txt;

  // ── Catálogo ──────────────────────────────────────────────────────────
  if (opt === 'OPT_CATALOGO' || txt.includes('cat\u00e1log') || txt.includes('catalogo') || txt.includes('ver') || txt === '1') {
    session.step = STEP.CATALOG_TALLA;
    await sendInteractiveButtons(
      phone,
      '\u00a1Perfecto! Vamos a encontrar algo que te encante \uD83D\uDC57\n\n*\u00bfCu\u00e1l es tu talla?*',
      [
        { id: 'TALLA_S',  title: '\uD83D\uDD39 S / Peque\u00f1a' },
        { id: 'TALLA_M',  title: '\uD83D\uDD38 M / Mediana' },
        { id: 'TALLA_L',  title: '\uD83D\uDD36 L / Grande'   },
      ],
      tenant
    );
    return;
  }

  // ── Consultar pedido ──────────────────────────────────────────────────
  if (opt === 'OPT_PEDIDO' || txt.includes('pedido') || txt.includes('order') || txt === '2') {
    session.step = STEP.CHECK_ORDER;
    await sendText(phone, '\uD83D\uDCE6 Cu\u00e9ntame el n\u00famero de tu pedido o el nombre con que lo hiciste y lo reviso de inmediato.', tenant);
    return;
  }

  // ── Ofertas del día ───────────────────────────────────────────────────
  if (opt === 'OPT_OFERTAS' || txt.includes('oferta') || txt.includes('promo') || txt === '3') {
    const offers = getOffers(tenant);
    if (offers.length > 0) {
      await sendText(phone, offers[0].text, tenant);
    } else {
      await sendText(phone, '\uD83D\uDD25 Hoy tenemos descuentos especiales. Escr\u00edbenos para conocer los detalles.', tenant);
    }
    await sendText(phone, '\n\u00bfTe interesa? Escribe *cat\u00e1logo* para ver m\u00e1s o *men\u00fa* para volver. \uD83D\uDE0A', tenant);
    session.step = STEP.MENU;
    return;
  }

  // ── Hablar con asesor ─────────────────────────────────────────────────
  if (opt === 'OPT_ASESOR' || txt.includes('asesor') || txt.includes('persona') || txt.includes('humano') || txt === '4') {
    const store = getStoreInfo(tenant);
    await sendText(phone,
      `\u2705 Entendido. Ya avis\u00e9 a nuestro equipo.\n\n` +
      `Te contactaremos pronto. Horario: ${store.schedule}. \uD83D\uDD58`,
      tenant
    );
    setImmediate(() => notifier.notifyAdvisorRequest(phone, tenant));
    session.step = STEP.MENU;
    return;
  }

  // ── Opción no reconocida ──────────────────────────────────────────────
  await sendText(phone, '\uD83E\uDD14 No entend\u00ed esa opci\u00f3n. Usa el men\u00fa:', tenant);
  await sendMainMenu(phone, session, tenant);
}

module.exports = { sendMainMenu, handleMenu };
