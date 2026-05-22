import { validateSession } from '@/lib/auth'
import { ok, serverError, unauthorized } from '@/lib/response'

export async function GET() {
  try {
    const user = await validateSession()
    if (!user) return unauthorized()
    return ok(user)
  } catch (e) {
    return serverError(e, 'auth.me')
  }
}
