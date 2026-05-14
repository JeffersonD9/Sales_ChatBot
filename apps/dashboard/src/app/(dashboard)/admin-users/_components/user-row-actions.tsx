'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import type { AdminUserRow } from '@/queries/admin-users'

export function UserRowActions({ user }: { user: AdminUserRow }) {
  const router = useRouter()
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)

  const action    = user.is_active ? 'desactivar' : 'activar'
  const nextState = !user.is_active

  async function handleConfirm() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ is_active: nextState }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? 'Error')
      }
      toast.success(nextState ? `"${user.username}" activado` : `"${user.username}" desactivado`)
      router.refresh()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al actualizar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`h-7 rounded-md px-2.5 text-xs font-medium transition-colors ${
          user.is_active
            ? 'border border-destructive/30 text-destructive hover:bg-destructive/10'
            : 'border border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'
        }`}
      >
        {user.is_active ? 'Desactivar' : 'Activar'}
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`${action.charAt(0).toUpperCase() + action.slice(1)} usuario`}
        description={`¿${action.charAt(0).toUpperCase() + action.slice(1)} a "${user.username}"?`}
        confirmLabel={action.charAt(0).toUpperCase() + action.slice(1)}
        variant={user.is_active ? 'destructive' : 'default'}
        loading={loading}
        onConfirm={handleConfirm}
      />
    </>
  )
}
