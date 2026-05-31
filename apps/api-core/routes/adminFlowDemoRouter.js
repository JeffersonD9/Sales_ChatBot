import express from 'express';
import { createRequire } from 'node:module';
import platformData from '../../../packages/platform-data/index.js';
import loggerModule from '@whatsapp-saas/logger';

const require = createRequire(import.meta.url);
const { getFlow, listFlows, DEFAULT_FLOW } = require('../../message-worker/core/flows/index.js');
const { runWithDemoCollector } = require('../../message-worker/core/whatsapp/sender.js');
const tenantLoader = platformData.tenantLoader;
const { logger } = loggerModule;

const router = express.Router();

function makeTextMessage(text) {
  return { type: 'text', text: { body: text } };
}

function makeInteractiveMessage(id, title) {
  return {
    type: 'interactive',
    interactive: {
      type: 'button_reply',
      button_reply: { id, title },
    },
  };
}

function makeDefaultSession(tenantSlug) {
  const now = Date.now();
  return {
    tenantSlug,
    waFrom: 'flow-demo-user',
    step: 'NEW',
    data: {},
    shownProducts: [],
    lastActivity: now,
    reactivationSent: false,
    createdAt: now,
  };
}

function makeNotifier() {
  const noop = async () => undefined;
  return {
    notifyLead: noop,
    notifyAdvisorRequest: noop,
    notifySale: noop,
    notifyNewLead: noop,
  };
}

function makeServices() {
  return {
    ai: {
      analyzeImage: null,
    },
  };
}

// ── Placeholder swap para el demo ──────────────────────────────────────────
// El engine arma URLs estilo "{storage_base_url}/images/tallas/L/001.jpg".
// En el demo no garantizamos que el tenant tenga CDN ni los archivos subidos,
// asi que cualquier URL no-http la mapeamos a picsum.photos con seed determinista
// (mismo path → siempre la misma imagen, no parpadea entre reloads).
function seedFromPath(value) {
  const cleaned = String(value || 'demo')
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\/?/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || 'demo';
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function normalizeDemoReplies(replies) {
  return replies.map((reply) => {
    if (reply?.type === 'image' && !isHttpUrl(reply.url)) {
      return { ...reply, url: `https://picsum.photos/seed/${seedFromPath(reply.url)}/600/750` };
    }
    if (reply?.type === 'audio' && !isHttpUrl(reply.url)) {
      // Audio placeholder publico — el UI muestra el nombre, no reproduce.
      return { ...reply, url: 'https://www.w3schools.com/html/horse.ogg' };
    }
    return reply;
  });
}

function validSession(input) {
  if (!input || typeof input !== 'object') return null;
  if (typeof input.step !== 'string') return null;
  return {
    tenantSlug: String(input.tenantSlug || ''),
    waFrom: String(input.waFrom || 'flow-demo-user'),
    step: input.step,
    data: input.data && typeof input.data === 'object' ? input.data : {},
    shownProducts: Array.isArray(input.shownProducts) ? input.shownProducts : [],
    lastActivity: Number(input.lastActivity) || Date.now(),
    reactivationSent: Boolean(input.reactivationSent),
    createdAt: Number(input.createdAt) || Date.now(),
  };
}

router.get('/:slug/flow-demo', async (req, res) => {
  try {
    const tenant = await tenantLoader.get(req.params.slug);
    if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant no encontrado' });

    return res.json({
      ok: true,
      data: {
        defaultFlow: DEFAULT_FLOW,
        currentFlow: tenant.bot_config?.flow_type || tenant.botConfig?.flow_type || DEFAULT_FLOW,
        flows: listFlows(),
      },
    });
  } catch (err) {
    logger.error({ slug: req.params.slug, err: err.message }, '[Admin:FlowDemo] get error');
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.post('/:slug/flow-demo', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message || message.length > 2000) {
    return res.status(400).json({ ok: false, error: 'Mensaje invalido' });
  }

  try {
    const tenant = await tenantLoader.get(req.params.slug);
    if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant no encontrado' });

    const flowType = String(
      req.body?.flowType || tenant.bot_config?.flow_type || tenant.botConfig?.flow_type || DEFAULT_FLOW,
    );
    const { engine } = getFlow(flowType);
    const session = validSession(req.body?.session) || makeDefaultSession(tenant.slug);
    const demoTenant = {
      ...tenant,
      bot_config: { ...(tenant.bot_config || tenant.botConfig || {}), flow_type: flowType },
      botConfig: { ...(tenant.botConfig || tenant.bot_config || {}), flow_type: flowType },
      wa_token: 'DEMO_TOKEN',
      phone_number_id: tenant.phone_number_id || 'DEMO_PHONE_NUMBER_ID',
      products: (tenant.products || []).map((product) => ({
        ...product,
        stock: product.stock ?? product.active ?? true,
        original_price: product.original_price ?? product.price,
      })),
    };
    const rawMsg = req.body?.interactiveId
      ? makeInteractiveMessage(String(req.body.interactiveId), String(req.body.interactiveTitle || message))
      : makeTextMessage(message);

    const replies = [];

    await runWithDemoCollector(replies, async () => {
      await engine.processMessage(
        'flow-demo-user',
        rawMsg,
        session,
        demoTenant,
        makeNotifier(),
        makeServices(),
      );
    });

    session.lastActivity = Date.now();
    return res.json({ ok: true, data: { flowType, replies: normalizeDemoReplies(replies), session } });
  } catch (err) {
    logger.error({ slug: req.params.slug, err: err.message }, '[Admin:FlowDemo] post error');
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

export default router;
