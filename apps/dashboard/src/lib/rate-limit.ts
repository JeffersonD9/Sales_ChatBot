import { db } from '@/db'
import { panelRateLimits } from '@/db/schema'
import { eq } from 'drizzle-orm'

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutos

// Backoff exponencial: 2min → 4min → 8min → ... hasta 60min
function backoffMs(failCount: number): number {
  const exp = Math.max(0, failCount - MAX_ATTEMPTS)
  return Math.min(2 ** exp * 2 * 60_000, 60 * 60_000)
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number; retryAfterDate: Date }

export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  const record = await db.query.panelRateLimits.findFirst({
    where: eq(panelRateLimits.key, key),
  })

  const now = new Date()

  if (record?.blocked_until && record.blocked_until > now) {
    return {
      allowed: false,
      retryAfterDate: record.blocked_until,
      retryAfterMs: record.blocked_until.getTime() - now.getTime(),
    }
  }

  return { allowed: true }
}

export async function recordFailedAttempt(key: string): Promise<void> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - WINDOW_MS)

  const existing = await db.query.panelRateLimits.findFirst({
    where: eq(panelRateLimits.key, key),
  })

  // Si no hay registro previo o el anterior es de fuera de la ventana → reiniciar
  if (!existing || (existing.first_attempt_at && existing.first_attempt_at < windowStart)) {
    await db
      .insert(panelRateLimits)
      .values({ key, count: 1, first_attempt_at: now, blocked_until: null })
      .onConflictDoUpdate({
        target: panelRateLimits.key,
        set: { count: 1, first_attempt_at: now, blocked_until: null },
      })
    return
  }

  const newCount = existing.count + 1
  const blocked = newCount > MAX_ATTEMPTS ? new Date(now.getTime() + backoffMs(newCount)) : null

  await db
    .update(panelRateLimits)
    .set({ count: newCount, blocked_until: blocked })
    .where(eq(panelRateLimits.key, key))
}

export async function clearRateLimit(key: string): Promise<void> {
  await db.delete(panelRateLimits).where(eq(panelRateLimits.key, key))
}

export async function checkAndRecordFixedWindowLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - windowMs)
  const retryAfterDate = new Date(now.getTime() + windowMs)

  const existing = await db.query.panelRateLimits.findFirst({
    where: eq(panelRateLimits.key, key),
  })

  if (!existing || !existing.first_attempt_at || existing.first_attempt_at < windowStart) {
    await db
      .insert(panelRateLimits)
      .values({ key, count: 1, first_attempt_at: now, blocked_until: null })
      .onConflictDoUpdate({
        target: panelRateLimits.key,
        set: { count: 1, first_attempt_at: now, blocked_until: null },
      })
    return { allowed: true }
  }

  if (existing.blocked_until && existing.blocked_until > now) {
    return {
      allowed: false,
      retryAfterDate: existing.blocked_until,
      retryAfterMs: existing.blocked_until.getTime() - now.getTime(),
    }
  }

  const newCount = existing.count + 1
  const blockedUntil = newCount > maxRequests ? retryAfterDate : null

  await db
    .update(panelRateLimits)
    .set({ count: newCount, blocked_until: blockedUntil })
    .where(eq(panelRateLimits.key, key))

  if (blockedUntil) {
    return {
      allowed: false,
      retryAfterDate: blockedUntil,
      retryAfterMs: blockedUntil.getTime() - now.getTime(),
    }
  }

  return { allowed: true }
}
