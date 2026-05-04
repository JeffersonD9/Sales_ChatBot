'use strict';

/**
 * panel/admin/router.js — API de gestión del panel (solo super_admin)
 *
 * Reutiliza:
 *   src/tenants/repository.js  → create, listAll, update, products CRUD
 *   src/utils/crypto.js        → encrypt para wa_token
 *   src/core/ai/aiMetrics.js   → getUsage(slug)
 *   src/core/state/manager.js  → getActiveSessions(slug)
 */

const express = require('express');

const repo               = require('../../tenants/repository');
const { encrypt }        = require('../../utils/crypto');
const { getUsage }       = require('../../core/ai/aiMetrics');
const { getActiveSessions } = require('../../core/state/manager');
const { query }          = require('../../db');
const { logger }         = require('../../utils/logger');
const { requireAuth, requireRole } = require('../auth/middleware');

const router = express.Router();

router.use(requireAuth, requireRole('super_admin'));

// ── Utilidades ────────────────────────────────────────────────────────────────

function generateSlug(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // quitar acentos
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48);
}

async function _resolveSlugConflict(base) {
  const { rows } = await query(
    "SELECT slug FROM tenants WHERE slug LIKE $1 ORDER BY slug",
    [`${base}%`]
  );
  if (!rows.length) return base;
  const existing = new Set(rows.map((r) => r.slug));
  if (!existing.has(base)) return base;

  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  try {
    const tenants = await repo.listAll();

    const tenantMetrics = await Promise.all(
      tenants.map(async (t) => {
        const [aiUsage, messagesRow, ordersRow] = await Promise.all([
          getUsage(t.slug),
          query(
            `SELECT COUNT(*) AS cnt
             FROM sessions
             WHERE tenant_id = $1
               AND last_activity > NOW() - INTERVAL '24 hours'`,
            [t.id]
          ),
          query(
            `SELECT COUNT(*) AS cnt
             FROM orders
             WHERE tenant_id = $1
               AND created_at > NOW() - INTERVAL '7 days'`,
            [t.id]
          ),
        ]);

        const activeSessions = getActiveSessions(t.slug).length;

        return {
          slug:               t.slug,
          name:               t.name,
          status:             t.status,
          plan:               t.plan || 'starter',
          active_sessions:    activeSessions,
          ai_calls_this_month: aiUsage.calls_this_month,
          ai_cost_usd:        aiUsage.estimated_cost_usd || '0.0000',
          messages_last_24h:  parseInt(messagesRow.rows[0].cnt, 10),
          orders_last_7d:     parseInt(ordersRow.rows[0].cnt, 10),
          next_billing_date:  t.next_billing_date || null,
        };
      })
    );

    const totals = {
      tenants_count:          tenants.length,
      active_sessions_total:  tenantMetrics.reduce((s, t) => s + t.active_sessions, 0),
      ai_calls_total:         tenantMetrics.reduce((s, t) => s + t.ai_calls_this_month, 0),
    };

    res.json({ ok: true, tenants: tenantMetrics, totals });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error en dashboard');
    res.status(500).json({ ok: false, error: 'Error cargando dashboard' });
  }
});

// ── Tenants ───────────────────────────────────────────────────────────────────

