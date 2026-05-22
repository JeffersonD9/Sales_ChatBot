'use client'

import { formatDate } from '@/lib/utils'
import type { PlanRow } from '@/queries/plans'
import type { ColumnDef } from '@tanstack/react-table'
import { PlanRowActions } from './_components/plan-row-actions'

export const columns: ColumnDef<PlanRow>[] = [
  {
    accessorKey: 'name',
    header: 'Plan',
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-foreground">{row.original.name}</p>
        <p className="font-mono text-xs text-muted-foreground">{row.original.code}</p>
      </div>
    ),
  },
  {
    accessorKey: 'monthly_price',
    header: 'Precio mensual',
    cell: ({ row }) => (
      <span className="text-sm text-foreground">
        {new Intl.NumberFormat('es-CO', {
          style: 'currency',
          currency: row.original.currency,
          maximumFractionDigits: 0,
        }).format(row.original.monthly_price)}
      </span>
    ),
    size: 150,
  },
  {
    accessorKey: 'tier',
    header: 'Tier',
    cell: ({ row }) => <span className="text-sm capitalize">{row.original.tier}</span>,
    size: 110,
  },
  {
    accessorKey: 'ai_enabled',
    header: 'IA',
    cell: ({ row }) => (
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
          row.original.ai_enabled
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        {row.original.ai_enabled ? 'Activa' : 'Sin IA'}
      </span>
    ),
    size: 90,
  },
  {
    accessorKey: 'daily_message_limit',
    header: 'Mensajes/día',
    cell: ({ row }) => row.original.daily_message_limit.toLocaleString('es-CO'),
    size: 120,
  },
  {
    accessorKey: 'default_allocation_strategy',
    header: 'Asignación',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.default_allocation_strategy}
      </span>
    ),
    size: 145,
  },
  {
    accessorKey: 'updated_at',
    header: 'Actualizado',
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{formatDate(row.original.updated_at)}</span>
    ),
    size: 155,
  },
  {
    id: 'actions',
    cell: ({ row }) => <PlanRowActions plan={row.original} />,
    size: 100,
  },
]
