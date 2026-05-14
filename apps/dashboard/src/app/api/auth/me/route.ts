import { validateSession } from '@/lib/auth'
import { ok, unauthorized } from '@/lib/response'

export async function GET() {
  const user = await validateSession()
  if (!user) return unauthorized()
  return ok(user)
}
