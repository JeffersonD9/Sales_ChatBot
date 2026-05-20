import { db } from '@/db'
import { panelUsers } from '@/db/schema'
import { createSession, sessionCookieOptions } from '@/lib/auth'
import { SESSION_COOKIE } from '@/lib/constants'
import { verifyPassword } from '@/lib/password'
import { checkRateLimit, clearRateLimit, recordFailedAttempt } from '@/lib/rate-limit'
import { err, ok, unauthorized } from '@/lib/response'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rateLimitKey = `login:${ip}`

  const limitResult = await checkRateLimit(rateLimitKey)
  if (!limitResult.allowed) {
    const waitMin = Math.ceil(limitResult.retryAfterMs / 60_000)
    return err(`Demasiados intentos fallidos. Intentá en ${waitMin} minuto(s).`, 429)
  }

  const body = await req.json().catch(() => null)
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) return err('Credenciales inválidas', 400)

  const { username, password } = parsed.data

  const user = await db.query.panelUsers
    .findFirst({
      where: eq(panelUsers.username, username),
    })
    .catch(() => null)

  // Respuesta idéntica para usuario inexistente y contraseña incorrecta
  // (evita user enumeration)
  if (!user || !user.is_active) {
    await recordFailedAttempt(rateLimitKey)
    return unauthorized('Usuario o contraseña incorrectos')
  }

  const valid = await verifyPassword(user.password_hash, password)
  if (!valid) {
    await recordFailedAttempt(rateLimitKey)
    return unauthorized('Usuario o contraseña incorrectos')
  }

  await clearRateLimit(rateLimitKey)

  const token = await createSession(user.id, ip, req.headers.get('user-agent'))

  const response = ok({ username: user.username, role: user.role })
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions)
  return response
}
