import express from 'express';
import { verifyMetaSignature } from './verifier.js';
import tenantLoader from '../../../tenants/loader.js';
import loggerModule from '../../../utils/logger.js';
import securityModule from '../../../middleware/security.js';
import { dispatch } from '../ingestion/dispatcher.js';

const { logger } = loggerModule;
const { validateSlug, ipRateLimit } = securityModule;

const router = express.Router({ mergeParams: true });

const webhookVerifyRateLimit = ipRateLimit({
  prefix: 'webhook-verify',
  max: parseInt(process.env.WEBHOOK_VERIFY_RATE_LIMIT || '15', 10),
  windowSec: 60,
});

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

router.post('/:slug', validateSlug, (req, res) => {
  const { slug } = req.params;

  const appSecret = process.env.META_APP_SECRET;
  if (appSecret && !verifyMetaSignature(req, appSecret)) {
    logger.warn({ tenantSlug: slug }, '[Webhook] Firma HMAC invalida - request rechazado');
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  setImmediate(async () => {
    try {
      const queueMode = (process.env.QUEUE_MODE || process.env.WHATSAPP_INBOUND_QUEUE_MODE || 'direct').toLowerCase();
      if (queueMode !== 'bullmq' && queueMode !== 'redis' && queueMode !== 'memory') {
        await dispatch(slug, req.body);
        return;
      }

      const { enqueueInboundWebhook } = await import('../../../queues/producers/whatsappInboundProducer.js');
      await enqueueInboundWebhook(slug, req.body);
    } catch (err) {
      logger.error({ tenantSlug: slug, err: err.message }, '[Webhook] Error encolando inbound');
    }
  });
});

export default router;
