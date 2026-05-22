import { validateSession } from '@/lib/auth'
import { err, forbidden, notFound, ok, serverError, unauthorized } from '@/lib/response'
import { toggleAdminUserActive, updateAdminUserRole } from '@/queries/admin-users'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

const patchSchema = z
  .object({
    is_active: z.boolean().optional(),
    role: z.enum(['admin', 'viewer']).optional(),
  })
  .refine((data) => data.is_active !== undefined || data.role !== undefined, {
    message: 'Debes enviar un cambio',
  })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await validateSession()
    if (!actor) return unauthorized()
    if (actor.role !== 'superadmin') return forbidden('Solo superadmin puede gestionar usuarios')

    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) return err('Datos inválidos', 400, parsed.error.flatten())

    const { id } = await params
    const updated =
      parsed.data.role !== undefined
        ? await updateAdminUserRole(id, parsed.data.role)
        : await toggleAdminUserActive(id, parsed.data.is_active as boolean)

    if (!updated) return notFound('Usuario editable')
    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}
