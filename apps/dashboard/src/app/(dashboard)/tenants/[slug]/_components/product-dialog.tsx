'use client'

import type { ProductRow } from '@/queries/products'
import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1, 'Requerido').max(256),
  description: z.string().max(2000).optional(),
  price: z.coerce.number().int().positive('Debe ser mayor a 0'),
  sizes: z.string().optional(),
  emoji: z.string().max(8).optional(),
  category: z.string().max(128).optional(),
  image_url: z.string().url('URL inválida').optional().or(z.literal('')),
})

type FormData = z.infer<typeof schema>

type Props = {
  open: boolean
  tenantSlug: string
  product?: ProductRow | null
  onClose: () => void
  onSaved: () => void
}

const INPUT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
const TEXTAREA =
  'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none'

function Field({
  label,
  children,
  error,
}: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-foreground">{label}</div>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function ProductDialog({ open, tenantSlug, product, onClose, onSaved }: Props) {
  const isEdit = !!product

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { emoji: '🛍️' },
  })

  useEffect(() => {
    if (!open) return
    if (product) {
      reset({
        name: product.name,
        description: product.description,
        price: product.price,
        sizes: product.sizes.join(', '),
        emoji: product.emoji,
        category: product.category,
        image_url: product.image_url,
      })
    } else {
      reset({ emoji: '🛍️', price: undefined as unknown as number })
    }
  }, [open, product, reset])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  async function onSubmit(data: FormData) {
    const body = {
      name: data.name,
      description: data.description ?? '',
      price: data.price,
      sizes: data.sizes
        ? data.sizes
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      emoji: data.emoji || '🛍️',
      category: data.category ?? '',
      image_url: data.image_url ?? '',
    }
    const productId = product?.id
    if (isEdit && !productId) return
    const url = isEdit
      ? `/api/admin/tenants/${tenantSlug}/products/${productId}`
      : `/api/admin/tenants/${tenantSlug}/products`
    const method = isEdit ? 'PUT' : 'POST'

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Error')
        return
      }
      toast.success(isEdit ? 'Producto actualizado' : 'Producto creado')
      onClose()
      onSaved()
    } catch {
      toast.error('Error de conexión')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar modal"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {isEdit ? 'Editar producto' : 'Nuevo producto'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Nombre *" error={errors.name?.message}>
            <input {...register('name')} placeholder="Vestido floral" className={INPUT} />
          </Field>

          <Field label="Descripción" error={errors.description?.message}>
            <textarea
              {...register('description')}
              rows={2}
              placeholder="Descripción breve del producto"
              className={TEXTAREA}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Precio (COP) *" error={errors.price?.message}>
              <input
                {...register('price')}
                type="number"
                placeholder="85000"
                min="1"
                className={INPUT}
              />
            </Field>
            <Field label="Emoji" error={errors.emoji?.message}>
              <input {...register('emoji')} placeholder="👗" maxLength={4} className={INPUT} />
            </Field>
          </div>

          <Field label="Tallas (separadas por coma)" error={errors.sizes?.message}>
            <input {...register('sizes')} placeholder="S, M, L, XL" className={INPUT} />
          </Field>

          <Field label="Categoría" error={errors.category?.message}>
            <input {...register('category')} placeholder="Vestidos" className={INPUT} />
          </Field>

          <Field label="URL de imagen" error={errors.image_url?.message}>
            <input
              {...register('image_url')}
              type="url"
              placeholder="https://..."
              className={INPUT}
            />
          </Field>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
