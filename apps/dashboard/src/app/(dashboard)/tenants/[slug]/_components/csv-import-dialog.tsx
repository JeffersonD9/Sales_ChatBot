'use client'

import { Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type ParsedRow = {
  index: number
  data: CsvProduct
  errors: string[]
  valid: boolean
}

type CsvProduct = {
  name: string
  price: number
  image_url: string
  description: string
  sizes: string[]
  emoji: string
  category: string
}

type ImportResult = {
  inserted: unknown[]
  skipped: Array<{
    name: string
    reason: string
    emoji?: string
    price?: number
    category?: string
  }>
  errors: Array<{ name: string; reason: string; emoji?: string; price?: number; category?: string }>
}

type Props = {
  open: boolean
  tenantSlug: string
  onClose: () => void
  onImported: () => void
}

function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const result: string[][] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const fields: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    fields.push(current.trim())
    result.push(fields)
  }
  return result
}

function isValidUrl(str: string) {
  try {
    new URL(str)
    return true
  } catch {
    return false
  }
}

const TEMPLATE_CSV = [
  'name,price,image_url,description,sizes,emoji,category',
  '"Vestido Floral",85000,https://ejemplo.com/vestido.jpg,"Vestido de verano floral",S|M|L,👗,Vestidos',
  '"Blusa Casual",45000,https://ejemplo.com/blusa.jpg,"Blusa básica de algodón",XS|S|M|L|XL,👚,Blusas',
].join('\n')

