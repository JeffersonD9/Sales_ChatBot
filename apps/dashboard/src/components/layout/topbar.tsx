'use client'

import { useTheme } from '@/hooks/use-theme'
import { cn } from '@/lib/utils'
import type { SessionUser } from '@/types/api'
import { LogOut, Moon, Sun, User } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'

const ROUTE_LABELS: Record<string, string> = {
  tenants: 'Tenants',
  orders: 'Órdenes',
  sessions: 'Sesiones',
  'admin-users': 'Usuarios Admin',
  'db-console': 'Consola DB',
}

function Breadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length === 0) {
    return <span className="text-sm font-medium text-foreground">Dashboard</span>
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      {segments.map((seg, i) => {
        const label =
          ROUTE_LABELS[seg] ?? seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        const isLast = i === segments.length - 1
        return (
          <span key={seg} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground/50">/</span>}
            <span className={cn(isLast ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {label}
            </span>
          </span>
        )
      })}
    </nav>
  )
}

export function Topbar({ user }: { user: SessionUser }) {
  const router = useRouter()
  const { theme, toggle } = useTheme()

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      router.push('/login')
      router.refresh()
    } catch {
      toast.error('Error al cerrar sesión')
    }
  }

  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-border bg-background px-6">
      <Breadcrumbs />

      <div className="flex items-center gap-3">
        {/* User pill */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
            <User className="h-3.5 w-3.5" />
          </div>
          <span className="hidden text-sm font-medium text-foreground md:block">
            {user.username}
          </span>
        </div>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggle}
          title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          title="Cerrar sesión"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
