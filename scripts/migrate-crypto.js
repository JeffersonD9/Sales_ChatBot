/**
 * scripts/migrate-crypto.js — Migra wa_tokens de AES-256-CBC a AES-256-GCM
 *
 * Corre UNA SOLA VEZ después de deployar el nuevo crypto.js.
 * Detecta tokens en formato CBC (2 partes) y los re-encripta en GCM (3 partes).
 * Los tokens ya en GCM se omiten sin modificarlos.
 *
 * Uso:
 *   node scripts/migrate-crypto.js          # dry-run (solo muestra qué migraría)
 *   node scripts/migrate-crypto.js --apply  # aplica los cambios en DB
 */

require('dotenv').config();

const { Pool } = require('pg');
const { encrypt, decrypt } = require('../src/utils/crypto');

const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  if (DRY_RUN) {
    console.log('🔍 DRY RUN — no se modificará nada. Usa --apply para aplicar.\n');
  } else {
    console.log('⚡ MODO APPLY — re-encriptando tokens en DB...\n');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const { rows } = await pool.query(
      'SELECT id, slug, wa_token_encrypted FROM tenants WHERE wa_token_encrypted IS NOT NULL'
    );

    console.log(`Tenants encontrados: ${rows.length}`);

    let migrated = 0;
    let skipped  = 0;

    for (const row of rows) {
      const parts = (row.wa_token_encrypted || '').split(':');

      if (parts.length === 3) {
        console.log(`  ✅ ${row.slug} — ya está en GCM, omitido`);
        skipped++;
        continue;
      }

      if (parts.length !== 2) {
        console.log(`  ⚠️  ${row.slug} — formato desconocido, omitido`);
        skipped++;
        continue;
      }

      // Desencriptar con CBC (formato legado), re-encriptar con GCM
      const plainToken = decrypt(row.wa_token_encrypted);
      if (!plainToken) {
        console.log(`  ❌ ${row.slug} — no se pudo desencriptar, omitido`);
        skipped++;
        continue;
      }

      const newEncrypted = encrypt(plainToken);
      console.log(`  🔄 ${row.slug} — migrando CBC → GCM`);

      if (!DRY_RUN) {
        await pool.query(
          'UPDATE tenants SET wa_token_encrypted = $1 WHERE id = $2',
          [newEncrypted, row.id]
        );
      }
      migrated++;
    }

    console.log(`\nResultado: ${migrated} migrados, ${skipped} omitidos`);
    if (DRY_RUN && migrated > 0) {
      console.log('\nEjecuta con --apply para aplicar los cambios.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
