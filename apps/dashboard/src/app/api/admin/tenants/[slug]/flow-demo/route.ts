import { env } from '@/env'
import { validateSession } from '@/lib/auth'
import { err, ok, serverError, unauthorized } from '@/lib/response'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BASE = (env.API_CORE_INTERNAL_URL || 'http://api:3000').replace(/\/+$/, '')

function authHeaders(): Record<string, string> {
  if (!env.ADMIN_API_KEY) throw new Error('ADMIN_API_KEY no configurado en el dashboard')
  return { 'x-api-key': env.ADMIN_API_KEY }
}

async function parseApiCore(res: Response) {
  const json = await res.json().catch(() => ({}))
  return json as { ok?: boolean; data?: unknown; error?: string }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params

  try {
    const res = await fetch(`${BASE}/api/admin/tenants/${slug}/flow-demo`, {
      headers: authHeaders(),
      cache: 'no-store',
    })
    const json = await parseApiCore(res)
    if (!res.ok) return err(json.error || `api-core ${res.status}`, res.status)
    return ok(json.data)
  } catch (e) {
    return serverError(e, 'flow-demo:get')
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await validateSession()
  if (!user) return unauthorized()

  const { slug } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return err('Datos invalidos', 400)

  try {
    const res = await fetch(`${BASE}/api/admin/tenants/${slug}/flow-demo`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await parseApiCore(res)
    if (!res.ok) return err(json.error || `api-core ${res.status}`, res.status)
    return ok(json.data)
  } catch (e) {
    return serverError(e, 'flow-demo:post')
  }
}
