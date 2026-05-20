import { DataTable, TableSkeleton } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/shared/page-header'
import { getSessionList } from '@/queries/sessions'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { columns } from './columns'

export const metadata: Metadata = { title: 'Sesiones' }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default function SessionsPage({ searchParams }: Props) {
  return (
    <div className="space-y-5">
      <PageHeader title="Sesiones" description="Conversaciones activas e históricas del bot" />
      <Suspense fallback={<TableSkeleton />}>
        <SessionsTable searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function SessionsTable({ searchParams }: { searchParams: Props['searchParams'] }) {
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page ?? 1))
  const size = Math.min(50, Math.max(10, Number(sp.size ?? 20)))
  const q = typeof sp.q === 'string' ? sp.q : undefined
  const tenant = typeof sp.tenant === 'string' ? sp.tenant : undefined
  const sort = typeof sp.sort === 'string' ? sp.sort : 'last_activity'
  const dir = sp.dir === 'asc' ? 'asc' : 'desc'

  const { rows, total } = await getSessionList({ page, pageSize: size, q, tenant, sort, dir })

  return (
    <DataTable
      data={rows}
      columns={columns}
      totalCount={total}
      defaultPageSize={size}
      searchPlaceholder="Buscar por teléfono…"
    />
  )
}
