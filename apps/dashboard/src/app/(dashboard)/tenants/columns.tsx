'use client'

import { DataTableColumnHeader } from '@/components/data-table/column-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { formatDate } from '@/lib/utils'
import type { TenantRow } from '@/queries/tenants'
import type { ColumnDef } from '@tanstack/react-table'
import { TenantRowActions } from './_components/tenant-row-actions'

export const columns: ColumnDef<TenantRow>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="font-medium text-foreground truncate">{row.original.name}</p>
        <p className="text-xs text-muted-foreground font-mono">{row.original.slug}</p>
      </div>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Estado',
    cell: ({ row }) => <StatusBadge status={row.original.status} type="tenant" />,
    size: 110,
  },
  {
    accessorKey: 'subscription_status',
    header: 'Suscripción',
    cell: ({ row }) => (
      <StatusBadge status={row.original.subscription_status} type="subscription" />
    ),
    size: 120,
  },
  {
    accessorKey: 'plan',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Plan" />,
    cell: ({ row }) => (
      <span className="capitalize text-sm text-foreground">{row.original.plan}</span>
    ),
    size: 100,
  },
  {
    accessorKey: 'owner_phone',
    header: 'Teléfono',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">{row.original.owner_phone}</span>
    ),
    size: 150,
  },
  {
    accessorKey: 'meta_live',
    header: 'Meta',
    cell: ({ row }) =>
      row.original.meta_live ? (
        <span className="text-xs font-medium text-emerald-500">✓ Live</span>
      ) : (
        <span className="text-xs text-muted-foreground">— Demo</span>
      ),
    size: 80,
  },
  {
    accessorKey: 'created_at',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Creado" />,
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{formatDate(row.original.created_at)}</span>
    ),
    size: 150,
  },
  {
    id: 'actions',
    cell: ({ row }) => <TenantRowActions tenant={row.original} />,
    size: 60,
  },
]