router.get('/tenants', async (req, res) => {
  try {
    const tenants = await repo.listAll();
    res.json({ ok: true, tenants });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error listando tenants');
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.post('/tenants', async (req, res) => {
  try {
    const { name, wa_token, phone_number_id, verify_token, owner_phone, owner_email, plan } = req.body || {};

    if (!name || !owner_phone) {
      return res.status(400).json({ ok: false, error: 'name y owner_phone son requeridos' });
    }

    const baseSlug = generateSlug(name);
    const slug     = await _resolveSlugConflict(baseSlug);

    const wa_token_encrypted = wa_token ? encrypt(wa_token) : null;

    const tenant = await repo.create({
      slug,
      name,
      wa_token_encrypted,
      phone_number_id: phone_number_id || null,
      verify_token:    verify_token    || null,
      owner_phone,
      owner_email:     owner_email     || null,
      bot_config:      {},
    });

    if (plan) {
      await query('UPDATE tenants SET plan = $1 WHERE id = $2', [plan, tenant.id]);
    }

    logger.info({ slug, createdBy: req.panelUser.username }, '[Panel] Tenant creado');
    res.status(201).json({ ok: true, tenant: { ...tenant, slug } });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error creando tenant');
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: 'El slug ya existe' });
    }
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.patch('/tenants/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { name, wa_token, phone_number_id, verify_token, owner_phone, owner_email, status } = req.body || {};

    const fields = {};
    if (name)            fields.name = name;
    if (phone_number_id) fields.phone_number_id = phone_number_id;
    if (verify_token)    fields.verify_token = verify_token;
    if (owner_phone)     fields.owner_phone = owner_phone;
    if (owner_email)     fields.owner_email = owner_email;
    if (status)          fields.status = status;
    if (wa_token)        fields.wa_token_encrypted = encrypt(wa_token);

    const updated = await repo.update(slug, fields);
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Tenant no encontrado' });
    }

    logger.info({ slug, updatedBy: req.panelUser.username }, '[Panel] Tenant actualizado');
    res.json({ ok: true, tenant: updated });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error actualizando tenant');
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ── Productos ─────────────────────────────────────────────────────────────────

router.get('/tenants/:slug/products', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT p.* FROM products p
       JOIN tenants t ON t.id = p.tenant_id
       WHERE t.slug = $1
       ORDER BY p.created_at DESC`,
      [req.params.slug]
    );
    res.json({ ok: true, products: rows });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error listando productos');
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.post('/tenants/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { name, description, price, sizes, image_url, emoji, category, attributes } = req.body || {};

    if (!name || price === undefined) {
      return res.status(400).json({ ok: false, error: 'name y price son requeridos' });
    }

    const { rows } = await query(
      `INSERT INTO products (tenant_id, name, description, price, sizes, image_url, emoji, category, attributes)
       SELECT t.id, $2, $3, $4, $5, $6, $7, $8, $9
       FROM tenants t WHERE t.slug = $1
       RETURNING *`,
      [
        slug,
        name,
        description || '',
        parseInt(price, 10),
        sizes || [],
        image_url || '',
        emoji || '🛍️',
        category || '',
        JSON.stringify(attributes || {}),
      ]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: 'Tenant no encontrado' });
    }

    res.status(201).json({ ok: true, product: rows[0] });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error creando producto');
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.put('/tenants/:slug/products/:id', async (req, res) => {
  try {
    const { slug, id } = req.params;
    const { name, description, price, sizes, image_url, emoji, category, attributes, active } = req.body || {};

    const { rows } = await query(
      `UPDATE products p
       SET name        = COALESCE($3, p.name),
           description = COALESCE($4, p.description),
           price       = COALESCE($5, p.price),
           sizes       = COALESCE($6, p.sizes),
           image_url   = COALESCE($7, p.image_url),
           emoji       = COALESCE($8, p.emoji),
           category    = COALESCE($9, p.category),
           attributes  = COALESCE($10, p.attributes),
           active      = COALESCE($11, p.active)
       FROM tenants t
       WHERE p.id = $1 AND t.slug = $2 AND p.tenant_id = t.id
       RETURNING p.*`,
      [
        id, slug,
        name        || null,
        description || null,
        price !== undefined ? parseInt(price, 10) : null,
        sizes       || null,
        image_url   || null,
        emoji       || null,
        category    || null,
        attributes !== undefined ? JSON.stringify(attributes) : null,
        active !== undefined ? active : null,
      ]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    }

    res.json({ ok: true, product: rows[0] });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error actualizando producto');
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.delete('/tenants/:slug/products/:id', async (req, res) => {
  try {
    const { slug, id } = req.params;

    const { rowCount } = await query(
      `UPDATE products p
       SET active = false
       FROM tenants t
       WHERE p.id = $1 AND t.slug = $2 AND p.tenant_id = t.id`,
      [id, slug]
    );

    if (rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error eliminando producto');
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ── Uso de IA ─────────────────────────────────────────────────────────────────

router.get('/tenants/:slug/ai-usage', async (req, res) => {
  try {
    const usage = await getUsage(req.params.slug);
    res.json({ ok: true, ...usage });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error obteniendo uso IA');
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

module.exports = router;
