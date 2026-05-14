import type { ColumnDef, Table } from '@tanstack/react-table'

export type { ColumnDef }

export interface DataTableProps<TData> {
  data: TData[]
  columns: ColumnDef<TData>[]
  totalCount: number
  defaultPageSize?: number
  searchPlaceholder?: string
  // Slot para acciones extra en la toolbar (botones de filtro, crear, etc.)
  toolbarActions?: React.ReactNode
}

export interface DataTableToolbarProps<TData> {
  table: Table<TData>
  searchPlaceholder: string
  query: string
  onQueryChange: (q: string) => void
  actions?: React.ReactNode
}

export interface DataTablePaginationProps {
  page: number
  pageSize: number
  pageCount: number
  totalCount: number
  onPageChange: (p: number) => void
  onPageSizeChange: (s: number) => void
}
