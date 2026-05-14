import express from 'express';
import { verifyMetaSignature } from './verifier.js';
import platformData from '../../../packages/platform-data/index.js';
import loggerModule from '@whatsapp-saas/logger';
import { validateSlug, ipRateLimit } from '@whatsapp-saas/http-runtime/security.js';

const tenantLoader = platformData.tenantLoader;
const { logger } = loggerModule;

const router = express.Router({ mergeParams: true });

const webhookVerifyRateLimit = ipRateLimit({
  prefix: 'webhook-verify',
  max: parseInt(process.env.WEBHOOK_VERIFY_RATE_LIMIT || '15', 10),
  windowSec: 60,
});

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (['360dialog', '360_dialog', 'd360', 'dialog360'].includes(provider)) return '360dialog';
  return 'meta';
}

function tenantProvider(tenant) {
  return normalizeProvider(
    tenant?.whatsapp?.provider ||
    tenant?.bot_config?.whatsapp_provider ||
    tenant?.botConfig?.whatsapp_provider ||
    process.env.WHATSAPP_PROVIDER ||
    'meta'
  );
}

function verify360DialogWebhook(req) {
  const expectedAuthorization = process.env.D360_WEBHOOK_AUTHORIZATION;
  if (!expectedAuthorization) return true;
  return req.get('authorization') === expectedAuthorization;
}

router.get('/:slug', validateSlug, webhookVerifyRateLimit, async (req, res) => {
  const { slug } = req.params;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe') return res.sendStatus(400);

  const tenant = await tenantLoader.get(slug);
  if (!tenant) {
    logger.warn({ tenantSlug: slug }, '[Webhook] Verificacion fallida - tenant no encontrado');
    return res.sendStatus(404);
  }

  if (token === tenant.verify_token) {
    logger.info({ tenantSlug: slug }, '[Webhook] Verificacion exitosa');
    return res.status(200).send(challenge);
  }

  logger.warn({ tenantSlug: slug }, '[Webhook] Token incorrecto - verificacion rechazada');
  return res.sendStatus(403);
});

router.post('/:slug', validateSlug, async (req, res) => {
  const { slug } = req.params;
  const tenant = await tenantLoader.get(slug);
  const provider = tenantProvider(tenant);

  if (!tenant) {
    logger.warn({ tenantSlug: slug }, '[Webhook] POST rechazado - tenant no encontrado');
    return res.sendStatus(404);
  }

  if (provider === '360dialog' && !verify360DialogWebhook(req)) {
    logger.warn({ tenantSlug: slug, provider }, '[Webhook] Header 360dialog invalido - request rechazado');
    return res.sendStatus(401);
  }

  const appSecret = process.env.META_APP_SECRET;
  if (provider === 'meta' && appSecret && !verifyMetaSignature(req, appSecret)) {
    logger.warn({ tenantSlug: slug, provider }, '[Webhook] Firma HMAC invalida - request rechazado');
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  setImmediate(async () => {
    try {
      const { enqueueInboundWebhook } = await import('../producers/whatsappInboundProducer.js');
      await enqueueInboundWebhook(slug, req.body);
    } catch (err) {
      logger.error({ tenantSlug: slug, err: err.message }, '[Webhook] Error encolando inbound');
    }
  });
});

export default router;
