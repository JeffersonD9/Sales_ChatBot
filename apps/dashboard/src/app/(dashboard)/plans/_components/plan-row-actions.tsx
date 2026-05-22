'use client'

import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import type { PlanRow } from '@/queries/plans'
import { Pencil, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { PlanDialog } from './plan-dialog'

export function PlanRowActions({ plan }: { plan: PlanRow }) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/plans/${plan.code}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Error al borrar')
      toast.success(`Plan "${plan.name}" eliminado`)
      router.refresh()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al borrar el plan')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="flex justify-end gap-1">
        <button
          type="button"
          title="Editar plan"
          onClick={() => setEditOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Eliminar plan"
          onClick={() => setDeleteOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <PlanDialog plan={plan} open={editOpen} onOpenChange={setEditOpen} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminar plan"
        description={`¿Eliminar "${plan.name}"? Los planes usados por tenants quedan protegidos.`}
        confirmLabel="Eliminar"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </>
  )
}
