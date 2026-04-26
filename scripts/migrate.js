/**
 * scripts/migrate.js — Correr migrations SQL en orden
 *
 * Uso:
 *   node scripts/migrate.js          (corre migrations pendientes)
 *   DATABASE_URL=... node scripts/migrate.js
 *
 * Las migrations se corren en orden numérico.
 * No vuelve a correr una migration ya aplicada.
 */

require('dotenv').config();

const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();

  try {
    // Tabla de control de migrations
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = await client.query('SELECT name FROM _migrations ORDER BY name');
    const appliedSet = new Set(applied.rows.map((r) => r.name));

    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  ✓ ${file} (ya aplicada)`);
        continue;
      }

      console.log(`  → Aplicando ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✅ ${file}`);
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Error en migration ${file}: ${err.message}`);
      }
    }

    if (count === 0) {
      console.log('\nNo hay migrations pendientes.');
    } else {
      console.log(`\n✅ ${count} migration(s) aplicada(s).`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
