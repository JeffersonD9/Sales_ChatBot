import { createHash } from 'node:crypto'
import { platformPool, tenantPool } from '@/db'
import { env } from '@/env'
import { validateSession } from '@/lib/auth'
import { getClientIp } from '@/lib/client-ip'
import { checkAndRecordFixedWindowLimit } from '@/lib/rate-limit'
import { err, forbidden, ok, serverError, unauthorized } from '@/lib/response'
import type { NextRequest } from 'next/server'
import type { Pool } from 'pg'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_QUERY_LENGTH = 2000
const MAX_ROWS = 50
const STATEMENT_TIMEOUT_MS = 2500
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 8

const querySchema = z.object({
  database: z.enum(['platform', 'tenant']),
  mode: z.enum(['read', 'write']).default('read'),
  query: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
  confirm: z.string().optional(),
  reason: z.string().trim().max(500).optional(),
})

type NormalizedQuery = { ok: true; query: string } | { ok: false; error: string }

const DISALLOWED_TOKENS = [
  'alter',
  'analyze',
  'call',
  'comment',
  'copy',
  'create',
  'discard',
  'do',
  'drop',
  'execute',
  'grant',
  'listen',
  'merge',
  'notify',
  'prepare',
  'reassign',
  'refresh',
  'reindex',
  'reset',
  'revoke',
  'security',
  'truncate',
  'unlisten',
  'vacuum',
]

const READ_ONLY_DISALLOWED_TOKENS = ['delete', 'insert', 'set', 'update']

const DANGEROUS_FUNCTIONS = [
  'dblink',
  'lo_export',
  'lo_import',
  'pg_advisory',
  'pg_cancel_backend',
  'pg_execute_server_program',
  'pg_export_snapshot',
  'pg_file',
  'pg_ls',
  'pg_log',
  'pg_read',
  'pg_reload_conf',
  'pg_sleep',
  'pg_stat_file',
  'pg_terminate_backend',
  'query_to_xml',
  'ts_stat',
]

const SENSITIVE_IDENTIFIERS = [
  'api_key',
  'auth_secret',
  'database_url',
  'database_url_encrypted',
  'encryption_key',
  'meta_app_secret',
  'password',
  'password_hash',
  'secret_key',
  'session_data',
  'token_hash',
  'verify_token',
  'wa_token',
  'wa_token_encrypted',
  'webhook_secret',
  'webhook_url',
]

function containsWord(query: string, word: string) {
  return new RegExp(`\\b${word}\\b`, 'i').test(query)
}

function normalizeSql(query: string): NormalizedQuery {
  const trimmed = query.trim()
  const withoutTrailingSemicolon = trimmed.endsWith(';') ? trimmed.slice(0, -1).trim() : trimmed

  if (withoutTrailingSemicolon.includes(';')) {
    return { ok: false, error: 'Solo se permite una sentencia por consulta.' }
  }

  if (/--|\/\*|\*\//.test(withoutTrailingSemicolon)) {
    return { ok: false, error: 'No se permiten comentarios SQL en esta consola.' }
  }

  for (const token of DISALLOWED_TOKENS) {
    if (containsWord(withoutTrailingSemicolon, token)) {
      return { ok: false, error: 'La consulta contiene una instruccion no permitida.' }
    }
  }

  for (const fn of DANGEROUS_FUNCTIONS) {
    if (new RegExp(`\\b${fn}[\\w_]*\\s*\\(`, 'i').test(withoutTrailingSemicolon)) {
      return { ok: false, error: 'La consulta contiene una funcion no permitida.' }
    }
  }

  for (const identifier of SENSITIVE_IDENTIFIERS) {
    if (containsWord(withoutTrailingSemicolon, identifier)) {
      return { ok: false, error: 'No se permite consultar columnas sensibles desde esta consola.' }
    }
  }

  return { ok: true, query: withoutTrailingSemicolon }
}

