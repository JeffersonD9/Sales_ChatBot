'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// El estado del DataTable (sort, paginación, búsqueda) vive en la URL.
// Ventajas: bookmarkable, el botón atrás funciona, sharable, el Server
// Component re-renderiza automáticamente con los nuevos datos.

export function useDataTable(totalCount: number, defaultPageSize = 20) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Number(searchParams.get('size') ?? defaultPageSize)
  const sort = searchParams.get('sort') ?? ''
  const dir = (searchParams.get('dir') ?? 'asc') as 'asc' | 'desc'
  const query = searchParams.get('q') ?? ''
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))

  const update = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  return {
    page,
    pageSize,
    sort,
    dir,
    query,
    pageCount,
    totalCount,
    setPage:     (p: number) => update({ page: p === 1 ? null : String(p) }),
    setPageSize: (s: number) => update({ size: String(s), page: null }),
    setSort:     (col: string, d: 'asc' | 'desc') =>
      update({ sort: col || null, dir: col ? d : null, page: null }),
    setQuery:    (q: string) => update({ q: q || null, page: null }),
  }
}

export type DataTableHook = ReturnType<typeof useDataTable>
