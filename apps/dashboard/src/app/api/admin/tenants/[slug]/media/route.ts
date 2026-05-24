import { validateSession } from '@/lib/auth'
import { mediaClient } from '@/lib/media-storage'
import { err, notFound, ok, serverError, unauthorized } from '@/lib/response'
import { getTenantBySlug } from '@/queries/tenants'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

function cleanScope(value: string | null) {
  const scope = String(value || 'uploads')
    .toLowerCase()
    .trim()
  return /^[a-z0-9_-]{1,40}$/.test(scope) ? scope : 'uploads'
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  const tenant = await getTenantBySlug(slug)
  if (!tenant) return notFound('Tenant')

  try {
    const type = req.nextUrl.searchParams.get('type') ?? undefined
    const { items, config } = await mediaClient.list(slug, type)
    return ok({ items, config })
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  const tenant = await getTenantBySlug(slug)
  if (!tenant) return notFound('Tenant')

  try {
    const form = await req.formData()
    const file = form.get('file')
    const scope = cleanScope(String(form.get('scope') || 'uploads'))
    if (!(file instanceof File)) return err('Archivo requerido', 400)

    const buffer = Buffer.from(await file.arrayBuffer())
    const saved = await mediaClient.upload(slug, scope, buffer, file.type)
    return ok(saved, undefined, 201)
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  const tenant = await getTenantBySlug(slug)
  if (!tenant) return notFound('Tenant')

  const relativePath = req.nextUrl.searchParams.get('path')
  if (!relativePath || !relativePath.startsWith(`${slug}/`)) {
    return err('Path de media inválido', 400)
  }

  try {
    return ok(await mediaClient.remove(slug, relativePath))
  } catch (e) {
    return serverError(e)
  }
}
