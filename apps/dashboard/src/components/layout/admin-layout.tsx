'use client'

import { useSidebar } from '@/hooks/use-sidebar'
import type { SessionUser } from '@/types/api'
import { Providers } from './providers'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'

interface AdminLayoutProps {
  user: SessionUser
  children: React.ReactNode
}

export function AdminLayout({ user, children }: AdminLayoutProps) {
  const { collapsed, toggle } = useSidebar()

  return (
    <Providers>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar collapsed={collapsed} onToggle={toggle} user={user} />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar user={user} />
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </Providers>
  )
}
