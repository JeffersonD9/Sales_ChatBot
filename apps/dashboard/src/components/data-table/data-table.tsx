'use client'

import {
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useState } from 'react'
import { useDataTable } from '@/hooks/use-data-table'
import { DataTablePagination } from './pagination'
import { DataTableToolbar } from './toolbar'
import type { DataTableProps } from './types'

// Nota: este componente usa useSearchParams (via useDataTable).
// Envolvelo en <Suspense fallback={<TableSkeleton />}> en la página que lo use.

export function DataTable<TData>({
  data,
  columns,
  totalCount,
  defaultPageSize = 20,
  searchPlaceholder = 'Buscar...',
  toolbarActions,
}: DataTableProps<TData>) {
  const { page, pageSize, sort, dir, query, pageCount, setPage, setPageSize, setSort, setQuery } =
    useDataTable(totalCount, defaultPageSize)

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  const sorting: SortingState = sort ? [{ id: sort, desc: dir === 'desc' }] : []

  const table = useReactTable({
    data,
    columns: columns as ColumnDef<TData>[],
    pageCount,
    state: {
      sorting,
      pagination: { pageIndex: page - 1, pageSize },
      columnVisibility,
    },
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      if (next.length > 0) {
        setSort(next[0].id, next[0].desc ? 'desc' : 'asc')
      } else {
        setSort('', 'asc')
      }
    },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="space-y-4">
      <DataTableToolbar
        table={table}
        searchPlaceholder={searchPlaceholder}
        query={query}
        onQueryChange={setQuery}
        actions={toolbarActions}
      />

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full caption-bottom text-sm">
          <thead className="bg-muted/40">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    style={{ width: h.getSize() !== 150 ? h.getSize() : undefined }}
                    className="h-10 px-4 text-left align-middle text-xs font-medium text-muted-foreground"
                  >
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  Sin resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <DataTablePagination
        page={page}
        pageSize={pageSize}
        pageCount={pageCount}
        totalCount={totalCount}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  )
}

// Skeleton para el Suspense fallback
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-4">
      <div className="h-9 w-64 rounded-md bg-muted animate-pulse" />
      <div className="overflow-hidden rounded-md border border-border">
        <div className="h-10 bg-muted/40 border-b border-border" />
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex h-12 items-center gap-4 px-4 border-b border-border last:border-0"
          >
            {Array.from({ length: cols }).map((_, j) => (
              <div
                key={j}
                className="h-4 flex-1 rounded bg-muted animate-pulse"
                style={{ animationDelay: `${(i * cols + j) * 50}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
