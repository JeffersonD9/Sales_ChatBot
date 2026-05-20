import { validateSession } from '@/lib/auth'
import { err, notFound, ok, serverError, unauthorized } from '@/lib/response'
import { updateTenantStatus } from '@/queries/tenants'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  status: z.enum(['active', 'suspended', 'trial']),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

  try {
    const updated = await updateTenantStatus(slug, parsed.data.status)
    if (!updated) return notFound('Tenant')
    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}
