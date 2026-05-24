'use client'

import type { PlanRow } from '@/queries/plans'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

const TIER_OPTIONS = [
  { value: 'basic', label: 'Básico', hint: 'Plan estándar para tenants pequeños' },
  { value: 'premium', label: 'Premium', hint: 'Plan avanzado con IA y límites altos' },
] as const

const ALLOCATION_OPTIONS = [
  {
    value: 'shared-low',
    label: 'Compartida — Low tier',
    hint: 'DB Postgres compartida de bajo costo. Para tenants pequeños (default Básico).',
  },
  {
    value: 'shared-medium',
    label: 'Compartida — Medium tier',
    hint: 'DB compartida con más recursos. Para tenants medianos (default Premium).',
  },
  {
    value: 'dedicated-db',
    label: 'Dedicada',
    hint: 'DB Postgres exclusiva del tenant. Para tenants grandes o requisitos de compliance.',
  },
] as const

type TierValue = (typeof TIER_OPTIONS)[number]['value']
type AllocationValue = (typeof ALLOCATION_OPTIONS)[number]['value']

const tierValues = TIER_OPTIONS.map((o) => o.value) as [TierValue, ...TierValue[]]
const allocationValues = ALLOCATION_OPTIONS.map((o) => o.value) as [
  AllocationValue,
  ...AllocationValue[],
]

const metadataEntrySchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
})

let metadataIdCounter = 0
function nextMetadataId(): string {
  metadataIdCounter += 1
  return `m_${metadataIdCounter}`
}

const schema = z.object({
  code: z.string().min(2, 'Mínimo 2 caracteres').max(50),
  name: z.string().min(2, 'Mínimo 2 caracteres').max(128),
  tier: z.enum(tierValues),
  monthly_price: z.number().int().nonnegative(),
  currency: z.string().min(3).max(8),
  ai_enabled: z.boolean(),
  daily_message_limit: z.number().int().nonnegative(),
  daily_ai_reply_limit: z.number().int().nonnegative(),
  daily_ai_token_limit: z.number().int().nonnegative(),
  default_allocation_strategy: z.enum(allocationValues),
  metadata: z.array(metadataEntrySchema),
})

type FormData = z.infer<typeof schema>

type Props = {
  plan?: PlanRow
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const INPUT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

function metadataToEntries(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return []
  return Object.entries(metadata).map(([key, value]) => ({
    id: nextMetadataId(),
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }))
}

function entriesToMetadata(entries: FormData['metadata']): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const { key, value } of entries) {
    const k = key.trim()
    if (!k) continue
    const v = value.trim()
    if (v === '') {
      out[k] = ''
      continue
    }
    if (v === 'true') out[k] = true
    else if (v === 'false') out[k] = false
    else if (/^-?\d+(\.\d+)?$/.test(v)) out[k] = Number(v)
    else out[k] = v
  }
  return out
}

function planDefaults(plan?: PlanRow): FormData {
  const tier = (plan?.tier as TierValue) ?? 'basic'
  const allocation =
    (plan?.default_allocation_strategy as AllocationValue) ??
    (tier === 'premium' ? 'shared-medium' : 'shared-low')
  return {
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    tier: tierValues.includes(tier) ? tier : 'basic',
    monthly_price: plan?.monthly_price ?? 0,
    currency: plan?.currency ?? 'COP',
    ai_enabled: plan?.ai_enabled ?? false,
    daily_message_limit: plan?.daily_message_limit ?? 500,
    daily_ai_reply_limit: plan?.daily_ai_reply_limit ?? 0,
    daily_ai_token_limit: plan?.daily_ai_token_limit ?? 0,
    default_allocation_strategy: allocationValues.includes(allocation) ? allocation : 'shared-low',
    metadata: metadataToEntries(plan?.metadata),
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

  const watchedName = form.watch('name')
  useEffect(() => {
    if (editing) return
    form.setValue('code', slugify(watchedName), { shouldValidate: true })
  }, [editing, form, watchedName])

  const metadata = form.watch('metadata')
  const tier = form.watch('tier')
  const allocation = form.watch('default_allocation_strategy')

  const tierHint = useMemo(() => TIER_OPTIONS.find((o) => o.value === tier)?.hint, [tier])
  const allocationHint = useMemo(
    () => ALLOCATION_OPTIONS.find((o) => o.value === allocation)?.hint,
    [allocation],
  )

  function addMetadataRow() {
    form.setValue(
      'metadata',
      [...form.getValues('metadata'), { id: nextMetadataId(), key: '', value: '' }],
      { shouldValidate: true },
    )
  }

  function removeMetadataRow(index: number) {
    const next = form.getValues('metadata').filter((_, i) => i !== index)
    form.setValue('metadata', next, { shouldValidate: true })
  }

  async function onSubmit(data: FormData) {
    const metadata = entriesToMetadata(data.metadata)
    const { code, metadata: _omit, ...fields } = data
    const payload = { ...(editing ? fields : { ...fields, code }), metadata }
    const res = await fetch(editing ? `/api/admin/plans/${plan?.code}` : '/api/admin/plans', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Nombre" error={form.formState.errors.name?.message}>
                  <input {...form.register('name')} placeholder="Premium" className={INPUT} />
                </Field>
                <Field
                  label="Código"
                  hint={editing ? 'No editable' : 'Se genera automáticamente desde el nombre'}
                  error={form.formState.errors.code?.message}
                >
                  <input
                    {...form.register('code')}
                    disabled
                    placeholder="premium"
                    className={`${INPUT} opacity-70`}
                  />
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Tier" hint={tierHint} error={form.formState.errors.tier?.message}>
                  <select {...form.register('tier')} className={INPUT}>
                    {TIER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Asignación de base de datos"
                  hint={allocationHint}
                  error={form.formState.errors.default_allocation_strategy?.message}
                >
                  <select {...form.register('default_allocation_strategy')} className={INPUT}>
                    {ALLOCATION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
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

              <div className="space-y-2 rounded-md border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Metadatos adicionales</h3>
                    <p className="text-xs text-muted-foreground">
                      Campos extra opcionales para extender el plan (ej. <code>trial_days</code>,{' '}
                      <code>support_tier</code>). Se guardan como JSON y quedan disponibles para
                      lógica futura. Valores <code>true</code>/<code>false</code> y números se
                      detectan automáticamente.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addMetadataRow}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-input px-2 text-xs font-medium hover:bg-accent"
                  >
                    <Plus className="h-3 w-3" />
                    Añadir campo
                  </button>
                </div>

                {metadata.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    Sin metadatos. Pulsa “Añadir campo” para agregar uno.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {metadata.map((entry, index) => (
                      <div key={entry.id} className="flex items-center gap-2">
                        <input
                          {...form.register(`metadata.${index}.key` as const)}
                          placeholder="clave"
                          className={`${INPUT} flex-1`}
                        />
                        <input
                          {...form.register(`metadata.${index}.value` as const)}
                          placeholder="valor"
                          className={`${INPUT} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => removeMetadataRow(index)}
                          aria-label="Eliminar campo"
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

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
  hint,
}: {
  label: string
  children: React.ReactNode
  error?: string
  hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted-foreground">{hint}</span>}
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </div>
  )
}
