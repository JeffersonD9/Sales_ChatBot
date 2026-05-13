import platformData from '../../../packages/platform-data/index.js';
import senderModule from '../core/whatsapp/sender.js';
import loggerModule from '@whatsapp-saas/logger';
import cryptoModule from '@whatsapp-saas/shared-utils';

const { query } = platformData.db;
const { sendText } = senderModule;
const { logger } = loggerModule;
const { decrypt } = cryptoModule;

const PREMIUM_PLANS = ['premium', 'enterprise'];

function msUntilHour(hour) {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

export async function runCartRecovery() {
  try {
    const res = await query(`
      SELECT
        s.tenant_id, s.wa_from, s.step, s.data,
        t.slug, t.phone_number_id, t.wa_token_encrypted, t.owner_phone, t.plan,
        t.name, t.bot_config
      FROM sessions s
      JOIN tenants t ON t.id = s.tenant_id
      WHERE s.step IN ('ORDER_NAME', 'ORDER_ADDRESS', 'ORDER_PAYMENT')
        AND s.last_activity < NOW() - INTERVAL '24 hours'
        AND s.abandoned_notified_at IS NULL
        AND t.subscription_status = 'active'
        AND t.plan = ANY($1)
    `, [PREMIUM_PLANS]);

    if (res.rows.length === 0) return;

    for (const row of res.rows) {
      try {
        const waToken = decrypt(row.wa_token_encrypted);
        const tenant = { ...row, wa_token: waToken };
        const nombre = row.data?.name || null;
        const saludo = nombre ? `Hola ${nombre}` : 'Hola';

        await sendText(row.wa_from,
          `${saludo} Vimos que te quedaste a un paso de completar tu pedido. ` +
          'Quieres que te ayudemos a terminarlo? Escribenos cuando quieras.',
          tenant
        );

        await query(
          `UPDATE sessions SET abandoned_notified_at = NOW()
           WHERE tenant_id = $1 AND wa_from = $2`,
          [row.tenant_id, row.wa_from]
        );

        logger.info({ tenantSlug: row.slug, phone: row.wa_from }, '[Scheduler] Cart recovery enviado');
      } catch (err) {
        logger.warn({ tenantSlug: row.slug, phone: row.wa_from, err: err.message }, '[Scheduler] Error en cart recovery row');
      }
    }

    logger.info({ count: res.rows.length }, '[Scheduler] Cart recovery completado');
  } catch (err) {
    logger.error({ err: err.message }, '[Scheduler] Error en cart recovery');
  }
}

export async function runDailySummary() {
  try {
    const tenantsRes = await query(
      `SELECT id, slug, name, bot_config, owner_phone, phone_number_id,
              wa_token_encrypted
       FROM tenants
       WHERE subscription_status = 'active'
         AND plan = ANY($1)`,
      [PREMIUM_PLANS]
    );

    if (tenantsRes.rows.length === 0) return;

    for (const row of tenantsRes.rows) {
      try {
        const statsRes = await query(`
          SELECT
            COUNT(DISTINCT wa_from) FILTER (
              WHERE created_at::date = CURRENT_DATE
            ) AS nuevas_conversaciones,
            COUNT(*) FILTER (
              WHERE step = 'ORDER_DONE' AND last_activity::date = CURRENT_DATE
            ) AS pedidos_completados,
            COUNT(*) FILTER (
              WHERE abandoned_notified_at::date = CURRENT_DATE
            ) AS carritos_recuperados
          FROM sessions
          WHERE tenant_id = $1
        `, [row.id]);

        const s = statsRes.rows[0];
        const nuevas = parseInt(s.nuevas_conversaciones, 10) || 0;
        const pedidos = parseInt(s.pedidos_completados, 10) || 0;
        const recuperados = parseInt(s.carritos_recuperados, 10) || 0;

        if (nuevas === 0 && pedidos === 0) continue;

        const storeName = row.bot_config?.business_name || row.name;
        const waToken = decrypt(row.wa_token_encrypted);
        const tenant = { ...row, wa_token: waToken };

        await sendText(row.owner_phone,
          `Resumen del dia - ${storeName}\n\n` +
          `Conversaciones nuevas: ${nuevas}\n` +
          `Pedidos completados: ${pedidos}\n` +
          `Carritos recuperados: ${recuperados}`,
          tenant
        );

        logger.info({ tenantSlug: row.slug, nuevas, pedidos, recuperados }, '[Scheduler] Resumen diario enviado');
      } catch (err) {
        logger.warn({ tenantSlug: row.slug, err: err.message }, '[Scheduler] Error en resumen diario row');
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, '[Scheduler] Error en resumen diario');
  }
}

export function startScheduler() {
  const recoveryHour = parseInt(process.env.CART_RECOVERY_HOUR || '9', 10);
  const summaryHour = parseInt(process.env.DAILY_SUMMARY_HOUR || '20', 10);

  setTimeout(function runRecovery() {
    runCartRecovery();
    setTimeout(runRecovery, 24 * 60 * 60 * 1000);
  }, msUntilHour(recoveryHour));

  setTimeout(function runSummary() {
    runDailySummary();
    setTimeout(runSummary, 24 * 60 * 60 * 1000);
  }, msUntilHour(summaryHour));

  logger.info({ recoveryHour, summaryHour }, '[Scheduler] Premium IA scheduler iniciado');
}
