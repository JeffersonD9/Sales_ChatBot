'use client'

import type { ProductRow } from '@/queries/products'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

const schema = z.object({
  persona_name: z.string().min(1, 'Requerido').max(40),
  persona_description: z.string().max(300).optional(),
  tone: z.enum(['casual', 'friendly', 'professional']),
  business_description: z.string().max(500).optional(),
  objection_price: z.string().max(300).optional(),
  objection_delivery: z.string().max(300).optional(),
  sales_tips: z.string().optional(),
  forbidden_topics: z.string().optional(),
  max_products: z.coerce.number().int().min(1).max(50),
  in_stock_only: z.boolean(),
  sizes_filter: z.string().optional(),
  min_price: z.coerce.number().int().min(0).optional().or(z.literal('')),
  max_price: z.coerce.number().int().min(0).optional().or(z.literal('')),
})

type FormData = z.infer<typeof schema>

type SalesPersona = {
  persona_name?: string
  persona_description?: string
  tone?: 'casual' | 'friendly' | 'professional'
  business_description?: string
  objection_price?: string
  objection_delivery?: string
  sales_tips?: string[]
  forbidden_topics?: string[]
  product_filter?: {
    max_products?: number
    in_stock_only?: boolean
    sizes?: string[]
    min_price?: number
    max_price?: number
    featured_ids?: string[]
  }
}

type Props = {
  tenantSlug: string
  botConfig: Record<string, unknown>
  products: ProductRow[]
}

const INPUT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
const TEXTAREA =
  'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none'
const SELECT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer'

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

