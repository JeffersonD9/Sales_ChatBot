import { relations } from 'drizzle-orm'
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// bytea para columnas encriptadas con pgcrypto (wa_token, webhook_secret)
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

// ── Shapes de columnas JSONB ───────────────────────────────────────────────────

export type ProductFilters = {
  max_products?: number
  in_stock_only?: boolean
  sizes?: string[]
  min_price?: number
  max_price?: number
  featured_ids?: string[]
}

export type BotPersona = {
  name?: string
  tone?: 'casual' | 'friendly' | 'professional'
  objections?: string
  tips?: string[]
  forbidden_topics?: string[]
  product_filters?: ProductFilters
}

export type BotConfig = {
  persona?: BotPersona
  verify_token_changes?: number
  [key: string]: unknown
}

export type OrderItem = {
  product_id: string
  name: string
  price: number
  quantity: number
  size?: string
}

export type SessionData = {
  name?: string
  address?: string
  payment?: string
  [key: string]: unknown
}

// ── tenants ───────────────────────────────────────────────────────────────────
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 64 }).unique().notNull(),
  name: varchar('name', { length: 256 }).notNull().unique('tenants_name_unique'),
  status: varchar('status', { length: 32 }).notNull().default('active'),

  wa_token_encrypted: text('wa_token_encrypted'),
  phone_number_id: varchar('phone_number_id', { length: 64 }).unique(
    'tenants_phone_number_id_unique',
  ),
  verify_token: varchar('verify_token', { length: 128 }).unique('tenants_verify_token_unique'),

  owner_phone: varchar('owner_phone', { length: 32 })
    .notNull()
    .unique('tenants_owner_phone_unique'),
  owner_email: varchar('owner_email', { length: 256 }).unique('tenants_owner_email_unique'),

  bot_config: jsonb('bot_config').notNull().$type<BotConfig>().default({}),

  db_shard: varchar('db_shard', { length: 50 }).notNull().default('shard-01'),

  plan: varchar('plan', { length: 50 }).notNull().default('starter'),
  billing_amount: integer('billing_amount').notNull().default(0),
  subscription_status: varchar('subscription_status', { length: 32 }).notNull().default('trial'),
  billing_cycle_start: date('billing_cycle_start'),
  next_billing_date: date('next_billing_date'),
  grace_period_days: integer('grace_period_days').notNull().default(3),
  last_payment_at: timestamp('last_payment_at', { withTimezone: true }),
  trial_ends_at: date('trial_ends_at'),

  meta_live: boolean('meta_live').notNull().default(false),
  meta_connected_at: timestamp('meta_connected_at', { withTimezone: true }),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── products ──────────────────────────────────────────────────────────────────
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 256 }).notNull(),
  description: text('description').notNull().default(''),
  price: integer('price').notNull(),
  sizes: text('sizes').array().notNull().default([]),
  image_url: text('image_url').notNull().default(''),
  emoji: varchar('emoji', { length: 8 }).notNull().default('🛍️'),
  category: varchar('category', { length: 128 }).notNull().default(''),
  active: boolean('active').notNull().default(true),
  attributes: jsonb('attributes').notNull().$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── sessions ──────────────────────────────────────────────────────────────────
export const sessions = pgTable(
  'sessions',
  {
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    wa_from: varchar('wa_from', { length: 32 }).notNull(),
    step: varchar('step', { length: 64 }).notNull().default('NEW'),
    data: jsonb('data').notNull().$type<SessionData>().default({}),
    shown_products: jsonb('shown_products').notNull().$type<string[]>().default([]),
    last_activity: timestamp('last_activity', { withTimezone: true }).notNull().defaultNow(),
    reactivation_sent: boolean('reactivation_sent').notNull().default(false),
    abandoned_notified_at: timestamp('abandoned_notified_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenant_id, t.wa_from] }),
  }),
)

