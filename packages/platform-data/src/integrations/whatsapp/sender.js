'use strict';

/**
 * WhatsApp Cloud API client (Meta).
 *
 * All functions accept `tenant` as the last argument so the same process
 * can serve multiple accounts without reading from process.env.
 *
 * In DEMO_MODE responses go to global.demoCollector when defined.
 */

const axios      = require('axios');
const { logger } = require('@whatsapp-saas/logger');

const BASE_URL = 'https://graph.facebook.com/v20.0';

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

async function sendText(phone, text, tenant) {
  if (isDemoMode(tenant)) { collectDemo({ type: 'text', content: text }); return; }
  return _callMeta(phone, { type: 'text', text: { body: text, preview_url: false } }, tenant);
}

async function sendImage(phone, imageUrl, caption = '', tenant) {
  if (isDemoMode(tenant)) { collectDemo({ type: 'image', url: imageUrl, caption }); return; }
  return _callMeta(phone, { type: 'image', image: { link: imageUrl, caption } }, tenant);
}

async function sendInteractiveButtons(phone, bodyText, buttons, tenant) {
  if (isDemoMode(tenant)) { collectDemo({ type: 'buttons', text: bodyText, buttons }); return; }
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

async function sendAudio(phone, audioUrl, tenant) {
  if (isDemoMode(tenant)) { collectDemo({ type: 'audio', url: audioUrl }); return; }
  return _callMeta(phone, { type: 'audio', audio: { link: audioUrl } }, tenant);
}

module.exports = { sendText, sendImage, sendInteractiveButtons, sendInteractiveList, sendAudio };
