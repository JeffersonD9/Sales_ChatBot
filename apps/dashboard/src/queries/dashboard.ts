import { count, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db, tenantDb } from '@/db'
import { orders, sessions, tenants } from '@/db/schema'
import type { DashboardStats } from '@/types/api'

export async function getDashboardStats(): Promise<DashboardStats> {
  const now    = new Date()
  const last7d  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000)
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const last1h  = new Date(now.getTime() - 60 * 60 * 1000)
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const [tenantCounts, ordersWeek, ordersMonth, revenue, activeSess, newSess] = await Promise.all([
    db.select({
      total:     count(),
      active:    sql<number>`count(*) filter (where ${tenants.status} = 'active')`,
      trial:     sql<number>`count(*) filter (where ${tenants.status} = 'trial')`,
      suspended: sql<number>`count(*) filter (where ${tenants.status} = 'suspended')`,
    }).from(tenants),

    tenantDb.select({ c: count() }).from(orders).where(gte(orders.created_at, last7d)),
    tenantDb.select({ c: count() }).from(orders).where(gte(orders.created_at, last30d)),

    tenantDb
      .select({ total: sql<string>`coalesce(sum(${orders.total}), 0)` })
      .from(orders)
      .where(eq(orders.status, 'delivered')),

    tenantDb.select({ c: count() }).from(sessions).where(gte(sessions.last_activity, last1h)),
    tenantDb.select({ c: count() }).from(sessions).where(gte(sessions.created_at,    last24h)),
  ])

  return {
    tenants: {
      total:     Number(tenantCounts[0].total),
      active:    Number(tenantCounts[0].active),
      trial:     Number(tenantCounts[0].trial),
      suspended: Number(tenantCounts[0].suspended),
    },
    orders: {
      last_7d:             Number(ordersWeek[0].c),
      last_30d:            Number(ordersMonth[0].c),
      total_revenue_cents: Number(revenue[0].total),
    },
    sessions: {
      active_last_hour: Number(activeSess[0].c),
      created_last_24h: Number(newSess[0].c),
    },
  }
}

export type RecentOrder = {
  id:             string
  tenant_name:    string
  tenant_slug:    string
  customer_name:  string | null
  customer_phone: string
  total:          number
  status:         string
  created_at:     Date
}

export async function getRecentOrders(limit = 8): Promise<RecentOrder[]> {
  const recentOrders = await tenantDb
    .select({
      id:             orders.id,
      tenant_id:      orders.tenant_id,
      customer_name:  orders.customer_name,
      customer_phone: orders.customer_phone,
      total:          orders.total,
      status:         orders.status,
      created_at:     orders.created_at,
    })
    .from(orders)
    .orderBy(desc(orders.created_at))
    .limit(limit)

  if (recentOrders.length === 0) return []

  const tenantIds = [...new Set(recentOrders.map(o => o.tenant_id))]
  const tenantRows = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(inArray(tenants.id, tenantIds))

  const tenantMap = new Map(tenantRows.map(t => [t.id, t]))

  return recentOrders.map(o => ({
    id:             o.id,
    tenant_name:    tenantMap.get(o.tenant_id)?.name ?? '—',
    tenant_slug:    tenantMap.get(o.tenant_id)?.slug ?? '',
    customer_name:  o.customer_name,
    customer_phone: o.customer_phone,
    total:          o.total,
    status:         o.status,
    created_at:     o.created_at,
  }))
}
