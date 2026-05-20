import { DataTable, TableSkeleton } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/shared/page-header'
import { getOrderList } from '@/queries/orders'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { columns } from './columns'

export const metadata: Metadata = { title: 'Órdenes' }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default function OrdersPage({ searchParams }: Props) {
  return (
    <div className="space-y-5">
      <PageHeader title="Órdenes" description="Historial de órdenes de todos los tenants" />
      <Suspense fallback={<TableSkeleton />}>
        <OrdersTable searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function OrdersTable({ searchParams }: { searchParams: Props['searchParams'] }) {
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page ?? 1))
  const size = Math.min(50, Math.max(10, Number(sp.size ?? 20)))
  const q = typeof sp.q === 'string' ? sp.q : undefined
  const status = typeof sp.status === 'string' ? sp.status : undefined
  const tenant = typeof sp.tenant === 'string' ? sp.tenant : undefined
  const sort = typeof sp.sort === 'string' ? sp.sort : 'created_at'
  const dir = sp.dir === 'asc' ? 'asc' : 'desc'

  const { rows, total } = await getOrderList({ page, pageSize: size, q, status, tenant, sort, dir })

  return (
    <DataTable
      data={rows}
      columns={columns}
      totalCount={total}
      defaultPageSize={size}
      searchPlaceholder="Buscar por cliente, teléfono o tenant…"
    />
  )
}
