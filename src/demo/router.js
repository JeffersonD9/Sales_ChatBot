/**
 * demo/router.js — Endpoints para la UI de prueba local
 *
 * Solo activo cuando DEMO_MODE=true.
 * Simula el flujo completo sin necesitar tokens de Meta ni webhooks reales.
 *
 * Rutas:
 *   POST /demo/chat         — mensaje de texto libre
 *   POST /demo/interactive  — clic en botón o ítem de lista
 *   POST /demo/reset        — reiniciar la sesión del usuario
 */

const express              = require('express');
const { get: getTenant }   = require('../tenants/loader');
const { getState, saveState, clearState } = require('../core/state/manager');
const { processMessage }   = require('../core/flow-engine/engine');
const { logger }           = require('../utils/logger');

const router = express.Router();

const DEMO_SLUG = process.env.DEMO_SLUG || 'demo-store';

// ── Middleware: solo en demo mode ─────────────────────────────────────────
router.use((_req, res, next) => {
  if (process.env.DEMO_MODE !== 'true') {
    return res.status(403).json({ error: 'Demo mode está desactivado' });
  }
  next();
});

// ── Captura las respuestas que el bot enviaría por WhatsApp ───────────────
async function runWithCollector(phone, rawMsg) {
  global.demoCollector = [];

  const tenant  = await getTenant(DEMO_SLUG);
  const session = await getState(DEMO_SLUG, phone);

  await processMessage(phone, rawMsg, session, tenant, _noopNotifier);
  await saveState(DEMO_SLUG, phone, session);

  const responses = [...global.demoCollector];
  global.demoCollector = [];
  return responses;
}

// ── Notifier noop (no enviar emails/WhatsApp al dueño en demo) ────────────
const _noopNotifier = {
  notifySale:           async () => {},
  notifyAdvisorRequest: async () => {},
  notifyLead:           async () => {},
};

// ── POST /demo/chat — texto libre ─────────────────────────────────────────
router.post('/chat', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'Faltan phone o message' });
  }

  try {
    const rawMsg = {
      id:   `demo_${Date.now()}`,
      type: 'text',
      text: { body: message },
      from: phone,
    };
    const responses = await runWithCollector(phone, rawMsg);
    res.json({ responses });
  } catch (err) {
    logger.error({ err: err.message }, '[Demo] Error en /demo/chat');
    res.status(500).json({ error: err.message, responses: [] });
  }
});

// ── POST /demo/interactive — botón o ítem de lista ────────────────────────
router.post('/interactive', async (req, res) => {
  const { phone, id, title, interactiveType } = req.body;
  if (!phone || !id) {
    return res.status(400).json({ error: 'Faltan phone o id' });
  }

  try {
    const rawMsg = {
      id:   `demo_${Date.now()}`,
      type: 'interactive',
      from: phone,
      interactive: {
        type: interactiveType === 'list_reply' ? 'list_reply' : 'button_reply',
        [interactiveType === 'list_reply' ? 'list_reply' : 'button_reply']: {
          id,
          title: title || id,
        },
      },
    };
    const responses = await runWithCollector(phone, rawMsg);
    res.json({ responses });
  } catch (err) {
    logger.error({ err: err.message }, '[Demo] Error en /demo/interactive');
    res.status(500).json({ error: err.message, responses: [] });
  }
});

// ── POST /demo/reset — reiniciar sesión ───────────────────────────────────
router.post('/reset', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Falta phone' });

  try {
    await clearState(DEMO_SLUG, phone);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
