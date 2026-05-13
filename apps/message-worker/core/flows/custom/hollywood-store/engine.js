'use strict';

/**
 * flows/custom/hollywood-store/engine.js
 * Cliente: Hollywood Store — Pantalonetas Sublimadas
 *
 * Activa con: bot_config.flow_type = "hollywood_store"
 *
 * ── Estructura de storage esperada en la VPS ──────────────────────────────
 *
 *   {storage_base_url}/
 *     audio/
 *       calidad.ogg              ← audio de calidad de las pantalonetas
 *     images/
 *       tallas/                  ← fotos por talla para ruta DETAL
 *         S/001.jpg, 002.jpg …
 *         M/001.jpg, 002.jpg …
 *         L/001.jpg …
 *         XL/001.jpg …
 *         XXL/001.jpg …
 *         XXXL/001.jpg …
 *       catalogo/                ← fotos del catálogo completo (todas las refs)
 *         001.jpg, 002.jpg …
 *
 * ── Configuración en tenant.bot_config ────────────────────────────────────
 *
 *   {
 *     "flow_type":              "hollywood_store",
 *     "storage_base_url":       "https://media.tudominio.com/hollywood-store",
 *     "catalog_link_mayorista": "https://link-al-catalogo-mayorista",
 *     "catalog_link_detal":     "https://link-al-catalogo-detal",
 *     "catalog_images_count":   20,     // cuántas fotos hay en images/catalogo/
 *     "talla_images_count": {
 *       "S": 2, "M": 3, "L": 3, "XL": 2, "XXL": 2, "XXXL": 1
 *     }
 *   }
 *
 * ── Precios (hardcodeados en el flujo, no en DB) ──────────────────────────
 *   Mayorista: hombre +12 und $23.000, +24 und $22.000 | dama/niño $20.000
 *   Detal: 1→$35k, 2→$65k, 3→$90k, 6→$168k, 12→$276k | XXXL $45k c/u
 */

const { extractInput } = require('../../../whatsapp/parser');
const {
  sendText,
  sendImage,
  sendAudio,
  sendInteractiveButtons,
  sendInteractiveList,
} = require('../../../whatsapp/sender');

// ── Steps locales (prefijo HS_ para no colisionar con STEP global) ─────────
const S = {
  MENU:             'MENU',
  MAY_AUDIO:        'HS_MAY_AUDIO',
  MAY_PHOTOS:       'HS_MAY_PHOTOS',
  DET_TALLA:        'HS_DET_TALLA',
  DET_PHOTOS:       'HS_DET_PHOTOS',
  DET_AUDIO:        'HS_DET_AUDIO',
  ORDER_REF:        'HS_ORDER_REF',
  ORDER_TALLA:      'HS_ORDER_TALLA',
  ORDER_CANT:       'HS_ORDER_CANT',
  ORDER_NAME:       'HS_ORDER_NAME',
  ORDER_PHONE:      'HS_ORDER_PHONE',
  ORDER_ADDR:       'HS_ORDER_ADDR',
  ORDER_PAY:        'HS_ORDER_PAY',
  ORDER_CONFIRM:    'HS_ORDER_CONFIRM',
};

const TALLAS_VALIDAS = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

const RESET_CMDS = new Set(['menu', 'menú', 'inicio', 'hola', 'hi', 'start', '0']);

// ── Helpers de storage ────────────────────────────────────────────────────

function mediaUrl(tenant, ...parts) {
  const base = tenant.bot_config?.storage_base_url || '';
  return [base, ...parts].join('/');
}

function audioCalidad(tenant) {
  return mediaUrl(tenant, 'audio', 'calidad.ogg');
}

function imagenesTalla(tenant, talla) {
  const counts = tenant.bot_config?.talla_images_count || {};
  const n = counts[talla] || 1;
  return Array.from({ length: n }, (_, i) =>
    mediaUrl(tenant, 'images', 'tallas', talla, `${String(i + 1).padStart(3, '0')}.jpg`)
  );
}

