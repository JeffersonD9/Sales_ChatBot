/**
 * steps/catalog.js — Flujo completo del catálogo de ventas
 */

const { STEP }                                        = require('@whatsapp-saas/shared-utils');
const { normalizeTalla, parseBudget }                 = require('../../../whatsapp/parser');
const { formatPrice }                                 = require('@whatsapp-saas/shared-utils');
const { filterProducts, getAlternatives, getStoreInfo } = require('../../../catalog');
const { sendText, sendImage, sendInteractiveButtons } = require('../../../whatsapp/sender');

// ── PASO: Talla ───────────────────────────────────────────────────────────

async function handleTalla(phone, session, txt, id, tenant) {
  let talla = null;

  if      (id === 'TALLA_S'  || txt.includes('talla_s')  || txt === 's'  || txt.includes('pequeñ')) talla = 'S';
  else if (id === 'TALLA_M'  || txt.includes('talla_m')  || txt === 'm'  || txt.includes('median'))      talla = 'M';
  else if (id === 'TALLA_L'  || txt.includes('talla_l')  || txt === 'l'  || txt.includes('grand'))       talla = 'L';
  else if (id === 'TALLA_XL' || txt.includes('talla_xl') || txt === 'xl' || txt.includes('extra'))       talla = 'XL';
  else    talla = normalizeTalla(txt);

  if (!talla) {
    await sendText(phone, '🤔 No reconocí esa talla. Indica *S*, *M*, *L* o *XL*:', tenant);
    return;
  }

  session.data.talla = talla;
  session.step       = STEP.CATALOG_PRESUPUESTO;

  await sendText(phone,
    `Talla *${talla}* anotada ✅\n\n` +
    `💰 ¿Cuál es tu presupuesto aproximado?\n_Ej: 80000 o 80k_`,
    tenant
  );
}

// ── PASO: Presupuesto → mostrar productos ─────────────────────────────────

async function handlePresupuesto(phone, session, txt, tenant, notifier) {
  const budget = parseBudget(txt);

  if (!budget) {
    const tallaCambiada = normalizeTalla(txt);
    if (tallaCambiada) {
      session.data.talla = tallaCambiada;
      await sendText(phone, `Talla cambiada a *${tallaCambiada}* ✅\n\n💰 ¿Cuál es tu presupuesto?\n_Ej: 80000 o 80k_`, tenant);
      return;
    }
    await sendText(phone, '🤔 No entendí el presupuesto. Escríbelo en pesos, ej: *80000* o *80k*:', tenant);
    return;
  }

  session.data.budget = budget;
  const matches       = filterProducts(tenant.products, session.data.talla, budget);
  session.shownProducts = matches;

  if (matches.length === 0) {
    await sendText(phone,
      `😕 Con talla *${session.data.talla}* y presupuesto de ${formatPrice(budget)} no tengo ` +
      `productos disponibles ahora mismo.\n\n` +
      `Te guardo el contacto y te aviso cuando llegue mercancía en tu rango. 🙌`,
      tenant
    );
    setImmediate(() => notifier.notifyLead(phone, `Talla ${session.data.talla}, presupuesto ${formatPrice(budget)} — sin coincidencias`, tenant));
    session.step = STEP.MENU;
    await sendText(phone, '¿Quieres explorar otras opciones? Escribe *menú*.', tenant);
    return;
  }

  await sendText(phone, `🛍️ Encontré *${matches.length} opción(es)* perfecta(s) para ti en talla ${session.data.talla}:`, tenant);

  for (let i = 0; i < matches.length; i++) {
    const p      = matches[i];
    const prefix = `*${i + 1}. ${p.emoji} ${p.name}*\n${p.description}\n\n`;
    const pricing =
      `💲 *${formatPrice(p.price)} COP*` +
      (p.original_price > p.price ? ` ~~${formatPrice(p.original_price)}~~` : '') +
      `\n📏 Tallas: *${p.sizes.join(', ')}*`;

    await sendImage(phone, p.image_url, prefix + pricing, tenant);
  }

  session.step = STEP.CATALOG_SHOWING;

  await sendInteractiveButtons(
    phone,
    `¿Cuál de estas opciones te gusta?\n\n` +
    matches.map((p, i) => `${i + 1}. ${p.emoji} ${p.name} — ${formatPrice(p.price)}`).join('\n') +
    `\n\n*¿Lo apartamos?* 👇`,
    [
      { id: 'DEC_SI',   title: '✅ Sí, lo aparto'   },
      { id: 'DEC_DUDA', title: '🤔 Tengo una duda' },
      { id: 'DEC_NO',   title: '❌ No me convenció' },
    ],
    tenant
  );
}

