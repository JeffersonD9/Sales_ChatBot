'use strict';

/**
 * billing/billingService.js — Control de suscripciones y cobros
 *
 * Logica del ciclo mensual:
 *   Dia 0  (next_billing_date): marcar past_due, notificar al dueno y al admin
 *   Dia 1-2 (gracia):           recordatorio diario al dueno
 *   Dia 3+ (gracia vencida):    suspender tenant, notificar
 */

const { eq, and, inArray, isNotNull, sql } = require('drizzle-orm');
const { getDb }  = require('../../drizzle/db');
const { tenants } = require('../../drizzle/schema');
const { logger } = require('@whatsapp-saas/logger');
const { notifyBillingDue, notifyBillingReminder, notifyBillingSuspended,
        notifyAdminBilling } = require('@whatsapp-saas/notifications');

function daysBetween(date1, date2) {
  const d1 = new Date(date1); d1.setHours(0, 0, 0, 0);
  const d2 = new Date(date2); d2.setHours(0, 0, 0, 0);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function addOneMonth(date) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
}

async function checkBillingCycle() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  logger.info('[Billing] Iniciando revision de ciclos de facturacion');

  const db = getDb();

  const rows = await db
    .select({
      id:                  tenants.id,
      slug:                tenants.slug,
      name:                tenants.name,
      owner_phone:         tenants.owner_phone,
      owner_email:         tenants.owner_email,
      plan:                tenants.plan,
      billing_amount:      tenants.billing_amount,
      subscription_status: tenants.subscription_status,
      next_billing_date:   tenants.next_billing_date,
      grace_period_days:   tenants.grace_period_days,
      bot_config:          tenants.bot_config,
    })
    .from(tenants)
    .where(
      and(
        eq(tenants.status, 'active'),
        inArray(tenants.subscription_status, ['active', 'past_due']),
        isNotNull(tenants.next_billing_date)
      )
    );

  let actioned = 0;

  for (const tenant of rows) {
    const daysOverdue = daysBetween(tenant.next_billing_date, today);

    if (daysOverdue < 0) continue;

    if (daysOverdue === 0 && tenant.subscription_status === 'active') {
      await db.update(tenants)
        .set({ subscription_status: 'past_due' })
        .where(eq(tenants.id, tenant.id));
      await notifyBillingDue(tenant);
      await notifyAdminBilling('past_due', tenant);
      logger.info({ tenantSlug: tenant.slug }, '[Billing] Vencio hoy — marcado past_due');
      actioned++;

    } else if (daysOverdue >= 1 && daysOverdue < tenant.grace_period_days) {
      const daysLeft = tenant.grace_period_days - daysOverdue;
      await notifyBillingReminder(tenant, daysLeft);
      await notifyAdminBilling('reminder', tenant, { daysOverdue, daysLeft });
      logger.info({ tenantSlug: tenant.slug, daysOverdue, daysLeft }, '[Billing] Recordatorio enviado');
      actioned++;

    } else if (daysOverdue >= tenant.grace_period_days) {
      await db.update(tenants)
        .set({ status: 'suspended', subscription_status: 'suspended' })
        .where(eq(tenants.id, tenant.id));
      await notifyBillingSuspended(tenant);
      await notifyAdminBilling('suspended', tenant);
      logger.warn({ tenantSlug: tenant.slug, daysOverdue }, '[Billing] Tenant suspendido por falta de pago');
      actioned++;
    }
  }

  logger.info({ actioned, total: rows.length }, '[Billing] Revision completada');
}

async function recordPayment(slug, amount) {
  const db    = getDb();
  const today = new Date().toISOString().split('T')[0];

  const found = await db
    .select({
      id:                  tenants.id,
      slug:                tenants.slug,
      name:                tenants.name,
      next_billing_date:   tenants.next_billing_date,
      billing_cycle_start: tenants.billing_cycle_start,
    })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);

  if (!found[0]) throw new Error(`Tenant no encontrado: ${slug}`);

  const tenant         = found[0];
  const newNextBilling = addOneMonth(today);
  const cycleStart     = tenant.billing_cycle_start || today;

  const updated = await db
    .update(tenants)
    .set({
      status:              'active',
      subscription_status: 'active',
      billing_amount:      amount || sql`${tenants.billing_amount}`,
      billing_cycle_start: cycleStart,
      next_billing_date:   newNextBilling,
      last_payment_at:     sql`NOW()`,
    })
    .where(eq(tenants.id, tenant.id))
    .returning({
      id:                  tenants.id,
      slug:                tenants.slug,
      name:                tenants.name,
      plan:                tenants.plan,
      billing_amount:      tenants.billing_amount,
      next_billing_date:   tenants.next_billing_date,
      subscription_status: tenants.subscription_status,
    });

  logger.info({ tenantSlug: slug, amount, nextBilling: newNextBilling }, '[Billing] Pago registrado');

  return updated[0];
}

module.exports = { checkBillingCycle, recordPayment, addOneMonth, daysBetween };
