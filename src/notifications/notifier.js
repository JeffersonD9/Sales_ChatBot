/**
 * notifications/notifier.js — Notificaciones al dueño del negocio
 *
 * Migrado de notifyService.js. Cambios clave:
 *   - Recibe `tenant` como parámetro (no lee process.env para owner/business)
 *   - Sender recibe `tenant` como último argumento
 *   - Transporter de email se crea por tenant (usa SMTP global compartido)
 *   - Llamar siempre desde setImmediate en los handlers (fire-and-forget)
 */

const nodemailer           = require('nodemailer');
const { sendText }         = require('../core/whatsapp/sender');
const { formatPrice, formatPhone } = require('../utils/formatters');
const { logger }           = require('../utils/logger');

// ── Transporte de email (lazy init, singleton por proceso) ────────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;

  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transporter;
}

async function _sendEmail(subject, html, tenant) {
  const transporter = getTransporter();
  const ownerEmail  = tenant?.owner_email;
  if (!transporter || !ownerEmail) return;

  try {
    await transporter.sendMail({
      from:    `"Bot ${tenant.name}" <${process.env.SMTP_USER}>`,
      to:      ownerEmail,
      subject,
      html,
    });
  } catch (err) {
    logger.error({ tenantSlug: tenant?.slug, err: err.message }, '[Notify] Error de email');
  }
}

// ── API pública ───────────────────────────────────────────────────────────

/**
 * Notifica al dueño sobre una nueva venta.
 *
 * @param {string} clientPhone
 * @param {{ name, address, payment, products }} orderData
 * @param {object} tenant
 */
async function notifySale(clientPhone, orderData, tenant) {
  const { name, address, payment, products = [] } = orderData;
  const total        = products.reduce((sum, p) => sum + p.price, 0);
  const productLines = products.map((p) => `  \u2022 ${p.name} \u2014 ${formatPrice(p.price)}`).join('\n');
  const storeName    = tenant.bot_config?.business_name || tenant.name;

  const msg =
    `\uD83C\uDF89 *\u00a1NUEVA VENTA \u2014 ${storeName}!*\n\n` +
    `\uD83D\uDC64 *Cliente:* ${name}\n` +
    `\uD83D\uDCF1 *WhatsApp:* ${formatPhone(clientPhone)}\n` +
    `\uD83D\uDCCD *Direcci\u00f3n:* ${address}\n` +
    `\uD83D\uDCB3 *Pago:* ${payment}\n\n` +
    `\uD83D\uDECD\uFE0F *Productos:*\n${productLines || '  (sin detalle)'}\n\n` +
    `\uD83D\uDCB0 *Total: ${formatPrice(total)} COP*\n\n` +
    `_Notificaci\u00f3n autom\u00e1tica \u2014 Bot Jest Tech_`;

  try {
    await sendText(tenant.owner_phone, msg, tenant);
    await _sendEmail(`\uD83C\uDF89 Nueva venta \u2014 ${storeName}`, `<pre>${msg}</pre>`, tenant);
    logger.info({ tenantSlug: tenant.slug, clientPhone, total }, '[Notify] Venta notificada');
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, clientPhone, err: err.message }, '[Notify] Error notificando venta');
  }
}

/**
 * Notifica al dueño que un cliente quiere hablar con un asesor.
 *
 * @param {string} clientPhone
 * @param {object} tenant
 */
async function notifyAdvisorRequest(clientPhone, tenant) {
  const storeName = tenant.bot_config?.business_name || tenant.name;
  const msg =
    `\uD83D\uDD14 *Solicitud de asesor \u2014 ${storeName}*\n\n` +
    `${formatPhone(clientPhone)} quiere hablar con un asesor.\n\n` +
    `Escr\u00edbele: wa.me/${clientPhone}`;

  try {
    await sendText(tenant.owner_phone, msg, tenant);
    logger.info({ tenantSlug: tenant.slug, clientPhone }, '[Notify] Asesor solicitado');
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, clientPhone, err: err.message }, '[Notify] Error notificando asesor');
  }
}

/**
 * Guarda el contacto de un cliente interesado que no compró.
 *
 * @param {string} clientPhone
 * @param {string} [reason]
 * @param {object} tenant
 */
async function notifyLead(clientPhone, reason = '', tenant) {
  const storeName = tenant.bot_config?.business_name || tenant.name;
  const msg =
    `\uD83D\uDCCB *Nuevo lead \u2014 ${storeName}*\n\n` +
    `\uD83D\uDCF1 ${formatPhone(clientPhone)}\n` +
    (reason ? `\uD83D\uDCAC ${reason}\n` : '') +
    `\n_Contactar con oferta personalizada_`;

  try {
    await sendText(tenant.owner_phone, msg, tenant);
    logger.info({ tenantSlug: tenant.slug, clientPhone, reason }, '[Notify] Lead guardado');
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, clientPhone, err: err.message }, '[Notify] Error notificando lead');
  }
}

module.exports = { notifySale, notifyAdvisorRequest, notifyLead };