function imagenescatalogo(tenant) {
  const n = tenant.bot_config?.catalog_images_count || 1;
  return Array.from({ length: n }, (_, i) =>
    mediaUrl(tenant, 'images', 'catalogo', `${String(i + 1).padStart(3, '0')}.jpg`)
  );
}

// ── Textos de precios ──────────────────────────────────────────────────────

const PRECIOS_MAYORISTA =
  `💰 *Precios Mayorista — Pantalonetas Sublimadas*\n\n` +
  `📌 *+12 unidades* (Hombre): $23.000 c/u\n` +
  `📌 *+24 unidades* (mismo pedido): $22.000 c/u\n` +
  `📌 *Dama y Niño*: $20.000 c/u\n` +
  `━━━━━━━━━━━━━━━━\n` +
  `✅ A mayor cantidad, menor precio\n` +
  `✅ Pagas al recibir\n` +
  `‼️ *NO asumimos costos de envío*`;

const PRECIOS_DETAL =
  `💰 *Precio Pantalonetas Detal*\n\n` +
  `📌 1 unidad → *$35.000*\n` +
  `📌 2 unidades → *$65.000*\n` +
  `📌 3 unidades → *$90.000*\n` +
  `📌 6 unidades → *$168.000*\n` +
  `📌 12 unidades → *$276.000*\n` +
  `━━━━━━━━━━━━━━━━\n` +
  `⚠️ Talla *XXXL*: $45.000 c/u\n` +
  `━━━━━━━━━━━━━━━━\n` +
  `⭐ A mayor cantidad, menor precio\n` +
  `‼️ *NO asumimos costos de envío*`;

// ── Flujo MAYORISTA ────────────────────────────────────────────────────────

async function iniciarMayorista(phone, session, tenant) {
  session.data.tipo = 'mayorista';
  await sendText(phone, PRECIOS_MAYORISTA, tenant);

  const linkCatalogo = tenant.bot_config?.catalog_link_mayorista || '(link pendiente)';
  await sendText(phone,
    `🔗 *Catálogo Mayorista:* ${linkCatalogo}\n` +
    `_(Cada foto tiene su N° de referencia)_`,
    tenant
  );

  session.step = S.MAY_AUDIO;
  await sendInteractiveButtons(phone,
    '🎧 ¿Quieres conocer la calidad de nuestras pantalonetas?',
    [
      { id: 'MAY_AUDIO_SI', title: '🎧 Sí, quiero escuchar' },
      { id: 'MAY_AUDIO_NO', title: '➡️ Continuar sin audio' },
    ],
    tenant
  );
}

async function handleMayAudio(phone, session, txt, id, tenant) {
  const opt = id || txt;
  const quiere = opt === 'MAY_AUDIO_SI' || txt === 'sí' || txt === 'si' || txt.includes('escuchar') || txt.includes('audio');

  if (quiere) {
    await sendAudio(phone, audioCalidad(tenant), tenant);
    await sendText(phone, '🎧 ¡Ahí tienes el audio de calidad! 💪', tenant);
  }

  session.step = S.MAY_PHOTOS;
  await sendInteractiveButtons(phone,
    '📸 ¿Deseas ver más fotos del catálogo?',
    [
      { id: 'PHOTOS_LINK',  title: '🔗 Ver el link del catálogo' },
      { id: 'PHOTOS_TODAS', title: '📸 Que me manden las fotos'  },
      { id: 'PHOTOS_NO',    title: '➡️ Ir al pedido'             },
    ],
    tenant
  );
}

async function handleMayPhotos(phone, session, txt, id, tenant) {
  const opt = id || txt;

  if (opt === 'PHOTOS_LINK' || txt.includes('link') || txt === '1') {
    const link = tenant.bot_config?.catalog_link_mayorista || '(link pendiente)';
    await sendText(phone,
      `🔗 *Catálogo Mayorista:* ${link}\n\n` +
      `Cada foto tiene su N° de referencia. ¡Explóralo con calma! 😊`,
      tenant
    );
  } else if (opt === 'PHOTOS_TODAS' || txt.includes('foto') || txt === '2') {
    const fotos = imagenescatalogo(tenant);
    await sendText(phone, `📸 Te envío las *${fotos.length} fotos* del catálogo 👇`, tenant);
    for (const url of fotos) {
      await sendImage(phone, url, '', tenant);
    }
  }

  await iniciarFormularioPedido(phone, session, tenant);
}

