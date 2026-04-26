/**
 * steps/catalog.js — Flujo completo del catálogo de ventas
 *
 * Migrado de catalogHandler.js. Cambios clave:
 *   - Recibe `tenant` como parámetro
 *   - filterProducts/getAlternatives reciben tenant.products
 *   - Sender recibe `tenant` como último argumento
 *   - notifyLead es fire-and-forget (setImmediate)
 */

const { STEP }                                        = require('../../../utils/constants');
const { normalizeTalla, parseBudget }                 = require('../../whatsapp/parser');
const { formatPrice }                                 = require('../../../utils/formatters');
const { filterProducts, getAlternatives, getStoreInfo } = require('../../catalog');
const { sendText, sendImage, sendInteractiveButtons } = require('../../whatsapp/sender');

// ── PASO: Talla ───────────────────────────────────────────────────────────

async function handleTalla(phone, session, txt, tenant) {
  let talla = null;

  if      (txt.includes('talla_s')  || txt === 's'  || txt.includes('peque\u00f1')) talla = 'S';
  else if (txt.includes('talla_m')  || txt === 'm'  || txt.includes('median'))      talla = 'M';
  else if (txt.includes('talla_l')  || txt === 'l'  || txt.includes('grand'))       talla = 'L';
  else if (txt.includes('talla_xl') || txt === 'xl' || txt.includes('extra'))       talla = 'XL';
  else    talla = normalizeTalla(txt);

  if (!talla) {
    await sendText(phone, '\uD83E\uDD14 No reconoc\u00ed esa talla. Indica *S*, *M*, *L* o *XL*:', tenant);
    return;
  }

  session.data.talla = talla;
  session.step       = STEP.CATALOG_PRESUPUESTO;

  await sendText(phone,
    `Talla *${talla}* anotada \u2705\n\n` +
    `\uD83D\uDCB0 \u00bfCu\u00e1l es tu presupuesto aproximado?\n_Ej: 80000 o 80k_`,
    tenant
  );
}

// ── PASO: Presupuesto → mostrar productos ─────────────────────────────────

async function handlePresupuesto(phone, session, txt, tenant, notifier) {
  const budget = parseBudget(txt);

  if (!budget) {
    await sendText(phone, '\uD83E\uDD14 No entend\u00ed el presupuesto. Escr\u00edbelo en pesos, ej: *80000* o *80k*:', tenant);
    return;
  }

  session.data.budget = budget;
  const matches       = filterProducts(tenant.products, session.data.talla, budget);
  session.shownProducts = matches;

  if (matches.length === 0) {
    await sendText(phone,
      `\uD83D\uDE15 Con talla *${session.data.talla}* y presupuesto de ${formatPrice(budget)} no tengo ` +
      `productos disponibles ahora mismo.\n\n` +
      `Te guardo el contacto y te aviso cuando llegue mercanc\u00eda en tu rango. \uD83D\uDE4C`,
      tenant
    );
    setImmediate(() => notifier.notifyLead(phone, `Talla ${session.data.talla}, presupuesto ${formatPrice(budget)} \u2014 sin coincidencias`, tenant));
    session.step = STEP.MENU;
    await sendText(phone, '\u00bfQuieres explorar otras opciones? Escribe *men\u00fa*.', tenant);
    return;
  }

  await sendText(phone, `\uD83D\uDECD\uFE0F Encontr\u00e9 *${matches.length} opci\u00f3n(es)* perfecta(s) para ti en talla ${session.data.talla}:`, tenant);

  for (let i = 0; i < matches.length; i++) {
    const p      = matches[i];
    const prefix = `*${i + 1}. ${p.emoji} ${p.name}*\n${p.description}\n\n`;
    const pricing =
      `\uD83D\uDCB2 *${formatPrice(p.price)} COP*` +
      (p.original_price > p.price ? ` ~~${formatPrice(p.original_price)}~~` : '') +
      `\n\uD83D\uDCCF Tallas: *${p.sizes.join(', ')}*`;

    await sendImage(phone, p.image_url, prefix + pricing, tenant);
  }

  session.step = STEP.CATALOG_SHOWING;

  await sendInteractiveButtons(
    phone,
    `\u00bfCu\u00e1l de estas opciones te gusta?\n\n` +
    matches.map((p, i) => `${i + 1}. ${p.emoji} ${p.name} \u2014 ${formatPrice(p.price)}`).join('\n') +
    `\n\n*\u00bfLo apartamos?* \uD83D\uDC47`,
    [
      { id: 'DEC_SI',   title: '\u2705 S\u00ed, lo aparto'   },
      { id: 'DEC_DUDA', title: '\uD83E\uDD14 Tengo una duda' },
      { id: 'DEC_NO',   title: '\u274C No me convenci\u00f3' },
    ],
    tenant
  );
}

// ── PASO: Decisión sobre el producto ─────────────────────────────────────

