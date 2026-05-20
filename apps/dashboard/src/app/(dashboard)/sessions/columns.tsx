'use client'

import { DataTableColumnHeader } from '@/components/data-table/column-header'
import { CopyButton } from '@/components/shared/copy-button'
import { formatRelativeTime } from '@/lib/utils'
import type { SessionRow } from '@/queries/sessions'
import type { ColumnDef } from '@tanstack/react-table'
import Link from 'next/link'

export const columns: ColumnDef<SessionRow>[] = [
  {
    accessorKey: 'wa_from',
    header: 'Teléfono',
    cell: ({ row }) => {
      const { wa_from, customer_name } = row.original
      return (
        <div className="flex items-center gap-1.5">
          <div>
            <span className="font-mono text-sm text-foreground">{wa_from}</span>
            {customer_name && <p className="text-xs text-muted-foreground">{customer_name}</p>}
          </div>
          <CopyButton value={wa_from} />
        </div>
      )
    },
  },
  {
    accessorKey: 'tenant_name',
    header: 'Tenant',
    cell: ({ row }) => (
      <Link
        href={`/tenants/${row.original.tenant_slug}`}
        className="text-sm text-primary hover:underline"
      >
        {row.original.tenant_name}
      </Link>
    ),
  },
  {
    accessorKey: 'step',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Paso" />,
    cell: ({ row }) => (
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.original.step}</code>
    ),
    size: 140,
  },
  {
    accessorKey: 'last_activity',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Última actividad" />,
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {formatRelativeTime(row.original.last_activity)}
      </span>
    ),
    size: 150,
  },
  {
    accessorKey: 'created_at',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Inicio" />,
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {formatRelativeTime(row.original.created_at)}
      </span>
    ),
    size: 110,
  },
]
