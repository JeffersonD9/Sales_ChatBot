import { getProductsByTenant } from '@/queries/products'
import { getTenantBySlug } from '@/queries/tenants'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TenantDetailClient } from './_components/tenant-detail-client'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const tenant = await getTenantBySlug(slug)
  return { title: tenant ? `${tenant.name} — Detalle` : 'Tenant no encontrado' }
}

export default async function TenantDetailPage({ params }: Props) {
  const { slug } = await params
  const tenant = await getTenantBySlug(slug)
  if (!tenant) notFound()

  const products = await getProductsByTenant(tenant.id)

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/tenants"
          className="flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Tenants
        </Link>
        <span>/</span>
        <span className="font-medium text-foreground">{tenant.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">{tenant.name}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{tenant.slug}</code>
            <StatusBadge status={tenant.status} />
            <PlanBadge plan={tenant.plan} />
          </div>
        </div>
      </div>

      <TenantDetailClient tenant={tenant} products={products} />
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'text-emerald-600 bg-emerald-500/10',
    suspended: 'text-destructive bg-destructive/10',
    trial: 'text-amber-600 bg-amber-500/10',
  }
  const labels: Record<string, string> = {
    active: 'Activo',
    suspended: 'Suspendido',
    trial: 'Trial',
  }
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${map[status] ?? 'bg-muted text-muted-foreground'}`}
    >
      {labels[status] ?? status}
    </span>
  )
}

function PlanBadge({ plan }: { plan: string }) {
  const map: Record<string, string> = {
    starter: 'bg-muted text-muted-foreground',
    pro: 'bg-primary/10 text-primary',
    enterprise: 'bg-amber-500/10 text-amber-600',
  }
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${map[plan] ?? 'bg-muted text-muted-foreground'}`}
    >
      {plan}
    </span>
  )
}
