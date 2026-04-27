/**
 * scripts/mark-payment.js — Registrar un pago recibido manualmente
 *
 * Uso:
 *   node scripts/mark-payment.js --slug=boutique-ana --amount=150000
 *
 * Que hace:
 *   1. Marca el pago en la DB (last_payment_at, next_billing_date += 1 mes)
 *   2. Reactiva el tenant si estaba suspendido
 *   3. Invalida el cache en Redis para que el bot lo tome en el proximo mensaje
 */

require('dotenv').config();

const { Pool }  = require('pg');
const Redis     = require('ioredis');
const { formatPrice } = require('../src/utils/formatters');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const [key, ...rest] = arg.replace('--', '').split('=');
    args[key] = rest.join('=');
  }
  return {
    slug:   args.slug   || process.env.SLUG,
    amount: parseInt(args.amount || process.env.AMOUNT || '0', 10),
  };
}

function addOneMonth(dateStr) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
}

async function main() {
  const { slug, amount } = parseArgs();

  if (!slug) {
    console.error('Uso: node scripts/mark-payment.js --slug=SLUG --amount=MONTO_COP');
    process.exit(1);
  }

  const pool  = new Pool({ connectionString: process.env.DATABASE_URL });
  let   redis = null;

  try {
    // Buscar tenant
    const { rows } = await pool.query(
      `SELECT id, slug, name, status, subscription_status, billing_cycle_start, billing_amount
       FROM tenants WHERE slug = $1`,
      [slug]
    );

    if (!rows[0]) {
      console.error(`❌ Tenant no encontrado: "${slug}"`);
      process.exit(1);
    }

    const tenant  = rows[0];
    const today   = new Date().toISOString().split('T')[0];
    const nextDate = addOneMonth(today);
    const cycleStart = tenant.billing_cycle_start || today;
    const finalAmount = amount || tenant.billing_amount || 0;

    // Actualizar en DB
    const { rows: updated } = await pool.query(
      `UPDATE tenants
       SET status              = 'active',
           subscription_status = 'active',
           billing_amount      = $2,
           billing_cycle_start = $3,
           next_billing_date   = $4,
           last_payment_at     = NOW()
       WHERE id = $1
       RETURNING slug, name, plan, billing_amount, next_billing_date, subscription_status`,
      [tenant.id, finalAmount, cycleStart, nextDate]
    );

    const t = updated[0];

    // Invalidar cache Redis (el loader usa la clave "tenant:{slug}")
    if (process.env.REDIS_URL) {
      try {
        redis = new Redis(process.env.REDIS_URL, { enableOfflineQueue: false });
        await redis.del(`tenant:${slug}`);
      } catch {
        // Redis opcional — no bloquea
      }
    }

    const wasReactivated = tenant.status !== 'active' || tenant.subscription_status !== 'active';

    console.log('\n✅ Pago registrado exitosamente:');
    console.log(`   Tenant:         ${t.slug} (${t.name})`);
    console.log(`   Plan:           ${t.plan}`);
    console.log(`   Monto:          ${formatPrice(t.billing_amount)} COP`);
    console.log(`   Proximo cobro:  ${t.next_billing_date}`);
    console.log(`   Estado:         ${t.subscription_status}`);
    if (wasReactivated) {
      console.log(`\n   ⚡ Bot REACTIVADO (estaba ${tenant.subscription_status})`);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
    if (redis) redis.disconnect();
  }
}

main();
