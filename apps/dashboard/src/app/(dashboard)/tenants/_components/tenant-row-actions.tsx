'use client'

import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import type { TenantRow } from '@/queries/tenants'
import { Ban, CheckCircle, Eye, MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export function TenantRowActions({ tenant }: { tenant: TenantRow }) {
  const router = useRouter()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const isSuspended = tenant.status === 'suspended'
  const targetStatus = isSuspended ? 'active' : 'suspended'

  function openMenu() {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setMenuOpen(true)
  }

  // Cierra al hacer scroll (el menú fixed quedaría desincronizado)
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [menuOpen])

  async function handleStatusChange() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.slug}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Error')
      }
      toast.success(isSuspended ? `"${tenant.name}" activado` : `"${tenant.name}" suspendido`)
      router.refresh()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al cambiar estado')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <button
          type="button"
          ref={buttonRef}
          onClick={openMenu}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        {menuOpen && (
          <>
            {/* Backdrop — cierra al clickear fuera */}
            <button
              type="button"
              aria-label="Cerrar menú"
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
            />

            {/* Dropdown fixed para escapar overflow:hidden de la tabla */}
            <div
              className="fixed z-50 w-44 rounded-md border border-border bg-background py-1 shadow-lg"
              style={{ top: menuPos.top, right: menuPos.right }}
            >
              <Link
                href={`/tenants/${tenant.slug}`}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <Eye className="h-3.5 w-3.5" />
                Gestionar
              </Link>

              <div className="my-1 h-px bg-border" />

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  setConfirmOpen(true)
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                  isSuspended
                    ? 'text-emerald-600 hover:bg-emerald-500/10'
                    : 'text-destructive hover:bg-destructive/10'
                }`}
              >
                {isSuspended ? (
                  <CheckCircle className="h-3.5 w-3.5" />
                ) : (
                  <Ban className="h-3.5 w-3.5" />
                )}
                {isSuspended ? 'Activar' : 'Suspender'}
              </button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={isSuspended ? 'Activar tenant' : 'Suspender tenant'}
        description={
          isSuspended
            ? `¿Activar "${tenant.name}"? El bot volverá a responder mensajes.`
            : `¿Suspender "${tenant.name}"? El bot dejará de responder mensajes de inmediato.`
        }
        confirmLabel={isSuspended ? 'Activar' : 'Suspender'}
        variant={isSuspended ? 'default' : 'destructive'}
        loading={loading}
        onConfirm={handleStatusChange}
      />
    </>
  )
}
