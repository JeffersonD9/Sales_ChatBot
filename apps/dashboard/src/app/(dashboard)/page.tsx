import { StatusBadge } from '@/components/shared/status-badge'
import { formatCurrency, formatRelativeTime } from '@/lib/utils'
import { getDashboardStats, getRecentOrders } from '@/queries/dashboard'
import { Building2, MessageSquare, ShoppingCart, TrendingUp } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const [stats, recentOrders] = await Promise.all([getDashboardStats(), getRecentOrders(8)])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Resumen general de la plataforma</p>
      </div>

      {/* Main stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Building2 className="h-4 w-4" />}
          label="Tenants"
          value={stats.tenants.total}
          sub={`${stats.tenants.active} activos · ${stats.tenants.trial} trial`}
          danger={
            stats.tenants.suspended > 0
              ? `${stats.tenants.suspended} suspendido${stats.tenants.suspended > 1 ? 's' : ''}`
              : undefined
          }
        />
        <StatCard
          icon={<ShoppingCart className="h-4 w-4" />}
          label="Órdenes (7 días)"
          value={stats.orders.last_7d}
          sub={`${stats.orders.last_30d} este mes`}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Ingresos acumulados"
          value={formatCurrency(stats.orders.total_revenue_cents)}
          sub="órdenes entregadas"
        />
        <StatCard
          icon={<MessageSquare className="h-4 w-4" />}
          label="Sesiones activas"
          value={stats.sessions.active_last_hour}
          sub={`${stats.sessions.created_last_24h} nuevas en 24 h`}
        />
      </div>

      {/* Recent orders */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">Órdenes recientes</h2>
          <Link href="/orders" className="text-xs text-primary hover:underline">
            Ver todas →
          </Link>
        </div>

        <div className="divide-y divide-border">
          {recentOrders.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Sin órdenes aún</p>
          ) : (
            recentOrders.map((order) => (
              <div key={order.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {order.customer_name ?? order.customer_phone}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <Link href={`/tenants/${order.tenant_slug}`} className="hover:underline">
                      {order.tenant_name}
                    </Link>
                    {' · '}
                    {formatRelativeTime(order.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={order.status} type="order" />
                  <span className="min-w-[80px] text-right text-sm font-medium tabular-nums text-foreground">
                    {formatCurrency(order.total)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  sub,
  danger,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  sub?: string
  danger?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-3 text-3xl font-semibold text-foreground">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      {danger && <p className="mt-1 text-xs text-destructive">{danger}</p>}
    </div>
  )
}
