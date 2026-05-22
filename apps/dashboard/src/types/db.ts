import type {
  messages,
  orders,
  panelRateLimits,
  panelSessions,
  panelUsers,
  plans,
  products,
  sessions,
  tenantWhatsappConfig,
  tenants,
} from '@/db/schema'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

// ── Select types (lo que devuelve la DB) ──────────────────────────────────────
export type Tenant = InferSelectModel<typeof tenants>
export type BillingPlan = InferSelectModel<typeof plans>
export type Product = InferSelectModel<typeof products>
export type Session = InferSelectModel<typeof sessions>
export type Order = InferSelectModel<typeof orders>
export type Message = InferSelectModel<typeof messages>
export type PanelUser = InferSelectModel<typeof panelUsers>
export type PanelSession = InferSelectModel<typeof panelSessions>
export type PanelRateLimit = InferSelectModel<typeof panelRateLimits>
export type TenantWhatsappConfig = InferSelectModel<typeof tenantWhatsappConfig>

// ── Insert types (lo que enviás a la DB) ──────────────────────────────────────
export type NewTenant = InferInsertModel<typeof tenants>
export type NewBillingPlan = InferInsertModel<typeof plans>
export type NewProduct = InferInsertModel<typeof products>
export type NewMessage = InferInsertModel<typeof messages>
export type NewPanelUser = InferInsertModel<typeof panelUsers>
export type NewPanelSession = InferInsertModel<typeof panelSessions>

// ── Status literals ──────────────────────────────────────────────────────────
export type TenantStatus = 'active' | 'trial' | 'suspended'
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'canceled'
export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'canceled'
export type MessageDirection = 'inbound' | 'outbound'
export type PanelUserRole = 'superadmin' | 'admin' | 'viewer'
export type Plan = 'starter' | 'pro' | 'enterprise'

// ── Tipos de vistas compuestas (queries con JOIN) ─────────────────────────────
export type TenantWithStats = Tenant & {
  product_count: number
  active_sessions: number
  order_count: number
}

export type SessionWithMessages = Session & {
  messages: Message[]
  tenant: Pick<Tenant, 'id' | 'slug' | 'name'>
}

export type OrderWithTenant = Order & {
  tenant: Pick<Tenant, 'id' | 'slug' | 'name'>
}