// ── Flujo DETAL ────────────────────────────────────────────────────────────

async function iniciarDetal(phone, session, tenant) {
  session.data.tipo = 'detal';
  await sendText(phone, PRECIOS_DETAL, tenant);

  session.step = S.DET_TALLA;
  await sendInteractiveButtons(phone,
    '👕 ¿Qué talla te interesa?\n\n_(Si tu talla es XXL o XXXL, escríbela directamente)_',
    [
      { id: 'TALLA_S',   title: '🔹 S'   },
      { id: 'TALLA_M',   title: '🔸 M'   },
      { id: 'TALLA_L',   title: '🔶 L'   },
      { id: 'TALLA_XL',  title: '🟠 XL'  },
    ],
    tenant
  );
}

async function handleDetTalla(phone, session, txt, id, tenant) {
  const tallaMap = {
    TALLA_S: 'S', TALLA_M: 'M', TALLA_L: 'L', TALLA_XL: 'XL',
    TALLA_XXL: 'XXL', TALLA_XXXL: 'XXXL',
  };
  let talla = tallaMap[id] || txt.toUpperCase().trim();

  if (!TALLAS_VALIDAS.includes(talla)) {
    await sendInteractiveButtons(phone,
      `🤔 No reconocí esa talla. Elige entre S, M, L, XL o escribe XXL / XXXL:`,
      [
        { id: 'TALLA_S',  title: '🔹 S'  },
        { id: 'TALLA_M',  title: '🔸 M'  },
        { id: 'TALLA_L',  title: '🔶 L'  },
        { id: 'TALLA_XL', title: '🟠 XL' },
      ],
      tenant
    );
    return;
  }

  session.data.talla_vista = talla;
  const fotos = imagenesTalla(tenant, talla);

  await sendText(phone, `📸 Te muestro las pantalonetas en talla *${talla}* 👇`, tenant);
  for (const url of fotos) {
    await sendImage(phone, url, `Talla ${talla}`, tenant);
  }

  session.step = S.DET_PHOTOS;
  await sendInteractiveButtons(phone,
    '¿Deseas ver más fotos del catálogo completo?',
    [
      { id: 'PHOTOS_LINK',  title: '🔗 Ver el link del catálogo' },
      { id: 'PHOTOS_TODAS', title: '📸 Que me manden las fotos'  },
      { id: 'PHOTOS_NO',    title: '➡️ Ir al pedido'             },
    ],
    tenant
  );
}

async function handleDetPhotos(phone, session, txt, id, tenant) {
  const opt = id || txt;

  if (opt === 'PHOTOS_LINK' || txt.includes('link') || txt === '1') {
    const link = tenant.bot_config?.catalog_link_detal || '(link pendiente)';
    await sendText(phone,
      `🔗 *Catálogo Detal:* ${link}\n\n` +
      `Cada foto tiene su N° de referencia. ¡Explóralo con calma! 😊`,
      tenant
    );
  } else if (opt === 'PHOTOS_TODAS' || txt.includes('foto') || txt === '2') {
    const fotos = imagenescatalogo(tenant);
    await sendText(phone, `📸 Te envío las *${fotos.length} fotos* del catálogo completo 👇`, tenant);
    for (const url of fotos) {
      await sendImage(phone, url, '', tenant);
    }
  }

  session.step = S.DET_AUDIO;
  await sendInteractiveButtons(phone,
    '🎧 ¿Quieres conocer la calidad de nuestras pantalonetas?',
    [
      { id: 'DET_AUDIO_SI', title: '🎧 Sí, quiero escuchar' },
      { id: 'DET_AUDIO_NO', title: '➡️ Ir al pedido'        },
    ],
    tenant
  );
}

