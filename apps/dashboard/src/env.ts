import { z } from 'zod'

const schema = z.object({
  NODE_ENV:            z.enum(['development', 'production', 'test']).default('development'),
  PORT:                z.coerce.number().default(3001),

  NEXT_PUBLIC_APP_URL: z.string().url('NEXT_PUBLIC_APP_URL debe ser una URL válida'),

  DATABASE_URL:        z.string().min(10, 'DATABASE_URL es requerido'),
  TENANT_DATABASE_URL: z.string().min(10, 'TENANT_DATABASE_URL es requerido'),

  AUTH_SECRET:         z.string().min(32, 'AUTH_SECRET debe tener al menos 32 caracteres — generá uno con: openssl rand -hex 32'),
  SESSION_TTL_SECONDS: z.coerce.number().positive().default(28800),

  ALLOWED_IPS:         z.string().default(''),

  PANEL_DOMAIN:        z.string().default('admin.jestsolution.dev'),
  BOT_DOMAIN:          z.string().default('bot.jestsolution.dev'),
})

// Durante `next build` en Docker se setea SKIP_ENV_VALIDATION=1 porque las
// variables reales se inyectan en runtime (no en la imagen).
// En producción (runtime), la validación corre completa y falla rápido si falta algo.
function validate() {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const lines = Object.entries(parsed.error.flatten().fieldErrors)
      .map(([field, errors]) => `  • ${field}: ${errors?.join(', ')}`)
      .join('\n')
    throw new Error(`\n❌ Variables de entorno inválidas o faltantes:\n${lines}\n`)
  }
  return parsed.data
}

export const env =
  process.env.SKIP_ENV_VALIDATION === '1'
    ? (process.env as unknown as z.infer<typeof schema>)
    : validate()
