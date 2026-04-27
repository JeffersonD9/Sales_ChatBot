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

/**
 * Notifica al dueno del negocio que su suscripcion vencio hoy.
 * @param {object} tenant
 */
async function notifyBillingDue(tenant) {
  const storeName = tenant.bot_config?.business_name || tenant.name;
  const amount    = tenant.billing_amount
    ? formatPrice(tenant.billing_amount)
    : 'el valor acordado';

  const msg =
    `🔔 *Renovacion vencida — ${storeName}*\n\n` +
    `Tu suscripcion del bot vencio hoy.\n` +
    `💰 *Valor:* ${amount} COP\n\n` +
    `Tienes *3 dias* para renovar antes de que el bot se pause.\n` +
    `Envínos el comprobante de pago para reactivar de inmediato.\n\n` +
    `_Jest Tech Solutions_`;

  try {
    await sendText(tenant.owner_phone, msg, tenant);
    await _sendEmail(
      `🔔 Renovacion vencida — ${storeName}`,
      `<pre>${msg}</pre>`,
      tenant
    );
    logger.info({ tenantSlug: tenant.slug }, '[Notify] Billing vencido notificado');
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, err: err.message }, '[Notify] Error notificando billing due');
  }
}

/**
 * Recordatorio durante el periodo de gracia (dias 1 y 2).
 * @param {object} tenant
 * @param {number} daysLeft - Dias restantes antes de suspension
 */
async function notifyBillingReminder(tenant, daysLeft) {
  const storeName = tenant.bot_config?.business_name || tenant.name;
  const msg =
    `⚠️ *Recordatorio de pago — ${storeName}*\n\n` +
    `Queda${daysLeft === 1 ? '' : 'n'} *${daysLeft} dia${daysLeft === 1 ? '' : 's'}* ` +
    `para que tu bot se pause por falta de pago.\n\n` +
    `Envínos el comprobante para evitar interrupciones.\n\n` +
    `_Jest Tech Solutions_`;

  try {
    await sendText(tenant.owner_phone, msg, tenant);
    logger.info({ tenantSlug: tenant.slug, daysLeft }, '[Notify] Recordatorio billing enviado');
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, err: err.message }, '[Notify] Error recordatorio billing');
  }
}

/**
 * Notifica al dueno que su bot fue suspendido por falta de pago.
 * @param {object} tenant
 */
async function notifyBillingSuspended(tenant) {
  const storeName = tenant.bot_config?.business_name || tenant.name;
  const msg =
    `🚫 *Bot pausado — ${storeName}*\n\n` +
    `Tu bot fue pausado temporalmente por falta de pago.\n\n` +
    `Para reactivarlo envínos tu comprobante de pago.\n` +
    `La reactivacion es inmediata una vez confirmemos el pago.\n\n` +
    `_Jest Tech Solutions_`;

  try {
    await sendText(tenant.owner_phone, msg, tenant);
    await _sendEmail(
      `🚫 Bot pausado — ${storeName}`,
      `<pre>${msg}</pre>`,
      tenant
    );
    logger.info({ tenantSlug: tenant.slug }, '[Notify] Suspension billing notificada');
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, err: err.message }, '[Notify] Error notificando suspension');
  }
}

/**
 * Notifica al admin (Jefferson) sobre eventos de billing.
 * @param {'past_due'|'reminder'|'suspended'} event
 * @param {object} tenant
 * @param {{ daysOverdue?: number, daysLeft?: number }} [extra]
 */
async function notifyAdminBilling(event, tenant, extra = {}) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const labels = {
    past_due:  '🔔 Vencio hoy',
    reminder:  '⚠️ En periodo de gracia',
    suspended: '🚫 Suspendido',
  };

  const subject = `[Billing] ${labels[event] || event} — ${tenant.slug}`;
  const body = `
    <b>Evento:</b> ${event}<br>
    <b>Tenant:</b> ${tenant.slug} (${tenant.name})<br>
    <b>Plan:</b> ${tenant.plan || '-'}<br>
    <b>Monto:</b> $${(tenant.billing_amount || 0).toLocaleString('es-CO')} COP<br>
    <b>Proximo cobro:</b> ${tenant.next_billing_date || '-'}<br>
    ${extra.daysOverdue !== undefined ? `<b>Dias vencido:</b> ${extra.daysOverdue}<br>` : ''}
    ${extra.daysLeft    !== undefined ? `<b>Dias restantes:</b> ${extra.daysLeft}<br>` : ''}
    <b>Owner phone:</b> ${tenant.owner_phone}<br>
    <b>Owner email:</b> ${tenant.owner_email || '-'}
  `;

  const transporter = getTransporter();
  if (!transporter) return;

  try {
    await transporter.sendMail({
      from:    `"Jest Tech Billing" <${process.env.SMTP_USER}>`,
      to:      adminEmail,
      subject,
      html:    body,
    });
  } catch (err) {
    logger.error({ tenantSlug: tenant.slug, event, err: err.message }, '[Notify] Error notificando admin billing');
  }
}

module.exports = {
  notifySale, notifyAdvisorRequest, notifyLead,
  notifyBillingDue, notifyBillingReminder, notifyBillingSuspended, notifyAdminBilling,
};
