import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { validateSession } from '@/lib/auth'
import { slugify } from '@/lib/utils'
import { createTenant, getTenantList } from '@/queries/tenants'
import { created, err, ok, serverError, unauthorized } from '@/lib/response'

export async function GET(req: NextRequest) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const sp = req.nextUrl.searchParams
  const params = {
    page:     Math.max(1, Number(sp.get('page') ?? 1)),
    pageSize: Number(sp.get('size') ?? 20),
    sort:     sp.get('sort') ?? 'created_at',
    dir:      (sp.get('dir') ?? 'desc') as 'asc' | 'desc',
    query:    sp.get('q') ?? '',
  }

  try {
    const { data, total } = await getTenantList(params)
    return ok(data, {
      total,
      page:      params.page,
      pageSize:  params.pageSize,
      pageCount: Math.ceil(total / params.pageSize),
    })
  } catch (e) {
    return serverError(e)
  }
}

const createSchema = z.object({
  name:        z.string().min(2, 'Mínimo 2 caracteres').max(256),
  owner_phone: z.string().min(7).max(32),
  owner_email: z.string().email().optional(),
  plan:        z.enum(['starter', 'pro', 'enterprise']).default('starter'),
})

export async function POST(req: NextRequest) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

  const slug = slugify(parsed.data.name)

  try {
    const tenant = await createTenant({
      ...parsed.data,
      slug,
      owner_email: parsed.data.owner_email ?? undefined,
    })
    return created(tenant)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return err('Ya existe un tenant con ese nombre o teléfono', 409)
    }
    return serverError(e)
  }
}
