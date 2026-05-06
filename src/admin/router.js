'use strict';

const express    = require('express');
const { adminMiddleware }           = require('./middleware');
const repo                          = require('../tenants/repository');
const { invalidate }                = require('../tenants/loader');
const { encrypt }                   = require('../utils/crypto');
const { eq, and, sql }              = require('drizzle-orm');
const { getDb }                     = require('../drizzle/db');
const { tenants, products }         = require('../drizzle/schema');
const { logger }                    = require('../utils/logger');
const {
  createTenantSchema,
  updateTenantSchema,
  createProductSchema,
  updateProductSchema,
} = require('../utils/tenantSchema');

const router = express.Router();
router.use(adminMiddleware);

function validate(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ');
    throw Object.assign(new Error(issues), { status: 400 });
  }
  return result.data;
}

// ── GET /admin/tenants ────────────────────────────────────────────────────────
router.get('/tenants', async (req, res, next) => {
  try {
    const list = await repo.listAll();
    res.json({ tenants: list });
  } catch (err) {
    logger.error({ err: err.message }, '[Admin] Error listando tenants');
    next(err);
  }
});

// ── POST /admin/tenants ───────────────────────────────────────────────────────
router.post('/tenants', async (req, res, next) => {
  try {
    const data = validate(createTenantSchema, req.body);
    const db   = getDb();

    const slugCheck = await db
      .select({ id: tenants.id }).from(tenants)
      .where(eq(tenants.slug, data.slug)).limit(1);
    if (slugCheck.length > 0) {
      return res.status(409).json({ error: `El slug '${data.slug}' ya está en uso` });
    }

    const phoneCheck = await db
      .select({ id: tenants.id }).from(tenants)
      .where(and(eq(tenants.owner_phone, data.owner_phone), sql`${tenants.status} != 'suspended'`))
      .limit(1);
    if (phoneCheck.length > 0) {
      return res.status(409).json({ error: 'El número de teléfono ya está registrado en otro tenant' });
    }

    const tenant = await repo.create({
      slug:               data.slug,
      name:               data.name,
      wa_token_encrypted: encrypt(data.wa_token),
      phone_number_id:    data.phone_number_id,
      verify_token:       data.verify_token,
      owner_phone:        data.owner_phone,
      owner_email:        data.owner_email,
      bot_config:         data.bot_config,
    });
    logger.info({ tenantSlug: data.slug }, '[Admin] Tenant creado');
    res.status(201).json({ tenant });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /admin/tenants/:slug — Actualizar tenant ────────────────────────
router.patch('/tenants/:slug', async (req, res, next) => {
  const { slug } = req.params;
  try {
    const data    = validate(updateTenantSchema, req.body);
    const updates = { ...data };

    if (updates.wa_token) {
      updates.wa_token_encrypted = encrypt(updates.wa_token);
      delete updates.wa_token;
    }

    if (updates.owner_phone) {
      const db         = getDb();
      const phoneCheck = await db
        .select({ id: tenants.id }).from(tenants)
        .where(and(
          eq(tenants.owner_phone, updates.owner_phone),
          sql`${tenants.status} != 'suspended'`,
          sql`${tenants.slug} != ${slug}`
        ))
        .limit(1);
      if (phoneCheck.length > 0) {
        return res.status(409).json({ error: 'El número de teléfono ya está registrado en otro tenant' });
      }
    }

    const tenant = await repo.update(slug, updates);
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });
    invalidate(slug);
    logger.info({ tenantSlug: slug }, '[Admin] Tenant actualizado');
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /admin/tenants/:slug/status — Cambiar estado del tenant ─────────
router.patch('/tenants/:slug/status', async (req, res, next) => {
  const { slug } = req.params;
  try {
    const { status } = validate(
      updateTenantSchema.pick({ status: true }).required({ status: true }),
      req.body
    );
    const tenant = await repo.update(slug, { status });
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });
    invalidate(slug);
    logger.info({ tenantSlug: slug, status }, '[Admin] Estado de tenant actualizado');
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /admin/tenants/:slug/meta-status — Estado de conexión con Meta ──
router.patch('/tenants/:slug/meta-status', async (req, res, next) => {
  const { slug } = req.params;
  try {
    const { meta_live } = validate(
      updateTenantSchema.pick({ meta_live: true }).required({ meta_live: true }),
      req.body
    );
    const tenant = await repo.update(slug, { meta_live });
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });
    invalidate(slug);
    res.json({ slug: tenant.slug, meta_live: tenant.meta_live, meta_connected_at: tenant.meta_connected_at });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/tenants/:slug/products ─────────────────────────────────────────
router.get('/tenants/:slug/products', async (req, res, next) => {
  try {
    const db   = getDb();
    const rows = await db
      .select()
      .from(products)
      .innerJoin(tenants, eq(tenants.id, products.tenant_id))
      .where(eq(tenants.slug, req.params.slug))
      .orderBy(sql`${products.price} DESC`);
    res.json({ products: rows.map((r) => r.products) });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/tenants/:slug/products ────────────────────────────────────────
router.post('/tenants/:slug/products', async (req, res, next) => {
  const { slug } = req.params;
  try {
    const data      = validate(createProductSchema, req.body);
    const db        = getDb();
    const tenantRow = await db
      .select({ id: tenants.id }).from(tenants)
      .where(eq(tenants.slug, slug)).limit(1);
    if (!tenantRow[0]) return res.status(404).json({ error: 'Tenant no encontrado' });

    const rows = await db
      .insert(products)
      .values({
        tenant_id:   tenantRow[0].id,
        name:        data.name,
        description: data.description,
        price:       data.price,
        sizes:       data.sizes,
        image_url:   data.image_url,
        emoji:       data.emoji,
        category:    data.category || '',
      })
      .returning();

    invalidate(slug);
    res.status(201).json({ product: rows[0] });
  } catch (err) {
    logger.error({ slug, err: err.message }, '[Admin] Error creando producto');
    next(err);
  }
});

// ── POST /admin/tenants/:slug/products/bulk — Importar productos en lote ──
router.post('/tenants/:slug/products/bulk', async (req, res, next) => {
  const { slug } = req.params;
  try {
    const { products: items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Se requiere un array "products" no vacío' });
    }

    const valid  = [];
    const errors = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.image_url) {
        errors.push({ index: i, message: 'image_url: Required' });
        continue;
      }
      const result = createProductSchema.safeParse(item);
      if (!result.success) {
        const msg = result.error.issues
          .map((iss) => `${iss.path.join('.') || 'root'}: ${iss.message}`)
          .join('; ');
        errors.push({ index: i, message: msg });
      } else if (!result.data.image_url) {
        errors.push({ index: i, message: 'image_url: Required' });
      } else {
        valid.push(result.data);
      }
    }

    if (valid.length === 0) {
      return res.status(400).json({ inserted: 0, errors });
    }

    const db        = getDb();
    const tenantRow = await db
      .select({ id: tenants.id }).from(tenants)
      .where(eq(tenants.slug, slug)).limit(1);
    if (!tenantRow[0]) return res.status(404).json({ error: 'Tenant no encontrado' });

    let inserted = 0;
    await db.transaction(async (tx) => {
      for (const p of valid) {
        await tx.insert(products).values({
          tenant_id:   tenantRow[0].id,
          name:        p.name,
          description: p.description,
          price:       p.price,
          sizes:       p.sizes,
          image_url:   p.image_url,
          emoji:       p.emoji,
          category:    p.category || '',
        });
        inserted++;
      }
    });

    invalidate(slug);
    logger.info({ slug, inserted, errors: errors.length }, '[Admin] Bulk import productos');
    return res.status(207).json({ inserted, errors });
  } catch (err) {
    logger.error({ slug, err: err.message }, '[Admin] Error en bulk import productos');
    next(err);
  }
});

// ── PUT /admin/tenants/:slug/products/:productId ──────────────────────────────
router.put('/tenants/:slug/products/:productId', async (req, res, next) => {
  const { slug, productId } = req.params;
  try {
    const data   = validate(updateProductSchema, req.body);
    const fields = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos a actualizar' });
    }

    const db        = getDb();
    const tenantRow = await db
      .select({ id: tenants.id }).from(tenants)
      .where(eq(tenants.slug, slug)).limit(1);
    if (!tenantRow[0]) return res.status(404).json({ error: 'Tenant no encontrado' });

    const rows = await db
      .update(products)
      .set(fields)
      .where(and(eq(products.id, productId), eq(products.tenant_id, tenantRow[0].id)))
      .returning();

    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    invalidate(slug);
    res.json({ product: rows[0] });
  } catch (err) {
    logger.error({ slug, productId, err: err.message }, '[Admin] Error editando producto');
    next(err);
  }
});

// ── DELETE /admin/tenants/:slug/products/:productId ───────────────────────────
router.delete('/tenants/:slug/products/:productId', async (req, res, next) => {
  const { slug, productId } = req.params;
  try {
    const db        = getDb();
    const tenantRow = await db
      .select({ id: tenants.id }).from(tenants)
      .where(eq(tenants.slug, slug)).limit(1);
    if (!tenantRow[0]) return res.status(404).json({ error: 'Tenant no encontrado' });

    const rows = await db
      .update(products)
      .set({ active: false })
      .where(and(eq(products.id, productId), eq(products.tenant_id, tenantRow[0].id)))
      .returning({ id: products.id });

    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    invalidate(slug);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/tenants/:slug/ai-usage ─────────────────────────────────────────
router.get('/tenants/:slug/ai-usage', async (req, res, next) => {
  try {
    const { getUsage } = require('../core/ai/aiMetrics');
    const usage = await getUsage(req.params.slug);
    res.json(usage);
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/health — Estado interno ───────────────────────────────────
router.get('/health', async (req, res, next) => {
  try {
    const { cachedSlugs } = require('../tenants/loader');
    const { healthCheck } = require('../db');
    const dbOk = await healthCheck();
    res.json({
      db:             dbOk ? 'connected' : 'error',
      cached_tenants: cachedSlugs(),
      uptime:         Math.round(process.uptime()),
    });
  } catch (err) {
    next(err);
  }
});

// ── Error handler ─────────────────────────────────────────────────────────
router.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status === 500) {
    logger.error({ err: err.message, path: req.path }, '[Admin] Error interno');
  }
  res.status(status).json({ error: err.message });
});

module.exports = router;
