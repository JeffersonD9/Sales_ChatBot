import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  NEXT_PUBLIC_APP_URL: z.string().url('NEXT_PUBLIC_APP_URL debe ser una URL vÃ¡lida'),

  DATABASE_URL: z.string().min(10, 'DATABASE_URL es requerido'),
  TENANT_DATABASE_URL: z.string().min(10, 'TENANT_DATABASE_URL es requerido'),

  AUTH_SECRET: z
    .string()
    .min(
      32,
      'AUTH_SECRET debe tener al menos 32 caracteres â€” generÃ¡ uno con: openssl rand -hex 32',
    ),
  SESSION_TTL_SECONDS: z.coerce.number().positive().default(28800),

  ALLOWED_IPS: z.string().default(''),
  DB_CONSOLE_WRITES_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),

  PANEL_DOMAIN: z.string().default('admin.jestsolution.tech'),
  BOT_DOMAIN: z.string().default('bot.jestsolution.tech'),

  REDIS_URL: z.string().url().optional(),
})

// Durante `next build` en Docker se setea SKIP_ENV_VALIDATION=1 porque las
// variables reales se inyectan en runtime (no en la imagen).
// En producciÃ³n (runtime), la validaciÃ³n corre completa y falla rÃ¡pido si falta algo.
function validate() {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const lines = Object.entries(parsed.error.flatten().fieldErrors)
      .map(([field, errors]) => `  â€¢ ${field}: ${errors?.join(', ')}`)
      .join('\n')
    throw new Error(`\nâŒ Variables de entorno invÃ¡lidas o faltantes:\n${lines}\n`)
  }
  return parsed.data
}

export const env =
  process.env.SKIP_ENV_VALIDATION === '1'
    ? (process.env as unknown as z.infer<typeof schema>)
    : validate()