async function handleDetAudio(phone, session, txt, id, tenant) {
  const opt = id || txt;
  const quiere = opt === 'DET_AUDIO_SI' || txt === 'sí' || txt === 'si' || txt.includes('escuchar') || txt.includes('audio');

  if (quiere) {
    await sendAudio(phone, audioCalidad(tenant), tenant);
    await sendText(phone, '🎧 ¡Ahí tienes el audio de calidad! 💪', tenant);
  }

  await iniciarFormularioPedido(phone, session, tenant);
}

// ── Formulario de pedido (común para ambas rutas) ─────────────────────────

async function iniciarFormularioPedido(phone, session, tenant) {
  session.step = S.ORDER_REF;
  await sendText(phone,
    `📋 *¿Cómo hacer el pedido?*\n\n` +
    `Busca la pantaloneta que te guste en el catálogo, anota el *N° de referencia* ` +
    `(Ej: REF-205) y envíalo junto con tus datos.\n\n` +
    `¡Así el pedido es rápido y sin errores! ✅\n\n` +
    `*¿Cuál es el N° de referencia que deseas?*\n_Ej: REF-205_`,
    tenant
  );
}

async function handleOrderRef(phone, session, txt, tenant) {
  session.data.referencia = txt.toUpperCase().trim();
  session.step = S.ORDER_TALLA;
  await sendInteractiveButtons(phone,
    `Referencia *${session.data.referencia}* anotada ✅\n\n*¿En qué talla la deseas?*\n_(Si es XXL o XXXL, escríbela)_`,
    [
      { id: 'ORD_S',  title: '🔹 S'  },
      { id: 'ORD_M',  title: '🔸 M'  },
      { id: 'ORD_L',  title: '🔶 L'  },
      { id: 'ORD_XL', title: '🟠 XL' },
    ],
    tenant
  );
}

async function handleOrderTalla(phone, session, txt, id, tenant) {
  const tallaMap = {
    ORD_S: 'S', ORD_M: 'M', ORD_L: 'L', ORD_XL: 'XL',
    ORD_XXL: 'XXL', ORD_XXXL: 'XXXL',
  };
  let talla = tallaMap[id] || txt.toUpperCase().trim();

  if (!TALLAS_VALIDAS.includes(talla)) {
    await sendText(phone, `🤔 Talla no válida. Escribe una de: ${TALLAS_VALIDAS.join(', ')}`, tenant);
    return;
  }

  session.data.talla = talla;
  session.step = S.ORDER_CANT;
  await sendText(phone,
    `Talla *${talla}* anotada ✅\n\n*¿Cuántas unidades deseas?*`,
    tenant
  );
}

async function handleOrderCant(phone, session, txt, tenant) {
  const cant = parseInt(txt, 10);
  if (!cant || cant < 1) {
    await sendText(phone, '🤔 Escribe la cantidad en números (Ej: 3):', tenant);
    return;
  }
  session.data.cantidad = cant;
  session.step = S.ORDER_NAME;
  await sendText(phone, `*${cant} unidad(es)* anotada(s) ✅\n\n*¿Cuál es tu nombre completo?*`, tenant);
}

async function handleOrderName(phone, session, txt, tenant) {
  if (txt.length < 3) {
    await sendText(phone, 'Por favor escribe tu nombre completo:', tenant);
    return;
  }
  session.data.name = txt.trim();
  session.step = S.ORDER_PHONE;
  await sendText(phone,
    `Gracias, *${session.data.name}* 😊\n\n*¿Cuál es tu número de teléfono de contacto?*\n_Ej: 3001234567_`,
    tenant
  );
}

