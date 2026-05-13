import express from 'express';
import platformData from '../../../packages/platform-data/index.js';
import { securityHeaders } from '@whatsapp-saas/http-runtime/security.js';
import loggerModule from '@whatsapp-saas/logger';

const configRepo = platformData.whatsappConfigRepository;
const { requireTenantAuth, tenantRateLimit } = platformData.tenantAuth;
const { logger } = loggerModule;

const router = express.Router();
router.use(securityHeaders());
router.use(requireTenantAuth);
router.use(tenantRateLimit);

router.get('/config', async (req, res) => {
  try {
    const config = await configRepo.getConfigForTenant(req.tenantContext);
    if (!config) return res.status(404).json({ ok: false, error: 'Config no encontrada' });
    const { tenant_id, bot_config, is_active, created_at, updated_at } = config;
    return res.json({ ok: true, data: { tenant_id, bot_config, is_active, created_at, updated_at } });
  } catch (err) {
    logger.error({ tenantId: req.tenantId, err: err.message }, '[ConfigRouter] GET error');
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.put('/config', async (req, res) => {
  const { session_data, bot_config, webhook_secret, is_active } = req.body || {};
  if ([session_data, bot_config, webhook_secret, is_active].every((v) => v === undefined)) {
    return res.status(400).json({ ok: false, error: 'Incluye al menos un campo a actualizar' });
  }
  try {
    const updated = await configRepo.saveConfigForTenant(req.tenantContext, {
      session_data, bot_config, webhook_secret, is_active,
    });
    return res.json({
      ok: true,
      data: {
        tenant_id: updated.tenant_id,
        bot_config: updated.bot_config,
        is_active: updated.is_active,
        updated_at: updated.updated_at,
      },
    });
  } catch (err) {
    const isValidation = err.message.startsWith('bot_config invalido') || err.message.startsWith('bot_config inválido');
    logger.warn({ tenantId: req.tenantId, err: err.message }, '[ConfigRouter] PUT error');
    return res.status(isValidation ? 400 : 500).json({
      ok: false,
      error: isValidation ? err.message : 'Error interno',
    });
  }
});

router.delete('/config', async (req, res) => {
  try {
    const deleted = await configRepo.deleteConfigForTenant(req.tenantContext);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Config no encontrada' });
    return res.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    logger.error({ tenantId: req.tenantId, err: err.message }, '[ConfigRouter] DELETE error');
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

export default router;
