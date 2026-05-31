import { validateSession } from '@/lib/auth'
import { created, err, forbidden, ok, serverError, unauthorized } from '@/lib/response'
import { createPlan, getPlanList, invalidatePlanCodes } from '@/queries/plans'
import { createPlanSchema } from './_schema'

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
    const parsed = createPlanSchema.safeParse(body)
    if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

    const plan = await createPlan(parsed.data)
    invalidatePlanCodes()
    return created(plan)
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('unique'))
      return err('El código del plan ya existe')
    return serverError(e)
  }
}
