'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { formatDate } from '@/lib/utils'
import type { AdminUserRow } from '@/queries/admin-users'
import { UserRowActions } from './_components/user-row-actions'

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Superadmin',
  admin:      'Admin',
  viewer:     'Viewer',
}

const ROLE_CLASSES: Record<string, string> = {
  superadmin: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  admin:      'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  viewer:     'bg-muted text-muted-foreground',
}

export const columns: ColumnDef<AdminUserRow>[] = [
  {
    accessorKey: 'username',
    header: 'Usuario',
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-foreground">{row.original.username}</p>
        <p className="text-xs text-muted-foreground">{row.original.email}</p>
      </div>
    ),
  },
  {
    accessorKey: 'role',
    header: 'Rol',
    cell: ({ row }) => (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
          ROLE_CLASSES[row.original.role] ?? 'bg-muted text-muted-foreground'
        }`}
      >
        {ROLE_LABELS[row.original.role] ?? row.original.role}
      </span>
    ),
    size: 120,
  },
  {
    accessorKey: 'is_active',
    header: 'Estado',
    cell: ({ row }) =>
      row.original.is_active ? (
        <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          Activo
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          Inactivo
        </span>
      ),
    size: 90,
  },
  {
    accessorKey: 'created_at',
    header: 'Creado',
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{formatDate(row.original.created_at)}</span>
    ),
    size: 155,
  },
  {
    id: 'actions',
    cell: ({ row }) => <UserRowActions user={row.original} />,
    size: 100,
  },
]
