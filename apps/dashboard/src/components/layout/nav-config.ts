import type { LucideIcon } from 'lucide-react'
import {
  Building2,
  CreditCard,
  Database,
  LayoutDashboard,
  MessageSquare,
  ShoppingCart,
  Users,
} from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
  roles?: string[]
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/tenants', label: 'Tenants', icon: Building2 },
  { href: '/orders', label: 'Órdenes', icon: ShoppingCart },
  { href: '/sessions', label: 'Sesiones', icon: MessageSquare },
  { href: '/plans', label: 'Planes', icon: CreditCard, roles: ['superadmin'] },
  { href: '/admin-users', label: 'Usuarios Admin', icon: Users, roles: ['superadmin'] },
  { href: '/db-console', label: 'Consola DB', icon: Database, roles: ['superadmin'] },
]
