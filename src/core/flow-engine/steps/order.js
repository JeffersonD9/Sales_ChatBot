/**
 * steps/order.js — Recopilación de datos del pedido y consulta de estado
 *
 * Migrado de orderHandler.js. Cambios clave:
 *   - Recibe `tenant` como parámetro
 *   - notifySale es fire-and-forget (setImmediate)
 *   - handleCheckOrder consulta la DB real (stub listo para implementar)
 */

const { STEP }                                   = require('../../../utils/constants');
const { formatPrice, capitalizeName }             = require('../../../utils/formatters');
const { sendText, sendInteractiveButtons }        = require('../../whatsapp/sender');
const { getStoreInfo }                            = require('../../catalog');
const { query }                                   = require('../../../db');
const { logger }                                  = require('../../../utils/logger');

const PAYMENT_LABELS = {
  PAY_EFECTIVO:      'Contraentrega en efectivo',
  PAY_NEQUI:         'Nequi / Daviplata',
  PAY_TRANSFERENCIA: 'Transferencia bancaria',
};

// ── ORDER_NAME ────────────────────────────────────────────────────────────

async function handleOrderName(phone, session, txt, tenant) {
  if (txt.length < 3) {
    await sendText(phone, 'Por favor escribe tu nombre completo:', tenant);
    return;
  }
  session.data.name = capitalizeName(txt);
  session.step      = STEP.ORDER_ADDRESS;
  await sendText(phone,
    `Gracias, *${session.data.name}* \uD83D\uDE0A\n\n` +
    `*\u00bfCu\u00e1l es tu direcci\u00f3n de entrega?*\n_Ej: Cra 15 #32-45, Cabecera, Bucaramanga_`,
    tenant
  );
}

// ── ORDER_ADDRESS ─────────────────────────────────────────────────────────

async function handleOrderAddress(phone, session, txt, tenant) {
  if (txt.length < 5) {
    await sendText(phone, 'Por favor escribe tu direcci\u00f3n completa (calle, barrio, ciudad):', tenant);
    return;
  }
  session.data.address = txt;
  session.step         = STEP.ORDER_PAYMENT;
  await sendInteractiveButtons(phone,
    `\uD83D\uDCCD Direcci\u00f3n anotada.\n\n*\u00bfC\u00f3mo prefieres pagar?*`,
    [
      { id: 'PAY_EFECTIVO',      title: '\uD83D\uDCB5 Contraentrega'    },
      { id: 'PAY_NEQUI',         title: '\uD83D\uDCF1 Nequi/Daviplata'  },
      { id: 'PAY_TRANSFERENCIA', title: '\uD83C\uDFE6 Transferencia'    },
    ],
    tenant
  );
}

// ── ORDER_PAYMENT ─────────────────────────────────────────────────────────

async function handleOrderPayment(phone, session, txt, tenant, notifier) {
  let payment =
    PAYMENT_LABELS[txt.toUpperCase()] ||
    PAYMENT_LABELS[Object.keys(PAYMENT_LABELS).find((k) => txt.toUpperCase() === k)] ||
    null;

  if (!payment) {
    if (txt.includes('efectivo') || txt.includes('contraren'))  payment = 'Contraentrega en efectivo';
    else if (txt.includes('nequi') || txt.includes('davi'))     payment = 'Nequi / Daviplata';
    else if (txt.includes('transfer') || txt.includes('banco')) payment = 'Transferencia bancaria';
    else payment = txt;
  }

  session.data.payment = payment;

  const product = session.data.selectedProduct || session.shownProducts?.[0];
  const total   = product?.price || 0;
  const store   = getStoreInfo(tenant);

  const summary =
    `\u2705 *\u00a1Pedido registrado exitosamente!*\n\n` +
    `\uD83D\uDCCB *Resumen:*\n` +
    `\uD83D\uDC64 Nombre: ${session.data.name}\n` +
    `\uD83D\uDCCD Direcci\u00f3n: ${session.data.address}\n` +
    `\uD83D\uDCB3 Pago: ${payment}\n` +
    (product ? `\uD83D\uDECD\uFE0F Producto: ${product.emoji} ${product.name}\n` : '') +
    `\uD83D\uDCB0 Total: *${formatPrice(total)} COP*\n\n` +
    `\uD83D\uDCF2 Un asesor te confirmar\u00e1 el pedido en breve.\n` +
    `\u23F1\uFE0F Tiempo de entrega: 1\u20132 d\u00edas h\u00e1biles\n\n` +
    `\u00a1Gracias por comprar en *${store.name}*! \uD83C\uDF89`;

  await sendText(phone, summary, tenant);

  // Guardar pedido en DB y notificar al dueño — ambos fire-and-forget
  const orderData = {
    name:     session.data.name,
    address:  session.data.address,
    payment,
    products: product ? [product] : [],
  };

  setImmediate(() => notifier.notifySale(phone, orderData, tenant));
  setImmediate(() => _saveOrder(session, phone, tenant, orderData, total));

  // Reset parcial — conservar nombre para saludos futuros
  const name           = session.data.name;
  session.data         = { name };
  session.shownProducts = [];
  session.step         = STEP.MENU;

  await sendText(phone, '\u00bfHay algo m\u00e1s en lo que te pueda ayudar? Escribe *men\u00fa* para continuar. \uD83D\uDE0A', tenant);
}

