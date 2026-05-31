import express from 'express';
import platformData from '../../../packages/platform-data/index.js';
import sharedUtils from '@whatsapp-saas/shared-utils';
import loggerModule from '@whatsapp-saas/logger';

const tenantRepo = platformData.tenantRepository;
const tenantLoader = platformData.tenantLoader;
const { publishConfigUpdated } = platformData.tenantConfigEvents;
const { encrypt, normalizePhoneE164 } = sharedUtils;
const { logger } = loggerModule;

// Mapea errores UNIQUE de Postgres al campo específico para que el dashboard pueda
// devolver un mensaje accionable en vez del genérico "duplicate".
function mapDuplicateError(err) {
  const detail = `${err?.constraint || ''} ${err?.detail || ''} ${err?.message || ''}`.toLowerCase();
  if (detail.includes('slug')) return 'El slug ya existe';
  if (detail.includes('owner_phone')) return 'Ya existe un tenant con ese teléfono';
  if (detail.includes('owner_email')) return 'Ya existe un tenant con ese email';
  if (detail.includes('phone_number_id')) return 'phone_number_id ya está en uso por otro tenant';
  if (detail.includes('verify_token')) return 'verify_token colisionado, reintentá';
  if (detail.includes('name')) return 'Ya existe un tenant con ese nombre';
  return 'Conflicto de unicidad';
}

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const tenants = await tenantRepo.listAll();
    return res.json({ ok: true, data: tenants });
  } catch (err) {
    logger.error({ err: err.message }, '[Admin:Tenants] listAll error');
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const tenant = await tenantRepo.findBySlug(req.params.slug);
    if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant no encontrado' });
    return res.json({ ok: true, data: tenant });
  } catch (err) {
    logger.error({ slug: req.params.slug, err: err.message }, '[Admin:Tenants] findBySlug error');
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.post('/', async (req, res) => {
  const {
    slug,
    name,
    wa_token,
    phone_number_id,
    owner_phone,
    owner_email,
    bot_config,
    plan,
    cluster_code,
    database_name,
    schema_name,
    entitlements,
  } = req.body || {};

  // Mínimos obligatorios — wa_token y phone_number_id ahora son opcionales y se
  // configuran luego desde la tab WhatsApp del dashboard.
  if (!slug || !name || !owner_phone) {
    return res.status(400).json({
      ok: false,
      error: 'Faltan campos requeridos: slug, name, owner_phone',
    });
  }

  // Defensa: slug debe coincidir con la forma que produce slugify() y respetar
  // el varchar(64) de la columna.
  if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
    return res.status(400).json({
      ok: false,
      error: 'slug inválido (solo a-z, 0-9 y -; máximo 64 chars)',
    });
  }
  if (typeof name !== 'string' || name.length < 2 || name.length > 256) {
    return res.status(400).json({ ok: false, error: 'name debe tener entre 2 y 256 chars' });
  }

  // Validación E.164 (acepta variantes con espacios/guiones, normaliza al canónico)
  const owner_phone_norm = normalizePhoneE164(owner_phone);
  if (!owner_phone_norm) {
    return res.status(400).json({
      ok: false,
      error: 'owner_phone debe estar en formato internacional E.164 (ej. +573001234567)',
    });
  }

  const normalized_email = owner_email
    ? String(owner_email).trim().toLowerCase() || null
    : null;

  try {
    const wa_token_encrypted = wa_token ? encrypt(wa_token) : null;
    const verify_token = await tenantRepo.generateUniqueVerifyToken(slug);

    const tenant = await tenantRepo.create({
      slug,
      name,
      wa_token_encrypted,
      phone_number_id: phone_number_id || null,
      verify_token,
      owner_phone: owner_phone_norm,
      owner_email: normalized_email,
      bot_config: bot_config || {},
      plan,
      cluster_code,
      database_name,
      schema_name,
      entitlements,
    });

    logger.info({ slug }, '[Admin:Tenants] Tenant creado');
    return res.status(201).json({ ok: true, data: { ...tenant, verify_token } });
  } catch (err) {
    const isDuplicate = err.code === '23505' || err.message?.includes('duplicate');
    logger.warn({ slug, err: err.message }, '[Admin:Tenants] create error');
    return res.status(isDuplicate ? 409 : 500).json({
      ok: false,
      error: isDuplicate ? mapDuplicateError(err) : 'Error interno',
    });
  }
});

router.patch('/:slug', async (req, res) => {
  const { wa_token, ...rest } = req.body || {};
  const fields = { ...rest };

  if (wa_token) {
    fields.wa_token_encrypted = encrypt(wa_token);
  }

  // Si el patch toca owner_phone, validar y normalizar antes de ir a DB.
  if ('owner_phone' in fields && fields.owner_phone != null) {
    const norm = normalizePhoneE164(fields.owner_phone);
    if (!norm) {
      return res.status(400).json({
        ok: false,
        error: 'owner_phone debe estar en formato internacional E.164 (ej. +573001234567)',
      });
    }
    fields.owner_phone = norm;
  }

  if ('owner_email' in fields && fields.owner_email != null) {
    const email = String(fields.owner_email).trim().toLowerCase();
    fields.owner_email = email || null;
  }

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ ok: false, error: 'Incluye al menos un campo a actualizar' });
  }

  try {
    const updated = await tenantRepo.update(req.params.slug, fields);
    if (!updated) return res.status(404).json({ ok: false, error: 'Tenant no encontrado' });

    tenantLoader.invalidate(req.params.slug);
    void publishConfigUpdated(req.params.slug, 'api-core');

    return res.json({ ok: true, data: updated });
  } catch (err) {
    const isDuplicate = err.code === '23505' || err.message?.includes('duplicate');
    logger.error({ slug: req.params.slug, err: err.message }, '[Admin:Tenants] update error');
    return res.status(isDuplicate ? 409 : 500).json({
      ok: false,
      error: isDuplicate ? mapDuplicateError(err) : 'Error interno',
    });
  }
});

export default router;
