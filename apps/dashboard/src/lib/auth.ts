import { createHash } from 'node:crypto'
import { db } from '@/db'
import { panelSessions } from '@/db/schema'
import { env } from '@/env'
import { SESSION_COOKIE } from '@/lib/constants'
import type { SessionUser } from '@/types/api'
import { and, eq, gt } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { cookies } from 'next/headers'

// ── Token helpers ─────────────────────────────────────────────────────────────

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

// ── Cookie options ────────────────────────────────────────────────────────────

export const sessionCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: env.SESSION_TTL_SECONDS,
  path: '/',
}

export const clearCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 0,
  path: '/',
}

// ── Session lifecycle ─────────────────────────────────────────────────────────

export async function createSession(
  userId: string,
  ip?: string | null,
  userAgent?: string | null,
): Promise<string> {
  const token = nanoid(32)
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000)

  await db.insert(panelSessions).values({
    user_id: userId,
    token_hash: hashToken(token),
    expires_at: expiresAt,
    ip_address: ip ?? null,
    user_agent: userAgent ?? null,
  })

  return token
}

// Llamado desde Server Components y Route Handlers.
// El middleware solo verifica existencia de cookie (sin DB) para performance.
export async function validateSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(SESSION_COOKIE)?.value
  if (!raw) return null

  const row = await db.query.panelSessions.findFirst({
    where: and(
      eq(panelSessions.token_hash, hashToken(raw)),
      eq(panelSessions.is_active, true),
      gt(panelSessions.expires_at, new Date()),
    ),
    with: { user: true },
  })

  if (!row || !row.user.is_active) return null

  return {
    id: row.user.id,
    username: row.user.username,
    email: row.user.email,
    role: row.user.role,
  }
}

export async function revokeCurrentSession(reason = 'logout'): Promise<void> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(SESSION_COOKIE)?.value
  if (!raw) return

  await db
    .update(panelSessions)
    .set({ is_active: false, revoked_at: new Date(), revoke_reason: reason })
    .where(eq(panelSessions.token_hash, hashToken(raw)))
}
