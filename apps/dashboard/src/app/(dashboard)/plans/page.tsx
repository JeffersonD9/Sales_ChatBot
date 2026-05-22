import { DataTable, TableSkeleton } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/shared/page-header'
import { validateSession } from '@/lib/auth'
import { getPlanList } from '@/queries/plans'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PlanDialog } from './_components/plan-dialog'
import { columns } from './columns'

export const metadata: Metadata = { title: 'Planes' }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PlansPage({ searchParams }: Props) {
  const user = await validateSession()
  if (user?.role !== 'superadmin') redirect('/')

  const sp = await searchParams
  const page = Math.max(1, Number(sp.page ?? 1))
  const pageSize = Math.min(50, Math.max(10, Number(sp.size ?? 20)))
  const q = typeof sp.q === 'string' ? sp.q : undefined
  const { rows, total } = await getPlanList({ page, pageSize, q })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planes"
        description="Precios, límites y capacidades disponibles para tenants."
        action={<PlanDialog />}
      />

      <Suspense fallback={<TableSkeleton rows={pageSize} cols={columns.length} />}>
        <DataTable
          data={rows}
          columns={columns}
          totalCount={total}
          defaultPageSize={pageSize}
          searchPlaceholder="Buscar por plan, código o tier..."
        />
      </Suspense>
    </div>
  )
}
