'use strict';

/**
 * panel/scripts/create-super-admin.js — Bootstrap inicial del primer super_admin
 *
 * Uso:
 *   node src/panel/scripts/create-super-admin.js \
 *     --username=jefferson \
 *     --password=MiPassword123! \
 *     --email=jefferson@empresa.com
 *
 * Requiere DATABASE_URL en el entorno (o en .env).
 * No inicia el servidor — acceso directo a DB.
 */

require('dotenv').config();

const { Pool } = require('pg');
const bcrypt   = require('bcrypt');

// Parsear args --key=value
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=')];
  })
);

const { username, password, email } = args;

if (!username || !password || !email) {
  console.error('Uso: node create-super-admin.js --username=X --password=X --email=X');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Error: el password debe tener al menos 8 caracteres');
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Verificar que no exista
    const existing = await pool.query(
      'SELECT id FROM panel_users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existing.rows.length > 0) {
      console.error(`Error: ya existe un usuario con username="${username}" o email="${email}"`);
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await pool.query(
      `INSERT INTO panel_users (username, email, password_hash, role, tenant_id)
       VALUES ($1, $2, $3, 'super_admin', NULL)
       RETURNING id, username, email, role, created_at`,
      [username, email, passwordHash]
    );

    const user = rows[0];
    console.log('');
    console.log('✓ Super admin creado exitosamente');
    console.log(`  ID:       ${user.id}`);
    console.log(`  Usuario:  ${user.username}`);
    console.log(`  Email:    ${user.email}`);
    console.log(`  Rol:      ${user.role}`);
    console.log(`  Creado:   ${user.created_at.toISOString()}`);
    console.log('');
    console.log('Ahora puedes iniciar sesión en:');
    console.log('  http://localhost:3000/panel-ui/login.html');
    console.log('');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
