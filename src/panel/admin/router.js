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
const { validateBotConfig } = require('../../utils/botConfigSchema');
const { buildSalesPrompt }  = require('../../core/ai/salesPrompt');
const loader                = require('../../tenants/loader');

const router = express.Router();

const UNIQUE_ERRORS = {
  tenants_slug_key:             'El slug ya existe',
  tenants_name_unique:          'Ya existe un tenant con ese nombre de negocio',
  tenants_owner_phone_unique:   'Ese número de teléfono ya está registrado en otro tenant',
  tenants_owner_email_unique:   'Ese email ya está registrado en otro tenant',
  tenants_verify_token_unique:  'Colisión de verify_token, intenta de nuevo',
  tenants_phone_number_id_unique: 'Ese Phone Number ID ya está asignado a otro tenant',
};

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

router.get('/dashboard', async (req, res, next) => {
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
    next(err);
  }
});

// ── Tenants ───────────────────────────────────────────────────────────────────

router.get('/tenants', async (req, res, next) => {
  try {
    const tenants = await repo.listAll();
    res.json({ ok: true, tenants });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error listando tenants');
    next(err);
  }
});

router.post('/tenants', async (req, res) => {
  try {
    const { name, wa_token, phone_number_id, owner_phone, owner_email, plan } = req.body || {};

    if (!name || !owner_phone) {
      return res.status(400).json({ ok: false, error: 'name y owner_phone son requeridos' });
    }

    const baseSlug       = generateSlug(name);
    const slug           = await _resolveSlugConflict(baseSlug);
    const finalVerifyToken   = await repo.generateUniqueVerifyToken(slug);
    const wa_token_encrypted = wa_token ? encrypt(wa_token) : null;

    const tenant = await repo.create({
      slug,
      name,
      wa_token_encrypted,
      phone_number_id: phone_number_id || null,
      verify_token:    finalVerifyToken,
      owner_phone,
      owner_email:     owner_email     || null,
      bot_config:      {},
    });

    if (plan) {
      await query('UPDATE tenants SET plan = $1 WHERE id = $2', [plan, tenant.id]);
    }

    const domain = process.env.DOMAIN ? `https://${process.env.DOMAIN}` : 'https://jestsolution.dev';
    const webhook_url = `${domain}/webhook/${slug}`;

    logger.info({ slug, createdBy: req.panelUser.username }, '[Panel] Tenant creado');
    res.status(201).json({
      ok: true,
      tenant: { ...tenant, slug },
      meta_setup: {
        webhook_url,
        verify_token: tenant.verify_token || finalVerifyToken,
        phone_number_id: phone_number_id || tenant.phone_number_id || '',
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error creando tenant');
    if (err.code === '23505') {
      const msg = UNIQUE_ERRORS[err.constraint] || 'Dato duplicado — verifica nombre, teléfono o email';
      return res.status(409).json({ ok: false, error: msg });
    }
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.patch('/tenants/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { name, wa_token, phone_number_id, owner_phone, owner_email, status } = req.body || {};

    const fields = {};
    if (name)            fields.name = name;
    if (phone_number_id) fields.phone_number_id = phone_number_id;
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
    if (err.code === '23505') {
      const msg = UNIQUE_ERRORS[err.constraint] || 'Dato duplicado — verifica nombre, teléfono o email';
      return res.status(409).json({ ok: false, error: msg });
    }
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ── Productos ─────────────────────────────────────────────────────────────────

router.get('/tenants/:slug/products', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const tenantRow = await query('SELECT id FROM tenants WHERE slug = $1', [slug]);
    if (!tenantRow.rows[0]) {
      return res.status(404).json({ ok: false, error: 'Tenant no encontrado' });
    }

    const { rows } = await query(
      'SELECT * FROM products WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantRow.rows[0].id]
    );
    res.json({ ok: true, products: rows });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error listando productos');
    next(err);
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

// ── Bot config (sales persona) ────────────────────────────────────────────────

router.patch('/tenants/:slug/bot-config', async (req, res) => {
  try {
    const { slug } = req.params;
    const { sales_persona } = req.body || {};

    const tenant = await repo.findBySlug(slug);
    if (!tenant) {
      return res.status(404).json({ ok: false, error: 'Tenant no encontrado' });
    }

    const currentConfig = tenant.bot_config || {};
    if (!currentConfig.greeting || !currentConfig.escalation) {
      return res.status(400).json({
        ok: false,
        error: 'El tenant no tiene bot_config base (greeting + escalation). Configúralo primero.',
      });
    }

    const merged = { ...currentConfig, sales_persona };

    let validated;
    try {
      validated = validateBotConfig(merged);
    } catch (validErr) {
      return res.status(400).json({ ok: false, error: validErr.message });
    }

    await query(
      'UPDATE tenants SET bot_config = $1 WHERE id = $2',
      [JSON.stringify(validated), tenant.id]
    );

    loader.invalidate(slug);

    logger.info({ slug, updatedBy: req.panelUser.username }, '[Panel] sales_persona actualizado');
    res.json({ ok: true, bot_config: validated });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error actualizando bot-config');
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.get('/tenants/:slug/prompt-preview', async (req, res) => {
  try {
    const { slug } = req.params;

    const tenant = await repo.findBySlug(slug);
    if (!tenant) {
      return res.status(404).json({ ok: false, error: 'Tenant no encontrado' });
    }

    // Cargar productos para incluirlos en el preview
    const { rows: products } = await query(
      `SELECT p.id, p.name, p.description, p.price, p.sizes, p.emoji, p.active AS stock
       FROM products p WHERE p.tenant_id = $1 AND p.active = true
       ORDER BY p.created_at DESC`,
      [tenant.id]
    );

    const tenantWithProducts = { ...tenant, products };
    const prompt = buildSalesPrompt(tenantWithProducts);

    res.json({ ok: true, prompt });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error generando preview de prompt');
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ── Uso de IA ─────────────────────────────────────────────────────────────────

router.get('/tenants/:slug/ai-usage', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const tenantRow = await query('SELECT id FROM tenants WHERE slug = $1', [slug]);
    if (!tenantRow.rows[0]) {
      return res.status(404).json({ ok: false, error: 'Tenant no encontrado' });
    }

    const usage = await getUsage(slug);
    res.json({ ok: true, ...usage });
  } catch (err) {
    logger.error({ err: err.message }, '[Panel] Error obteniendo uso IA');
    next(err);
  }
});

module.exports = router;
