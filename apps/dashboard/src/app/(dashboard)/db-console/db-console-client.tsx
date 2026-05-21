'use client'

import { AlertTriangle, Database, Play, RotateCcw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

type DatabaseTarget = 'platform' | 'tenant'
type ConsoleMode = 'read' | 'write'

type QueryResult = {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  returnedRows: number
  truncated: boolean
}

const EXAMPLES: Record<ConsoleMode, Record<DatabaseTarget, string>> = {
  read: {
    platform:
      "SELECT table_name\nFROM information_schema.tables\nWHERE table_schema = 'public'\nORDER BY table_name",
    tenant:
      'SELECT tenant_id, COUNT(*) AS orders\nFROM orders\nGROUP BY tenant_id\nORDER BY orders DESC\nLIMIT 20',
  },
  write: {
    platform:
      "UPDATE tenants\nSET status = 'active'\nWHERE slug = 'tenant-slug'\nRETURNING id, slug, status",
    tenant:
      "UPDATE orders\nSET status = 'cancelled'\nWHERE id = 'order-uuid'\nRETURNING id, status",
  },
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function DbConsoleClient({ writesEnabled }: { writesEnabled: boolean }) {
  const [mode, setMode] = useState<ConsoleMode>('read')
  const [database, setDatabase] = useState<DatabaseTarget>('platform')
  const [query, setQuery] = useState(EXAMPLES.read.platform)
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<QueryResult | null>(null)

  function changeMode(value: ConsoleMode) {
    if (value === 'write' && !writesEnabled) return
    setMode(value)
    setQuery(EXAMPLES[value][database])
    setReason('')
    setConfirm('')
    setError(null)
    setResult(null)
  }

  function changeDatabase(value: DatabaseTarget) {
    setDatabase(value)
    setQuery(EXAMPLES[mode][value])
    setError(null)
    setResult(null)
  }

  async function runQuery() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/superadmin/db-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ database, mode, query, reason, confirm }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setResult(null)
        setError(json.error ?? 'No se pudo ejecutar la consulta')
        return
      }

      setResult(json.data)
      toast.success(mode === 'write' ? 'Cambio aplicado' : 'Consulta ejecutada')
    } catch {
      setResult(null)
      setError('Error de conexion')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(380px,500px)_1fr]">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-4 flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Consola SQL</h2>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => changeMode('read')}
              disabled={loading}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors ${
                mode === 'read'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              Lectura
            </button>
            <button
              type="button"
              onClick={() => changeMode('write')}
              disabled={loading || !writesEnabled}
              title={
                writesEnabled
                  ? 'Ejecutar cambios controlados'
                  : 'La escritura esta deshabilitada en este entorno'
              }
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors ${
                mode === 'write'
                  ? 'border-destructive bg-destructive text-destructive-foreground'
                  : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <AlertTriangle className="h-4 w-4" />
              Escritura
            </button>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="db-target" className="text-xs font-medium text-muted-foreground">
              Base de datos
            </label>
            <select
              id="db-target"
              value={database}
              onChange={(event) => changeDatabase(event.target.value as DatabaseTarget)}
              disabled={loading}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="platform">Platform</option>
              <option value="tenant">Tenant</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="sql-query" className="text-xs font-medium text-muted-foreground">
              SQL
            </label>
            <textarea
              id="sql-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={loading}
              spellCheck={false}
              className="min-h-[280px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {mode === 'write' && (
            <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="space-y-1.5">
                <label htmlFor="write-reason" className="text-xs font-medium text-muted-foreground">
                  Motivo
                </label>
                <input
                  id="write-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={loading}
                  placeholder="Ej: corregir estado de orden reportada por soporte"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="write-confirm"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Confirmacion
                </label>
                <input
                  id="write-confirm"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  disabled={loading}
                  placeholder="APLICAR"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runQuery}
              disabled={
                loading ||
                !query.trim() ||
                (mode === 'write' && (confirm !== 'APLICAR' || reason.trim().length < 10))
              }
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium shadow transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                mode === 'write'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
            >
              <Play className="h-4 w-4" />
              {loading ? 'Ejecutando...' : mode === 'write' ? 'Aplicar' : 'Ejecutar'}
            </button>
            <button
              type="button"
              onClick={() => setQuery(EXAMPLES[mode][database])}
              disabled={loading}
              title="Restaurar ejemplo"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      <section className="min-w-0 rounded-md border border-border bg-card">
        <div className="flex h-12 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold text-foreground">Resultado</h2>
          {result && (
            <span className="text-xs text-muted-foreground">
              {result.returnedRows} filas mostradas
              {result.truncated ? ` de ${result.rowCount}` : ''}
            </span>
          )}
        </div>

        {!result ? (
          <div className="flex min-h-[360px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Ejecuta una consulta para ver los resultados.
          </div>
        ) : result.columns.length === 0 ? (
          <div className="flex min-h-[360px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Consulta ejecutada sin columnas para mostrar.
          </div>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {result.columns.map((column) => (
                    <th
                      key={column}
                      className="border-b border-r border-border px-3 py-2 font-medium text-muted-foreground last:border-r-0"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr
                    key={result.columns.map((column) => formatCell(row[column])).join('|')}
                    className="odd:bg-background even:bg-muted/30"
                  >
                    {result.columns.map((column) => (
                      <td
                        key={column}
                        className="max-w-[360px] border-b border-r border-border px-3 py-2 align-top text-foreground last:border-r-0"
                      >
                        <pre className="whitespace-pre-wrap break-words font-mono">
                          {formatCell(row[column])}
                        </pre>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
