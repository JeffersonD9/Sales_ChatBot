import { tenantDb } from '@/db'
import { products } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

export type ProductRow = {
  id: string
  name: string
  description: string
  price: number
  sizes: string[]
  image_url: string
  emoji: string
  category: string
  active: boolean
  created_at: Date
}

export type CreateProductData = {
  name: string
  description?: string
  price: number
  sizes?: string[]
  image_url?: string
  emoji?: string
  category?: string
}

export type UpdateProductData = Partial<CreateProductData & { active: boolean }>

export async function getProductsByTenant(tenantId: string): Promise<ProductRow[]> {
  return tenantDb
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      price: products.price,
      sizes: products.sizes,
      image_url: products.image_url,
      emoji: products.emoji,
      category: products.category,
      active: products.active,
      created_at: products.created_at,
    })
    .from(products)
    .where(eq(products.tenant_id, tenantId))
    .orderBy(products.created_at)
}

export async function createProduct(tenantId: string, data: CreateProductData) {
  const [product] = await tenantDb
    .insert(products)
    .values({
      tenant_id: tenantId,
      name: data.name,
      description: data.description ?? '',
      price: data.price,
      sizes: data.sizes ?? [],
      image_url: data.image_url ?? '',
      emoji: data.emoji ?? '🛍️',
      category: data.category ?? '',
      active: true,
      attributes: {},
    })
    .returning()
  return product
}

export async function updateProduct(id: string, tenantId: string, data: UpdateProductData) {
  const [updated] = await tenantDb
    .update(products)
    .set(data)
    .where(and(eq(products.id, id), eq(products.tenant_id, tenantId)))
    .returning()
  return updated
}

export async function deactivateProduct(id: string, tenantId: string) {
  const [updated] = await tenantDb
    .update(products)
    .set({ active: false })
    .where(and(eq(products.id, id), eq(products.tenant_id, tenantId)))
    .returning({ id: products.id })
  return updated
}

/**
 * Inserción por lote de productos, **no transaccional a propósito**.
 *
 * Cada item se inserta de forma independiente. Si un item falla por UNIQUE
 * (mismo nombre que un producto existente del tenant — ver
 * `products_tenant_name_lower_unique` en scripts/sql/fase-4-constraints.sql),
 * se reporta en `skipped` o `errors` y los demás siguen.
 *
 * Decisión deliberada: en imports CSV es preferible que 499 filas válidas
 * queden insertadas aunque la 500 tenga un problema, en vez de hacer un
 * all-or-nothing que obligaría al usuario a corregir el CSV completo y
 * reintentar todo. El UI de csv-import-dialog refleja esta contract con
 * tres counters (importados / ya existían / errores).
 */
export async function bulkCreateProducts(
  tenantId: string,
  items: CreateProductData[],
): Promise<{
  inserted: ProductRow[]
  skipped: Array<CreateProductData & { reason: string }>
  errors: Array<CreateProductData & { reason: string }>
}> {
  const existing = await tenantDb
    .select({ name: products.name })
    .from(products)
    .where(eq(products.tenant_id, tenantId))

  const existingNames = new Set(existing.map((r) => r.name.toLowerCase()))

  const inserted: ProductRow[] = []
  const skipped: Array<CreateProductData & { reason: string }> = []
  const errors: Array<CreateProductData & { reason: string }> = []

  for (const item of items) {
    if (existingNames.has(item.name.toLowerCase())) {
      skipped.push({ ...item, reason: 'Ya existe un producto con ese nombre' })
      continue
    }
    try {
      const product = await createProduct(tenantId, item)
      inserted.push(product)
      existingNames.add(item.name.toLowerCase())
    } catch (e) {
      errors.push({ ...item, reason: e instanceof Error ? e.message : 'Error al insertar' })
    }
  }

  return { inserted, skipped, errors }
}
