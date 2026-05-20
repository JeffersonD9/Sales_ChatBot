import { validateSession } from '@/lib/auth'
import { publishTenantConfigUpdated } from '@/lib/cache-events'
import { err, notFound, ok, serverError, unauthorized } from '@/lib/response'
import { deactivateProduct, updateProduct } from '@/queries/products'
import { getTenantBySlug } from '@/queries/tenants'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

const updateSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  description: z.string().max(2000).optional(),
  price: z.number().int().positive().optional(),
  sizes: z.array(z.string()).optional(),
  image_url: z.string().url().optional().or(z.literal('')),
  emoji: z.string().max(8).optional(),
  category: z.string().max(128).optional(),
  active: z.boolean().optional(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug, id } = await params
  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

  try {
    const tenant = await getTenantBySlug(slug)
    if (!tenant) return notFound('Tenant')
    const updated = await updateProduct(id, tenant.id, parsed.data)
    if (!updated) return notFound('Producto')
    void publishTenantConfigUpdated(slug)
    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug, id } = await params
  try {
    const tenant = await getTenantBySlug(slug)
    if (!tenant) return notFound('Tenant')
    const result = await deactivateProduct(id, tenant.id)
    if (!result) return notFound('Producto')
    void publishTenantConfigUpdated(slug)
    return ok({ id })
  } catch (e) {
    return serverError(e)
  }
}
