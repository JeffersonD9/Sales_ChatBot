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
  primaryKey,
  customType,
} = require('drizzle-orm/pg-core');

const bytea = customType({
  dataType() { return 'bytea'; },
});

const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  name: varchar('name', { length: 256 }).notNull(),
  description: text('description').notNull().default(''),
  price: integer('price').notNull(),
  sizes: text('sizes').array().notNull().default([]),
  image_url: text('image_url').notNull().default(''),
  emoji: varchar('emoji', { length: 8 }).notNull().default(''),
  category: varchar('category', { length: 128 }).notNull().default(''),
  active: boolean('active').notNull().default(true),
  attributes: jsonb('attributes').notNull().default({}),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

const sessions = pgTable('sessions', {
  tenant_id: uuid('tenant_id').notNull(),
  wa_from: varchar('wa_from', { length: 32 }).notNull(),
  step: varchar('step', { length: 64 }).notNull().default('NEW'),
  data: jsonb('data').notNull().default({}),
  shown_products: jsonb('shown_products').notNull().default([]),
  last_activity: timestamp('last_activity', { withTimezone: true }).notNull().defaultNow(),
  reactivation_sent: boolean('reactivation_sent').notNull().default(false),
  abandoned_notified_at: timestamp('abandoned_notified_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenant_id, t.wa_from] }),
}));

const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  customer_phone: varchar('customer_phone', { length: 32 }).notNull(),
  customer_name: varchar('customer_name', { length: 256 }),
  customer_address: text('customer_address'),
  items: jsonb('items').notNull().default([]),
  payment_method: varchar('payment_method', { length: 64 }),
  total: integer('total').notNull().default(0),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

const tenantWhatsappConfig = pgTable('tenant_whatsapp_config', {
  tenant_id: uuid('tenant_id').primaryKey(),
  session_data: bytea('session_data'),
  bot_config: jsonb('bot_config').notNull().default({}),
  webhook_secret: bytea('webhook_secret'),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

module.exports = {
  products,
  sessions,
  orders,
  tenantWhatsappConfig,
};
