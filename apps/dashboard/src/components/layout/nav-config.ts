import type { LucideIcon } from 'lucide-react'
import { Building2, LayoutDashboard, MessageSquare, ShoppingCart, Users } from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/',            label: 'Dashboard',     icon: LayoutDashboard, exact: true },
  { href: '/tenants',     label: 'Tenants',       icon: Building2 },
  { href: '/orders',      label: 'Órdenes',       icon: ShoppingCart },
  { href: '/sessions',    label: 'Sesiones',      icon: MessageSquare },
  { href: '/admin-users', label: 'Usuarios Admin',icon: Users },
]
