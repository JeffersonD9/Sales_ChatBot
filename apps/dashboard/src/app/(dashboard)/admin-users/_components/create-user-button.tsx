'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { UserPlus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

const schema = z.object({
  username: z
    .string()
    .min(3, 'MÃ­nimo 3 caracteres')
    .max(64)
    .regex(/^[a-z0-9_-]+$/, 'Solo minÃºsculas, nÃºmeros, _ y -'),
  email: z.string().email('Email invÃ¡lido'),
  password: z.string().min(8, 'MÃ­nimo 8 caracteres').max(128),
  role: z.enum(['superadmin', 'admin', 'viewer']),
})

type FormData = z.infer<typeof schema>

const INPUT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

export function CreateUserButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'admin' },
  })

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  async function onSubmit(data: FormData) {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error((json as { error?: string }).error ?? 'Error al crear usuario')
        return
      }
      toast.success('Usuario creado')
      reset()
      setOpen(false)
      router.refresh()
    } catch {
      toast.error('Error de conexiÃ³n')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <UserPlus className="h-4 w-4" />
        Nuevo usuario
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cerrar modal"
            className="absolute inset-0 bg-black/50"
            disabled={isSubmitting}
            onClick={() => !isSubmitting && setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Nuevo usuario admin</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
                className="rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Field label="Usuario" error={errors.username?.message}>
                <input
                  {...register('username')}
                  autoComplete="off"
                  placeholder="maria_admin"
                  className={INPUT}
                />
              </Field>

              <Field label="Email" error={errors.email?.message}>
                <input
                  {...register('email')}
                  type="email"
                  placeholder="maria@jestsolution.tech"
                  className={INPUT}
                />
              </Field>

              <Field label="ContraseÃ±a" error={errors.password?.message}>
                <input
                  {...register('password')}
                  type="password"
                  placeholder="MÃ­nimo 8 caracteres"
                  className={INPUT}
                />
              </Field>

              <Field label="Rol" error={errors.role?.message}>
                <select {...register('role')} className={INPUT}>
                  <option value="viewer">Viewer â€” solo lectura</option>
                  <option value="admin">Admin â€” gestiÃ³n de tenants y Ã³rdenes</option>
                  <option value="superadmin">Superadmin â€” acceso total</option>
                </select>
              </Field>

              <div className="flex justify-end gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isSubmitting}
                  className="h-9 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {isSubmitting ? 'Creandoâ€¦' : 'Crear usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

function Field({
  label,
  children,
  error,
}: {
  label: string
  children: React.ReactNode
  error?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-foreground">{label}</div>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