// ── PASO: Decisión sobre el producto ─────────────────────────────────────

async function handleDecisionProducto(phone, session, txt, id, tenant, notifier) {
  const opt = id || txt;

  if (opt === 'DEC_SI' || txt.includes('aparto') || txt.includes('quiero') || txt.includes('sí') || txt === 'si') {
    if (session.shownProducts?.length > 1) {
      session.step = STEP.CATALOG_SELECTING;
      await sendText(phone,
        `¡Excelente elección! 🎉\n\n¿Cuál de los productos quieres apartar?\n` +
        session.shownProducts.map((p, i) => `*${i + 1}.* ${p.emoji} ${p.name}`).join('\n') +
        '\n\nResponde con el número:',
        tenant
      );
      return;
    }
    session.data.selectedProduct = session.shownProducts?.[0];
    session.step                 = STEP.ORDER_NAME;
    await sendText(phone,
      `¡Perfecto! Vamos a apartarlo 🛍️\n\nPara completar tu pedido necesito algunos datos.\n\n` +
      `*¿Cuál es tu nombre completo?*`,
      tenant
    );
    return;
  }

  if (opt === 'DEC_DUDA' || txt.includes('duda') || txt.includes('pregunt') || txt === '2') {
    session.step = STEP.CATALOG_OBJECTION;
    await sendInteractiveButtons(phone,
      '¡Con gusto te ayudo! ¿Cuál es tu duda? 😊',
      [
        { id: 'OBJ_ENVIO',   title: '🚚 Cómo es el envío'    },
        { id: 'OBJ_CAMBIOS', title: '🔄 Política de cambios'     },
        { id: 'OBJ_VER_MAS', title: '👀 Ver más opciones'        },
      ],
      tenant
    );
    return;
  }

  if (opt === 'DEC_NO' || txt.includes('no me') || txt.includes('no conv') || txt === '3') {
    await _mostrarAlternativas(phone, session, tenant, notifier);
    return;
  }

  return false;
}

// ── PASO: Objeción ────────────────────────────────────────────────────────

async function handleObjecion(phone, session, txt, id, tenant) {
  const opt = id || txt;

  if (opt === 'OBJ_ENVIO' || txt.includes('envío') || txt.includes('envio') || txt.includes('domic')) {
    const store = getStoreInfo(tenant);
    await sendText(phone,
      `🚚 *Información de envío:*\n\n` +
      `• Domicilio en ${store.city}: *Gratis* en compras +$60.000\n` +
      `• Otros municipios: Coordinadora o Servientrega\n` +
      `• Tiempo: 1–3 días hábiles\n` +
      `• Pago contraentrega disponible ✅`,
      tenant
    );
    session.step = STEP.CATALOG_SHOWING;
    await sendInteractiveButtons(phone, '¿Eso te da más tranquilidad? ¿Lo apartamos?',
      [
        { id: 'DEC_SI',   title: '✅ Sí, lo aparto'    },
        { id: 'DEC_DUDA', title: '🤔 Otra pregunta'   },
        { id: 'DEC_NO',   title: '❌ Ver más opciones' },
      ],
      tenant
    );
    return;
  }

  if (opt === 'OBJ_CAMBIOS' || txt.includes('cambio') || txt.includes('devolu') || txt.includes('garantía')) {
    await sendText(phone,
      `🔄 *Política de cambios:*\n\n` +
      `• Cambios dentro de los *7 días* de recibido\n` +
      `• Producto en perfecto estado (sin uso, con etiqueta)\n` +
      `• Cambio por otra talla o producto de igual/mayor valor\n` +
      `• Devolución de dinero: máximo 5 días hábiles\n\n` +
      `Trabajamos con total garantía 🤝`,
      tenant
    );
    session.step = STEP.CATALOG_SHOWING;
    await sendInteractiveButtons(phone, '¿Quedó clara la duda? ¿Lo apartamos?',
      [
        { id: 'DEC_SI',   title: '✅ Sí, lo aparto'    },
        { id: 'DEC_DUDA', title: '🤔 Otra pregunta'   },
        { id: 'DEC_NO',   title: '❌ Ver más opciones' },
      ],
      tenant
    );
    return;
  }

  if (opt === 'OBJ_VER_MAS' || txt.includes('ver más') || txt.includes('ver mas') || txt.includes('otras')) {
    session.step = STEP.CATALOG_PRESUPUESTO;
    await sendText(phone, `💰 ¿Cuánto tienes de presupuesto esta vez? (puede ser mayor para ver más opciones):`, tenant);
    return;
  }

  await sendText(phone, 'Cuéntame tu duda y con gusto te ayudo 😊', tenant);
}