export function CsvImportDialog({ open, tenantSlug, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedRow[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  useEffect(() => {
    if (!open) {
      setParsed([])
      setResult(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const validRows = parsed.filter((r) => r.valid)
  const invalidRows = parsed.filter((r) => !r.valid)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target?.result as string)
      if (rows.length < 2) {
        toast.error('El CSV debe tener al menos una fila de datos')
        return
      }
      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, '_'))
      const dataRows = rows.slice(1)

      const idxName = headers.indexOf('name')
      const idxPrice = headers.indexOf('price')
      const idxImg = headers.indexOf('image_url')
      const idxDesc = headers.indexOf('description')
      const idxSizes = headers.indexOf('sizes')
      const idxEmoji = headers.indexOf('emoji')
      const idxCat = headers.indexOf('category')

      if (idxName === -1 || idxPrice === -1 || idxImg === -1) {
        toast.error('Faltan columnas requeridas: name, price, image_url')
        return
      }

      const get = (cols: string[], idx: number) => (idx >= 0 && cols[idx] != null ? cols[idx] : '')

      const result: ParsedRow[] = dataRows.map((cols, i) => {
        const name = get(cols, idxName)
        const priceS = get(cols, idxPrice)
        const imgUrl = get(cols, idxImg)
        const desc = get(cols, idxDesc)
        const sizesS = get(cols, idxSizes)
        const emoji = get(cols, idxEmoji) || '🛍️'
        const cat = get(cols, idxCat)
        const price = Number.parseInt(priceS, 10)
        const sizes = sizesS
          ? sizesS
              .split('|')
              .map((s) => s.trim())
              .filter(Boolean)
          : []
        const errors: string[] = []
        if (!name) errors.push('name requerido')
        if (!priceS || Number.isNaN(price) || price <= 0) errors.push('price inválido')
        if (!imgUrl) errors.push('image_url requerida')
        else if (!isValidUrl(imgUrl)) errors.push('image_url no es URL válida')
        return {
          index: i,
          data: { name, price, image_url: imgUrl, description: desc, sizes, emoji, category: cat },
          errors,
          valid: errors.length === 0,
        }
      })

      setParsed(result)
      setResult(null)
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    if (!validRows.length) return
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/tenants/${tenantSlug}/products/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: validRows.map((r) => r.data) }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Error')
        return
      }

      const importResult = json.data as ImportResult
      if (!importResult.skipped.length && !importResult.errors.length) {
        toast.success(`${importResult.inserted.length} producto(s) importados`)
        onClose()
        onImported()
      } else {
        setResult(importResult)
        if (importResult.inserted.length) onImported()
      }
    } catch {
      toast.error('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'plantilla-productos.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar modal"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-2xl rounded-lg border border-border bg-background p-6 shadow-xl max-h-[92vh] overflow-y-auto">
        {result ? (
          /* Pantalla de resultado */
          <>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold">
                  {result.inserted.length === 0
                    ? 'No se importó ningún producto'
                    : `${result.inserted.length} de ${result.inserted.length + result.skipped.length + result.errors.length} importados`}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {result.skipped.length + result.errors.length} producto(s) no pudieron importarse
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-3">
              {[
                {
                  label: 'Importados',
                  count: result.inserted.length,
                  color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/30',
                },
                {
                  label: 'Ya existían',
                  count: result.skipped.length,
                  color: 'text-amber-600 bg-amber-500/10 border-amber-500/30',
                },
                {
                  label: 'Errores',
                  count: result.errors.length,
                  color: 'text-destructive bg-destructive/10 border-destructive/30',
                },
              ].map(({ label, count, color }) => (
                <div
                  key={label}
                  className={`flex items-center gap-3 rounded-lg border p-3 ${color}`}
                >
                  <span className="text-xl font-bold leading-none">{count}</span>
                  <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
                </div>
              ))}
            </div>

            <div className="max-h-52 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Producto
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Precio
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...result.skipped.map((p) => ({ ...p, _s: 'skip' })),
                    ...result.errors.map((p) => ({ ...p, _s: 'err' })),
                  ].map((p) => (
                    <tr
                      key={`${p._s}-${p.name}-${p.reason}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          {p.emoji || '🛍️'} {p.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{p.reason}</div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.price != null ? `$${Number(p.price).toLocaleString('es-CO')}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p._s === 'skip' ? (
                          <span className="inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600">
                            Ya existe
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                            Error
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Cerrar
              </button>
            </div>
          </>
        ) : (
          /* Pantalla de importación */
          <>
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold">Importar productos por CSV</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Requeridos: <code className="rounded bg-muted px-1">name</code>,{' '}
                  <code className="rounded bg-muted px-1">price</code>,{' '}
                  <code className="rounded bg-muted px-1">image_url</code>. Opcionales:{' '}
                  <code className="rounded bg-muted px-1">description</code>,{' '}
                  <code className="rounded bg-muted px-1">sizes</code> (separar con{' '}
                  <code className="rounded bg-muted px-1">|</code>),{' '}
                  <code className="rounded bg-muted px-1">emoji</code>,{' '}
                  <code className="rounded bg-muted px-1">category</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 flex items-center gap-3">
              <button
                type="button"
                onClick={downloadTemplate}
                className="flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-xs font-medium transition-colors hover:bg-accent"
              >
                ↓ Descargar plantilla
              </button>
              <span className="text-xs text-muted-foreground">o sube tu propio CSV</span>
            </div>

            <div className="mb-4">
              <label htmlFor="products-csv-file" className="mb-1.5 block text-sm font-medium">
                Archivo CSV
              </label>
              <input
                id="products-csv-file"
                ref={fileRef}
                type="file"
                accept=".csv"
                onChange={handleFile}
                className="flex h-9 w-full cursor-pointer rounded-md border border-input bg-transparent px-3 py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium"
              />
            </div>

            {parsed.length > 0 && (
              <>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Vista previa — {parsed.length} fila(s)
                  {invalidRows.length > 0 && (
                    <span className="ml-2 text-amber-600">
                      {invalidRows.length} con errores (serán ignoradas)
                    </span>
                  )}
                </div>
                <div className="mb-4 max-h-48 overflow-auto rounded-md border border-border">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        {[
                          '#',
                          'name',
                          'price',
                          'image_url',
                          'sizes',
                          'emoji',
                          'category',
                          'estado',
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-2.5 py-1.5 text-left font-semibold text-muted-foreground"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.map((row) => (
                        <tr key={row.index} className={row.valid ? '' : 'bg-destructive/5'}>
                          <td className="px-2.5 py-1">{row.index + 1}</td>
                          <td className="px-2.5 py-1">{row.data.name}</td>
                          <td className="px-2.5 py-1">
                            {Number.isNaN(row.data.price) ? '' : row.data.price}
                          </td>
                          <td className="px-2.5 py-1" title={row.data.image_url}>
                            {row.data.image_url.length > 24
                              ? `${row.data.image_url.slice(0, 24)}…`
                              : row.data.image_url}
                          </td>
                          <td className="px-2.5 py-1">{row.data.sizes.join('|')}</td>
                          <td className="px-2.5 py-1">{row.data.emoji}</td>
                          <td className="px-2.5 py-1">{row.data.category}</td>
                          <td className="px-2.5 py-1">
                            {row.valid ? (
                              <span className="text-emerald-600">✓</span>
                            ) : (
                              <span className="text-destructive">{row.errors.join(', ')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={validRows.length === 0 || loading}
                className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {loading
                  ? 'Importando…'
                  : `Subir ${validRows.length} producto${validRows.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
