import { z } from 'zod'

// Permite que una env var venga vacía ("") y la trate como undefined.
// Sin esto, `.url().optional()` falla con "Invalid url" cuando .env tiene SENTRY_DSN= sin valor.
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional())

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  NEXT_PUBLIC_APP_URL: z.string().url('NEXT_PUBLIC_APP_URL debe ser una URL válida'),

  DATABASE_URL: z.string().min(10, 'DATABASE_URL es requerido'),
  TENANT_DATABASE_URL: z.string().min(10, 'TENANT_DATABASE_URL es requerido'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY debe ser 32 bytes en hex (64 chars)'),

  AUTH_SECRET: z
    .string()
    .min(
      32,
      'AUTH_SECRET debe tener al menos 32 caracteres - genera uno con: openssl rand -hex 32',
    ),
  SESSION_TTL_SECONDS: z.coerce.number().positive().default(28800),

  ALLOWED_IPS: z.string().default(''),
  DB_CONSOLE_WRITES_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),

  PANEL_DOMAIN: z.string().default('admin.jestsolution.tech'),
  BOT_DOMAIN: z.string().default('bot.jestsolution.tech'),

  // Acceso interno a api-core para operaciones de media (storage vive allá).
  API_CORE_INTERNAL_URL: z.string().url().default('http://api:3000'),
  ADMIN_API_KEY: z.string().optional(),

  REDIS_URL: optionalUrl,
  SENTRY_DSN: optionalUrl,
  SENTRY_ENVIRONMENT: z.string().default('production'),
})

// Durante `next build` en Docker se setea SKIP_ENV_VALIDATION=1 porque las
// variables reales se inyectan en runtime (no en la imagen).
// En producción (runtime), la validación corre completa y falla rápido si falta algo.
function validate() {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const lines = Object.entries(parsed.error.flatten().fieldErrors)
      .map(([field, errors]) => `  - ${field}: ${errors?.join(', ')}`)
      .join('\n')
    throw new Error(`\nVariables de entorno inválidas o faltantes:\n${lines}\n`)
  }
  return parsed.data
}

export const env =
  process.env.SKIP_ENV_VALIDATION === '1'
    ? (process.env as unknown as z.infer<typeof schema>)
    : validate()
