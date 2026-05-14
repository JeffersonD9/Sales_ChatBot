'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItemProps {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
  collapsed: boolean
}

export function NavItem({ href, label, icon: Icon, exact, collapsed }: NavItemProps) {
  const pathname = usePathname()
  const isActive = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center rounded-md px-2 py-2 text-sm font-medium transition-colors',
        collapsed ? 'justify-center' : 'gap-3',
        isActive
          ? 'bg-sidebar-primary/10 text-sidebar-primary'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      )}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  )
}
