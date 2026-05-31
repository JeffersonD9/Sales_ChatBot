'use client'

import { isValidPhoneE164, normalizePhoneE164, slugify } from '@/lib/utils'
import type { PlanRow } from '@/queries/plans'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

const schema = z.object({
  name: z
    .string()
    .min(2, 'Mínimo 2 caracteres')
    .max(256)
    .refine((v) => slugify(v).length >= 2 && slugify(v).length <= 60, {
      message: 'Nombre genera un slug inválido (usá letras, números y espacios)',
    }),
  owner_phone: z
    .string()
    .min(7, 'Mínimo 7 dígitos')
    .max(32)
    .refine((v) => isValidPhoneE164(v), {
      message: 'Formato internacional E.164 (ej. +573001234567)',
    }),
  owner_email: z.union([z.string().email('Email inválido'), z.literal('')]).optional(),
  plan: z.string().regex(/^[a-z0-9_-]+$/, 'Selecciona un plan válido'),
})

type FormData = z.infer<typeof schema>

export function CreateTenantButton({
  planOptions,
}: { planOptions: Pick<PlanRow, 'code' | 'name'>[] }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { plan: planOptions[0]?.code ?? 'basic' },
  })

  const name = watch('name')
  const previewSlug = name ? slugify(name).slice(0, 60) : ''
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Chequea disponibilidad del slug con debounce 400ms. Usa GET /api/admin/tenants/<slug>
  // que devuelve 404 si no existe y 200 si existe — no necesitamos endpoint nuevo.
  useEffect(() => {
    if (!previewSlug || previewSlug.length < 2) {
      setSlugStatus('idle')
      return
    }
    setSlugStatus('checking')
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/tenants/${encodeURIComponent(previewSlug)}`, {
          signal: ctrl.signal,
        })
        if (ctrl.signal.aborted) return
        setSlugStatus(res.status === 404 ? 'available' : res.ok ? 'taken' : 'idle')
      } catch {
        // Network/abort → no mostramos error de validación.
        if (!ctrl.signal.aborted) setSlugStatus('idle')
      }
    }, 400)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [previewSlug])

  async function onSubmit(data: FormData) {
    const phoneNorm = normalizePhoneE164(data.owner_phone)
    if (!phoneNorm) {
      toast.error('Teléfono inválido')
      return
    }
    if (slugStatus === 'taken') {
      toast.error(`El slug "${previewSlug}" ya está en uso. Cambiá el nombre.`)
      return
    }
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          owner_phone: phoneNorm,
          owner_email: data.owner_email || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Error al crear el tenant')
        return
      }
      toast.success(`Tenant "${data.name}" creado correctamente`)
      setOpen(false)
      reset()
      router.refresh()
    } catch {
      toast.error('Error de conexión')
    }
  }

  function handleClose() {
    setOpen(false)
    reset()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
        Nuevo tenant
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cerrar modal"
            className="absolute inset-0 bg-black/50"
            onClick={handleClose}
          />

          <div className="relative z-10 w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl">
            {/* Header */}
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Nuevo tenant</h2>
              <button
                type="button"
                onClick={handleClose}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Field label="Nombre del negocio *" error={errors.name?.message}>
                <input {...register('name')} placeholder="Tienda de Ropa ABC" className={INPUT} />
                {previewSlug && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Slug: <span className="font-mono">{previewSlug}</span>{' '}
                    {slugStatus === 'checking' && (
                      <span className="text-muted-foreground">verificando…</span>
                    )}
                    {slugStatus === 'available' && (
                      <span className="text-emerald-600">disponible ✓</span>
                    )}
                    {slugStatus === 'taken' && (
                      <span className="text-destructive">ya existe ✗</span>
                    )}
                  </p>
                )}
              </Field>

              <Field label="Teléfono del dueño *" error={errors.owner_phone?.message}>
                <input {...register('owner_phone')} placeholder="+573001234567" className={INPUT} />
              </Field>

              <Field label="Email del dueño" error={errors.owner_email?.message}>
                <input
                  {...register('owner_email')}
                  type="email"
                  placeholder="dueño@ejemplo.com"
                  className={INPUT}
                />
              </Field>

              <Field label="Plan" error={errors.plan?.message}>
                <select {...register('plan')} className={INPUT}>
                  {planOptions.map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.name}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="h-9 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {isSubmitting ? 'Creando…' : 'Crear tenant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

const INPUT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

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
      <div className="text-sm font-medium leading-none text-foreground">{label}</div>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