function normalizeReadOnlyQuery(query: string): NormalizedQuery {
  const base = normalizeSql(query)
  if (!base.ok) return base

  const withoutTrailingSemicolon = base.query

  if (!/^(select|with|explain)\b/i.test(withoutTrailingSemicolon)) {
    return {
      ok: false,
      error: 'Solo se permiten consultas de lectura: SELECT, WITH o EXPLAIN.',
    }
  }

  if (/^explain\s+(analyze|analyse)\b/i.test(withoutTrailingSemicolon)) {
    return { ok: false, error: 'EXPLAIN ANALYZE no esta permitido.' }
  }

  for (const token of READ_ONLY_DISALLOWED_TOKENS) {
    if (containsWord(withoutTrailingSemicolon, token)) {
      return { ok: false, error: 'La consulta contiene una instruccion no permitida.' }
    }
  }

  if (/\bselect\s+\*/i.test(withoutTrailingSemicolon)) {
    return { ok: false, error: 'SELECT * no esta permitido. Indica columnas explicitas.' }
  }

  return { ok: true, query: withoutTrailingSemicolon }
}

function normalizeWriteQuery(query: string): NormalizedQuery {
  const base = normalizeSql(query)
  if (!base.ok) return base

  const normalized = base.query
  if (!/^(update|insert|delete)\b/i.test(normalized)) {
    return {
      ok: false,
      error: 'En modo escritura solo se permiten UPDATE, INSERT o DELETE.',
    }
  }

  if (/^(update|delete)\b/i.test(normalized) && !containsWord(normalized, 'where')) {
    return { ok: false, error: 'UPDATE y DELETE requieren WHERE.' }
  }

  if (/\bwhere\s+(true|1\s*=\s*1)\b/i.test(normalized)) {
    return { ok: false, error: 'WHERE demasiado amplio. Usa una condicion especifica.' }
  }

  return { ok: true, query: normalized }
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return `[bytea ${value.length} bytes]`
  if (typeof value === 'bigint') return value.toString()
  return value
}

function serializeRows(rows: Record<string, unknown>[]) {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, serializeValue(value)])),
  )
}

async function runDbConsoleQuery(pool: Pool, query: string, mode: 'read' | 'write') {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    if (mode === 'read') {
      await client.query('SET TRANSACTION READ ONLY')
      await client.query("SELECT set_config('default_transaction_read_only', 'on', true)")
    }
    await client.query("SELECT set_config('row_security', 'on', true)")
    await client.query("SELECT set_config('lock_timeout', $1, true)", [`${STATEMENT_TIMEOUT_MS}ms`])
    await client.query("SELECT set_config('idle_in_transaction_session_timeout', $1, true)", [
      `${STATEMENT_TIMEOUT_MS}ms`,
    ])
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      `${STATEMENT_TIMEOUT_MS}ms`,
    ])

    const result = await client.query(query)
    await client.query('COMMIT')

    return {
      columns: result.fields.map((field) => field.name),
      rows: serializeRows(result.rows.slice(0, MAX_ROWS)),
      rowCount: result.rowCount ?? result.rows.length,
      returnedRows: Math.min(result.rows.length, MAX_ROWS),
      truncated: result.rows.length > MAX_ROWS,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

function getAllowedOrigins(req: NextRequest): Set<string> {
  const currentOrigin = new URL(req.url).origin
  const configuredOrigin = env.NEXT_PUBLIC_APP_URL ? new URL(env.NEXT_PUBLIC_APP_URL).origin : ''
  return new Set([currentOrigin, configuredOrigin].filter(Boolean))
}

function validateBrowserRequest(req: NextRequest): string | null {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return 'Content-Type invalido'
  }

  if (req.headers.get('x-requested-with') !== 'XMLHttpRequest') {
    return 'Solicitud rechazada'
  }

  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')
  const allowedOrigins = getAllowedOrigins(req)

  if (!origin || !allowedOrigins.has(origin)) {
    return 'Origen no permitido'
  }

  if (referer && !allowedOrigins.has(new URL(referer).origin)) {
    return 'Referer no permitido'
  }

  const fetchSite = req.headers.get('sec-fetch-site')
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    return 'Contexto de navegacion no permitido'
  }

  return null
}

