import { validateSession } from '@/lib/auth'
import { publishTenantConfigUpdated } from '@/lib/cache-events'
import { err, notFound, ok, serverError, unauthorized } from '@/lib/response'
import { bulkCreateProducts } from '@/queries/products'
import { getTenantBySlug } from '@/queries/tenants'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

const itemSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  price: z.number().int().positive(),
  sizes: z.array(z.string()).optional(),
  image_url: z.string().url().optional().or(z.literal('')),
  emoji: z.string().max(8).optional(),
  category: z.string().max(128).optional(),
})

const schema = z.object({
  products: z.array(itemSchema).min(1).max(500),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

  try {
    const tenant = await getTenantBySlug(slug)
    if (!tenant) return notFound('Tenant')
    const result = await bulkCreateProducts(tenant.id, parsed.data.products)
    if (result.inserted.length > 0) void publishTenantConfigUpdated(slug)
    return ok(result, undefined, 201)
  } catch (e) {
    return serverError(e)
  }
}