// ── CHECK_ORDER ───────────────────────────────────────────────────────────

async function handleCheckOrder(phone, session, txt, tenant) {
  let statusMsg;

  // Intentar buscar en BD real
  try {
    if (process.env.DEMO_MODE !== 'true' && process.env.NODE_ENV !== 'test') {
      const result = await query(
        `SELECT o.id, o.status, o.created_at, o.items
         FROM orders o
         JOIN tenants t ON o.tenant_id = t.id
         WHERE t.slug = $1
           AND (o.customer_phone = $2 OR o.customer_name ILIKE $3)
         ORDER BY o.created_at DESC
         LIMIT 1`,
        [tenant.slug, phone, `%${txt}%`]
      );

      if (result.rows[0]) {
        const order = result.rows[0];
        const statusLabels = {
          pending:   '\u2705 En preparaci\u00f3n \u2014 Estamos alistando tu paquete.',
          shipped:   '\uD83D\uDE9A En camino \u2014 Tu pedido ya fue despachado.',
          delivered: '\uD83C\uDF89 Entregado \u2014 \u00a1Tu pedido fue recibido!',
          cancelled: '\u274C Cancelado \u2014 Cont\u00e1ctanos para m\u00e1s info.',
        };
        statusMsg =
          `\uD83D\uDCE6 *Estado de tu pedido:*\n\n` +
          `${statusLabels[order.status] || order.status}\n` +
          `\uD83D\uDCC5 Fecha: ${new Date(order.created_at).toLocaleDateString('es-CO')}\n\n` +
          `\u00bfTienes alguna otra duda? Escribe *men\u00fa* para volver. \uD83D\uDE0A`;
      }
    }
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, phone, err: err.message }, '[Order] Error consultando pedido');
  }

  if (!statusMsg) {
    statusMsg =
      `\uD83D\uDD0D No encontramos ning\u00fan pedido con *"${txt}"*.\n\n` +
      `Verifica el nombre o n\u00famero con el que lo hiciste, o escribe *men\u00fa* para volver. \uD83D\uDE0A`;
  }

  await sendText(phone, statusMsg, tenant);
  session.step = STEP.MENU;
}

// ── Helpers privados ──────────────────────────────────────────────────────

async function _saveOrder(session, phone, tenant, orderData, total) {
  if (process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'test') return;
  try {
    await query(
      `INSERT INTO orders
         (tenant_id, customer_phone, customer_name, customer_address,
          items, payment_method, total, status)
       VALUES (
         (SELECT id FROM tenants WHERE slug = $1),
         $2, $3, $4, $5, $6, $7, 'pending'
       )`,
      [
        tenant.slug,
        phone,
        orderData.name,
        orderData.address,
        JSON.stringify(orderData.products),
        orderData.payment,
        total,
      ]
    );
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, phone, err: err.message }, '[Order] Error guardando pedido en DB');
  }
}

module.exports = { handleOrderName, handleOrderAddress, handleOrderPayment, handleCheckOrder };
