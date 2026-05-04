/**
 * admin/router.js — API de administración interna (solo para Jefferson)
 *
 * Protegida por API key (X-Api-Key header).
 * Endpoints para crear/listar tenants y gestionar catálogos.
 *
 * Uso:
 *   curl -X POST /admin/tenants \
 *     -H "X-Api-Key: $ADMIN_API_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"slug":"boutique-ana","name":"Boutique Ana",...}'
 */

const express    = require('express');
const { requireApiKey }             = require('./middleware');
const repo                          = require('../tenants/repository');
const { invalidate }                = require('../tenants/loader');
const { encrypt }                   = require('../utils/crypto');
const { query }                     = require('../db');
const { logger }                    = require('../utils/logger');

const router = express.Router();
router.use(requireApiKey);

// ── GET /admin/tenants — Listar todos los tenants ─────────────────────────
router.get('/tenants', async (req, res) => {
  try {
    const tenants = await repo.listAll();
    res.json({ tenants });
  } catch (err) {
    logger.error({ err: err.message }, '[Admin] Error listando tenants');
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/tenants — Crear nuevo tenant ──────────────────────────────
router.post('/tenants', async (req, res) => {
  const {
    slug, name, wa_token, phone_number_id, verify_token,
    owner_phone, owner_email, bot_config,
  } = req.body;

  if (!slug || !name || !wa_token || !phone_number_id || !verify_token || !owner_phone) {
    return res.status(400).json({
      error: 'Faltan campos: slug, name, wa_token, phone_number_id, verify_token, owner_phone',
    });
  }

  try {
    const tenant = await repo.create({
      slug,
      name,
      wa_token_encrypted: encrypt(wa_token),
      phone_number_id,
      verify_token,
      owner_phone,
      owner_email,
      bot_config: bot_config || {},
    });
    logger.info({ tenantSlug: slug }, '[Admin] Tenant creado');
    res.status(201).json({ tenant });
  } catch (err) {
    if (err.code === '23505') { // unique violation
      return res.status(409).json({ error: `El slug "${slug}" ya existe` });
    }
    logger.error({ slug, err: err.message }, '[Admin] Error creando tenant');
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /admin/tenants/:slug — Actualizar tenant ────────────────────────
router.patch('/tenants/:slug', async (req, res) => {
  const { slug } = req.params;
  const updates  = { ...req.body };

  // Si actualizan el wa_token, encriptarlo antes de guardar
  if (updates.wa_token) {
    updates.wa_token_encrypted = encrypt(updates.wa_token);
    delete updates.wa_token;
  }

  try {
    const tenant = await repo.update(slug, updates);
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });
    invalidate(slug); // limpiar cache
    logger.info({ tenantSlug: slug }, '[Admin] Tenant actualizado');
    res.json({ tenant });
  } catch (err) {
    logger.error({ slug, err: err.message }, '[Admin] Error actualizando tenant');
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/tenants/:slug/products — Listar productos ──────────────────
router.get('/tenants/:slug/products', async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/tenants/:slug/products — Agregar producto ─────────────────
router.post('/tenants/:slug/products', async (req, res) => {
  const { slug } = req.params;
  const { name, description, price, sizes, attributes, image_url, emoji, category } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: 'Faltan campos: name, price' });
  }

  try {
    const result = await query(
      `INSERT INTO products
         (tenant_id, name, description, price, sizes, attributes, image_url, emoji, category)
       VALUES (
         (SELECT id FROM tenants WHERE slug = $1),
         $2, $3, $4, $5, $6, $7, $8, $9
       )
       RETURNING *`,
      [
        slug,
        name,
        description || '',
        price,
        sizes || [],
        JSON.stringify(attributes || {}),
        image_url || '',
        emoji || '🛍️',
        category || '',
      ]
    );
    invalidate(slug);
    res.status(201).json({ product: result.rows[0] });
  } catch (err) {
    logger.error({ slug, err: err.message }, '[Admin] Error creando producto');
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /admin/tenants/:slug/products/:productId — Editar producto ─────────
router.put('/tenants/:slug/products/:productId', async (req, res) => {
  const { slug, productId } = req.params;
  const { name, description, price, sizes, attributes, image_url, emoji, category } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: 'Faltan campos: name, price' });
  }

  try {
    const result = await query(
      `UPDATE products
       SET name        = $1,
           description = $2,
           price       = $3,
           sizes       = $4,
           attributes  = $5,
           image_url   = $6,
           emoji       = $7,
           category    = $8
       WHERE id = $9
         AND tenant_id = (SELECT id FROM tenants WHERE slug = $10)
       RETURNING *`,
      [
        name,
        description || '',
        price,
        sizes || [],
        JSON.stringify(attributes || {}),
        image_url || '',
        emoji || '🛍️',
        category || '',
        productId,
        slug,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    invalidate(slug);
    res.json({ product: result.rows[0] });
  } catch (err) {
    logger.error({ slug, productId, err: err.message }, '[Admin] Error editando producto');
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/tenants/:slug/products/:productId — Desactivar producto ─
router.delete('/tenants/:slug/products/:productId', async (req, res) => {
  const { slug, productId } = req.params;
  try {
    await query(
      `UPDATE products SET active = false
       WHERE id = $1
         AND tenant_id = (SELECT id FROM tenants WHERE slug = $2)`,
      [productId, slug]
    );
    invalidate(slug);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/tenants/:slug/ai-usage — Uso de IA del tenant ─────────────
router.get('/tenants/:slug/ai-usage', async (req, res) => {
  try {
    const { getUsage } = require('../core/ai/aiMetrics');
    const usage = await getUsage(req.params.slug);
    res.json(usage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/health — Estado interno ───────────────────────────────────
router.get('/health', async (req, res) => {
  const { cachedSlugs } = require('../tenants/loader');
  const { healthCheck } = require('../db');
  const dbOk = await healthCheck();
  res.json({
    db:            dbOk ? 'connected' : 'error',
    cached_tenants: cachedSlugs(),
    uptime:        Math.round(process.uptime()),
  });
});

module.exports = router;
