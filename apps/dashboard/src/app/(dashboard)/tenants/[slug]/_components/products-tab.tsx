'use client'

import type { ProductRow } from '@/queries/products'
import { Pencil, Plus, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { CsvImportDialog } from './csv-import-dialog'
import { ProductDialog } from './product-dialog'

type Props = {
  tenantSlug: string
  products: ProductRow[]
}

export function ProductsTab({ tenantSlug, products: initialProducts }: Props) {
  const router = useRouter()
  const [products, setProducts] = useState<ProductRow[]>(initialProducts)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [csvOpen, setCsvOpen] = useState(false)
  const [editing, setEditing] = useState<ProductRow | null>(null)
  const [deactivating, setDeactivating] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/admin/tenants/${tenantSlug}/products`)
    if (res.ok) {
      const json = await res.json()
      setProducts(json.data ?? [])
    }
    router.refresh()
  }, [tenantSlug, router])

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(p: ProductRow) {
    setEditing(p)
    setDialogOpen(true)
  }

  async function handleDeactivate(id: string, name: string) {
    if (!confirm(`¿Desactivar "${name}"?`)) return
    setDeactivating(id)
    try {
      const res = await fetch(`/api/admin/tenants/${tenantSlug}/products/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const j = await res.json()
        toast.error(j.error ?? 'Error')
        return
      }
      toast.success('Producto desactivado')
      await refresh()
    } catch {
      toast.error('Error de conexión')
    } finally {
      setDeactivating(null)
    }
  }

  const activeProducts = products.filter((p) => p.active)
  const inactiveProducts = products.filter((p) => !p.active)

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm text-muted-foreground">{activeProducts.length} activo(s)</span>
          {inactiveProducts.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">
              · {inactiveProducts.length} inactivo(s)
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCsvOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-xs font-medium transition-colors hover:bg-accent"
          >
            <Upload className="h-3.5 w-3.5" />
            Importar CSV
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Nuevo producto
          </button>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
          <span className="text-4xl">🛍️</span>
          <p className="text-sm">Sin productos — agrega el primero</p>
        </div>
      ) : (
        <div className="mt-4 overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Producto
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Precio
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tallas
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Categoría
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Estado
                </th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg leading-none">{p.emoji}</span>
                      <div>
                        <div className="font-medium text-foreground">{p.name}</div>
                        {p.description && (
                          <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                            {p.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    ${p.price.toLocaleString('es-CO')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {p.sizes.length ? (
                        p.sizes.map((s) => (
                          <span
                            key={s}
                            className="inline-flex rounded bg-muted px-1.5 py-0.5 text-xs font-medium"
                          >
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.category || '—'}</td>
                  <td className="px-4 py-3">
                    {p.active ? (
                      <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600">
                        Activo
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {p.active && (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(p.id, p.name)}
                          disabled={deactivating === p.id}
                          className="flex h-7 items-center rounded-md px-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                          title="Desactivar"
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProductDialog
        open={dialogOpen}
        tenantSlug={tenantSlug}
        product={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={refresh}
      />

      <CsvImportDialog
        open={csvOpen}
        tenantSlug={tenantSlug}
        onClose={() => setCsvOpen(false)}
        onImported={refresh}
      />
    </>
  )
}
