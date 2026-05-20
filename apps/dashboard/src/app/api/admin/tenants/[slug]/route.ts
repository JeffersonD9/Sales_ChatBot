import { validateSession } from '@/lib/auth'
import { err, notFound, ok, serverError, unauthorized } from '@/lib/response'
import { getTenantBySlug, updateTenant } from '@/queries/tenants'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  try {
    const tenant = await getTenantBySlug(slug)
    if (!tenant) return notFound('Tenant')
    return ok(tenant)
  } catch (e) {
    return serverError(e)
  }
}

const patchSchema = z.object({
  name: z.string().min(2).max(256).optional(),
  owner_phone: z.string().min(7).max(32).optional(),
  owner_email: z
    .union([z.string().email(), z.literal('')])
    .nullable()
    .optional(),
  plan: z.enum(['starter', 'pro', 'enterprise']).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

  try {
    const updated = await updateTenant(slug, {
      ...parsed.data,
      owner_email: parsed.data.owner_email === '' ? null : (parsed.data.owner_email ?? undefined),
    })
    if (!updated) return notFound('Tenant')
    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}