function queryHash(query: string): string {
  return createHash('sha256').update(query).digest('hex').slice(0, 16)
}

function auditDbConsole(event: string, fields: Record<string, unknown>) {
  console.warn(JSON.stringify({ event: `db_console.${event}`, ...fields }))
}

function sanitizeQueryError(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code === '57014') return 'La consulta excedio el tiempo permitido.'
  if (code === '25P02') return 'La transaccion fue abortada.'
  if (code === '42501') return 'Permisos insuficientes para consultar ese recurso.'
  return 'La consulta fue rechazada o fallo.'
}

function secureResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'no-store, max-age=0')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    const browserError = validateBrowserRequest(req)
    if (browserError) {
      auditDbConsole('rejected_request', { ip, reason: browserError })
      return secureResponse(forbidden('Solicitud no permitida'))
    }

    const user = await validateSession()
    if (!user) return unauthorized()
    if (user.role !== 'superadmin') {
      auditDbConsole('forbidden', { ip, userId: user.id, role: user.role })
      return forbidden('Solo superadmin puede consultar la base de datos')
    }

    const limit = await checkAndRecordFixedWindowLimit(
      `db-console:${user.id}:${ip}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS,
    )
    if (!limit.allowed) {
      auditDbConsole('rate_limited', { ip, userId: user.id })
      return secureResponse(err('Demasiadas consultas. Espera un momento e intenta de nuevo.', 429))
    }

    const body = await req.json().catch(() => null)
    const parsed = querySchema.safeParse(body)
    if (!parsed.success) return secureResponse(err('Datos invalidos', 400))

    if (parsed.data.mode === 'write') {
      if (!env.DB_CONSOLE_WRITES_ENABLED) {
        auditDbConsole('write_disabled', { ip, userId: user.id, database: parsed.data.database })
        return secureResponse(forbidden('La escritura desde consola no esta habilitada.'))
      }

      if (parsed.data.confirm !== 'APLICAR') {
        return secureResponse(err('Para escribir debes confirmar con APLICAR.', 400))
      }

      if (!parsed.data.reason || parsed.data.reason.length < 10) {
        return secureResponse(err('Indica un motivo de al menos 10 caracteres.', 400))
      }
    }

    const normalized =
      parsed.data.mode === 'write'
        ? normalizeWriteQuery(parsed.data.query)
        : normalizeReadOnlyQuery(parsed.data.query)
    if (!normalized.ok) {
      auditDbConsole('rejected_query', {
        ip,
        userId: user.id,
        database: parsed.data.database,
        mode: parsed.data.mode,
        reason: normalized.error,
        queryHash: queryHash(parsed.data.query),
      })
      return secureResponse(err(normalized.error, 400))
    }

    const pool = parsed.data.database === 'platform' ? platformPool : tenantPool
    let result: Awaited<ReturnType<typeof runDbConsoleQuery>>
    try {
      result = await runDbConsoleQuery(pool, normalized.query, parsed.data.mode)
    } catch (error) {
      auditDbConsole('query_failed', {
        ip,
        userId: user.id,
        database: parsed.data.database,
        mode: parsed.data.mode,
        queryHash: queryHash(normalized.query),
        code:
          typeof error === 'object' && error && 'code' in error ? String(error.code) : undefined,
      })
      return secureResponse(err(sanitizeQueryError(error), 400))
    }

    auditDbConsole('query_ok', {
      ip,
      userId: user.id,
      database: parsed.data.database,
      mode: parsed.data.mode,
      queryHash: queryHash(normalized.query),
      reasonHash: parsed.data.reason ? queryHash(parsed.data.reason) : undefined,
      returnedRows: result.returnedRows,
      truncated: result.truncated,
      affectedRows: result.rowCount,
    })

    return secureResponse(ok(result))
  } catch (error) {
    return secureResponse(serverError(error))
  }
}
