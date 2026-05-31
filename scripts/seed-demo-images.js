'use strict';

/**
 * scripts/seed-demo-images.js
 *
 * Asigna URLs picsum.photos a products.image_url de un tenant.
 * Uso:
 *   node scripts/seed-demo-images.js --slug=hollywood-store
 *   node scripts/seed-demo-images.js --slug=hollywood-store --force   # sobreescribe los que ya tengan url
 *
 * Requiere en .env (local):
 *   PLATFORM_DATABASE_URL=postgresql://...
 *   TENANT_DATABASE_URL_DEFAULT=postgresql://...
 *
 * No ejecuta migraciones. Solo UPDATE. No toca productos sin id.
 */

require('dotenv').config();
const { Pool } = require('pg');

function parseArgs() {
  const out = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] ?? true;
  }
  return out;
}

// Hash determinista corto: misma seed para mismo producto → siempre la misma imagen
function seedFor(name, category, idx) {
  const base = `${category || 'item'}-${idx}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return base || `demo-${idx}`;
}

function urlFor(name, category, idx) {
  const seed = seedFor(name, category, idx);
  // 600x750 ratio retrato — se ve mejor en cards de WhatsApp
  return `https://picsum.photos/seed/${seed}/600/750`;
}

async function main() {
  const args = parseArgs();
  const slug = args.slug;
  const force = Boolean(args.force);
  if (!slug) {
    console.error('Falta --slug=<tenant-slug>');
    process.exit(1);
  }

  const platformUrl = process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL;
  const tenantUrl   = process.env.TENANT_DATABASE_URL_DEFAULT;
  if (!platformUrl) throw new Error('Falta PLATFORM_DATABASE_URL');
  if (!tenantUrl)   throw new Error('Falta TENANT_DATABASE_URL_DEFAULT');

  const platform = new Pool({ connectionString: platformUrl, ssl: platformUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false });
  const tenant   = new Pool({ connectionString: tenantUrl,   ssl: tenantUrl.includes('sslmode=require')   ? { rejectUnauthorized: false } : false });

  try {
    const { rows: trows } = await platform.query(
      'SELECT id, name FROM tenants WHERE slug = $1 LIMIT 1',
      [slug],
    );
    if (trows.length === 0) {
      console.error(`Tenant "${slug}" no existe en platform DB`);
      process.exit(2);
    }
    const tenantId = trows[0].id;
    console.log(`✔ Tenant resuelto: ${trows[0].name} (${tenantId})`);

    const { rows: products } = await tenant.query(
      `SELECT id, name, category, image_url
         FROM products
        WHERE tenant_id = $1
        ORDER BY created_at ASC`,
      [tenantId],
    );
    if (products.length === 0) {
      console.log('Sin productos en ese tenant. Nada que hacer.');
      return;
    }
    console.log(`✔ ${products.length} productos encontrados`);

    let updated = 0;
    let skipped = 0;
    for (let i = 0; i < products.length; i += 1) {
      const p = products[i];
      const hasUrl = Boolean(p.image_url && p.image_url.trim());
      if (hasUrl && !force) {
        skipped += 1;
        continue;
      }
      const url = urlFor(p.name, p.category, i + 1);
      await tenant.query(
        'UPDATE products SET image_url = $1 WHERE id = $2 AND tenant_id = $3',
        [url, p.id, tenantId],
      );
      console.log(`  → [${i + 1}] ${p.name} ← ${url}`);
      updated += 1;
    }

    console.log(`\n✅ Listo: ${updated} actualizados, ${skipped} con url existente (use --force para sobreescribir)`);
  } finally {
    await platform.end();
    await tenant.end();
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