async function handleOrderPhone(phone, session, txt, tenant) {
  const digits = txt.replace(/\D/g, '');
  if (digits.length < 7) {
    await sendText(phone, '🤔 Escribe un número de teléfono válido (Ej: 3001234567):', tenant);
    return;
  }
  session.data.phone_contacto = digits;
  session.step = S.ORDER_ADDR;
  await sendText(phone,
    `Teléfono anotado ✅\n\n*¿Cuál es tu dirección completa de entrega?*\n_Ej: Cra 15 #32-45, Cabecera, Bucaramanga_`,
    tenant
  );
}

async function handleOrderAddr(phone, session, txt, tenant) {
  if (txt.length < 5) {
    await sendText(phone, 'Escribe la dirección completa (calle, barrio, ciudad):', tenant);
    return;
  }
  session.data.address = txt.trim();
  session.step = S.ORDER_PAY;
  await sendInteractiveList(phone,
    `📍 Dirección anotada ✅\n\n*¿Cómo prefieres pagar?*`,
    'Ver opciones',
    [
      {
        title: 'Método de pago',
        rows: [
          { id: 'PAY_NEQUI',  title: '📲 Nequi / Bancolombia / Daviplata', description: 'Transferencia digital' },
          { id: 'PAY_CONTRA', title: '💵 Contraentrega', description: 'Pagas en efectivo al recibir' },
          { id: 'PAY_LINK',   title: '💳 Link de pago', description: 'Tarjeta débito / crédito' },
          { id: 'PAY_PUNTO',  title: '🏪 Punto físico', description: 'Pago en tienda Hollywood Store' },
        ],
      },
    ],
    tenant
  );
}

async function handleOrderPay(phone, session, txt, id, tenant) {
  const pagos = {
    PAY_NEQUI:  'Transferencia Nequi/Bancolombia/Daviplata',
    PAY_CONTRA: 'Contraentrega (efectivo al recibir)',
    PAY_LINK:   'Link de pago tarjeta débito/crédito',
    PAY_PUNTO:  'Pago en punto físico Hollywood Store',
  };
  session.data.payment = pagos[id] || txt.trim();
  session.step = S.ORDER_CONFIRM;

  const tipo = session.data.tipo === 'mayorista' ? 'Mayorista' : 'Detal';

  await sendText(phone,
    `📋 *Resumen de tu pedido:*\n\n` +
    `🔖 Referencia: *${session.data.referencia}*\n` +
    `📐 Talla: *${session.data.talla}*\n` +
    `🔢 Cantidad: *${session.data.cantidad} und.*\n` +
    `👤 Nombre: ${session.data.name}\n` +
    `📞 Teléfono: ${session.data.phone_contacto}\n` +
    `📍 Dirección: ${session.data.address}\n` +
    `💳 Pago: ${session.data.payment}\n` +
    `🏷️ Tipo: ${tipo}\n\n` +
    `*¿Confirmas el pedido?*`,
    tenant
  );

  await sendInteractiveButtons(phone,
    'Confirma para registrar el pedido:',
    [
      { id: 'CONF_SI', title: '✅ Sí, confirmo'     },
      { id: 'CONF_NO', title: '✏️ Modificar pedido' },
    ],
    tenant
  );
}

async function handleOrderConfirm(phone, session, txt, id, tenant, notifier) {
  const opt = id || txt;

  if (opt === 'CONF_NO' || txt.includes('modif') || txt === 'no') {
    session.step = S.ORDER_REF;
    await sendText(phone,
      '✏️ Entendido. Empecemos de nuevo.\n\n*¿Cuál es el N° de referencia que deseas?*',
      tenant
    );
    session.data.referencia = undefined;
    session.data.talla      = undefined;
    session.data.cantidad   = undefined;
    return;
  }

  // Confirmar
  const orderNum = `HS-${Date.now().toString(36).toUpperCase()}`;
  session.data.order_number = orderNum;

  await sendText(phone,
    `✅ *¡Pedido registrado exitosamente!*\n\n` +
    `🎉 N° de pedido: *${orderNum}*\n` +
    `⏱️ Tiempo de entrega estimado: 2–5 días hábiles\n\n` +
    `Un asesor confirmará los detalles y te indicará cómo realizar el pago. 📲\n` +
    `Tiempo de respuesta: máx. 15 min en horario comercial.\n\n` +
    `¡Gracias por tu compra en *Hollywood Store*! 🎬👗`,
    tenant
  );

  setImmediate(() => notifier.notifySale(phone, session.data, tenant));

  // Reset parcial
  const name = session.data.name;
  session.data = { name };
  session.step = S.MENU;

  await sendText(phone, '¿Hay algo más en lo que te pueda ayudar? Escribe *menú*. 😊', tenant);
}

