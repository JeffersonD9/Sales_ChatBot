import { db, tenantDb } from '@/db'
import { messages, sessions, tenants } from '@/db/schema'
import { and, asc, count, desc, eq, ilike, inArray, sql } from 'drizzle-orm'

export type SessionRow = {
  tenant_id: string
  wa_from: string
  tenant_name: string
  tenant_slug: string
  step: string
  customer_name: string | null
  last_activity: Date
  created_at: Date
}

export type SessionListParams = {
  page: number
  pageSize: number
  q?: string
  tenant?: string
  sort?: string
  dir?: 'asc' | 'desc'
}

function buildOrderBy(sort: string, dir: 'asc' | 'desc') {
  const fn = dir === 'desc' ? desc : asc
  switch (sort) {
    case 'step':
      return fn(sessions.step)
    case 'created_at':
      return fn(sessions.created_at)
    default:
      return fn(sessions.last_activity)
  }
}

export async function getSessionList(params: SessionListParams) {
  const { page, pageSize, q, tenant: tenantSlug, sort = 'last_activity', dir = 'desc' } = params

  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)

  const tenantMap = new Map(allTenants.map((t) => [t.id, t]))

  let allowedTenantIds: string[] | undefined

  if (tenantSlug) {
    allowedTenantIds = allTenants.filter((t) => t.slug === tenantSlug).map((t) => t.id)
    if (allowedTenantIds.length === 0) return { rows: [], total: 0 }
  }

  const conditions = []

  if (allowedTenantIds) conditions.push(inArray(sessions.tenant_id, allowedTenantIds))
  if (q) conditions.push(ilike(sessions.wa_from, `%${q}%`))

  const where = conditions.length ? and(...conditions) : undefined

  const [rows, [{ total }]] = await Promise.all([
    tenantDb
      .select({
        tenant_id: sessions.tenant_id,
        wa_from: sessions.wa_from,
        step: sessions.step,
        customer_name: sql<string | null>`${sessions.data}->>'name'`,
        last_activity: sessions.last_activity,
        created_at: sessions.created_at,
      })
      .from(sessions)
      .where(where)
      .orderBy(buildOrderBy(sort, dir))
      .limit(pageSize)
      .offset((page - 1) * pageSize),

    tenantDb.select({ total: count() }).from(sessions).where(where),
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

export type ConversationMessage = {
  id: string
  direction: string
  type: string
  body: string
  created_at: Date
}

export type ConversationDetail = {
  tenant_id: string
  wa_from: string
  tenant_name: string
  tenant_slug: string
  step: string
  customer_name: string | null
  last_activity: Date
  created_at: Date
  messages: ConversationMessage[]
}

export async function getConversation(
  tenantSlug: string,
  waFrom: string,
): Promise<ConversationDetail | undefined> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, tenantSlug),
    columns: { id: true, name: true, slug: true },
  })
  if (!tenant) return undefined

  const session = await tenantDb.query.sessions.findFirst({
    where: and(eq(sessions.tenant_id, tenant.id), eq(sessions.wa_from, waFrom)),
  })
  if (!session) return undefined

  const msgs = await tenantDb
    .select({
      id: messages.id,
      direction: messages.direction,
      type: messages.type,
      body: messages.body,
      created_at: messages.created_at,
    })
    .from(messages)
    .where(and(eq(messages.tenant_id, tenant.id), eq(messages.wa_from, waFrom)))
    .orderBy(asc(messages.created_at))
    .limit(200)

  return {
    tenant_id: tenant.id,
    wa_from: waFrom,
    tenant_name: tenant.name,
    tenant_slug: tenant.slug,
    step: session.step,
    customer_name: (session.data as { name?: string })?.name ?? null,
    last_activity: session.last_activity,
    created_at: session.created_at,
    messages: msgs,
  }
}