export function PersonaTab({ tenantSlug, botConfig, products }: Props) {
  const router = useRouter()
  const persona = (botConfig?.sales_persona as SalesPersona | undefined) ?? {}
  const pf = persona.product_filter ?? {}
  const featuredIdsKey = (pf.featured_ids ?? []).join('\u0000')

  const [featuredIds, setFeaturedIds] = useState<Set<string>>(new Set(pf.featured_ids ?? []))

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      persona_name: persona.persona_name ?? '',
      persona_description: persona.persona_description ?? '',
      tone: persona.tone ?? 'friendly',
      business_description: persona.business_description ?? '',
      objection_price: persona.objection_price ?? '',
      objection_delivery: persona.objection_delivery ?? '',
      sales_tips: (persona.sales_tips ?? []).join('\n'),
      forbidden_topics: (persona.forbidden_topics ?? []).join(', '),
      max_products: pf.max_products ?? 10,
      in_stock_only: pf.in_stock_only !== false,
      sizes_filter: (pf.sizes ?? []).join(', '),
      min_price: pf.min_price ?? '',
      max_price: pf.max_price ?? '',
    },
  })

  // Sync featured when bot_config changes (after save → router.refresh)
  useEffect(() => {
    setFeaturedIds(new Set(featuredIdsKey ? featuredIdsKey.split('\u0000') : []))
  }, [featuredIdsKey])

  function toggleFeatured(id: string) {
    setFeaturedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onSubmit(data: FormData) {
    const sizesFilter = data.sizes_filter
      ? data.sizes_filter
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined

    const sales_tips = data.sales_tips
      ? data.sales_tips
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8)
      : undefined

    const forbidden_topics = data.forbidden_topics
      ? data.forbidden_topics
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 5)
      : undefined

    const featured_ids = Array.from(featuredIds)

    const product_filter = {
      max_products: data.max_products,
      in_stock_only: data.in_stock_only,
      ...(featured_ids.length ? { featured_ids } : {}),
      ...(sizesFilter ? { sizes: sizesFilter } : {}),
      ...(data.min_price !== '' && data.min_price != null
        ? { min_price: Number(data.min_price) }
        : {}),
      ...(data.max_price !== '' && data.max_price != null
        ? { max_price: Number(data.max_price) }
        : {}),
    }

    const sales_persona: SalesPersona = {
      persona_name: data.persona_name,
      ...(data.persona_description ? { persona_description: data.persona_description } : {}),
      tone: data.tone,
      ...(data.business_description ? { business_description: data.business_description } : {}),
      ...(data.objection_price ? { objection_price: data.objection_price } : {}),
      ...(data.objection_delivery ? { objection_delivery: data.objection_delivery } : {}),
      ...(sales_tips?.length ? { sales_tips } : {}),
      ...(forbidden_topics?.length ? { forbidden_topics } : {}),
      product_filter,
    }

    try {
      const res = await fetch(`/api/admin/tenants/${tenantSlug}/bot-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales_persona }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Error')
        return
      }
      toast.success('Persona IA guardada')
      router.refresh()
    } catch {
      toast.error('Error de conexión')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pb-6">
      <SectionTitle>Identidad y tono</SectionTitle>

      <Field label="Nombre de la persona *" error={errors.persona_name?.message}>
        <input
          {...register('persona_name')}
          placeholder="Valeria, Carlos, Sofía…"
          className={INPUT}
        />
      </Field>

      <Field label="Descripción breve" hint="Aparece al inicio del prompt del bot">
        <textarea
          {...register('persona_description')}
          rows={2}
          maxLength={300}
          placeholder="Soy una asesora de moda apasionada por ayudarte a encontrar el outfit perfecto…"
          className={TEXTAREA}
        />
      </Field>

      <Field label="Tono de comunicación">
        <select {...register('tone')} className={SELECT}>
          <option value="casual">Casual — relajado, como una amiga, con emojis</option>
          <option value="friendly">Amigable — cálido y profesional, algunos emojis</option>
          <option value="professional">Profesional — formal y claro, sin emojis</option>
        </select>
      </Field>

      <Field label="Descripción del negocio" hint="Contexto adicional para el bot">
        <textarea
          {...register('business_description')}
          rows={2}
          maxLength={500}
          placeholder="Boutique de ropa femenina con lo último en moda urbana…"
          className={TEXTAREA}
        />
      </Field>

      <SectionTitle>Manejo de objeciones</SectionTitle>

      <Field label='Cuando digan "está muy caro"'>
        <textarea
          {...register('objection_price')}
          rows={2}
          maxLength={300}
          placeholder="Entiendo, la calidad tiene su precio. ¿Te muestro algo similar con mejor precio?"
          className={TEXTAREA}
        />
      </Field>

      <Field label="Sobre tiempos de entrega">
        <textarea
          {...register('objection_delivery')}
          rows={2}
          maxLength={300}
          placeholder="Entregamos en 2-3 días hábiles a toda Colombia con seguimiento."
          className={TEXTAREA}
        />
      </Field>

      <SectionTitle>Tips y restricciones</SectionTitle>

      <Field label="Consejos de ventas" hint="Uno por línea, máximo 8">
        <textarea
          {...register('sales_tips')}
          rows={3}
          placeholder={
            'Pregunta siempre la talla y la ocasión\nSi duda entre dos, sugiere llevarse las dos'
          }
          className={TEXTAREA}
        />
      </Field>

      <Field label="Temas prohibidos" hint="Separados por coma, máximo 5">
        <input
          {...register('forbidden_topics')}
          placeholder="política, competidores, precios anteriores"
          className={INPUT}
        />
      </Field>

      <SectionTitle>Productos que verá el bot</SectionTitle>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Máximo de productos en el prompt" error={errors.max_products?.message}>
          <input {...register('max_products')} type="number" min="1" max="50" className={INPUT} />
        </Field>
        <div className="flex items-center gap-2 pt-7">
          <input
            {...register('in_stock_only')}
            id="in-stock"
            type="checkbox"
            className="h-4 w-4 cursor-pointer accent-primary"
          />
          <label htmlFor="in-stock" className="cursor-pointer text-sm text-muted-foreground">
            Solo productos activos
          </label>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Filtrar por tallas (coma)">
          <input {...register('sizes_filter')} placeholder="S, M, L" className={INPUT} />
        </Field>
        <Field label="Precio mínimo">
          <input
            {...register('min_price')}
            type="number"
            min="0"
            placeholder="0"
            className={INPUT}
          />
        </Field>
        <Field label="Precio máximo">
          <input
            {...register('max_price')}
            type="number"
            min="0"
            placeholder="Sin límite"
            className={INPUT}
          />
        </Field>
      </div>

      <Field label="Productos destacados" hint="Aparecen primero en el catálogo del bot">
        {products.length === 0 ? (
          <p className="rounded-md border border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
            Sin productos — agrega productos primero en la pestaña Productos
          </p>
        ) : (
          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/20 p-2">
            {products.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <input
                  type="checkbox"
                  checked={featuredIds.has(p.id)}
                  onChange={() => toggleFeatured(p.id)}
                  className="h-4 w-4 cursor-pointer accent-primary"
                />
                <span>{p.emoji}</span>
                <span className="font-medium text-foreground">{p.name}</span>
                <span className="ml-auto text-xs">${p.price.toLocaleString('es-CO')}</span>
                {!p.active && <span className="text-xs text-destructive">[inactivo]</span>}
              </label>
            ))}
          </div>
        )}
      </Field>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="h-9 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isSubmitting ? 'Guardando…' : 'Guardar persona IA'}
        </button>
      </div>
    </form>
  )
}
