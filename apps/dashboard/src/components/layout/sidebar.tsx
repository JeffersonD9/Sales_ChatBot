'use client'

import { cn } from '@/lib/utils'
import type { SessionUser } from '@/types/api'
import { ChevronLeft } from 'lucide-react'
import { NAV_ITEMS } from './nav-config'
import { NavItem } from './nav-item'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  user: SessionUser
}

export function Sidebar({ collapsed, onToggle, user }: SidebarProps) {
  return (
    <aside
      className={cn(
        'relative flex flex-shrink-0 flex-col h-screen',
        'bg-sidebar border-r border-sidebar-border',
        'transition-all duration-300 ease-in-out',
        collapsed ? 'w-14' : 'w-56',
      )}
    >
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'flex h-14 flex-shrink-0 items-center border-b border-sidebar-border px-3',
          collapsed ? 'justify-center' : 'gap-2.5',
        )}
      >
        <span className="select-none text-xl">💬</span>
        {!collapsed && (
          <span className="truncate text-sm font-semibold text-sidebar-foreground">
            JestSolution
          </span>
        )}
      </div>

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            exact={item.exact}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* ── Footer: user info + collapse toggle ──────────────────────────── */}
      <div className="flex-shrink-0 space-y-1 border-t border-sidebar-border p-2">
        {!collapsed && (
          <div className="px-2 py-1.5">
            <p className="truncate text-xs font-medium text-sidebar-foreground">{user.username}</p>
            <p className="truncate text-xs text-sidebar-foreground/50">{user.role}</p>
          </div>
        )}

        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          className={cn(
            'flex h-8 w-full items-center rounded-md px-2 text-sidebar-foreground/60',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors',
            collapsed ? 'justify-center' : 'gap-2',
          )}
        >
          <ChevronLeft
            className={cn('h-4 w-4 transition-transform duration-300', collapsed && 'rotate-180')}
          />
          {!collapsed && <span className="text-xs">Colapsar</span>}
        </button>
      </div>
    </aside>
  )
}