// ── orders ────────────────────────────────────────────────────────────────────
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  customer_phone: varchar('customer_phone', { length: 32 }).notNull(),
  customer_name: varchar('customer_name', { length: 256 }),
  customer_address: text('customer_address'),
  items: jsonb('items').notNull().$type<OrderItem[]>().default([]),
  payment_method: varchar('payment_method', { length: 64 }),
  total: integer('total').notNull().default(0),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── tenant_whatsapp_config ────────────────────────────────────────────────────
export const tenantWhatsappConfig = pgTable('tenant_whatsapp_config', {
  tenant_id: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  session_data: bytea('session_data'),
  bot_config: jsonb('bot_config').notNull().$type<BotConfig>().default({}),
  webhook_secret: bytea('webhook_secret'),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── messages ──────────────────────────────────────────────────────────────────
// Tabla nueva — el bot la crea como migración (migration_008 o similar).
// El panel solo lee. Ver scripts/setup-db-permissions.sql.
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    wa_from: varchar('wa_from', { length: 32 }).notNull(),
    direction: varchar('direction', { length: 8 }).notNull(), // 'inbound' | 'outbound'
    type: varchar('type', { length: 32 }).notNull().default('text'),
    body: text('body').notNull().default(''),
    wa_message_id: varchar('wa_message_id', { length: 256 }),
    metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idx_tenant_wa: index('messages_tenant_wa_idx').on(t.tenant_id, t.wa_from),
    idx_created: index('messages_created_at_idx').on(t.created_at),
  }),
)

// ── panel_users ───────────────────────────────────────────────────────────────
export const panelUsers = pgTable('panel_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 64 }).unique().notNull(),
  email: varchar('email', { length: 256 }).unique().notNull(),
  password_hash: text('password_hash').notNull(),
  role: varchar('role', { length: 32 }).notNull(),
  tenant_id: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── panel_sessions ────────────────────────────────────────────────────────────
export const panelSessions = pgTable('panel_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id')
    .notNull()
    .references(() => panelUsers.id, { onDelete: 'cascade' }),
  token_hash: text('token_hash').unique().notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  is_active: boolean('is_active').notNull().default(true),
  ip_address: varchar('ip_address', { length: 45 }),
  user_agent: text('user_agent'),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  revoke_reason: varchar('revoke_reason', { length: 64 }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── panel_rate_limits ─────────────────────────────────────────────────────────
export const panelRateLimits = pgTable('panel_rate_limits', {
  key: varchar('key', { length: 256 }).primaryKey(),
  count: integer('count').notNull().default(0),
  first_attempt_at: timestamp('first_attempt_at', { withTimezone: true }),
  blocked_until: timestamp('blocked_until', { withTimezone: true }),
})

// ── Relations ─────────────────────────────────────────────────────────────────

export const tenantsRelations = relations(tenants, ({ many, one }) => ({
  products: many(products),
  sessions: many(sessions),
  orders: many(orders),
  messages: many(messages),
  whatsappConfig: one(tenantWhatsappConfig, {
    fields: [tenants.id],
    references: [tenantWhatsappConfig.tenant_id],
  }),
  panelUsers: many(panelUsers),
}))

export const productsRelations = relations(products, ({ one }) => ({
  tenant: one(tenants, {
    fields: [products.tenant_id],
    references: [tenants.id],
  }),
}))

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [sessions.tenant_id],
    references: [tenants.id],
  }),
  messages: many(messages, { relationName: 'session_messages' }),
}))

export const ordersRelations = relations(orders, ({ one }) => ({
  tenant: one(tenants, {
    fields: [orders.tenant_id],
    references: [tenants.id],
  }),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  tenant: one(tenants, {
    fields: [messages.tenant_id],
    references: [tenants.id],
  }),
  session: one(sessions, {
    relationName: 'session_messages',
    fields: [messages.tenant_id, messages.wa_from],
    references: [sessions.tenant_id, sessions.wa_from],
  }),
}))

export const panelUsersRelations = relations(panelUsers, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [panelUsers.tenant_id],
    references: [tenants.id],
  }),
  sessions: many(panelSessions),
}))

export const panelSessionsRelations = relations(panelSessions, ({ one }) => ({
  user: one(panelUsers, {
    fields: [panelSessions.user_id],
    references: [panelUsers.id],
  }),
}))
