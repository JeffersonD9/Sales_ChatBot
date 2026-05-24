import { validateSession } from '@/lib/auth'
import { publishTenantConfigUpdated } from '@/lib/cache-events'
import { mediaStorage } from '@/lib/media-storage'
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
    const config = mediaStorage.normalizeMediaStorageConfig(tenant.bot_config)
    const products =
      config.enabled && config.importProductsEnabled
        ? await localizeProductImages(slug, parsed.data.products, config)
        : parsed.data.products
    const result = await bulkCreateProducts(tenant.id, products)
    if (result.inserted.length > 0) void publishTenantConfigUpdated(slug)
    return ok(result, undefined, 201)
  } catch (e) {
    return serverError(e)
  }
}

async function localizeProductImages(
  tenantSlug: string,
  products: z.infer<typeof itemSchema>[],
  config: Record<string, unknown> & { maxImageUploadMb?: number },
) {
  const adapter = mediaStorage.createLocalVpsStorageAdapter()
  const maxBytes = Number(config.maxImageUploadMb ?? 8) * 1024 * 1024

  return Promise.all(
    products.map(async (product) => {
      if (!product.image_url || !/^https?:\/\//i.test(product.image_url)) return product
      const res = await fetch(product.image_url)
      if (!res.ok) throw new Error(`No se pudo descargar imagen de ${product.name}`)
      const size = Number(res.headers.get('content-length') || 0)
      if (size > maxBytes) throw new Error(`Imagen de ${product.name} supera el limite configurado`)
      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.length > maxBytes) {
        throw new Error(`Imagen de ${product.name} supera el limite configurado`)
      }
      const saved = await adapter.saveImage({
        tenantSlug,
        scope: 'products',
        buffer,
        config,
      })
      return { ...product, image_url: String(saved.url) }
    }),
  )
}
