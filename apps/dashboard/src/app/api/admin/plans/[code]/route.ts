import { validateSession } from '@/lib/auth'
import { err, forbidden, notFound, ok, serverError, unauthorized } from '@/lib/response'
import { deletePlan, updatePlan } from '@/queries/plans'
import type { NextRequest } from 'next/server'
import { planFieldsSchema } from '../_schema'

async function requireSuperadmin() {
  const user = await validateSession()
  if (!user) return unauthorized()
  if (user.role !== 'superadmin') return forbidden('Solo superadmin puede gestionar planes')
  return null
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const authError = await requireSuperadmin()
    if (authError) return authError

    const body = await req.json().catch(() => null)
    const parsed = planFieldsSchema.safeParse(body)
    if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

    const { code } = await params
    const plan = await updatePlan(code, parsed.data)
    if (!plan) return notFound('Plan')
    return ok(plan)
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const authError = await requireSuperadmin()
    if (authError) return authError

    const { code } = await params
    const deleted = await deletePlan(code)
    if (deleted === 'in_use') return err('No puedes borrar un plan usado por tenants', 409)
    if (!deleted) return notFound('Plan')
    return ok(deleted)
  } catch (e) {
    return serverError(e)
  }
}
