'use strict';

/**
 * billing/billingService.js — Control de suscripciones y cobros
 *
 * Logica del ciclo mensual:
 *   Dia 0  (next_billing_date): marcar past_due, notificar al dueno y al admin
 *   Dia 1-2 (gracia):           recordatorio diario al dueno
 *   Dia 3+ (gracia vencida):    suspender tenant, notificar
 *
 * El cron en server.js llama checkBillingCycle() cada dia a las 8am.
 * El script mark-payment.js llama recordPayment() cuando llega un pago.
 */

const { query }  = require('../db');
const { logger } = require('../utils/logger');
const { notifyBillingDue, notifyBillingReminder, notifyBillingSuspended,
        notifyAdminBilling } = require('../notifications/notifier');

// Dias entre dos fechas (date2 - date1, positivo si date2 > date1)
function daysBetween(date1, date2) {
  const d1 = new Date(date1); d1.setHours(0, 0, 0, 0);
  const d2 = new Date(date2); d2.setHours(0, 0, 0, 0);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

// Sumar un mes exacto a una fecha (respeta el dia del ciclo)
function addOneMonth(date) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Corre una vez al dia (desde server.js).
 * Revisa todos los tenants activos con fecha de cobro definida y actua segun el estado.
 */
async function checkBillingCycle() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  logger.info('[Billing] Iniciando revision de ciclos de facturacion');

  const { rows: tenants } = await query(`
    SELECT id, slug, name, owner_phone, owner_email,
           plan, billing_amount, subscription_status,
           next_billing_date, grace_period_days, bot_config
    FROM tenants
    WHERE status = 'active'
      AND subscription_status IN ('active', 'past_due')
      AND next_billing_date IS NOT NULL
  `);

  let actioned = 0;

  for (const tenant of tenants) {
    const daysOverdue = daysBetween(tenant.next_billing_date, today);

    if (daysOverdue < 0) continue; // Aun no vence

    if (daysOverdue === 0 && tenant.subscription_status === 'active') {
      // Vence hoy — marcar past_due y notificar
      await query(
        `UPDATE tenants SET subscription_status = 'past_due' WHERE id = $1`,
        [tenant.id]
      );
      await notifyBillingDue(tenant);
      await notifyAdminBilling('past_due', tenant);
      logger.info({ tenantSlug: tenant.slug }, '[Billing] Vencio hoy — marcado past_due');
      actioned++;

    } else if (daysOverdue >= 1 && daysOverdue < tenant.grace_period_days) {
      // Dentro del periodo de gracia — recordatorio
      const daysLeft = tenant.grace_period_days - daysOverdue;
      await notifyBillingReminder(tenant, daysLeft);
      await notifyAdminBilling('reminder', tenant, { daysOverdue, daysLeft });
      logger.info({ tenantSlug: tenant.slug, daysOverdue, daysLeft }, '[Billing] Recordatorio enviado');
      actioned++;

    } else if (daysOverdue >= tenant.grace_period_days) {
      // Gracia vencida — suspender
      await query(
        `UPDATE tenants SET status = 'suspended', subscription_status = 'suspended' WHERE id = $1`,
        [tenant.id]
      );
      await notifyBillingSuspended(tenant);
      await notifyAdminBilling('suspended', tenant);
      logger.warn({ tenantSlug: tenant.slug, daysOverdue }, '[Billing] Tenant suspendido por falta de pago');
      actioned++;
    }
  }

  logger.info({ actioned, total: tenants.length }, '[Billing] Revision completada');
}

/**
 * Registra un pago recibido. Reactiva el tenant y avanza el ciclo un mes.
 * Llamado desde scripts/mark-payment.js
 *
 * @param {string} slug
 * @param {number} amount - Monto recibido en COP
 * @returns {object} tenant actualizado
 */
async function recordPayment(slug, amount) {
  const today = new Date().toISOString().split('T')[0];

  const { rows } = await query(
    `SELECT id, slug, name, next_billing_date, billing_cycle_start FROM tenants WHERE slug = $1`,
    [slug]
  );

  if (!rows[0]) throw new Error(`Tenant no encontrado: ${slug}`);

  const tenant = rows[0];

  // Si es el primer pago, el ciclo arranca hoy
  // Si ya tenia ciclo activo (ej: pago tarde), el nuevo vencimiento es desde hoy
  const newNextBilling = addOneMonth(today);
  const cycleStart     = tenant.billing_cycle_start || today;

  const { rows: updated } = await query(
    `UPDATE tenants
     SET status               = 'active',
         subscription_status  = 'active',
         billing_amount       = COALESCE(NULLIF($2, 0), billing_amount),
         billing_cycle_start  = $3,
         next_billing_date    = $4,
         last_payment_at      = NOW()
     WHERE id = $1
     RETURNING id, slug, name, plan, billing_amount, next_billing_date, subscription_status`,
    [tenant.id, amount, cycleStart, newNextBilling]
  );

  logger.info({
    tenantSlug: slug,
    amount,
    nextBilling: newNextBilling,
  }, '[Billing] Pago registrado');

  return updated[0];
}

module.exports = { checkBillingCycle, recordPayment, addOneMonth, daysBetween };