async function handleDecisionProducto(phone, session, txt, id, tenant, notifier) {
  const opt = id || txt;

  if (opt === 'DEC_SI' || txt.includes('aparto') || txt.includes('quiero') || txt.includes('s\u00ed') || txt === 'si') {
    if (session.shownProducts?.length > 1) {
      session.step = STEP.CATALOG_SELECTING;
      await sendText(phone,
        `\u00a1Excelente elecci\u00f3n! \uD83C\uDF89\n\n\u00bfCu\u00e1l de los productos quieres apartar?\n` +
        session.shownProducts.map((p, i) => `*${i + 1}.* ${p.emoji} ${p.name}`).join('\n') +
        '\n\nResponde con el n\u00famero:',
        tenant
      );
      return;
    }
    session.data.selectedProduct = session.shownProducts?.[0];
    session.step                 = STEP.ORDER_NAME;
    await sendText(phone,
      `\u00a1Perfecto! Vamos a apartarlo \uD83D\uDECD\uFE0F\n\nPara completar tu pedido necesito algunos datos.\n\n` +
      `*\u00bfCu\u00e1l es tu nombre completo?*`,
      tenant
    );
    return;
  }

  if (opt === 'DEC_DUDA' || txt.includes('duda') || txt.includes('pregunt') || txt === '2') {
    session.step = STEP.CATALOG_OBJECTION;
    await sendInteractiveButtons(phone,
      '\u00a1Con gusto te ayudo! \u00bfCu\u00e1l es tu duda? \uD83D\uDE0A',
      [
        { id: 'OBJ_ENVIO',   title: '\uD83D\uDE9A C\u00f3mo es el env\u00edo'    },
        { id: 'OBJ_CAMBIOS', title: '\uD83D\uDD04 Pol\u00edtica de cambios'     },
        { id: 'OBJ_VER_MAS', title: '\uD83D\uDC40 Ver m\u00e1s opciones'        },
      ],
      tenant
    );
    return;
  }

  if (opt === 'DEC_NO' || txt.includes('no me') || txt.includes('no conv') || txt === '3') {
    await _mostrarAlternativas(phone, session, tenant, notifier);
    return;
  }

  await sendText(phone, '\u00bfQu\u00e9 decides? Usa los botones de arriba o escribe *s\u00ed*, *duda* o *no*.', tenant);
}

// ── PASO: Objeción ────────────────────────────────────────────────────────

async function handleObjecion(phone, session, txt, id, tenant) {
  const opt = id || txt;

  if (opt === 'OBJ_ENVIO' || txt.includes('env\u00edo') || txt.includes('envio') || txt.includes('domic')) {
    const store = getStoreInfo(tenant);
    await sendText(phone,
      `\uD83D\uDE9A *Informaci\u00f3n de env\u00edo:*\n\n` +
      `\u2022 Domicilio en ${store.city}: *Gratis* en compras +$60.000\n` +
      `\u2022 Otros municipios: Coordinadora o Servientrega\n` +
      `\u2022 Tiempo: 1\u20133 d\u00edas h\u00e1biles\n` +
      `\u2022 Pago contraentrega disponible \u2705`,
      tenant
    );
    session.step = STEP.CATALOG_SHOWING;
    await sendInteractiveButtons(phone, '\u00bfEso te da m\u00e1s tranquilidad? \u00bfLo apartamos?',
      [
        { id: 'DEC_SI',   title: '\u2705 S\u00ed, lo aparto'    },
        { id: 'DEC_DUDA', title: '\uD83E\uDD14 Otra pregunta'   },
        { id: 'DEC_NO',   title: '\u274C Ver m\u00e1s opciones' },
      ],
      tenant
    );
    return;
  }

  if (opt === 'OBJ_CAMBIOS' || txt.includes('cambio') || txt.includes('devolu') || txt.includes('garant\u00eda')) {
    await sendText(phone,
      `\uD83D\uDD04 *Pol\u00edtica de cambios:*\n\n` +
      `\u2022 Cambios dentro de los *7 d\u00edas* de recibido\n` +
      `\u2022 Producto en perfecto estado (sin uso, con etiqueta)\n` +
      `\u2022 Cambio por otra talla o producto de igual/mayor valor\n` +
      `\u2022 Devoluci\u00f3n de dinero: m\u00e1ximo 5 d\u00edas h\u00e1biles\n\n` +
      `Trabajamos con total garant\u00eda \uD83E\uDD1D`,
      tenant
    );
    session.step = STEP.CATALOG_SHOWING;
    await sendInteractiveButtons(phone, '\u00bfQued\u00f3 clara la duda? \u00bfLo apartamos?',
      [
        { id: 'DEC_SI',   title: '\u2705 S\u00ed, lo aparto'    },
        { id: 'DEC_DUDA', title: '\uD83E\uDD14 Otra pregunta'   },
        { id: 'DEC_NO',   title: '\u274C Ver m\u00e1s opciones' },
      ],
      tenant
    );
    return;
  }

  if (opt === 'OBJ_VER_MAS' || txt.includes('ver m\u00e1s') || txt.includes('ver mas') || txt.includes('otras')) {
    session.step = STEP.CATALOG_PRESUPUESTO;
    await sendText(phone, `\uD83D\uDCB0 \u00bfCu\u00e1nto tienes de presupuesto esta vez? (puede ser mayor para ver m\u00e1s opciones):`, tenant);
    return;
  }

  await sendText(phone, 'Cu\u00e9ntame tu duda y con gusto te ayudo \uD83D\uDE0A', tenant);
}

