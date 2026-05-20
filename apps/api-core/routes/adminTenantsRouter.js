import express from 'express';
import platformData from '../../../packages/platform-data/index.js';
import cryptoModule from '@whatsapp-saas/shared-utils';
import loggerModule from '@whatsapp-saas/logger';

const tenantRepo = platformData.tenantRepository;
const tenantLoader = platformData.tenantLoader;
const { publishConfigUpdated } = platformData.tenantConfigEvents;
const { encrypt } = cryptoModule;
const { logger } = loggerModule;

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

  if (!slug || !name || !wa_token || !phone_number_id || !owner_phone) {
    return res.status(400).json({
      ok: false,
      error: 'Faltan campos requeridos: slug, name, wa_token, phone_number_id, owner_phone',
    });
  }

  try {
    const wa_token_encrypted = encrypt(wa_token);
    const verify_token = await tenantRepo.generateUniqueVerifyToken(slug);

    const tenant = await tenantRepo.create({
      slug,
      name,
      wa_token_encrypted,
      phone_number_id,
      verify_token,
      owner_phone,
      owner_email,
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
      error: isDuplicate ? 'El slug ya existe' : 'Error interno',
    });
  }
});

router.patch('/:slug', async (req, res) => {
  const { wa_token, ...rest } = req.body || {};
  const fields = { ...rest };

  if (wa_token) {
    fields.wa_token_encrypted = encrypt(wa_token);
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
    logger.error({ slug: req.params.slug, err: err.message }, '[Admin:Tenants] update error');
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

export default router;
