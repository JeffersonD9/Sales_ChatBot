import { cn } from '@/lib/utils'
import type { OrderStatus, SubscriptionStatus, TenantStatus } from '@/types/db'

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const VARIANT_CLASSES: Record<Variant, string> = {
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  danger:  'bg-red-500/15 text-red-600 dark:text-red-400',
  info:    'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  neutral: 'bg-muted text-muted-foreground',
}

const TENANT_MAP: Record<TenantStatus, Variant> = {
  active:    'success',
  trial:     'info',
  suspended: 'danger',
}

const ORDER_MAP: Record<OrderStatus, Variant> = {
  pending:   'warning',
  confirmed: 'info',
  shipped:   'info',
  delivered: 'success',
  canceled:  'danger',
}

const SUB_MAP: Record<SubscriptionStatus, Variant> = {
  trial:    'info',
  active:   'success',
  past_due: 'warning',
  canceled: 'danger',
}

const LABELS: Record<string, string> = {
  active:    'Activo',
  trial:     'Trial',
  suspended: 'Suspendido',
  pending:   'Pendiente',
  confirmed: 'Confirmado',
  shipped:   'Enviado',
  delivered: 'Entregado',
  canceled:  'Cancelado',
  past_due:  'Vencido',
}

interface StatusBadgeProps {
  status: string
  type: 'tenant' | 'order' | 'subscription'
  className?: string
}

function getVariant(status: string, type: StatusBadgeProps['type']): Variant {
  if (type === 'tenant')       return TENANT_MAP[status as TenantStatus] ?? 'neutral'
  if (type === 'order')        return ORDER_MAP[status as OrderStatus] ?? 'neutral'
  if (type === 'subscription') return SUB_MAP[status as SubscriptionStatus] ?? 'neutral'
  return 'neutral'
}

export function StatusBadge({ status, type, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        VARIANT_CLASSES[getVariant(status, type)],
        className,
      )}
    >
      {LABELS[status] ?? status}
    </span>
  )
}
