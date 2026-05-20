/**
 * Crea el primer usuario superadmin en la DB.
 *
 * Uso:
 *   pnpm admin:create
 *
 * Variables de entorno requeridas en .env.local:
 *   DATABASE_URL, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD
 */

import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { panelUsers } from '../src/db/schema'
import { hashPassword } from '../src/lib/password'

const username = process.env.ADMIN_USERNAME
const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD

if (!username || !email || !password) {
  console.error('\n❌ Faltan variables de entorno:')
  console.error('  ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD\n')
  process.exit(1)
}

if (password.length < 12) {
  console.error('\n❌ ADMIN_PASSWORD debe tener al menos 12 caracteres.\n')
  process.exit(1)
}

async function main() {
  const existing = await db.query.panelUsers.findFirst({
    where: eq(panelUsers.username, username as string),
  })

  if (existing) {
    console.error(`\n❌ El usuario '${username}' ya existe.\n`)
    process.exit(1)
  }

  const passwordHash = await hashPassword(password as string)

  await db.insert(panelUsers).values({
    username: username as string,
    email: email as string,
    password_hash: passwordHash,
    role: 'superadmin',
  })

  console.log(`\n✅ Usuario superadmin '${username}' creado correctamente.\n`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