// ── Menú principal ────────────────────────────────────────────────────────

async function sendMainMenu(phone, session, tenant) {
  session.step = S.MENU;
  const greeting = session.data?.name
    ? `¡Hola de nuevo, ${session.data.name}! 👋`
    : `¡Hola! Muy buenos días / buenas tardes. ¡Bienvenidos a *Hollywood Store*! 🎬👗\nSerá un placer atenderlos hoy.`;

  await sendInteractiveButtons(phone,
    `${greeting}\n\n*¿Eres cliente MAYORISTA o DETAL?*`,
    [
      { id: 'OPT_MAYORISTA', title: '1️⃣ MAYORISTA (+12 und.)' },
      { id: 'OPT_DETAL',     title: '2️⃣ DETAL (unidades)'     },
    ],
    tenant
  );
}

// ── Dispatcher principal ──────────────────────────────────────────────────

async function processMessage(phone, rawMsg, session, tenant, notifier) {
  const parsed = extractInput(rawMsg);
  const { type, text, interactiveId } = parsed;

  if (type === 'audio' || type === 'image' || type === 'unsupported') {
    await sendText(phone, '📱 Solo proceso mensajes de texto y botones. Escribe *menú* para continuar.', tenant);
    return;
  }

  const txt = text.toLowerCase().trim();
  const id  = interactiveId;

  if (RESET_CMDS.has(txt)) {
    await sendMainMenu(phone, session, tenant);
    return;
  }

  switch (session.step) {
    case S.MENU:
    case undefined:
    case null: {
      const opt = id || txt;
      if (opt === 'OPT_MAYORISTA' || txt.includes('mayor') || txt === '1') {
        await iniciarMayorista(phone, session, tenant);
      } else if (opt === 'OPT_DETAL' || txt.includes('detal') || txt.includes('detail') || txt === '2') {
        await iniciarDetal(phone, session, tenant);
      } else {
        await sendMainMenu(phone, session, tenant);
      }
      break;
    }

    case S.MAY_AUDIO:
      await handleMayAudio(phone, session, txt, id, tenant);
      break;

    case S.MAY_PHOTOS:
      await handleMayPhotos(phone, session, txt, id, tenant);
      break;

    case S.DET_TALLA:
      await handleDetTalla(phone, session, txt, id, tenant);
      break;

    case S.DET_PHOTOS:
      await handleDetPhotos(phone, session, txt, id, tenant);
      break;

    case S.DET_AUDIO:
      await handleDetAudio(phone, session, txt, id, tenant);
      break;

    case S.ORDER_REF:
      await handleOrderRef(phone, session, txt, tenant);
      break;

    case S.ORDER_TALLA:
      await handleOrderTalla(phone, session, txt, id, tenant);
      break;

    case S.ORDER_CANT:
      await handleOrderCant(phone, session, txt, tenant);
      break;

    case S.ORDER_NAME:
      await handleOrderName(phone, session, txt, tenant);
      break;

    case S.ORDER_PHONE:
      await handleOrderPhone(phone, session, txt, tenant);
      break;

    case S.ORDER_ADDR:
      await handleOrderAddr(phone, session, txt, tenant);
      break;

    case S.ORDER_PAY:
      await handleOrderPay(phone, session, txt, id, tenant);
      break;

    case S.ORDER_CONFIRM:
      await handleOrderConfirm(phone, session, txt, id, tenant, notifier);
      break;

    default:
      await sendMainMenu(phone, session, tenant);
  }
}

module.exports = { processMessage };
