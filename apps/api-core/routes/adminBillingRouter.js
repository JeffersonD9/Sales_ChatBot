import express from 'express';
import platformData from '../../../packages/platform-data/index.js';
import loggerModule from '@whatsapp-saas/logger';

const { checkBillingCycle, recordPayment } = platformData.billingService;
const { logger } = loggerModule;

const router = express.Router();

router.post('/check', async (_req, res) => {
  try {
    await checkBillingCycle();
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err.message }, '[Admin:Billing] checkBillingCycle error');
    return res.status(500).json({ ok: false, error: 'Error en ciclo de facturación' });
  }
});

router.post('/:slug/payment', async (req, res) => {
  const { amount } = req.body || {};

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ ok: false, error: 'Campo requerido: amount (número positivo)' });
  }

  try {
    const tenant = await recordPayment(req.params.slug, amount);
    if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant no encontrado' });
    logger.info({ slug: req.params.slug, amount }, '[Admin:Billing] Pago registrado');
    return res.json({
      ok: true,
      data: { slug: req.params.slug, amount, next_billing_date: tenant.next_billing_date },
    });
  } catch (err) {
    logger.error({ slug: req.params.slug, err: err.message }, '[Admin:Billing] recordPayment error');
    return res.status(500).json({ ok: false, error: 'Error registrando pago' });
  }
});

export default router;
