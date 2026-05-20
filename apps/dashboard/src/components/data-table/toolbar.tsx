'use client'

import { useDebounce } from '@/hooks/use-debounce'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DataTableToolbarProps } from './types'

export function DataTableToolbar<TData>({
  searchPlaceholder,
  query,
  onQueryChange,
  actions,
}: DataTableToolbarProps<TData>) {
  const [local, setLocal] = useState(query)
  const debounced = useDebounce(local, 350)

  // Propagar al hook de URL solo cuando el valor debounced cambia Y difiere del query actual
  useEffect(() => {
    if (debounced !== query) onQueryChange(debounced)
  }, [debounced, query, onQueryChange])

  // Si la URL cambia desde afuera (ej: limpian filtros), sincronizar
  useEffect(() => {
    setLocal(query)
  }, [query])

  return (
    <div className="flex items-center justify-between gap-3">
      {/* Search */}
      <div className="relative w-full max-w-xs">
        <input
          type="search"
          placeholder={searchPlaceholder}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {local && (
          <button
            type="button"
            onClick={() => {
              setLocal('')
              onQueryChange('')
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            title="Limpiar búsqueda"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Slot de acciones: botones de filtro extra, "Nuevo", etc. */}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
