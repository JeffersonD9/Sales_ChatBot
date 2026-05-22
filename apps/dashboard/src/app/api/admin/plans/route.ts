import { validateSession } from '@/lib/auth'
import { created, err, forbidden, ok, serverError, unauthorized } from '@/lib/response'
import { createPlan, getPlanList } from '@/queries/plans'
import { z } from 'zod'

export const planFieldsSchema = z.object({
  name: z.string().min(2).max(128),
  tier: z.string().min(2).max(32),
  monthly_price: z.number().int().nonnegative(),
  currency: z
    .string()
    .trim()
    .min(3)
    .max(8)
    .transform((value) => value.toUpperCase()),
  ai_enabled: z.boolean(),
  daily_message_limit: z.number().int().nonnegative(),
  daily_ai_reply_limit: z.number().int().nonnegative(),
  daily_ai_token_limit: z.number().int().nonnegative(),
  default_allocation_strategy: z.string().min(2).max(32),
  metadata: z.record(z.unknown()).default({}),
})

const createSchema = planFieldsSchema.extend({
  code: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, 'Usa letras minúsculas, números, _ o -'),
})

export async function GET(req: Request) {
  try {
    const user = await validateSession()
    if (!user) return unauthorized()

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, Number(searchParams.get('page') ?? 1))
    const pageSize = Math.min(50, Math.max(10, Number(searchParams.get('size') ?? 20)))
    const q = searchParams.get('q') ?? undefined
    const { rows, total } = await getPlanList({ page, pageSize, q })

    return ok(rows, {
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
    })
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: Request) {
  try {
    const user = await validateSession()
    if (!user) return unauthorized()
    if (user.role !== 'superadmin') return forbidden('Solo superadmin puede gestionar planes')

    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

    return created(await createPlan(parsed.data))
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('unique'))
      return err('El código del plan ya existe')
    return serverError(e)
  }
}
