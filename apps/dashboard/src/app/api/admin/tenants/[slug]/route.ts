import { validateSession } from '@/lib/auth'
import { err, notFound, ok, serverError, unauthorized } from '@/lib/response'
import { normalizePhoneE164 } from '@/lib/utils'
import { getActivePlanCodes } from '@/queries/plans'
import { getTenantBySlug, updateTenant } from '@/queries/tenants'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

// Slug en la URL: misma forma que produce slugify().
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

function assertSlug(slug: string) {
  return SLUG_RE.test(slug)
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  if (!assertSlug(slug)) return err('Slug inválido', 400)

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
  plan: z
    .string()
    .regex(/^[a-z0-9_-]+$/)
    .optional(),
})

function mapDuplicateMessage(e: unknown): { status: number; message: string } | null {
  const detail = (e instanceof Error ? `${e.message}` : '').toLowerCase()
  if (!detail.includes('unique') && !detail.includes('duplicate')) return null
  if (detail.includes('slug')) return { status: 409, message: 'El slug ya existe' }
  if (detail.includes('owner_phone'))
    return { status: 409, message: 'Ya existe un tenant con ese teléfono' }
  if (detail.includes('owner_email'))
    return { status: 409, message: 'Ya existe un tenant con ese email' }
  if (detail.includes('phone_number_id'))
    return { status: 409, message: 'phone_number_id ya está en uso por otro tenant' }
  if (detail.includes('name')) return { status: 409, message: 'Ya existe un tenant con ese nombre' }
  return { status: 409, message: 'Conflicto de unicidad' }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  if (!assertSlug(slug)) return err('Slug inválido', 400)

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

  const patch: Record<string, unknown> = { ...parsed.data }

  // owner_phone → normalizar a E.164 si viene.
  if (typeof patch.owner_phone === 'string') {
    const norm = normalizePhoneE164(patch.owner_phone)
    if (!norm) {
      return err('owner_phone debe estar en formato internacional E.164 (ej. +573001234567)', 400)
    }
    patch.owner_phone = norm
  }

  // owner_email → trim + lowercase. '' o null → null en DB.
  if ('owner_email' in patch) {
    const raw = patch.owner_email
    if (raw === '' || raw === null || raw === undefined) {
      patch.owner_email = null
    } else if (typeof raw === 'string') {
      patch.owner_email = raw.trim().toLowerCase() || null
    }
  }

  // plan → validar contra tabla plans
  if (typeof patch.plan === 'string') {
    const validCodes = await getActivePlanCodes()
    if (!validCodes.includes(patch.plan)) {
      return err(
        `Plan inválido. Opciones: ${validCodes.join(', ') || '(no hay planes activos)'}`,
        400,
      )
    }
  }

  try {
    const updated = await updateTenant(slug, patch)
    if (!updated) return notFound('Tenant')
    return ok(updated)
  } catch (e) {
    const dup = mapDuplicateMessage(e)
    if (dup) return err(dup.message, dup.status)
    return serverError(e)
  }
}
