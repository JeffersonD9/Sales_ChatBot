/**
 * Cliente de salida WhatsApp.
 *
 * Todas las funciones aceptan `tenant` como ultimo parametro. Los tokens no se
 * leen de process.env sino del tenant, para operar multiples cuentas.
 */

const axios = require('axios');
const { AsyncLocalStorage } = require('node:async_hooks');
const { logger } = require('@whatsapp-saas/logger');
const antiBanGuard = require('../../../../packages/platform-data/src/integrations/whatsapp/antiBanGuard');
const { createLocalVpsStorageAdapter } = require('../../../../packages/platform-data/src/media/storage');

const META_BASE_URL = process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com/v20.0';
const D360_BASE_URL = process.env.D360_BASE_URL || 'https://waba-v2.360dialog.io';
const demoCollectorStorage = global.__demoCollectorStorage || new AsyncLocalStorage();
global.__demoCollectorStorage = demoCollectorStorage;

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function isDemoMode(tenant) {
  return (
    process.env.DEMO_MODE === 'true' ||
    process.env.COLLECTING_DEMO === 'true' ||
    tenant?.wa_token === 'DEMO_TOKEN'
  );
}

function collectDemo(simplified) {
  const scopedCollector = demoCollectorStorage.getStore();
  if (scopedCollector) {
    scopedCollector.push(simplified);
    return;
  }
  if (global.demoCollector) {
    global.demoCollector.push(simplified);
  }
}

function runWithDemoCollector(collector, fn) {
  return demoCollectorStorage.run(collector, fn);
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (['360dialog', '360_dialog', 'd360', 'dialog360'].includes(provider)) return '360dialog';
  return 'meta';
}

function getProvider(tenant) {
  return normalizeProvider(
    tenant?.whatsapp?.provider ||
    tenant?.bot_config?.whatsapp_provider ||
    tenant?.botConfig?.whatsapp_provider ||
    tenant?.bot_config?.whatsapp?.provider ||
    tenant?.botConfig?.whatsapp?.provider ||
    process.env.WHATSAPP_PROVIDER ||
    'meta'
  );
}

function tokenForProvider(tenant, provider) {
  return (
    tenant?.whatsapp?.apiKey ||
    tenant?.whatsapp?.token ||
    tenant?.wa_token ||
    tenant?.bot_config?.d360_api_key ||
    tenant?.botConfig?.d360_api_key ||
    (provider === '360dialog' ? process.env.D360_API_KEY : process.env.META_ACCESS_TOKEN)
  );
}

function resolveMediaUrl(url, tenant) {
  try {
    return createLocalVpsStorageAdapter().resolveFinalUrl(url);
  } catch (err) {
    if (process.env.MEDIA_STORAGE_PUBLIC_BASE_URL && process.env.MEDIA_STORAGE_BASE_PATH) {
      logger.warn({ tenantSlug: tenant?.slug, err: err.message }, '[Sender] No se pudo resolver media local');
    }
    return url;
  }
}

function requestForProvider(phone, payload, tenant) {
  const provider = getProvider(tenant);
  const token = tokenForProvider(tenant, provider);
  const { _antiBanBypass, ...publicPayload } = payload;
  const body = { messaging_product: 'whatsapp', to: phone, ...publicPayload };

  if (provider === '360dialog') {
    return {
      provider,
      token,
      url: `${D360_BASE_URL}/messages`,
      body,
      headers: {
        'D360-API-KEY': token,
        'Content-Type': 'application/json',
      },
    };
  }

  return {
    provider,
    token,
    url: `${META_BASE_URL}/${tenant.phone_number_id}/messages`,
    body,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
}

async function _callWhatsApp(phone, payload, tenant) {
  const startedAt = process.hrtime.bigint();
  const request = requestForProvider(phone, payload, tenant);

  if (!request.token) {
    throw new Error(`Falta token/API key para proveedor WhatsApp ${request.provider}`);
  }

  const guard = await antiBanGuard.beforeSend(phone, payload, tenant);
  if (!guard.allowed) {
    return { skipped: true, reason: guard.reason };
  }

  try {
    const res = await axios.post(request.url, request.body, { headers: request.headers });
    logger.info({
      metric: 'whatsapp.outbound.sent',
      provider: request.provider,
      tenantSlug: tenant.slug,
      phone,
      type: payload.type,
      durationMs: Math.round(elapsedMs(startedAt)),
      status: res.status,
    }, '[Sender] Mensaje enviado a WhatsApp');
    return antiBanGuard.afterSend(phone, payload, tenant, res.data);
  } catch (err) {
    const antiBanAction = await antiBanGuard.handleApiError(err, tenant, phone);
    const detail = err.response?.data || err.message;
    logger.error({
      metric: 'whatsapp.outbound.failed',
      provider: request.provider,
      tenantSlug: tenant.slug,
      phone,
      type: payload.type,
      durationMs: Math.round(elapsedMs(startedAt)),
      status: err.response?.status,
      antiBanAction: antiBanAction?.action,
      detail,
    }, '[Sender] Error WhatsApp API');
    throw err;
  }
}

async function sendText(phone, text, tenant, options = {}) {
  if (isDemoMode(tenant)) {
    collectDemo({ type: 'text', content: text });
    return;
  }
  return _callWhatsApp(phone, { type: 'text', text: { body: text, preview_url: false }, _antiBanBypass: options.antiBanBypass === true }, tenant);
}

async function sendImage(phone, imageUrl, caption = '', tenant) {
  const finalUrl = resolveMediaUrl(imageUrl, tenant);
  if (isDemoMode(tenant)) {
    collectDemo({ type: 'image', url: finalUrl, caption });
    return;
  }
  return _callWhatsApp(phone, { type: 'image', image: { link: finalUrl, caption } }, tenant);
}

async function sendInteractiveButtons(phone, bodyText, buttons, tenant) {
  if (isDemoMode(tenant)) {
    collectDemo({ type: 'buttons', text: bodyText, buttons });
    return;
  }
  return _callWhatsApp(phone, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((button) => ({
          type: 'reply',
          reply: { id: button.id, title: button.title },
        })),
      },
    },
  }, tenant);
}

async function sendInteractiveList(phone, bodyText, buttonText, sections, tenant) {
  if (isDemoMode(tenant)) {
    collectDemo({ type: 'list', text: bodyText, buttonText, sections });
    return;
  }
  return _callWhatsApp(phone, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: { button: buttonText, sections },
    },
  }, tenant);
}

async function sendAudio(phone, audioUrl, tenant) {
  const finalUrl = resolveMediaUrl(audioUrl, tenant);
  if (isDemoMode(tenant)) {
    collectDemo({ type: 'audio', url: finalUrl });
    return;
  }
  return _callWhatsApp(phone, { type: 'audio', audio: { link: finalUrl } }, tenant);
}

module.exports = {
  sendText,
  sendImage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendAudio,
  getProvider,
  requestForProvider,
  runWithDemoCollector,
};
