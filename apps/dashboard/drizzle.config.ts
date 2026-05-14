import type { Config } from 'drizzle-kit'

// Este archivo existe SOLO para `pnpm db:studio` (explorador visual de la DB).
// El panel NUNCA ejecuta migraciones — esa responsabilidad es del proyecto whatsapp-saas.
export default {
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config
