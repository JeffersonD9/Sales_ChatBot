'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

const STATUSES = [
  { value: 'pending',   label: 'Pendiente'  },
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'shipped',   label: 'Enviado'    },
  { value: 'delivered', label: 'Entregado'  },
  { value: 'canceled',  label: 'Cancelado'  },
]

export function OrderStatusSelect({
  orderId,
  currentStatus,
}: {
  orderId:       string
  currentStatus: string
}) {
  const router  = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const status = e.target.value
    if (status === currentStatus) return
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/status`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? 'Error')
      }
      toast.success('Estado actualizado')
      router.refresh()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al actualizar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <select
      defaultValue={currentStatus}
      onChange={handleChange}
      disabled={loading}
      className="h-7 rounded-md border border-input bg-transparent px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
    >
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value}>{s.label}</option>
      ))}
    </select>
  )
}
