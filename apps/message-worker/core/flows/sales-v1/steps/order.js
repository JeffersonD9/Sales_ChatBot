/**
 * steps/order.js — Recopilación de datos del pedido y consulta de estado
 */

const { STEP }                                   = require('@whatsapp-saas/shared-utils');
const { formatPrice, capitalizeName }             = require('@whatsapp-saas/shared-utils');
const { sendText, sendInteractiveButtons }        = require('../../../whatsapp/sender');
const { getStoreInfo }                            = require('../../../catalog');
const { sql }                                     = require('drizzle-orm');
const { getDbForTenant }                          = require('../../../../../../packages/platform-data/src/tenant/database/tenantDb');
const { logger }                                  = require('@whatsapp-saas/logger');

const PAYMENT_LABELS = {
  PAY_EFECTIVO:      'Contraentrega en efectivo',
  PAY_NEQUI:         'Nequi / Daviplata',
  PAY_TRANSFERENCIA: 'Transferencia bancaria',
};

async function handleOrderName(phone, session, txt, tenant) {
  if (txt.length < 3) {
    await sendText(phone, 'Por favor escribe tu nombre completo:', tenant);
    return;
  }
  session.data.name = capitalizeName(txt);
  session.step      = STEP.ORDER_ADDRESS;
  await sendText(phone,
    `Gracias, *${session.data.name}* 😊\n\n` +
    `*¿Cuál es tu dirección de entrega?*\n_Ej: Cra 15 #32-45, Cabecera, Bucaramanga_`,
    tenant
  );
}

async function handleOrderAddress(phone, session, txt, tenant) {
  if (txt.length < 5) {
    await sendText(phone, 'Por favor escribe tu dirección completa (calle, barrio, ciudad):', tenant);
    return;
  }
  session.data.address = txt;
  session.step         = STEP.ORDER_PAYMENT;
  await sendInteractiveButtons(phone,
    `📍 Dirección anotada.\n\n*¿Cómo prefieres pagar?*`,
    [
      { id: 'PAY_EFECTIVO',      title: '💵 Contraentrega'    },
      { id: 'PAY_NEQUI',         title: '📱 Nequi/Daviplata'  },
      { id: 'PAY_TRANSFERENCIA', title: '🏦 Transferencia'    },
    ],
    tenant
  );
}

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
    `✅ *¡Pedido registrado exitosamente!*\n\n` +
    `📋 *Resumen:*\n` +
    `👤 Nombre: ${session.data.name}\n` +
    `📍 Dirección: ${session.data.address}\n` +
    `💳 Pago: ${payment}\n` +
    (product ? `🛍️ Producto: ${product.emoji} ${product.name}\n` : '') +
    `💰 Total: *${formatPrice(total)} COP*\n\n` +
    `📲 Un asesor te confirmará el pedido en breve.\n` +
    `⏱️ Tiempo de entrega: 1–2 días hábiles\n\n` +
    `¡Gracias por comprar en *${store.name}*! 🎉`;

  await sendText(phone, summary, tenant);

  const orderData = {
    name:     session.data.name,
    address:  session.data.address,
    payment,
    products: product ? [product] : [],
  };

  setImmediate(() => notifier.notifySale(phone, orderData, tenant));
  setImmediate(() => _saveOrder(session, phone, tenant, orderData, total));

  const name           = session.data.name;
  session.data         = { name };
  session.shownProducts = [];
  session.step         = STEP.MENU;

  await sendText(phone, '¿Hay algo más en lo que te pueda ayudar? Escribe *menú* para continuar. 😊', tenant);
}

async function handleCheckOrder(phone, session, txt, tenant) {
  let statusMsg;

  try {
    if (process.env.DEMO_MODE !== 'true' && process.env.NODE_ENV !== 'test') {
      const tenantId = tenant.tenantId ?? tenant.id;
      const db = await getDbForTenant(tenant);
      const result = await db.execute(sql`
        SELECT id, status, created_at, items
        FROM orders
        WHERE tenant_id = ${tenantId}::uuid
          AND (customer_phone = ${phone} OR customer_name ILIKE ${'%' + txt + '%'})
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (result.rows[0]) {
        const order = result.rows[0];
        const statusLabels = {
          pending:   '✅ En preparación — Estamos alistando tu paquete.',
          shipped:   '🚚 En camino — Tu pedido ya fue despachado.',
          delivered: '🎉 Entregado — ¡Tu pedido fue recibido!',
          cancelled: '❌ Cancelado — Contáctanos para más info.',
        };
        statusMsg =
          `📦 *Estado de tu pedido:*\n\n` +
          `${statusLabels[order.status] || order.status}\n` +
          `📅 Fecha: ${new Date(order.created_at).toLocaleDateString('es-CO')}\n\n` +
          `¿Tienes alguna otra duda? Escribe *menú* para volver. 😊`;
      }
    }
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, phone, err: err.message }, '[Order] Error consultando pedido');
  }

  if (!statusMsg) {
    statusMsg =
      `🔍 No encontramos ningún pedido con *"${txt}"*.\n\n` +
      `Verifica el nombre o número con el que lo hiciste, o escribe *menú* para volver. 😊`;
  }

  await sendText(phone, statusMsg, tenant);
  session.step = STEP.MENU;
}

async function _saveOrder(session, phone, tenant, orderData, total) {
  if (process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'test') return;
  try {
    const tenantId = tenant.tenantId ?? tenant.id;
    const db = await getDbForTenant(tenant);
    await db.execute(sql`
      INSERT INTO orders
        (tenant_id, customer_phone, customer_name, customer_address,
         items, payment_method, total, status)
      VALUES (
        ${tenantId}::uuid,
        ${phone},
        ${orderData.name},
        ${orderData.address},
        ${JSON.stringify(orderData.products)}::jsonb,
        ${orderData.payment},
        ${total},
        'pending'
      )
    `);
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, phone, err: err.message }, '[Order] Error guardando pedido en DB');
  }
}

module.exports = { handleOrderName, handleOrderAddress, handleOrderPayment, handleCheckOrder };