// ── PASO: Alternativas ────────────────────────────────────────────────────

async function _mostrarAlternativas(phone, session, tenant, notifier) {
  const shownIds     = (session.shownProducts || []).map((p) => p.id);
  const alternatives = getAlternatives(tenant.products, session.data.talla, shownIds, 2);

  if (alternatives.length === 0) {
    await sendText(phone,
      `😕 No tengo más opciones en talla *${session.data.talla}* por ahora.\n\n` +
      `Te guardo el contacto y te aviso cuando llegue mercancía nueva 📲`,
      tenant
    );
    setImmediate(() => notifier.notifyLead(phone, `Talla ${session.data.talla} — no le gustaron los productos`, tenant));
    session.step = STEP.MENU;
    await sendText(phone, 'Escribe *menú* cuando quieras volver. ¡Hasta pronto! 👋', tenant);
    return;
  }

  session.shownProducts = alternatives;
  session.step          = STEP.CATALOG_ALTERNATIVES;

  await sendText(phone, '¡No hay problema! Te muestro dos alternativas 👇', tenant);
  for (let i = 0; i < alternatives.length; i++) {
    const p = alternatives[i];
    await sendImage(phone, p.image_url,
      `*${i + 1}. ${p.emoji} ${p.name}*\n${p.description}\n\n💲 *${formatPrice(p.price)} COP*`,
      tenant
    );
  }

  await sendInteractiveButtons(phone, '¿Alguna de estas te llama la atención?',
    [
      { id: 'ALT_SI', title: '✅ Me gusta una'       },
      { id: 'ALT_NO', title: '❌ Ninguna por ahora'  },
    ],
    tenant
  );
}

async function handleAlternativas(phone, session, txt, id, tenant, notifier) {
  const opt = id || txt;

  if (opt === 'ALT_SI' || txt === 'sí' || txt === 'si' || txt.includes('gusta') || txt.includes('quiero')) {
    session.step = STEP.ORDER_NAME;
    await sendText(phone, `¡Genial! 🎉\n\n*¿Cuál es tu nombre completo?*`, tenant);
    return;
  }

  if (opt === 'ALT_NO' || txt === 'no' || txt.includes('ninguna')) {
    await sendText(phone,
      `Entendido 😊 Te guardo el contacto y cuando llegue nueva mercancía ` +
      `en talla *${session.data.talla}* te aviso. ¡Gracias por visitarnos! 🙏`,
      tenant
    );
    setImmediate(() => notifier.notifyLead(phone, `Talla ${session.data.talla} — tampoco le gustaron las alternativas`, tenant));
    session.step = STEP.MENU;
    return;
  }

  await sendText(phone, '¿Te gustó alguna? Responde *sí* o *no*.', tenant);
}

// ── PASO: Selección de producto por número ────────────────────────────────

async function handleProductSelection(phone, session, txt, tenant) {
  const num = parseInt(txt, 10);

  if (num >= 1 && num <= session.shownProducts.length) {
    session.data.selectedProduct = session.shownProducts[num - 1];
    session.step                 = STEP.ORDER_NAME;
    await sendText(phone,
      `¡Perfecto! Elegiste *${session.data.selectedProduct.emoji} ${session.data.selectedProduct.name}* 🎉\n\n` +
      `Para completar tu pedido necesito algunos datos.\n\n*¿Cuál es tu nombre completo?*`,
      tenant
    );
  } else {
    await sendText(phone, `Escribe solo el número del producto (1 al ${session.shownProducts.length}):`, tenant);
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
