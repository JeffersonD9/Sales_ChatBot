import { db } from '@/db'
import { panelSessions } from '@/db/schema'
import { createSession, hashToken, revokeCurrentSession, sessionCookieOptions } from '@/lib/auth'
import { SESSION_COOKIE } from '@/lib/constants'
import { ok, unauthorized } from '@/lib/response'
import { and, eq, gt } from 'drizzle-orm'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const raw = cookieStore.get(SESSION_COOKIE)?.value
  if (!raw) return unauthorized()

  const row = await db.query.panelSessions.findFirst({
    where: and(
      eq(panelSessions.token_hash, hashToken(raw)),
      eq(panelSessions.is_active, true),
      gt(panelSessions.expires_at, new Date()),
    ),
    with: { user: true },
  })

  if (!row || !row.user.is_active) return unauthorized()

  await revokeCurrentSession('refresh')

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const newToken = await createSession(row.user.id, ip, req.headers.get('user-agent'))

  const response = ok({ refreshed: true })
  response.cookies.set(SESSION_COOKIE, newToken, sessionCookieOptions)
  return response
}
