/**
 * scripts/create-tenant.js — CLI para crear un nuevo tenant
 *
 * Uso:
 *   node scripts/create-tenant.js \
 *     --slug=boutique-ana \
 *     --name="Boutique Ana" \
 *     --wa-token=EAAxxxxx \
 *     --phone-id=123456789 \
 *     --verify-token=mi_token_secreto \
 *     --owner-phone=573001234567
 *
 * O con variables de entorno:
 *   SLUG=boutique-ana NAME="Boutique Ana" ... node scripts/create-tenant.js
 */

require('dotenv').config();

const { Pool }   = require('pg');
const { createCipheriv, randomBytes } = require('crypto');

// ── Encriptar token ───────────────────────────────────────────────────────
function encrypt(text) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv  = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${enc.toString('hex')}`;
}

// ── Parsear args ──────────────────────────────────────────────────────────
function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const [key, ...rest] = arg.replace('--', '').split('=');
    args[key] = rest.join('=');
  }
  return {
    slug:        args.slug        || process.env.SLUG,
    name:        args.name        || process.env.NAME,
    waToken:     args['wa-token'] || process.env.WA_TOKEN,
    phoneId:     args['phone-id'] || process.env.PHONE_ID,
    verifyToken: args['verify-token'] || process.env.VERIFY_TOKEN,
    ownerPhone:  args['owner-phone'] || process.env.OWNER_PHONE,
    ownerEmail:  args['owner-email'] || process.env.OWNER_EMAIL || null,
    city:        args.city        || process.env.CITY        || 'Colombia',
    schedule:    args.schedule    || process.env.SCHEDULE    || 'Lun-Sáb 9am-7pm',
  };
}

async function main() {
  const params = parseArgs();

  const missing = ['slug','name','waToken','phoneId','verifyToken','ownerPhone']
    .filter((k) => !params[k]);

  if (missing.length > 0) {
    console.error('Faltan parámetros:', missing.join(', '));
    console.error('\nUso: node scripts/create-tenant.js --slug=xxx --name="..." --wa-token=... --phone-id=... --verify-token=... --owner-phone=...');
    process.exit(1);
  }

  if (!/^[a-z0-9-]+$/.test(params.slug)) {
    console.error(`❌ Slug inválido: "${params.slug}"`);
    console.error('   Solo se permiten letras minúsculas, números y guiones. Ej: boutique-ana');
    process.exit(1);
  }

  const databaseUrl = process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Falta PLATFORM_DATABASE_URL para crear tenants.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const result = await pool.query(
      `INSERT INTO tenants
         (slug, name, wa_token_encrypted, phone_number_id, verify_token,
          owner_phone, owner_email, bot_config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, slug, name, status, created_at`,
      [
        params.slug,
        params.name,
        encrypt(params.waToken),
        params.phoneId,
        params.verifyToken,
        params.ownerPhone,
        params.ownerEmail,
        JSON.stringify({
          business_name: params.name,
          city:          params.city,
          schedule:      params.schedule,
          offers:        [],
          flow_type:     'sales_v1',
        }),
      ]
    );

    const tenant = result.rows[0];
    console.log('\n✅ Tenant creado exitosamente:');
    console.log(`   ID:      ${tenant.id}`);
    console.log(`   Slug:    ${tenant.slug}`);
    console.log(`   Nombre:  ${tenant.name}`);
    console.log(`   Status:  ${tenant.status}`);
    console.log(`\n   URL webhook: https://jestsolution.dev/webhook/${tenant.slug}`);
    console.log('\n   ⚠️  Registra esa URL en Meta para este número de WhatsApp.');

  } catch (err) {
    if (err.code === '23505') {
      console.error(`❌ El slug "${params.slug}" ya existe`);
    } else {
      console.error('❌ Error:', err.message);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
