import { DataTable, TableSkeleton } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/shared/page-header'
import { validateSession } from '@/lib/auth'
import { getAdminUserList } from '@/queries/admin-users'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { CreateUserButton } from './_components/create-user-button'
import { columns } from './columns'

export const metadata: Metadata = { title: 'Usuarios Admin' }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AdminUsersPage({ searchParams }: Props) {
  const user = await validateSession()
  const isSuperadmin = user?.role === 'superadmin'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Usuarios Admin"
        description="Cuentas con acceso al panel de administración"
        action={isSuperadmin ? <CreateUserButton /> : undefined}
      />
      <Suspense fallback={<TableSkeleton />}>
        <UsersTable searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function UsersTable({ searchParams }: { searchParams: Props['searchParams'] }) {
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page ?? 1))
  const size = Math.min(50, Math.max(10, Number(sp.size ?? 20)))
  const q = typeof sp.q === 'string' ? sp.q : undefined

  const { rows, total } = await getAdminUserList({ page, pageSize: size, q })

  return (
    <DataTable
      data={rows}
      columns={columns}
      totalCount={total}
      defaultPageSize={size}
      searchPlaceholder="Buscar por usuario o email…"
    />
  )
}
