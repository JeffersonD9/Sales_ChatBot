'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

// Flows disponibles — mirror exacto del FLOWS_REGISTRY en message-worker/core/flows/index.js
const FLOWS = [
  {
    value: 'sales_v1',
    label: 'Sales v1 — Catálogo retail',
    description:
      'Flujo de catálogo con filtros por talla y presupuesto, gestión de pedidos y objeción de precios. Soporta análisis de imágenes con IA.',
    ai: true,
    default: true,
  },
  {
    value: 'mayoristas',
    label: 'Mayoristas — Venta al por mayor',
    description:
      'Flujo orientado a pedidos por volumen. Sin filtros de catálogo; el cliente maneja referencias propias. IA disponible en plan premium.',
    ai: false,
    default: false,
  },
  {
    value: 'hollywood_store',
    label: 'Hollywood Store — Tienda con imágenes',
    description:
      'Flujo con navegación por catálogo de imágenes (fotos de tallas y catálogo). Requiere configuración de storage_base_url. Soporta análisis de imágenes.',
    ai: true,
    default: false,
  },
] as const

type FlowValue = (typeof FLOWS)[number]['value']

const TALLAS = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const

const schema = z.object({
  flow_type: z.enum(['sales_v1', 'mayoristas', 'hollywood_store']),
  business_name: z.string().max(128).optional(),
  city: z.string().max(64).optional(),
  schedule: z.string().max(256).optional(),
  whatsapp_provider: z.enum(['meta', '360dialog']),
  ai_enabled: z.boolean(),
  image_analysis_enabled: z.boolean(),
  audio_transcription_enabled: z.boolean(),
  // Hollywood Store
  storage_base_url: z.string().max(512).optional(),
  catalog_images_count: z.coerce.number().int().min(0).max(500).optional(),
  catalog_link_mayorista: z.string().max(512).optional(),
  catalog_link_detal: z.string().max(512).optional(),
  talla_images_count: z
    .object({
      S: z.coerce.number().int().min(0).optional(),
      M: z.coerce.number().int().min(0).optional(),
      L: z.coerce.number().int().min(0).optional(),
      XL: z.coerce.number().int().min(0).optional(),
      XXL: z.coerce.number().int().min(0).optional(),
      XXXL: z.coerce.number().int().min(0).optional(),
    })
    .optional(),
})

type FormData = z.infer<typeof schema>

type Props = {
  tenantSlug: string
  botConfig: Record<string, unknown>
}

const INPUT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
const SELECT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer'
const TEXTAREA =
  'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none'

function Field({
  label,
  hint,
  children,
  error,
}: { label: string; hint?: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-foreground">{label}</div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border pb-1.5 pt-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {children}
      </h3>
    </div>
  )
}

function Toggle({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/30 ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <div className="relative mt-0.5 flex-shrink-0">
        <input
          id={id}
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="h-5 w-9 rounded-full bg-input transition-colors peer-checked:bg-primary" />
        <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
      </div>
    </label>
  )
}

