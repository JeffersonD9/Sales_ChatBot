'use client'

import type { PlanRow } from '@/queries/plans'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

const schema = z.object({
  code: z.string().min(2, 'Mínimo 2 caracteres').max(50),
  name: z.string().min(2, 'Mínimo 2 caracteres').max(128),
  tier: z.string().min(2).max(32),
  monthly_price: z.number().int().nonnegative(),
  currency: z.string().min(3).max(8),
  ai_enabled: z.boolean(),
  daily_message_limit: z.number().int().nonnegative(),
  daily_ai_reply_limit: z.number().int().nonnegative(),
  daily_ai_token_limit: z.number().int().nonnegative(),
  default_allocation_strategy: z.string().min(2).max(32),
  metadata: z.string(),
})

type FormData = z.infer<typeof schema>

type Props = {
  plan?: PlanRow
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const INPUT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

function planDefaults(plan?: PlanRow): FormData {
  return {
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    tier: plan?.tier ?? 'basic',
    monthly_price: plan?.monthly_price ?? 0,
    currency: plan?.currency ?? 'COP',
    ai_enabled: plan?.ai_enabled ?? false,
    daily_message_limit: plan?.daily_message_limit ?? 500,
    daily_ai_reply_limit: plan?.daily_ai_reply_limit ?? 0,
    daily_ai_token_limit: plan?.daily_ai_token_limit ?? 0,
    default_allocation_strategy: plan?.default_allocation_strategy ?? 'shared-low',
    metadata: JSON.stringify(plan?.metadata ?? {}, null, 2),
  }
}

export function PlanDialog({ plan, open: controlledOpen, onOpenChange }: Props) {
  const router = useRouter()
  const editing = Boolean(plan)
  const [internalOpen, setInternalOpen] = useState(false)
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: planDefaults(plan),
  })
  const open = controlledOpen ?? internalOpen

  const setOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) {
        onOpenChange(next)
      } else {
        setInternalOpen(next)
      }
      if (next) form.reset(planDefaults(plan))
    },
    [form, onOpenChange, plan],
  )

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open, setOpen])

  async function onSubmit(data: FormData) {
    let metadata: Record<string, unknown>
    try {
      const value = JSON.parse(data.metadata || '{}') as unknown
      if (!value || Array.isArray(value) || typeof value !== 'object') {
        throw new Error('Los metadatos deben ser un objeto JSON')
      }
      metadata = value as Record<string, unknown>
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'JSON de metadatos inválido')
      return
    }

    const { code, ...fields } = data
    const res = await fetch(editing ? `/api/admin/plans/${plan?.code}` : '/api/admin/plans', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(editing ? fields : data), metadata }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error((json as { error?: string }).error ?? 'Error al guardar el plan')
      return
    }

    toast.success(editing ? `Plan "${data.name}" actualizado` : `Plan "${data.name}" creado`)
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      {!editing && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Nuevo plan
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cerrar modal"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {editing ? `Editar ${plan?.name}` : 'Nuevo plan'}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Código" error={form.formState.errors.code?.message}>
                  <input
                    {...form.register('code')}
                    disabled={editing}
                    placeholder="premium"
                    className={INPUT}
                  />
                </Field>
                <Field label="Nombre" error={form.formState.errors.name?.message}>
                  <input {...form.register('name')} placeholder="Premium" className={INPUT} />
                </Field>
                <Field label="Tier" error={form.formState.errors.tier?.message}>
                  <input {...form.register('tier')} placeholder="premium" className={INPUT} />
                </Field>
                <Field label="Precio mensual" error={form.formState.errors.monthly_price?.message}>
                  <input
                    {...form.register('monthly_price', { valueAsNumber: true })}
                    type="number"
                    min="0"
                    className={INPUT}
                  />
                </Field>
                <Field label="Moneda" error={form.formState.errors.currency?.message}>
                  <input {...form.register('currency')} placeholder="COP" className={INPUT} />
                </Field>
                <Field
                  label="Asignación"
                  error={form.formState.errors.default_allocation_strategy?.message}
                >
                  <input
                    {...form.register('default_allocation_strategy')}
                    placeholder="shared-medium"
                    className={INPUT}
                  />
                </Field>
                <Field
                  label="Mensajes diarios"
                  error={form.formState.errors.daily_message_limit?.message}
                >
                  <input
                    {...form.register('daily_message_limit', { valueAsNumber: true })}
                    type="number"
                    min="0"
                    className={INPUT}
                  />
                </Field>
                <Field
                  label="Respuestas IA/día"
                  error={form.formState.errors.daily_ai_reply_limit?.message}
                >
                  <input
                    {...form.register('daily_ai_reply_limit', { valueAsNumber: true })}
                    type="number"
                    min="0"
                    className={INPUT}
                  />
                </Field>
                <Field
                  label="Tokens IA/día"
                  error={form.formState.errors.daily_ai_token_limit?.message}
                >
                  <input
                    {...form.register('daily_ai_token_limit', { valueAsNumber: true })}
                    type="number"
                    min="0"
                    className={INPUT}
                  />
                </Field>
              </div>

              <label className="flex items-center gap-2 text-sm font-medium">
                <input {...form.register('ai_enabled')} type="checkbox" className="h-4 w-4" />
                IA habilitada por defecto
              </label>

              <Field label="Metadatos JSON" error={form.formState.errors.metadata?.message}>
                <textarea
                  {...form.register('metadata')}
                  spellCheck={false}
                  rows={5}
                  className={`${INPUT} h-auto py-2 font-mono`}
                />
              </Field>

              <div className="flex justify-end gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-accent"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={form.formState.isSubmitting}
                  className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {form.formState.isSubmitting ? 'Guardando...' : 'Guardar plan'}
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
      <span className="block text-sm font-medium">{label}</span>
      {children}
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </div>
  )
}
