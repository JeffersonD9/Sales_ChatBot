import { env } from '@/env'
import { validateSession } from '@/lib/auth'
import { created, err, ok, serverError, unauthorized } from '@/lib/response'
import { normalizePhoneE164, slugify } from '@/lib/utils'
import { getActivePlanCodes } from '@/queries/plans'
import { getTenantList } from '@/queries/tenants'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'

const BASE = (env.API_CORE_INTERNAL_URL || 'http://api:3000').replace(/\/+$/, '')

function authHeaders(): Record<string, string> {
  if (!env.ADMIN_API_KEY) throw new Error('ADMIN_API_KEY no configurado en el dashboard')
  return { 'x-api-key': env.ADMIN_API_KEY, 'Content-Type': 'application/json' }
}

export async function GET(req: NextRequest) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const sp = req.nextUrl.searchParams
  const params = {
    page: Math.max(1, Number(sp.get('page') ?? 1)),
    pageSize: Number(sp.get('size') ?? 20),
    sort: sp.get('sort') ?? 'created_at',
    dir: (sp.get('dir') ?? 'desc') as 'asc' | 'desc',
    query: sp.get('q') ?? '',
  }

  try {
    const { data, total } = await getTenantList(params)
    return ok(data, {
      total,
      page: params.page,
      pageSize: params.pageSize,
      pageCount: Math.ceil(total / params.pageSize),
    })
  } catch (e) {
    return serverError(e)
  }
}

// Validación cliente-side (server-side la repite api-core).
// owner_phone se acepta con formato libre; se normaliza a E.164 antes de enviar.
const createSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(256),
  owner_phone: z.string().min(7).max(32),
  owner_email: z.string().email().optional(),
  plan: z
    .string()
    .regex(/^[a-z0-9_-]+$/)
    .default('basic'),
})

export async function POST(req: NextRequest) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

  const phoneNorm = normalizePhoneE164(parsed.data.owner_phone)
  if (!phoneNorm) {
    return err('owner_phone debe estar en formato internacional E.164 (ej. +573001234567)', 400)
  }

  // Plan debe existir en la tabla plans (no basta el regex sintáctico).
  const validPlanCodes = await getActivePlanCodes()
  if (!validPlanCodes.includes(parsed.data.plan)) {
    return err(
      `Plan inválido. Opciones: ${validPlanCodes.join(', ') || '(no hay planes activos)'}`,
      400,
    )
  }

  const slug = slugify(parsed.data.name).slice(0, 60)
  if (slug.length < 2) return err('Nombre inválido para generar slug (mínimo 2 chars)', 400)

  // Proxy a api-core: genera verify_token, cifra wa_token cuando exista,
  // crea la allocation y publica el evento de invalidación de cache.
  try {
    const upstream = await fetch(`${BASE}/api/admin/tenants`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        slug,
        name: parsed.data.name,
        owner_phone: phoneNorm,
        owner_email: parsed.data.owner_email
          ? parsed.data.owner_email.trim().toLowerCase()
          : undefined,
        plan: parsed.data.plan,
      }),
    })
    const json = (await upstream.json().catch(() => ({}))) as {
      ok?: boolean
      data?: unknown
      error?: string
    }
    if (!upstream.ok) {
      return err(json.error || `api-core ${upstream.status}`, upstream.status)
    }
    return created(json.data ?? null)
  } catch (e) {
    return serverError(e, 'admin:tenants:create')
  }
}
