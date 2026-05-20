'use client'

import { DataTableColumnHeader } from '@/components/data-table/column-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { OrderRow } from '@/queries/orders'
import type { ColumnDef } from '@tanstack/react-table'
import Link from 'next/link'
import { OrderStatusSelect } from './_components/order-status-select'

export const columns: ColumnDef<OrderRow>[] = [
  {
    accessorKey: 'customer_name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Cliente" />,
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{row.original.customer_name ?? '—'}</p>
        <p className="font-mono text-xs text-muted-foreground">{row.original.customer_phone}</p>
      </div>
    ),
  },
  {
    accessorKey: 'tenant_name',
    header: 'Tenant',
    cell: ({ row }) => (
      <Link
        href={`/tenants/${row.original.tenant_slug}`}
        className="block max-w-[140px] truncate text-sm text-primary hover:underline"
      >
        {row.original.tenant_name}
      </Link>
    ),
  },
  {
    accessorKey: 'items_count',
    header: 'Items',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{row.original.items_count}</span>
    ),
    size: 60,
  },
  {
    accessorKey: 'total',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
    cell: ({ row }) => (
      <span className="text-sm font-medium tabular-nums text-foreground">
        {formatCurrency(row.original.total)}
      </span>
    ),
    size: 120,
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
    cell: ({ row }) => <StatusBadge status={row.original.status} type="order" />,
    size: 110,
  },
  {
    accessorKey: 'created_at',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{formatDate(row.original.created_at)}</span>
    ),
    size: 155,
  },
  {
    id: 'actions',
    cell: ({ row }) => (
      <OrderStatusSelect orderId={row.original.id} currentStatus={row.original.status} />
    ),
    size: 130,
  },
]
