import { validateSession } from '@/lib/auth'
import { err, notFound, ok, serverError, unauthorized } from '@/lib/response'
import { updateTenantBotConfig } from '@/queries/tenants'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

const productFilterSchema = z.object({
  max_products: z.number().int().min(1).max(50).optional(),
  in_stock_only: z.boolean().optional(),
  sizes: z.array(z.string()).optional(),
  min_price: z.number().int().min(0).optional(),
  max_price: z.number().int().min(0).optional(),
  featured_ids: z.array(z.string().uuid()).optional(),
})

const salesPersonaSchema = z.object({
  persona_name: z.string().min(1).max(40),
  persona_description: z.string().max(300).optional(),
  tone: z.enum(['casual', 'friendly', 'professional']).optional(),
  business_description: z.string().max(500).optional(),
  objection_price: z.string().max(300).optional(),
  objection_delivery: z.string().max(300).optional(),
  sales_tips: z.array(z.string()).max(8).optional(),
  forbidden_topics: z.array(z.string()).max(5).optional(),
  product_filter: productFilterSchema.optional(),
})

const tallaImagesCountSchema = z.object({
  S: z.number().int().min(0).optional(),
  M: z.number().int().min(0).optional(),
  L: z.number().int().min(0).optional(),
  XL: z.number().int().min(0).optional(),
  XXL: z.number().int().min(0).optional(),
  XXXL: z.number().int().min(0).optional(),
})

// Config operacional — leída directamente por el message-worker y tenantResolver
const operationalConfigSchema = z.object({
  flow_type: z.enum(['sales_v1', 'mayoristas', 'hollywood_store']).optional(),
  business_name: z.string().max(128).optional(),
  city: z.string().max(64).optional(),
  schedule: z.string().max(256).optional(),
  whatsapp_provider: z.enum(['meta', '360dialog']).optional(),
  ai_enabled: z.boolean().optional(),
  image_analysis_enabled: z.boolean().optional(),
  audio_transcription_enabled: z.boolean().optional(),
  // Hollywood Store
  storage_base_url: z.string().url().max(512).optional().or(z.literal('')),
  catalog_images_count: z.number().int().min(0).max(500).optional(),
  catalog_link_mayorista: z.string().url().max(512).optional().or(z.literal('')),
  catalog_link_detal: z.string().url().max(512).optional().or(z.literal('')),
  talla_images_count: tallaImagesCountSchema.optional(),
  media_storage: z
    .object({
      enabled: z.boolean().optional(),
      importProductsEnabled: z.boolean().optional(),
      imageMaxWidth: z.number().int().min(64).max(4096).optional(),
      outputFormat: z.enum(['jpeg', 'webp', 'original']).optional(),
      quality: z.number().int().min(1).max(100).optional(),
      generateThumbnail: z.boolean().optional(),
      thumbnailWidth: z.number().int().min(32).max(2048).optional(),
      preserveExif: z.boolean().optional(),
      maxImageUploadMb: z.number().int().min(1).max(100).optional(),
      maxAudioUploadMb: z.number().int().min(1).max(200).optional(),
      allowedImageFormats: z.array(z.enum(['jpg', 'png', 'webp'])).optional(),
      allowedAudioFormats: z.array(z.enum(['mp3', 'ogg', 'm4a', 'opus'])).optional(),
    })
    .optional(),
})

const schema = z.union([
  z.object({ sales_persona: salesPersonaSchema }),
  z.object({ operational: operationalConfigSchema }),
])

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

  try {
    // Merge as top-level keys in bot_config JSONB
    const patch =
      'sales_persona' in parsed.data
        ? { sales_persona: parsed.data.sales_persona }
        : parsed.data.operational

    const updated = await updateTenantBotConfig(slug, patch)
    if (!updated) return notFound('Tenant')
    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}
