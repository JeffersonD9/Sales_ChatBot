import { validateSession } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'
import { err, forbidden, ok, serverError, unauthorized } from '@/lib/response'
import {
  type UpdateTenantData,
  getTenantBySlug,
  updateTenant,
  updateTenantBotConfig,
} from '@/queries/tenants'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  phone_number_id: z.string().max(64).nullable().optional(),
  verify_token: z.string().max(128).nullable().optional(),
  access_token: z.string().nullable().optional(),
  provider: z.enum(['meta', '360dialog']).optional(),
})

type Provider = z.infer<typeof schema>['provider']

function serializeWhatsappConfig(
  tenant: Awaited<ReturnType<typeof getTenantBySlug>>,
  provider?: Provider,
) {
  if (!tenant) return undefined

  return {
    slug: tenant.slug,
    phone_number_id: tenant.phone_number_id,
    verify_token: tenant.verify_token,
    provider:
      provider ??
      (tenant.bot_config.whatsapp_provider as 'meta' | '360dialog' | undefined) ??
      'meta',
    meta_live: tenant.meta_live,
    meta_connected_at: tenant.meta_connected_at,
    token_configured: Boolean(tenant.wa_token_encrypted),
  }
}

async function updateWhatsapp(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()
  if (user.role !== 'superadmin') return forbidden('Solo superadmin puede gestionar WhatsApp')

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return err('Datos invalidos', 400, parsed.error.flatten())

  const { slug } = await params
  try {
    const tenant = await getTenantBySlug(slug)
    if (!tenant) return err('Tenant no encontrado', 404)

    const data: UpdateTenantData = {}
    if ('phone_number_id' in parsed.data) data.phone_number_id = parsed.data.phone_number_id
    if ('verify_token' in parsed.data) data.verify_token = parsed.data.verify_token

    if ('access_token' in parsed.data) {
      data.wa_token_encrypted = parsed.data.access_token ? encrypt(parsed.data.access_token) : null
    }

    if (Object.keys(data).length) {
      await updateTenant(slug, data)
    }

    if (parsed.data.provider) {
      await updateTenantBotConfig(slug, { whatsapp_provider: parsed.data.provider })
    }

    const updated = await getTenantBySlug(slug)
    return ok(serializeWhatsappConfig(updated, parsed.data.provider))
  } catch (e) {
    return serverError(e, 'admin/tenants/whatsapp')
  }
}

export const PATCH = updateWhatsapp
export const POST = updateWhatsapp