export function ConfigTab({ tenantSlug, botConfig }: Props) {
  const router = useRouter()

  const tallaCount = botConfig.talla_images_count as Record<string, number> | undefined

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      flow_type: (botConfig.flow_type as FlowValue | undefined) ?? 'sales_v1',
      business_name: (botConfig.business_name as string | undefined) ?? '',
      city: (botConfig.city as string | undefined) ?? '',
      schedule: (botConfig.schedule as string | undefined) ?? '',
      whatsapp_provider:
        (botConfig.whatsapp_provider as 'meta' | '360dialog' | undefined) ?? 'meta',
      ai_enabled: (botConfig.ai_enabled as boolean | undefined) ?? false,
      image_analysis_enabled: (botConfig.image_analysis_enabled as boolean | undefined) ?? false,
      audio_transcription_enabled:
        (botConfig.audio_transcription_enabled as boolean | undefined) ?? false,
      storage_base_url: (botConfig.storage_base_url as string | undefined) ?? '',
      catalog_images_count: (botConfig.catalog_images_count as number | undefined) ?? 0,
      catalog_link_mayorista: (botConfig.catalog_link_mayorista as string | undefined) ?? '',
      catalog_link_detal: (botConfig.catalog_link_detal as string | undefined) ?? '',
      talla_images_count: {
        S: tallaCount?.S ?? 0,
        M: tallaCount?.M ?? 0,
        L: tallaCount?.L ?? 0,
        XL: tallaCount?.XL ?? 0,
        XXL: tallaCount?.XXL ?? 0,
        XXXL: tallaCount?.XXXL ?? 0,
      },
    },
  })

  const currentFlow = watch('flow_type')
  const aiEnabled = watch('ai_enabled')
  const selectedFlowDef = FLOWS.find((f) => f.value === currentFlow)

  async function onSubmit(data: FormData) {
    // Limpiar strings vacíos para no pisar valores existentes
    const payload: Record<string, unknown> = { ...data }
    if (!payload.storage_base_url) payload.storage_base_url = undefined
    if (!payload.catalog_link_mayorista) payload.catalog_link_mayorista = undefined
    if (!payload.catalog_link_detal) payload.catalog_link_detal = undefined

    try {
      const res = await fetch(`/api/admin/tenants/${tenantSlug}/bot-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operational: payload }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Error')
        return
      }
      toast.success('Configuración guardada')
      router.refresh()
    } catch {
      toast.error('Error de conexión')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pb-6">
      {/* ── Flow ── */}
      <SectionTitle>Flow de conversación</SectionTitle>

      <Field
        label="Tipo de flow"
        hint="Determina cómo el bot guía al cliente. El cambio aplica a nuevas conversaciones (caché de 5 min)."
        error={errors.flow_type?.message}
      >
        <select {...register('flow_type')} className={SELECT}>
          {FLOWS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>

      {selectedFlowDef && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            currentFlow === 'sales_v1'
              ? 'border-primary/30 bg-primary/5'
              : currentFlow === 'mayoristas'
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-purple-500/30 bg-purple-500/5'
          }`}
        >
          <div className="flex items-center gap-2">
            <FlowIcon flow={currentFlow} />
            <span className="font-medium">{selectedFlowDef.label}</span>
            {selectedFlowDef.default && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                default
              </span>
            )}
            {selectedFlowDef.ai && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                soporta IA
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{selectedFlowDef.description}</p>
        </div>
      )}

      {/* ── Negocio ── */}
      <SectionTitle>Datos del negocio</SectionTitle>

      <Field
        label="Nombre del negocio"
        hint="Usado en el saludo del bot y el prompt de IA. Si está vacío se usa el nombre del tenant."
      >
        <input {...register('business_name')} placeholder="Boutique Ana" className={INPUT} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Ciudad" error={errors.city?.message}>
          <input {...register('city')} placeholder="Bogotá" className={INPUT} />
        </Field>
        <Field label="Proveedor WhatsApp" error={errors.whatsapp_provider?.message}>
          <select {...register('whatsapp_provider')} className={SELECT}>
            <option value="meta">Meta Cloud API</option>
            <option value="360dialog">360dialog</option>
          </select>
        </Field>
      </div>

      <Field
        label="Horario de atención"
        hint="Se incluye en el prompt de IA cuando el cliente pregunta cuándo responden."
      >
        <textarea
          {...register('schedule')}
          rows={2}
          placeholder="Lunes a Sábado 9am–6pm. Domingos solo WhatsApp."
          className={TEXTAREA}
        />
      </Field>

      {/* ── IA ── */}
      <SectionTitle>Capacidades IA</SectionTitle>

      <p className="text-xs text-muted-foreground">
        La IA solo se activa si el plan del tenant lo permite. Desactivar aquí fuerza el flujo
        determinista aunque el plan la soporte.
      </p>

      <div className="space-y-2">
        <Toggle
          id="ai_enabled"
          label="Respuestas con IA habilitadas"
          description="El bot usa Claude para responder preguntas fuera del flujo determinista."
          checked={aiEnabled}
          onChange={(v) => setValue('ai_enabled', v)}
        />
        <Toggle
          id="image_analysis_enabled"
          label="Análisis de imágenes"
          description="El bot puede recibir fotos y describir o analizar prendas. Requiere IA habilitada."
          checked={watch('image_analysis_enabled')}
          onChange={(v) => setValue('image_analysis_enabled', v)}
          disabled={!aiEnabled}
        />
        <Toggle
          id="audio_transcription_enabled"
          label="Transcripción de audios"
          description="El bot transcribe mensajes de voz antes de procesarlos. Requiere IA habilitada."
          checked={watch('audio_transcription_enabled')}
          onChange={(v) => setValue('audio_transcription_enabled', v)}
          disabled={!aiEnabled}
        />
      </div>

      {currentFlow === 'hollywood_store' && (
        <>
          <SectionTitle>Hollywood Store — Storage y catálogo</SectionTitle>

          <p className="text-xs text-muted-foreground">
            Configuración específica del flujo con imágenes. El bot construye las URLs como{' '}
            <code className="rounded bg-muted px-1">
              {'{storage_base_url}'}/images/catalogo/001.jpg
            </code>
          </p>

          <Field
            label="URL base del storage"
            hint="Sin slash al final. Ej: https://media.tudominio.com/hollywood-store"
            error={errors.storage_base_url?.message}
          >
            <input
              {...register('storage_base_url')}
              placeholder="https://media.tudominio.com/hollywood-store"
              className={INPUT}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Link catálogo mayorista"
              hint="URL compartida con clientes mayoristas"
              error={errors.catalog_link_mayorista?.message}
            >
              <input
                {...register('catalog_link_mayorista')}
                placeholder="https://..."
                className={INPUT}
              />
            </Field>
            <Field
              label="Link catálogo detal"
              hint="URL compartida con clientes al detal"
              error={errors.catalog_link_detal?.message}
            >
              <input
                {...register('catalog_link_detal')}
                placeholder="https://..."
                className={INPUT}
              />
            </Field>
          </div>

          <Field
            label="Fotos en /images/catalogo/"
            hint="Cuántas imágenes hay en la carpeta del catálogo completo"
            error={errors.catalog_images_count?.message}
          >
            <input
              {...register('catalog_images_count')}
              type="number"
              min={0}
              max={500}
              className={INPUT}
            />
          </Field>

          <div className="space-y-1.5">
            <div className="text-sm font-medium text-foreground">
              Fotos por talla en /images/tallas/
            </div>
            <p className="text-xs text-muted-foreground">
              Número de imágenes disponibles por talla (el bot las envía en secuencia).
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {TALLAS.map((talla) => (
                <div key={talla} className="space-y-1">
                  <div className="block text-center text-xs font-semibold text-muted-foreground">
                    {talla}
                  </div>
                  <input
                    {...register(`talla_images_count.${talla}`)}
                    type="number"
                    min={0}
                    className={`${INPUT} text-center`}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="h-9 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isSubmitting ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>
    </form>
  )
}

function FlowIcon({ flow }: { flow: string }) {
  const icons: Record<string, string> = {
    sales_v1: '🛍️',
    mayoristas: '📦',
    hollywood_store: '🎬',
  }
  return <span className="text-base leading-none">{icons[flow] ?? '🤖'}</span>
}
