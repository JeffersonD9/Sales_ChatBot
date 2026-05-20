'use client'

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import type { DataTablePaginationProps } from './types'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export function DataTablePagination({
  page,
  pageSize,
  pageCount,
  totalCount,
  onPageChange,
  onPageSizeChange,
}: DataTablePaginationProps) {
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, totalCount)

  return (
    <div className="flex items-center justify-between gap-4 px-1">
      <p className="text-sm text-muted-foreground">
        {totalCount === 0 ? 'Sin resultados' : `${from}–${to} de ${totalCount}`}
      </p>

      <div className="flex items-center gap-4">
        {/* Page size */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Por página</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Nav */}
        <div className="flex items-center gap-1">
          <NavBtn onClick={() => onPageChange(1)} disabled={page <= 1} title="Primera">
            <ChevronsLeft className="h-4 w-4" />
          </NavBtn>
          <NavBtn onClick={() => onPageChange(page - 1)} disabled={page <= 1} title="Anterior">
            <ChevronLeft className="h-4 w-4" />
          </NavBtn>

          <span className="min-w-[5rem] text-center text-sm text-muted-foreground">
            {page} / {pageCount}
          </span>

          <NavBtn
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount}
            title="Siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </NavBtn>
          <NavBtn
            onClick={() => onPageChange(pageCount)}
            disabled={page >= pageCount}
            title="Última"
          >
            <ChevronsRight className="h-4 w-4" />
          </NavBtn>
        </div>
      </div>
    </div>
  )
}

function NavBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled: boolean
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}
