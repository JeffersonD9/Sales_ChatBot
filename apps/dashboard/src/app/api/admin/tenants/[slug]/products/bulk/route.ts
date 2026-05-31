import { validateSession } from '@/lib/auth'
import { publishTenantConfigUpdated } from '@/lib/cache-events'
import { mediaClient, mediaConfigFlags } from '@/lib/media-storage'
import { err, notFound, ok, serverError, unauthorized } from '@/lib/response'
import { bulkCreateProducts } from '@/queries/products'
import { getTenantBySlug } from '@/queries/tenants'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

// image_url debe ser http(s) explicito: bloquea javascript:, data:, file:, etc.
const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: 'image_url debe ser http(s)' })

const itemSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  price: z.number().int().positive(),
  sizes: z.array(z.string().min(1).max(16)).max(20).optional(),
  image_url: httpUrl.optional().or(z.literal('')),
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
    const flags = mediaConfigFlags(tenant.bot_config)
    const products =
      flags.enabled && flags.importProductsEnabled
        ? await localizeProductImages(slug, parsed.data.products)
        : parsed.data.products
    const result = await bulkCreateProducts(tenant.id, products)
    if (result.inserted.length > 0) void publishTenantConfigUpdated(slug)
    return ok(result, undefined, 201)
  } catch (e) {
    return serverError(e)
  }
}

async function localizeProductImages(tenantSlug: string, products: z.infer<typeof itemSchema>[]) {
  const urls = products
    .map((p) => p.image_url)
    .filter((u): u is string => !!u && /^https?:\/\//i.test(u))
  if (urls.length === 0) return products

  // api-core descarga, procesa y guarda; devuelve el mapeo url externa → local.
  const { map } = await mediaClient.localize(tenantSlug, Array.from(new Set(urls)))

  return products.map((product) =>
    product.image_url && map[product.image_url]
      ? { ...product, image_url: map[product.image_url] }
      : product,
  )
}
