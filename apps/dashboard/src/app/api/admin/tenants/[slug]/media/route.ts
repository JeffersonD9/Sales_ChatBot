import { validateSession } from '@/lib/auth'
import { mediaStorage } from '@/lib/media-storage'
import { err, notFound, ok, serverError, unauthorized } from '@/lib/response'
import { getTenantBySlug } from '@/queries/tenants'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

function cleanScope(value: string | null) {
  const scope = String(value || 'uploads')
    .toLowerCase()
    .trim()
  return /^[a-z0-9_-]{1,40}$/i.test(scope) ? scope : 'uploads'
}

async function requireTenant(slug: string) {
  const tenant = await getTenantBySlug(slug)
  return tenant
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  const tenant = await requireTenant(slug)
  if (!tenant) return notFound('Tenant')

  try {
    const type = req.nextUrl.searchParams.get('type') ?? undefined
    const adapter = mediaStorage.createLocalVpsStorageAdapter()
    const items = await adapter.list({ tenantSlug: slug, type })
    return ok({ items, config: mediaStorage.normalizeMediaStorageConfig(tenant.bot_config) })
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  const tenant = await requireTenant(slug)
  if (!tenant) return notFound('Tenant')

  const config = mediaStorage.normalizeMediaStorageConfig(tenant.bot_config)
  if (!config.enabled) return err('El almacenamiento local esta desactivado', 400)

  try {
    const form = await req.formData()
    const file = form.get('file')
    const type = String(form.get('type') || '')
    const scope = cleanScope(String(form.get('scope') || 'uploads'))
    if (!(file instanceof File)) return err('Archivo requerido', 400)

    const maxMb = type === 'audio' ? config.maxAudioUploadMb : config.maxImageUploadMb
    if (file.size > maxMb * 1024 * 1024) {
      return err(`El archivo supera el limite de ${maxMb} MB`, 413)
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const detected = mediaStorage.detectMime(buffer)
    if (!detected) return err('Tipo de archivo no reconocido', 400)

    const adapter = mediaStorage.createLocalVpsStorageAdapter()
    if (detected.kind === 'image') {
      const saved = await adapter.saveImage({ tenantSlug: slug, scope, buffer, config })
      return ok(saved, undefined, 201)
    }
    if (detected.kind === 'audio') {
      const saved = await adapter.saveAudio({
        tenantSlug: slug,
        scope,
        buffer,
        allowedFormats: config.allowedAudioFormats,
      })
      return ok(saved, undefined, 201)
    }
    return err('Tipo de archivo no soportado', 400)
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  const tenant = await requireTenant(slug)
  if (!tenant) return notFound('Tenant')

  const relativePath = req.nextUrl.searchParams.get('path')
  if (!relativePath || !relativePath.startsWith(`${slug}/`)) {
    return err('Path de media invalido', 400)
  }

  try {
    const adapter = mediaStorage.createLocalVpsStorageAdapter()
    return ok(await adapter.delete(relativePath))
  } catch (e) {
    return serverError(e)
  }
}
