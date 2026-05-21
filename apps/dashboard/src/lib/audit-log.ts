import { env } from '@/env'
import * as Sentry from '@sentry/nextjs'

type AuditLevel = 'info' | 'warn' | 'error'

const SENTRY_EXTRA_KEYS = new Set([
  'queryHash',
  'userId',
  'database',
  'mode',
  'code',
  'returnedRows',
  'affectedRows',
  'truncated',
])

function sentryLevel(level: AuditLevel) {
  return level === 'warn' ? 'warning' : level
}

function sentryExtra(fields: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) => SENTRY_EXTRA_KEYS.has(key) && value !== undefined,
    ),
  )
}

export function auditLog(event: string, level: AuditLevel, fields: Record<string, unknown>) {
  console.warn(JSON.stringify({ event, ...fields }))

  if (!env.SENTRY_DSN) return

  Sentry.captureMessage(event, {
    level: sentryLevel(level),
    extra: sentryExtra(fields),
    tags: { event },
  })
}
