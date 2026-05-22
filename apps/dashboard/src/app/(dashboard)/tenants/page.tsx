import { DataTable, TableSkeleton } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/shared/page-header'
import { getPlanList } from '@/queries/plans'
import { getTenantList } from '@/queries/tenants'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { CreateTenantButton } from './_components/create-tenant-button'
import { columns } from './columns'

export const metadata: Metadata = { title: 'Tenants' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function TenantsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams

  const params = {
    page: Math.max(1, Number(sp.page ?? 1)),
    pageSize: Number(sp.size ?? 20),
    sort: String(sp.sort ?? 'created_at'),
    dir: String(sp.dir ?? 'desc') as 'asc' | 'desc',
    query: String(sp.q ?? ''),
  }

  const [{ data, total }, { rows: planOptions }] = await Promise.all([
    getTenantList(params),
    getPlanList({ page: 1, pageSize: 100 }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenants"
        description={`${total} cliente${total !== 1 ? 's' : ''} en total`}
        action={<CreateTenantButton planOptions={planOptions} />}
      />

      <Suspense fallback={<TableSkeleton rows={params.pageSize} cols={columns.length} />}>
        <DataTable
          data={data}
          columns={columns}
          totalCount={total}
          defaultPageSize={params.pageSize}
          searchPlaceholder="Buscar por nombre, slug o teléfono…"
        />
      </Suspense>
    </div>
  )
}
