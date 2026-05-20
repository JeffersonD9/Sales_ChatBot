import { env } from '@/env'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const poolConfig = {
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
}

// Platform DB: tenants, panel_users, panel_sessions, panel_rate_limits, plans
const platformPool = new Pool({ connectionString: env.DATABASE_URL, ...poolConfig })

// Tenant shared DB: products, sessions, orders, messages, tenant_whatsapp_config
const tenantPool = new Pool({ connectionString: env.TENANT_DATABASE_URL, ...poolConfig })

export const db = drizzle(platformPool, { schema })
export const tenantDb = drizzle(tenantPool, { schema })
export type DB = typeof db
