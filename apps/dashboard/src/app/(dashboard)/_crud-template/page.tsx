/**
 * PLANTILLA DE PÁGINA CRUD
 * ─────────────────────────────────────────────────────────────────────────────
 * Copia esta carpeta y renombrala (ej: tenants/, orders/).
 * Reemplazá los tipos, queries y columnas con los del recurso real.
 *
 * Patrón:
 *  page.tsx         → Server Component: lee searchParams → query DB → pasa data
 *  columns.tsx      → define ColumnDef para el DataTable
 *  _components/     → modales, formularios, acciones específicas de esta vista
 *
 * El DataTable usa estado en URL (page, size, sort, dir, q).
 * Mutaciones (crear, editar, eliminar) usan TanStack Query → invalidan el cache
 * → Next.js re-renderiza el Server Component con datos frescos via router.refresh().
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable, TableSkeleton } from '@/components/data-table/data-table'
import { type ColumnDef } from '@/components/data-table/types'
import { DataTableColumnHeader } from '@/components/data-table/column-header'

export const metadata: Metadata = { title: 'Recurso' }

// ── Tipos ──────────────────────────────────────────────────────────────────────
// En cada vista real, importar desde @/types/db
type ResourceRow = {
  id: string
  name: string
  status: string
  created_at: Date
}

// ── Query (en la vista real, mover a @/queries/resource.ts) ────────────────────
async function getResources(_params: {
  page: number
  pageSize: number
  sort: string
  dir: string
  query: string
}): Promise<{ data: ResourceRow[]; total: number }> {
  // Ejemplo de cómo se vería la query real:
  //
  // const { data, total } = await db.transaction(async (tx) => {
  //   const where = params.query
  //     ? ilike(resources.name, `%${params.query}%`)
  //     : undefined
  //
  //   const [items, [{ count }]] = await Promise.all([
  //     tx.select().from(resources)
  //       .where(where)
  //       .orderBy(...)
  //       .limit(params.pageSize)
  //       .offset((params.page - 1) * params.pageSize),
  //     tx.select({ count: count() }).from(resources).where(where),
  //   ])
  //
  //   return { data: items, total: Number(count) }
  // })
  //
  // return { data, total }

  return { data: [], total: 0 }
}

// ── Columnas ───────────────────────────────────────────────────────────────────
// En la vista real, mover a columns.tsx junto a la page
const columns: ColumnDef<ResourceRow>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
    cell: ({ row }) => (
      <span className="font-medium text-foreground">{row.original.name}</span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Estado',
    cell: ({ row }) => <span>{row.original.status}</span>,
    size: 120,
  },
  {
    accessorKey: 'created_at',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Creado" />,
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {row.original.created_at.toLocaleDateString('es-CO')}
      </span>
    ),
    size: 140,
  },
  {
    id: 'actions',
    cell: () => (
      // En la vista real: botón de editar, menú de acciones, etc.
      <div className="flex items-center gap-2" />
    ),
    size: 80,
  },
]

// ── Page (Server Component) ────────────────────────────────────────────────────
// Next.js 15: searchParams es una Promise en Server Components
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function ResourcePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams

  const page     = Math.max(1, Number(sp.page ?? 1))
  const pageSize = Number(sp.size ?? 20)
  const sort     = String(sp.sort ?? 'created_at')
  const dir      = String(sp.dir ?? 'desc')
  const query    = String(sp.q ?? '')

  const { data, total } = await getResources({ page, pageSize, sort, dir, query })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recurso"
        description="Descripción del recurso que se administra aquí."
        action={
          // En la vista real: <NuevoRecursoButton />
          <button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            Nuevo
          </button>
        }
      />

      {/* Suspense requerido porque DataTable usa useSearchParams internamente */}
      <Suspense fallback={<TableSkeleton rows={pageSize} cols={columns.length} />}>
        <DataTable
          data={data}
          columns={columns}
          totalCount={total}
          defaultPageSize={pageSize}
          searchPlaceholder="Buscar por nombre…"
        />
      </Suspense>
    </div>
  )
}
