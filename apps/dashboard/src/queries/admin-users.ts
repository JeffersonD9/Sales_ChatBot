import { db } from '@/db'
import { panelUsers } from '@/db/schema'
import { hashPassword } from '@/lib/password'
import { and, count, desc, eq, ilike, ne, or } from 'drizzle-orm'

export type AdminUserRow = {
  id: string
  username: string
  email: string
  role: string
  is_active: boolean
  created_at: Date
}

export type AdminUserListParams = {
  page: number
  pageSize: number
  q?: string
}

export async function getAdminUserList(params: AdminUserListParams) {
  const { page, pageSize, q } = params

  const where = q
    ? or(ilike(panelUsers.username, `%${q}%`), ilike(panelUsers.email, `%${q}%`))
    : undefined

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: panelUsers.id,
        username: panelUsers.username,
        email: panelUsers.email,
        role: panelUsers.role,
        is_active: panelUsers.is_active,
        created_at: panelUsers.created_at,
      })
      .from(panelUsers)
      .where(where)
      .orderBy(desc(panelUsers.created_at))
      .limit(pageSize)
      .offset((page - 1) * pageSize),

    db.select({ total: count() }).from(panelUsers).where(where),
  ])

  return { rows, total: Number(total) }
}

export type CreateAdminUserData = {
  username: string
  email: string
  password: string
  role: string
}

export async function createAdminUser(data: CreateAdminUserData) {
  const password_hash = await hashPassword(data.password)
  const [user] = await db
    .insert(panelUsers)
    .values({
      username: data.username,
      email: data.email,
      password_hash,
      role: data.role,
    })
    .returning({
      id: panelUsers.id,
      username: panelUsers.username,
      email: panelUsers.email,
      role: panelUsers.role,
    })
  return user
}

export async function toggleAdminUserActive(id: string, is_active: boolean) {
  const [updated] = await db
    .update(panelUsers)
    .set({ is_active, updated_at: new Date() })
    .where(and(eq(panelUsers.id, id), ne(panelUsers.role, 'superadmin')))
    .returning({ id: panelUsers.id, role: panelUsers.role, is_active: panelUsers.is_active })
  return updated ?? null
}

export async function updateAdminUserRole(id: string, role: 'admin' | 'viewer') {
  const [updated] = await db
    .update(panelUsers)
    .set({ role, updated_at: new Date() })
    .where(and(eq(panelUsers.id, id), ne(panelUsers.role, 'superadmin')))
    .returning({ id: panelUsers.id, role: panelUsers.role, is_active: panelUsers.is_active })
  return updated ?? null
}
