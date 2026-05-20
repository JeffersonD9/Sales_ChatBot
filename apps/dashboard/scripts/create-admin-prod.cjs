'use strict';

// Crea o actualiza un usuario superadmin del panel directamente sobre la DB
// platform usando las dependencias ya bundleadas en la imagen standalone de
// Next.js (pg + @node-rs/argon2). Pensado para invocarse con docker exec.
//
// Variables requeridas:
//   ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD (>= 12 chars)
//   DATABASE_URL (ya viene definida en el container del dashboard)
//
// Comportamiento: si username ya existe → falla con mensaje claro.

const { Pool } = require('pg');
const { hash } = require('@node-rs/argon2');

const ARGON2_OPTS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
};

const username = process.env.ADMIN_USERNAME;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

function die(msg, code = 1) {
  console.error(`\n[create-admin-prod] ${msg}\n`);
  process.exit(code);
}

if (!username || !email || !password) die('Faltan ADMIN_USERNAME, ADMIN_EMAIL o ADMIN_PASSWORD');
if (!databaseUrl) die('Falta DATABASE_URL');
if (password.length < 12) die('ADMIN_PASSWORD debe tener al menos 12 caracteres');

(async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 });
  try {
    const existing = await pool.query(
      'SELECT id, username FROM panel_users WHERE username = $1 OR email = $2 LIMIT 1',
      [username, email],
    );
    if (existing.rowCount > 0) {
      die(`Ya existe un usuario con username='${username}' o email='${email}' (id=${existing.rows[0].id})`);
    }
    const passwordHash = await hash(password, ARGON2_OPTS);
    const result = await pool.query(
      `INSERT INTO panel_users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'superadmin', true)
       RETURNING id, username, email, role, created_at`,
      [username, email, passwordHash],
    );
    const row = result.rows[0];
    console.log(`\n✅ Superadmin creado: id=${row.id} username=${row.username} email=${row.email} role=${row.role}\n`);
  } catch (e) {
    die(`Error: ${e.message}`);
  } finally {
    await pool.end();
  }
})();
