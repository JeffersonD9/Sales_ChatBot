/**
 * tenants/repository.js — Queries SQL para tenants y productos
 *
 * Toda la interacción con la BD de tenants pasa por aquí.
 * El loader usa estas funciones y aplica su capa de cache encima.
 */

const { query }   = require('../db');
const { decrypt } = require('../utils/crypto');
const { logger }  = require('../utils/logger');

/**
 * Carga un tenant con sus productos activos.
 * Desencripta wa_token antes de retornar.
 *
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
async function findBySlug(slug) {
  const result = await query(
    `SELECT
       t.id,
       t.slug,
       t.name,
       t.status,
       t.wa_token_encrypted,
       t.phone_number_id,
       t.verify_token,
       t.owner_phone,
       t.owner_email,
       t.bot_config,
       COALESCE(
         json_agg(
           json_build_object(
             'id',          p.id,
             'name',        p.name,
             'description', p.description,
             'price',       p.price,
             'sizes',       p.sizes,
             'attributes',  p.attributes,
             'image_url',   p.image_url,
             'emoji',       p.emoji,
             'category',    p.category,
             'stock',       p.active
           ) ORDER BY p.price DESC
         ) FILTER (WHERE p.id IS NOT NULL),
         '[]'
       ) AS products
     FROM tenants t
     LEFT JOIN products p ON p.tenant_id = t.id AND p.active = true
     WHERE t.slug = $1 AND t.status = 'active'
     GROUP BY t.id`,
    [slug]
  );

  if (!result.rows[0]) return null;

  const tenant = result.rows[0];

  // Desencriptar token — nunca loguearlo
  try {
    tenant.wa_token = decrypt(tenant.wa_token_encrypted);
  } catch (err) {
    logger.error({ tenantSlug: slug, err: err.message }, '[Repo] Error desencriptando wa_token');
    tenant.wa_token = '';
  }
  delete tenant.wa_token_encrypted;

  return tenant;
}

/**
 * Crea un nuevo tenant.
 * @param {{ slug, name, wa_token_encrypted, phone_number_id, verify_token, owner_phone, owner_email, bot_config }} data
 * @returns {Promise<object>}
 */
async function create(data) {
  const result = await query(
    `INSERT INTO tenants
       (slug, name, wa_token_encrypted, phone_number_id, verify_token,
        owner_phone, owner_email, bot_config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, slug, name, status, created_at`,
    [
      data.slug,
      data.name,
      data.wa_token_encrypted,
      data.phone_number_id,
      data.verify_token,
      data.owner_phone,
      data.owner_email || null,
      JSON.stringify(data.bot_config || {}),
    ]
  );
  return result.rows[0];
}

/**
 * Actualiza campos de un tenant (parcial).
 * @param {string} slug
 * @param {object} fields - Campos a actualizar
 * @returns {Promise<object|null>}
 */
async function update(slug, fields) {
  const allowed = ['name', 'wa_token_encrypted', 'phone_number_id', 'verify_token',
                   'owner_phone', 'owner_email', 'bot_config', 'status',
                   'meta_live', 'meta_connected_at'];
  const keys   = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return null;

  // When activating meta_live, set meta_connected_at the first time only
  const extraSets = fields.meta_live === true
    ? ['meta_connected_at = COALESCE(meta_connected_at, NOW())']
    : [];

  const sets   = [...keys.map((k, i) => `${k} = $${i + 2}`), ...extraSets].join(', ');
  const values = keys.map((k) => k === 'bot_config' ? JSON.stringify(fields[k]) : fields[k]);

  const result = await query(
    `UPDATE tenants SET ${sets}, updated_at = NOW()
     WHERE slug = $1
     RETURNING id, slug, name, status, meta_live, meta_connected_at`,
    [slug, ...values]
  );
  return result.rows[0] || null;
}

/**
 * Lista todos los tenants (sin tokens).
 * @returns {Promise<object[]>}
 */
async function listAll() {
  const result = await query(
    `SELECT id, slug, name, status, meta_live, meta_connected_at,
            owner_phone, owner_email, bot_config, created_at
     FROM tenants ORDER BY created_at DESC`,
    []
  );
  return result.rows;
}

module.exports = { findBySlug, create, update, listAll };