// ── PASO: Alternativas ────────────────────────────────────────────────────

async function _mostrarAlternativas(phone, session, tenant, notifier) {
  const shownIds     = (session.shownProducts || []).map((p) => p.id);
  const alternatives = getAlternatives(tenant.products, session.data.talla, shownIds, 2);

  if (alternatives.length === 0) {
    await sendText(phone,
      `\uD83D\uDE15 No tengo m\u00e1s opciones en talla *${session.data.talla}* por ahora.\n\n` +
      `Te guardo el contacto y te aviso cuando llegue mercanc\u00eda nueva \uD83D\uDCF2`,
      tenant
    );
    setImmediate(() => notifier.notifyLead(phone, `Talla ${session.data.talla} \u2014 no le gustaron los productos`, tenant));
    session.step = STEP.MENU;
    await sendText(phone, 'Escribe *men\u00fa* cuando quieras volver. \u00a1Hasta pronto! \uD83D\uDC4B', tenant);
    return;
  }

  session.shownProducts = alternatives;
  session.step          = STEP.CATALOG_ALTERNATIVES;

  await sendText(phone, '\u00a1No hay problema! Te muestro dos alternativas \uD83D\uDC47', tenant);
  for (let i = 0; i < alternatives.length; i++) {
    const p = alternatives[i];
    await sendImage(phone, p.image_url,
      `*${i + 1}. ${p.emoji} ${p.name}*\n${p.description}\n\n\uD83D\uDCB2 *${formatPrice(p.price)} COP*`,
      tenant
    );
  }

  await sendInteractiveButtons(phone, '\u00bfAlguna de estas te llama la atenci\u00f3n?',
    [
      { id: 'ALT_SI', title: '\u2705 Me gusta una'       },
      { id: 'ALT_NO', title: '\u274C Ninguna por ahora'  },
    ],
    tenant
  );
}

async function handleAlternativas(phone, session, txt, id, tenant, notifier) {
  const opt = id || txt;

  if (opt === 'ALT_SI' || txt === 's\u00ed' || txt === 'si' || txt.includes('gusta') || txt.includes('quiero')) {
    session.step = STEP.ORDER_NAME;
    await sendText(phone, `\u00a1Genial! \uD83C\uDF89\n\n*\u00bfCu\u00e1l es tu nombre completo?*`, tenant);
    return;
  }

  if (opt === 'ALT_NO' || txt === 'no' || txt.includes('ninguna')) {
    await sendText(phone,
      `Entendido \uD83D\uDE0A Te guardo el contacto y cuando llegue nueva mercanc\u00eda ` +
      `en talla *${session.data.talla}* te aviso. \u00a1Gracias por visitarnos! \uD83D\uDE4F`,
      tenant
    );
    setImmediate(() => notifier.notifyLead(phone, `Talla ${session.data.talla} \u2014 tampoco le gustaron las alternativas`, tenant));
    session.step = STEP.MENU;
    return;
  }

  await sendText(phone, '\u00bfTe gust\u00f3 alguna? Responde *s\u00ed* o *no*.', tenant);
}

// ── PASO: Selección de producto por número ────────────────────────────────

async function handleProductSelection(phone, session, txt, tenant) {
  const num = parseInt(txt, 10);

  if (num >= 1 && num <= session.shownProducts.length) {
    session.data.selectedProduct = session.shownProducts[num - 1];
    session.step                 = STEP.ORDER_NAME;
    await sendText(phone,
      `\u00a1Perfecto! Elegiste *${session.data.selectedProduct.emoji} ${session.data.selectedProduct.name}* \uD83C\uDF89\n\n` +
      `Para completar tu pedido necesito algunos datos.\n\n*\u00bfCu\u00e1l es tu nombre completo?*`,
      tenant
    );
  } else {
    await sendText(phone, `Escribe solo el n\u00famero del producto (1 al ${session.shownProducts.length}):`, tenant);
  }
}

module.exports = {
  handleTalla,
  handlePresupuesto,
  handleDecisionProducto,
  handleProductSelection,
  handleObjecion,
  handleAlternativas,
};
