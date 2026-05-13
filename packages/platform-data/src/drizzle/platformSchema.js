'use strict';

const {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  date,
  primaryKey,
} = require('drizzle-orm/pg-core');

const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 64 }).unique().notNull(),
  name: varchar('name', { length: 256 }).notNull().unique('tenants_name_unique'),
  status: varchar('status', { length: 32 }).notNull().default('active'),

  wa_token_encrypted: text('wa_token_encrypted'),
  phone_number_id: varchar('phone_number_id', { length: 64 }).unique('tenants_phone_number_id_unique'),
  verify_token: varchar('verify_token', { length: 128 }).unique('tenants_verify_token_unique'),

  owner_phone: varchar('owner_phone', { length: 32 }).notNull().unique('tenants_owner_phone_unique'),
  owner_email: varchar('owner_email', { length: 256 }).unique('tenants_owner_email_unique'),

  bot_config: jsonb('bot_config').notNull().default({}),
  db_shard: varchar('db_shard', { length: 50 }).notNull().default('shard-01'),

  plan: varchar('plan', { length: 50 }).notNull().default('basic'),
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
});

const dbClusters = pgTable('db_clusters', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 80 }).unique().notNull(),
  tier: varchar('tier', { length: 32 }).notNull().default('low'),
  allocation_strategy: varchar('allocation_strategy', { length: 32 }).notNull().default('shared'),
  database_url_encrypted: text('database_url_encrypted'),
  max_tenants: integer('max_tenants').notNull().default(100),
  is_active: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').notNull().default({}),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const tenantDbAllocations = pgTable('tenant_db_allocations', {
  tenant_id: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  cluster_id: uuid('cluster_id').references(() => dbClusters.id, { onDelete: 'restrict' }),
  allocation_strategy: varchar('allocation_strategy', { length: 32 }).notNull().default('shared-low'),
  database_name: varchar('database_name', { length: 128 }),
  schema_name: varchar('schema_name', { length: 128 }).notNull().default('public'),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  metadata: jsonb('metadata').notNull().default({}),
  migrated_at: timestamp('migrated_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const plans = pgTable('plans', {
  code: varchar('code', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  tier: varchar('tier', { length: 32 }).notNull().default('basic'),
  ai_enabled: boolean('ai_enabled').notNull().default(false),
  daily_message_limit: integer('daily_message_limit').notNull().default(500),
  daily_ai_reply_limit: integer('daily_ai_reply_limit').notNull().default(0),
  daily_ai_token_limit: integer('daily_ai_token_limit').notNull().default(0),
  default_allocation_strategy: varchar('default_allocation_strategy', { length: 32 }).notNull().default('shared-low'),
  metadata: jsonb('metadata').notNull().default({}),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const tenantEntitlements = pgTable('tenant_entitlements', {
  tenant_id: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  plan_code: varchar('plan_code', { length: 50 }).notNull().default('basic'),
  ai_enabled: boolean('ai_enabled').notNull().default(false),
  daily_message_limit: integer('daily_message_limit').notNull().default(500),
  daily_ai_reply_limit: integer('daily_ai_reply_limit').notNull().default(0),
  daily_ai_token_limit: integer('daily_ai_token_limit').notNull().default(0),
  overage_enabled: boolean('overage_enabled').notNull().default(false),
  metadata: jsonb('metadata').notNull().default({}),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const tenantUsageDaily = pgTable('tenant_usage_daily', {
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  usage_date: date('usage_date').notNull(),
  inbound_messages: integer('inbound_messages').notNull().default(0),
  outbound_messages: integer('outbound_messages').notNull().default(0),
  ai_replies: integer('ai_replies').notNull().default(0),
  ai_input_tokens: integer('ai_input_tokens').notNull().default(0),
  ai_output_tokens: integer('ai_output_tokens').notNull().default(0),
  billable_overage_amount: integer('billable_overage_amount').notNull().default(0),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenant_id, t.usage_date] }),
}));

module.exports = {
  tenants,
  dbClusters,
  tenantDbAllocations,
  plans,
  tenantEntitlements,
  tenantUsageDaily,
};
