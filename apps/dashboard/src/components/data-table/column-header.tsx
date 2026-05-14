'use client'

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { Column } from '@tanstack/react-table'
import { cn } from '@/lib/utils'

interface ColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>
  title: string
  className?: string
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: ColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <span className={cn('text-xs font-medium', className)}>{title}</span>
  }

  return (
    <button
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      className={cn(
        'flex items-center gap-1 text-xs font-medium -ml-1 px-1 py-0.5 rounded',
        'hover:text-foreground transition-colors',
        className,
      )}
    >
      {title}
      {column.getIsSorted() === 'desc' ? (
        <ArrowDown className="h-3 w-3" />
      ) : column.getIsSorted() === 'asc' ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  )
}
