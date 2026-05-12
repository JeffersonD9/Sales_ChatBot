/**
 * core/whatsapp/sender.js — Cliente de la API de WhatsApp Cloud (Meta)
 *
 * CAMBIO CRÍTICO vs. el original:
 * Todas las funciones aceptan `tenant` como último parámetro.
 * Los tokens ya no se leen de process.env sino del objeto tenant,
 * lo que permite operar múltiples cuentas de Meta en el mismo proceso.
 *
 * En DEMO_MODE: las respuestas pueden ir a global.demoCollector si un harness local lo define.
 */

const axios   = require('axios');
const { logger } = require('../../utils/logger');

const BASE_URL = 'https://graph.facebook.com/v20.0';

// ── Demo mode ─────────────────────────────────────────────────────────────

function isDemoMode(tenant) {
  return (
    process.env.DEMO_MODE === 'true' ||
    process.env.COLLECTING_DEMO === 'true' ||
    tenant?.wa_token === 'DEMO_TOKEN'
  );
}

function collectDemo(simplified) {
  if (global.demoCollector) {
    global.demoCollector.push(simplified);
  }
}

// ── Llamada a Meta API ────────────────────────────────────────────────────

async function _callMeta(phone, payload, tenant) {
  const url  = `${BASE_URL}/${tenant.phone_number_id}/messages`;
  const body = { messaging_product: 'whatsapp', to: phone, ...payload };

  try {
    const res = await axios.post(url, body, {
      headers: {
        Authorization:  `Bearer ${tenant.wa_token}`,
        'Content-Type': 'application/json',
      },
    });
    return res.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error({ tenantSlug: tenant.slug, phone, detail }, '[Sender] Error Meta API');
    throw err;
  }
}

// ── API pública ───────────────────────────────────────────────────────────

async function sendText(phone, text, tenant) {
  if (isDemoMode(tenant)) {
    collectDemo({ type: 'text', content: text });
    return;
  }
  return _callMeta(phone, { type: 'text', text: { body: text, preview_url: false } }, tenant);
}

async function sendImage(phone, imageUrl, caption = '', tenant) {
  if (isDemoMode(tenant)) {
    collectDemo({ type: 'image', url: imageUrl, caption });
    return;
  }
  return _callMeta(phone, { type: 'image', image: { link: imageUrl, caption } }, tenant);
}

/**
 * @param {string} phone
 * @param {string} bodyText
 * @param {Array<{id:string, title:string}>} buttons
 * @param {object} tenant
 */
async function sendInteractiveButtons(phone, bodyText, buttons, tenant) {
  if (isDemoMode(tenant)) {
    collectDemo({ type: 'buttons', text: bodyText, buttons });
    return;
  }
  return _callMeta(phone, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
      },
    },
  }, tenant);
}

/**
 * @param {string} phone
 * @param {string} bodyText
 * @param {string} buttonText
 * @param {Array<{title:string, rows:Array<{id,title,description}>}>} sections
 * @param {object} tenant
 */
async function sendInteractiveList(phone, bodyText, buttonText, sections, tenant) {
  if (isDemoMode(tenant)) {
    collectDemo({ type: 'list', text: bodyText, buttonText, sections });
    return;
  }
  return _callMeta(phone, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: { button: buttonText, sections },
    },
  }, tenant);
}

module.exports = { sendText, sendImage, sendInteractiveButtons, sendInteractiveList };
