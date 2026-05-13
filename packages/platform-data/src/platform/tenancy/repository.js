'use strict';

const { randomBytes }  = require('crypto');
const { eq, and, sql } = require('drizzle-orm');
const { getDb }        = require('../../drizzle/db');
const { tenants } = require('../../drizzle/schema');
const { resolveTenantBySlug, toLegacyTenant } = require('./tenantResolver');
const { listActiveProducts } = require('../../tenant/repositories/catalogRepository');

/**
 * Carga un tenant con sus productos activos.
 * Desencripta wa_token antes de retornar.
 */
async function findBySlug(slug) {
  const tenantContext = await resolveTenantBySlug(slug);
  if (!tenantContext) return null;

  const tenantData = {
    products: await listActiveProducts(tenantContext),
  };

  return toLegacyTenant(tenantContext, tenantData);
}

/**
 * Genera un verify_token único garantizando que no exista en la BD.
 * Formato: {slug}-{16 bytes hex}  (~144 bits de entropía efectiva dado slug único)
 */
async function generateUniqueVerifyToken(slug) {
  const db = getDb();
  for (let i = 0; i < 5; i++) {
    const candidate = `${slug}-${randomBytes(16).toString('hex')}`;
    const rows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.verify_token, candidate))
      .limit(1);
    if (rows.length === 0) return candidate;
  }
  // Fallback con mayor entropía si por algún motivo los 5 intentos fallan
  return `${slug}-${randomBytes(32).toString('hex')}`;
}

/**
 * Crea un nuevo tenant.
 */
async function create(data) {
  const db = getDb();

  const rows = await db
    .insert(tenants)
    .values({
      slug:               data.slug,
      name:               data.name,
      wa_token_encrypted: data.wa_token_encrypted,
      phone_number_id:    data.phone_number_id,
      verify_token:       data.verify_token,
      owner_phone:        data.owner_phone,
      owner_email:        data.owner_email || null,
      bot_config:         data.bot_config || {},
    })
    .returning({
      id:         tenants.id,
      slug:       tenants.slug,
      name:       tenants.name,
      status:     tenants.status,
      created_at: tenants.created_at,
    });

  return rows[0];
}

/**
 * Actualiza campos de un tenant (parcial).
 */
async function update(slug, fields) {
  const db = getDb();

  const allowed = ['name', 'wa_token_encrypted', 'phone_number_id', 'verify_token',
                   'owner_phone', 'owner_email', 'bot_config', 'status',
                   'meta_live', 'meta_connected_at'];

  const patch = {};
  for (const k of allowed) {
    if (k in fields) patch[k] = fields[k];
  }

  if (Object.keys(patch).length === 0) return null;

  // Cuando meta_live se activa, fijar meta_connected_at solo si aún no estaba
  if (patch.meta_live === true) {
    patch.meta_connected_at = sql`COALESCE(${tenants.meta_connected_at}, NOW())`;
  }

  patch.updated_at = sql`NOW()`;

  const rows = await db
    .update(tenants)
    .set(patch)
    .where(eq(tenants.slug, slug))
    .returning({
      id:                tenants.id,
      slug:              tenants.slug,
      name:              tenants.name,
      status:            tenants.status,
      meta_live:         tenants.meta_live,
      meta_connected_at: tenants.meta_connected_at,
    });

  return rows[0] || null;
}

/**
 * Lista todos los tenants (sin tokens).
 */
async function listAll() {
  const db = getDb();

  return db
    .select({
      id:                tenants.id,
      slug:              tenants.slug,
      name:              tenants.name,
      status:            tenants.status,
      meta_live:         tenants.meta_live,
      meta_connected_at: tenants.meta_connected_at,
      owner_phone:       tenants.owner_phone,
      owner_email:       tenants.owner_email,
      verify_token:      tenants.verify_token,
      phone_number_id:   tenants.phone_number_id,
      bot_config:        tenants.bot_config,
      created_at:        tenants.created_at,
    })
    .from(tenants)
    .orderBy(sql`${tenants.created_at} DESC`);
}

module.exports = { findBySlug, create, update, listAll, generateUniqueVerifyToken };
