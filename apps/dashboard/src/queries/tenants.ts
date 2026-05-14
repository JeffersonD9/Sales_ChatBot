import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { db, tenantDb } from '@/db'
import { orders, products, sessions, tenants } from '@/db/schema'

// ── Tipos públicos de esta query ──────────────────────────────────────────────

export type TenantRow = {
  id: string
  slug: string
  name: string
  status: string
  plan: string
  subscription_status: string
  billing_amount: number
  owner_phone: string
  owner_email: string | null
  meta_live: boolean
  created_at: Date
}

export type TenantDetail = TenantRow & {
  verify_token: string | null
  phone_number_id: string | null
  wa_token_encrypted: string | null
  bot_config: Record<string, unknown>
  db_shard: string
  trial_ends_at: string | null
  next_billing_date: string | null
  grace_period_days: number
  last_payment_at: Date | null
  meta_connected_at: Date | null
  updated_at: Date
}

export type TenantStats = {
  activeProducts: number
  totalSessions:  number
  totalOrders:    number
  revenue:        number
}

export type TenantListParams = {
  page:     number
  pageSize: number
  sort:     string
  dir:      'asc' | 'desc'
  query:    string
}

// ── Columnas de lista (sin campos sensibles) ──────────────────────────────────

const LIST_COLUMNS = {
  id:                  tenants.id,
  slug:                tenants.slug,
  name:                tenants.name,
  status:              tenants.status,
  plan:                tenants.plan,
  subscription_status: tenants.subscription_status,
  billing_amount:      tenants.billing_amount,
  owner_phone:         tenants.owner_phone,
  owner_email:         tenants.owner_email,
  meta_live:           tenants.meta_live,
  created_at:          tenants.created_at,
} as const

function buildOrderBy(sort: string, dir: 'asc' | 'desc') {
  const fn = dir === 'desc' ? desc : asc
  switch (sort) {
    case 'name':                return fn(tenants.name)
    case 'status':              return fn(tenants.status)
    case 'plan':                return fn(tenants.plan)
    case 'subscription_status': return fn(tenants.subscription_status)
    default:                    return fn(tenants.created_at)
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getTenantList(
  params: TenantListParams,
): Promise<{ data: TenantRow[]; total: number }> {
  const { page, pageSize, sort, dir, query } = params

  const where = query
    ? or(
        ilike(tenants.name, `%${query}%`),
        ilike(tenants.slug, `%${query}%`),
        ilike(tenants.owner_phone, `%${query}%`),
      )
    : undefined

  const [rows, [{ total }]] = await Promise.all([
    db
      .select(LIST_COLUMNS)
      .from(tenants)
      .where(where)
      .orderBy(buildOrderBy(sort, dir))
      .limit(pageSize)
      .offset((page - 1) * pageSize),

    db.select({ total: count() }).from(tenants).where(where),
  ])

  return { data: rows, total: Number(total) }
}

export async function getTenantBySlug(slug: string): Promise<TenantDetail | undefined> {
  const row = await db.query.tenants.findFirst({
    where: eq(tenants.slug, slug),
  })
  if (!row) return undefined

  return {
    id:                  row.id,
    slug:                row.slug,
    name:                row.name,
    status:              row.status,
    plan:                row.plan,
    subscription_status: row.subscription_status,
    billing_amount:      row.billing_amount,
    owner_phone:         row.owner_phone,
    owner_email:         row.owner_email,
    meta_live:           row.meta_live,
    created_at:          row.created_at,
    verify_token:        row.verify_token,
    phone_number_id:     row.phone_number_id,
    wa_token_encrypted:  row.wa_token_encrypted,
    bot_config:          row.bot_config as Record<string, unknown>,
    db_shard:            row.db_shard,
    trial_ends_at:       row.trial_ends_at,
    next_billing_date:   row.next_billing_date,
    grace_period_days:   row.grace_period_days,
    last_payment_at:     row.last_payment_at,
    meta_connected_at:   row.meta_connected_at,
    updated_at:          row.updated_at,
  }
}

export async function getTenantStats(tenantId: string): Promise<TenantStats> {
  const [productRes, sessionRes, orderRes, revenueRes] = await Promise.all([
    tenantDb
      .select({ c: count() })
      .from(products)
      .where(and(eq(products.tenant_id, tenantId), eq(products.active, true))),

    tenantDb
      .select({ c: count() })
      .from(sessions)
      .where(eq(sessions.tenant_id, tenantId)),

    tenantDb
      .select({ c: count() })
      .from(orders)
      .where(eq(orders.tenant_id, tenantId)),

    tenantDb
      .select({ total: sql<string>`coalesce(sum(${orders.total}), 0)` })
      .from(orders)
      .where(and(eq(orders.tenant_id, tenantId), eq(orders.status, 'delivered'))),
  ])

  return {
    activeProducts: Number(productRes[0]?.c ?? 0),
    totalSessions:  Number(sessionRes[0]?.c ?? 0),
    totalOrders:    Number(orderRes[0]?.c ?? 0),
    revenue:        Number(revenueRes[0]?.total ?? 0),
  }
}

export type CreateTenantData = {
  name:        string
  slug:        string
  owner_phone: string
  owner_email?: string
  plan:        string
}

export async function createTenant(data: CreateTenantData) {
  const [tenant] = await db.insert(tenants).values(data).returning()
  return tenant
}

export type UpdateTenantData = Partial<{
  name:            string
  owner_phone:     string
  owner_email:     string | null
  plan:            string
  billing_amount:  number
  verify_token:    string | null
  phone_number_id: string | null
}>

export async function updateTenant(slug: string, data: UpdateTenantData) {
  const [updated] = await db
    .update(tenants)
    .set({ ...data, updated_at: new Date() })
    .where(eq(tenants.slug, slug))
    .returning()
  return updated
}

export async function updateTenantStatus(slug: string, status: string) {
  const [updated] = await db
    .update(tenants)
    .set({ status, updated_at: new Date() })
    .where(eq(tenants.slug, slug))
    .returning({
      id:     tenants.id,
      slug:   tenants.slug,
      status: tenants.status,
    })
  return updated
}

export async function markTenantMetaLive(slug: string) {
  const [updated] = await db
    .update(tenants)
    .set({ meta_live: true, meta_connected_at: new Date(), updated_at: new Date() })
    .where(eq(tenants.slug, slug))
    .returning({ id: tenants.id, slug: tenants.slug, meta_live: tenants.meta_live })
  return updated
}
