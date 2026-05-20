import { AdminLayout } from '@/components/layout/admin-layout'
import { validateSession } from '@/lib/auth'
import { redirect } from 'next/navigation'

// Server Component: valida sesión en DB, luego pasa user al AdminLayout (Client).
// El middleware ya hizo el check rápido de cookie — aquí hacemos la validación real.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await validateSession()
  if (!user) redirect('/login')

  return <AdminLayout user={user}>{children}</AdminLayout>
}
