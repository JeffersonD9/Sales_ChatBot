'use strict';

const express    = require('express');
const { requireApiKey }             = require('./middleware');
const repo                          = require('../tenants/repository');
const { invalidate }                = require('../tenants/loader');
const { encrypt }                   = require('../utils/crypto');
const { query, getPool }            = require('../db');
const { logger }                    = require('../utils/logger');
const {
  createTenantSchema,
  updateTenantSchema,
  createProductSchema,
  updateProductSchema,
} = require('../utils/tenantSchema');

const router = express.Router();
router.use(requireApiKey);

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

// ── GET /admin/tenants — Listar todos los tenants ─────────────────────────
router.get('/tenants', async (req, res, next) => {
  try {
    const tenants = await repo.listAll();
    res.json({ tenants });
  } catch (err) {
    logger.error({ err: err.message }, '[Admin] Error listando tenants');
    next(err);
  }
});

// ── POST /admin/tenants — Crear nuevo tenant ──────────────────────────────
router.post('/tenants', async (req, res, next) => {
  try {
    const data = validate(createTenantSchema, req.body);

    const slugCheck = await query('SELECT id FROM tenants WHERE slug = $1', [data.slug]);
    if (slugCheck.rows.length > 0) {
      return res.status(409).json({ error: `El slug '${data.slug}' ya está en uso` });
    }

    const phoneCheck = await query(
      "SELECT id FROM tenants WHERE owner_phone = $1 AND status != 'suspended'",
      [data.owner_phone]
    );
    if (phoneCheck.rows.length > 0) {
      return res.status(409).json({ error: 'El número de teléfono ya está registrado en otro tenant' });
    }

    const tenant = await repo.create({
      slug:              data.slug,
      name:              data.name,
      wa_token_encrypted: encrypt(data.wa_token),
      phone_number_id:   data.phone_number_id,
      verify_token:      data.verify_token,
      owner_phone:       data.owner_phone,
      owner_email:       data.owner_email,
      bot_config:        data.bot_config,
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
      const phoneCheck = await query(
        "SELECT id FROM tenants WHERE owner_phone = $1 AND status != 'suspended' AND slug != $2",
        [updates.owner_phone, slug]
      );
      if (phoneCheck.rows.length > 0) {
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

// ── GET /admin/tenants/:slug/products — Listar productos ──────────────────
router.get('/tenants/:slug/products', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.* FROM products p
       JOIN tenants t ON p.tenant_id = t.id
       WHERE t.slug = $1
       ORDER BY p.price DESC`,
      [req.params.slug]
    );
    res.json({ products: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/tenants/:slug/products — Agregar producto ─────────────────
router.post('/tenants/:slug/products', async (req, res, next) => {
  const { slug } = req.params;
  try {
    const data   = validate(createProductSchema, req.body);
    const result = await query(
      `INSERT INTO products
         (tenant_id, name, description, price, sizes, image_url, emoji, category)
       VALUES (
         (SELECT id FROM tenants WHERE slug = $1),
         $2, $3, $4, $5, $6, $7, $8
       )
       RETURNING *`,
      [slug, data.name, data.description, data.price, data.sizes, data.image_url, data.emoji, data.category || '']
    );
    invalidate(slug);
    res.status(201).json({ product: result.rows[0] });
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

    const client = await getPool().connect();
    let inserted = 0;
    try {
      await client.query('BEGIN');
      for (const p of valid) {
        await client.query(
          `INSERT INTO products (tenant_id, name, description, price, sizes, image_url, emoji, category)
           VALUES ((SELECT id FROM tenants WHERE slug = $1), $2, $3, $4, $5, $6, $7, $8)`,
          [slug, p.name, p.description, p.price, p.sizes, p.image_url, p.emoji, p.category || '']
        );
        inserted++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    invalidate(slug);
    logger.info({ slug, inserted, errors: errors.length }, '[Admin] Bulk import productos');
    return res.status(207).json({ inserted, errors });
  } catch (err) {
    logger.error({ slug, err: err.message }, '[Admin] Error en bulk import productos');
    next(err);
  }
});

// ── PUT /admin/tenants/:slug/products/:productId — Editar producto ─────────
router.put('/tenants/:slug/products/:productId', async (req, res, next) => {
  const { slug, productId } = req.params;
  try {
    const data   = validate(updateProductSchema, req.body);
    const fields = Object.keys(data).filter((k) => data[k] !== undefined);
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos a actualizar' });
    }

    const sets   = fields.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const values = fields.map((k) => data[k]);

    const result = await query(
      `UPDATE products SET ${sets}
       WHERE id = $1
         AND tenant_id = (SELECT id FROM tenants WHERE slug = $2)
       RETURNING *`,
      [productId, slug, ...values]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    invalidate(slug);
    res.json({ product: result.rows[0] });
  } catch (err) {
    logger.error({ slug, productId, err: err.message }, '[Admin] Error editando producto');
    next(err);
  }
});

// ── DELETE /admin/tenants/:slug/products/:productId — Desactivar producto ─
router.delete('/tenants/:slug/products/:productId', async (req, res, next) => {
  const { slug, productId } = req.params;
  try {
    const result = await query(
      `UPDATE products SET active = false
       WHERE id = $1
         AND tenant_id = (SELECT id FROM tenants WHERE slug = $2)
       RETURNING id`,
      [productId, slug]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    invalidate(slug);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/tenants/:slug/ai-usage — Uso de IA del tenant ─────────────
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
