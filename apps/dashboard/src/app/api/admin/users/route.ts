import { validateSession } from '@/lib/auth'
import { created, err, forbidden, ok, serverError, unauthorized } from '@/lib/response'
import { createAdminUser, getAdminUserList } from '@/queries/admin-users'
import type { PaginationMeta } from '@/types/api'
import { z } from 'zod'

const createSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9_-]+$/, 'Solo letras minúsculas, números, _ y -'),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(['superadmin', 'admin', 'viewer']),
})

export async function GET(req: Request) {
  try {
    const user = await validateSession()
    if (!user) return unauthorized()

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, Number(searchParams.get('page') ?? 1))
    const pageSize = Math.min(50, Math.max(10, Number(searchParams.get('size') ?? 20)))
    const q = searchParams.get('q') ?? undefined

    const { rows, total } = await getAdminUserList({ page, pageSize, q })

    const meta: PaginationMeta = {
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
    }

    return ok(rows, meta)
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: Request) {
  try {
    const user = await validateSession()
    if (!user) return unauthorized()
    if (user.role !== 'superadmin') return forbidden('Solo superadmin puede crear usuarios')

    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

    const newUser = await createAdminUser(parsed.data)
    return created(newUser)
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('unique')) {
      return err('El nombre de usuario o email ya existe')
    }
    return serverError(e)
  }
}
