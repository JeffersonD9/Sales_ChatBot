import { db } from '@/db'
import { plans, tenants } from '@/db/schema'
import { asc, count, eq, ilike, or } from 'drizzle-orm'

const PLAN_CODES_TTL_MS = 60_000
let cachedCodes: { value: string[]; expiresAt: number } | null = null

/**
 * Lista de códigos de plan válidos. Cache en memoria 60s para no martillar la DB
 * en cada POST/PATCH de tenant. Bust manual con invalidatePlanCodes().
 */
export async function getActivePlanCodes(): Promise<string[]> {
  if (cachedCodes && Date.now() < cachedCodes.expiresAt) return cachedCodes.value
  const rows = await db.select({ code: plans.code }).from(plans)
  const value = rows.map((r) => r.code)
  cachedCodes = { value, expiresAt: Date.now() + PLAN_CODES_TTL_MS }
  return value
}

export function invalidatePlanCodes() {
  cachedCodes = null
}

export type PlanRow = typeof plans.$inferSelect

export type PlanListParams = {
  page: number
  pageSize: number
  q?: string
}

export type PlanData = {
  code: string
  name: string
  tier: string
  monthly_price: number
  currency: string
  ai_enabled: boolean
  daily_message_limit: number
  daily_ai_reply_limit: number
  daily_ai_token_limit: number
  default_allocation_strategy: string
  metadata: Record<string, unknown>
}

export async function getPlanList({ page, pageSize, q }: PlanListParams) {
  const where = q
    ? or(ilike(plans.code, `%${q}%`), ilike(plans.name, `%${q}%`), ilike(plans.tier, `%${q}%`))
    : undefined

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(plans)
      .where(where)
      .orderBy(asc(plans.tier), asc(plans.monthly_price), asc(plans.code))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(plans).where(where),
  ])

  return { rows, total: Number(total) }
}

export async function createPlan(data: PlanData) {
  const [plan] = await db.insert(plans).values(data).returning()
  return plan
}

export async function updatePlan(code: string, data: Omit<PlanData, 'code'>) {
  const [plan] = await db
    .update(plans)
    .set({ ...data, updated_at: new Date() })
    .where(eq(plans.code, code))
    .returning()
  return plan ?? null
}

export async function deletePlan(code: string) {
  const [{ total }] = await db
    .select({ total: count() })
    .from(tenants)
    .where(eq(tenants.plan, code))
  if (Number(total) > 0) return 'in_use' as const

  const [deleted] = await db
    .delete(plans)
    .where(eq(plans.code, code))
    .returning({ code: plans.code })
  return deleted ?? null
}
