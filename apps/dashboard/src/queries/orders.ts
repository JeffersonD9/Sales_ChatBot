import { db, tenantDb } from '@/db'
import { orders, tenants } from '@/db/schema'
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'

export type OrderRow = {
  id: string
  tenant_id: string
  tenant_name: string
  tenant_slug: string
  customer_phone: string
  customer_name: string | null
  total: number
  status: string
  items_count: number
  created_at: Date
}

export type OrderListParams = {
  page: number
  pageSize: number
  q?: string
  status?: string
  tenant?: string // slug
  sort?: string
  dir?: 'asc' | 'desc'
}

function buildOrderBy(sort: string, dir: 'asc' | 'desc') {
  const fn = dir === 'desc' ? desc : asc
  switch (sort) {
    case 'total':
      return fn(orders.total)
    case 'status':
      return fn(orders.status)
    default:
      return fn(orders.created_at)
  }
}

export async function getOrderList(params: OrderListParams) {
  const {
    page,
    pageSize,
    q,
    status,
    tenant: tenantSlug,
    sort = 'created_at',
    dir = 'desc',
  } = params

  // Fetch all tenants from platform DB for enrichment + filtering
  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)

  const tenantMap = new Map(allTenants.map((t) => [t.id, t]))

  // Build tenant-level filters
  let allowedTenantIds: string[] | undefined

  if (tenantSlug) {
    allowedTenantIds = allTenants.filter((t) => t.slug === tenantSlug).map((t) => t.id)
  }

  if (q) {
    const nameMatches = allTenants
      .filter((t) => t.name.toLowerCase().includes(q.toLowerCase()))
      .map((t) => t.id)

    // If filtering by tenant slug too, intersect; otherwise union with customer search
    if (allowedTenantIds) {
      allowedTenantIds = allowedTenantIds.filter((id) => nameMatches.includes(id))
    } else {
      allowedTenantIds = nameMatches.length > 0 ? nameMatches : undefined
    }
  }

  // Build order-level conditions on the tenant DB
  const conditions = []

  if (allowedTenantIds !== undefined) {
    if (allowedTenantIds.length === 0) return { rows: [], total: 0 }
    conditions.push(inArray(orders.tenant_id, allowedTenantIds))
  }

  if (q) {
    conditions.push(
      or(
        ilike(orders.customer_phone, `%${q}%`),
        ilike(orders.customer_name, `%${q}%`),
        allowedTenantIds?.length ? inArray(orders.tenant_id, allowedTenantIds) : sql`false`,
      ),
    )
  }

  if (status) conditions.push(eq(orders.status, status))

  const where = conditions.length ? and(...conditions) : undefined

  const [rows, [{ total }]] = await Promise.all([
    tenantDb
      .select({
        id: orders.id,
        tenant_id: orders.tenant_id,
        customer_phone: orders.customer_phone,
        customer_name: orders.customer_name,
        total: orders.total,
        status: orders.status,
        items_count: sql<number>`jsonb_array_length(${orders.items})`,
        created_at: orders.created_at,
      })
      .from(orders)
      .where(where)
      .orderBy(buildOrderBy(sort, dir))
      .limit(pageSize)
      .offset((page - 1) * pageSize),

    tenantDb.select({ total: count() }).from(orders).where(where),
  ])

  return {
    rows: rows.map((r) => ({
      ...r,
      tenant_name: tenantMap.get(r.tenant_id)?.name ?? '—',
      tenant_slug: tenantMap.get(r.tenant_id)?.slug ?? '',
    })),
    total: Number(total),
  }
}

export async function updateOrderStatus(id: string, status: string) {
  const [updated] = await tenantDb
    .update(orders)
    .set({ status })
    .where(eq(orders.id, id))
    .returning({ id: orders.id, status: orders.status })
  return updated ?? null
}
