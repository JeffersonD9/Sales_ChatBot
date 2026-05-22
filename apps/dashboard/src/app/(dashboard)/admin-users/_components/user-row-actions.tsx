'use client'

import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import type { AdminUserRow } from '@/queries/admin-users'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

export function UserRowActions({ user }: { user: AdminUserRow }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const action = user.is_active ? 'desactivar' : 'activar'
  const nextState = !user.is_active

  if (user.role === 'superadmin') {
    return <span className="text-xs text-muted-foreground">Protegido</span>
  }

  async function handleConfirm() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: nextState }),
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

  async function handleRoleChange(role: 'admin' | 'viewer') {
    if (role === user.role) return
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? 'Error')
      }
      toast.success(`Permisos de "${user.username}" actualizados`)
      router.refresh()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al actualizar permisos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <select
          value={user.role}
          disabled={loading}
          aria-label={`Permisos de ${user.username}`}
          onChange={(event) => handleRoleChange(event.target.value as 'admin' | 'viewer')}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:opacity-50"
        >
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
        </select>

        <button
          type="button"
          disabled={loading}
          onClick={() => setOpen(true)}
          className={`h-7 rounded-md px-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            user.is_active
              ? 'border border-destructive/30 text-destructive hover:bg-destructive/10'
              : 'border border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'
          }`}
        >
          {user.is_active ? 'Desactivar' : 'Activar'}
        </button>
      </div>

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
