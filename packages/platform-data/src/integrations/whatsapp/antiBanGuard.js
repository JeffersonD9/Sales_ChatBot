'use strict';

const { logger } = require('@whatsapp-saas/logger');
const redisModule = require('../../redis');

const MEMORY = {
  suppression: new Map(),
  outbound: new Map(),
  rate: new Map(),
};

const OPT_OUT_KEYWORDS = [
  'stop', 'baja', 'cancelar', 'no mas', 'no más', 'no quiero', 'eliminar',
  'no me escribas', 'no me mandes', 'quitar', 'salir', 'dejar',
  'unsubscribe', 'remove', 'opt out', 'optout',
  'parar', 'remover',
];

const HUMAN_KEYWORDS = [
  'asesor', 'humano', 'persona', 'agente', 'soporte', 'ayuda',
  'queja', 'reclamo', 'problema',
];

const COUNTRY_TIMEZONE_MAP = {
  57: 'America/Bogota',
  52: 'America/Mexico_City',
  54: 'America/Argentina/Buenos_Aires',
  55: 'America/Sao_Paulo',
  51: 'America/Lima',
  56: 'America/Santiago',
  58: 'America/Caracas',
  593: 'America/Guayaquil',
  34: 'Europe/Madrid',
  1: 'America/New_York',
};

const ERROR_ACTIONS = {
  130429: { action: 'rate_limit', pauseMs: 60_000, rateMultiplier: 0.7 },
  131031: { action: 'restricted', critical: true },
  131047: { action: 'outside_customer_care_window' },
  131048: { action: 'spam_rate_limit', critical: true, suppressReason: 'spam_complaint' },
  131049: { action: 'message_quality', rateMultiplier: 0.6 },
  131050: { action: 'recipient_marketing_opt_out', suppressReason: 'opt_out' },
  132000: { action: 'template_error', noRetry: true },
  132001: { action: 'template_error', noRetry: true },
  132005: { action: 'template_error', noRetry: true },
  132007: { action: 'template_error', noRetry: true },
  132012: { action: 'template_error', noRetry: true },
  132015: { action: 'template_paused', noRetry: true, rateMultiplier: 0.5 },
  132016: { action: 'template_disabled', noRetry: true, rateMultiplier: 0.5 },
  132068: { action: 'flow_blocked', noRetry: true, rateMultiplier: 0.5 },
  132069: { action: 'flow_throttled', rateMultiplier: 0.5 },
};

function antiBanEnabled() {
  if (process.env.NODE_ENV === 'test' && process.env.WHATSAPP_ANTIBAN_TEST_ENABLED !== 'true') return false;
  return process.env.WHATSAPP_ANTIBAN_ENABLED !== 'false';
}

function shouldDelay() {
  return antiBanEnabled() && process.env.NODE_ENV !== 'test';
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTenantSlug(tenant) {
  return tenant?.slug || tenant?.tenantSlug || 'unknown';
}

function phoneNumberIdForTenant(tenant) {
  return tenant?.phone_number_id || tenant?.whatsapp?.phoneNumberId || tenant?.whatsapp?.phone_number_id || 'default';
}

function getRedis() {
  try {
    return redisModule.getRedis();
  } catch (err) {
    logger.warn({ err: err.message }, '[AntiBan] Redis no disponible, usando memoria local');
    return null;
  }
}

function suppressionKey(tenant, phone) {
  return `wa:suppress:${getTenantSlug(tenant)}:${normalizePhone(phone)}`;
}

function outboundKey(tenant, phone) {
  return `wa:outbound:${getTenantSlug(tenant)}:${normalizePhone(phone)}`;
}

function rateKey(tenant) {
  return `${getTenantSlug(tenant)}:${phoneNumberIdForTenant(tenant)}`;
}

function tierMaxRate(tenant) {
  const tier = Number(tenant?.bot_config?.whatsapp_tier || tenant?.botConfig?.whatsapp_tier || process.env.WHATSAPP_TIER || 1);
  if (tier >= 3) return 500;
  if (tier === 2) return 200;
  return 60;
}

function getRateState(tenant) {
  const key = rateKey(tenant);
  const existing = MEMORY.rate.get(key);
  if (existing) return existing;

  const maxRate = Number(process.env.WHATSAPP_MAX_RATE_PER_MIN || tierMaxRate(tenant));
  const state = {
    currentRate: Math.max(10, maxRate * 0.8),
    nextSendAt: 0,
    pausedUntil: 0,
    window: [],
  };
  MEMORY.rate.set(key, state);
  return state;
}

function getCountryTimezone(phone) {
  const normalized = normalizePhone(phone);
  for (const len of [3, 2, 1]) {
    const code = normalized.slice(0, len);
    if (COUNTRY_TIMEZONE_MAP[code]) return COUNTRY_TIMEZONE_MAP[code];
  }
  return process.env.DEFAULT_RECIPIENT_TIMEZONE || 'America/Bogota';
}

function localHourForPhone(phone) {
  const timeZone = getCountryTimezone(phone);
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).format(new Date());
  return Number(value);
}

function isWithinSendWindow(phone, tenant) {
  const enabled = tenant?.bot_config?.enforce_send_window === true ||
    tenant?.botConfig?.enforce_send_window === true ||
    process.env.WHATSAPP_SEND_WINDOW_ENABLED === 'true';
  if (!enabled) return true;
  const start = Number(tenant?.bot_config?.send_window_start || tenant?.botConfig?.send_window_start || process.env.WHATSAPP_SEND_WINDOW_START || 9);
  const end = Number(tenant?.bot_config?.send_window_end || tenant?.botConfig?.send_window_end || process.env.WHATSAPP_SEND_WINDOW_END || 20);
  const hour = localHourForPhone(phone);
  return hour >= start && hour < end;
}

function isOptOutText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return OPT_OUT_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function asksForHuman(text) {
  const normalized = normalizeText(text);
  return HUMAN_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)));
}

async function addSuppression(tenant, phone, reason = 'opt_out') {
  const key = suppressionKey(tenant, phone);
  const redis = getRedis();
  const payload = JSON.stringify({ reason, at: new Date().toISOString() });
  const ttlByReason = {
    opt_out: 0,
    spam_complaint: 0,
    bounced: 30 * 86400,
    cooling: 7 * 86400,
  };
  const ttl = ttlByReason[reason] ?? 0;

  if (redis) {
    if (ttl > 0) await redis.set(key, payload, 'EX', ttl);
    else await redis.set(key, payload);
  } else {
    MEMORY.suppression.set(key, payload);
  }

  logger.warn({ tenantSlug: getTenantSlug(tenant), phone: normalizePhone(phone), reason }, '[AntiBan] Numero agregado a suppression list');
}

async function isSuppressed(tenant, phone) {
  const key = suppressionKey(tenant, phone);
  const redis = getRedis();
  if (redis) return (await redis.exists(key)) === 1;
  return MEMORY.suppression.has(key);
}

async function markInboundReply(tenant, phone) {
  const redis = getRedis();
  const key = outboundKey(tenant, phone);

  if (redis) {
    await redis.del(key);
  } else {
    MEMORY.outbound.delete(key);
  }
}

async function incrementOutboundWithoutReply(tenant, phone) {
  const redis = getRedis();
  const key = outboundKey(tenant, phone);
  const ttlSeconds = Number(process.env.WHATSAPP_OUTBOUND_GUARD_TTL_SECONDS || 24 * 3600);

  if (redis) {
    const value = await redis.incr(key);
    await redis.expire(key, ttlSeconds);
    return value;
  }

  const now = Date.now();
  const existing = MEMORY.outbound.get(key);
  if (!existing || existing.expiresAt <= now) {
    MEMORY.outbound.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

async function outboundWithoutReplyCount(tenant, phone) {
  const redis = getRedis();
  const key = outboundKey(tenant, phone);
  if (redis) return Number(await redis.get(key)) || 0;

  const existing = MEMORY.outbound.get(key);
  if (!existing || existing.expiresAt <= Date.now()) return 0;
  return existing.count;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(tenant) {
  if (!shouldDelay()) return;

  const state = getRateState(tenant);
  const now = Date.now();
  const waitForPause = Math.max(0, state.pausedUntil - now);
  if (waitForPause > 0) await sleep(waitForPause);

  const baseDelay = 60_000 / state.currentRate;
  const jitter = baseDelay * 0.3 * ((Math.random() * 2) - 1);
  const delay = Math.max(800, baseDelay + jitter);
  const sendAt = Math.max(Date.now(), state.nextSendAt) + delay;
  state.nextSendAt = sendAt;
  await sleep(Math.max(0, sendAt - Date.now()));
}

async function beforeSend(phone, payload, tenant) {
  if (!antiBanEnabled()) return { allowed: true };
  if (payload?._antiBanBypass === true) return { allowed: true };

  if (await isSuppressed(tenant, phone)) {
    logger.warn({ tenantSlug: getTenantSlug(tenant), phone: normalizePhone(phone), type: payload?.type }, '[AntiBan] Envio omitido por suppression list');
    return { allowed: false, reason: 'suppressed' };
  }

  if (!isWithinSendWindow(phone, tenant)) {
    logger.warn({ tenantSlug: getTenantSlug(tenant), phone: normalizePhone(phone), type: payload?.type }, '[AntiBan] Envio omitido fuera de ventana horaria');
    return { allowed: false, reason: 'outside_send_window' };
  }

  const maxOutbound = Number(process.env.WHATSAPP_MAX_OUTBOUND_WITHOUT_REPLY || 3);
  const count = await outboundWithoutReplyCount(tenant, phone);
  if (count >= maxOutbound) {
    logger.warn({ tenantSlug: getTenantSlug(tenant), phone: normalizePhone(phone), count }, '[AntiBan] Circuit breaker de conversacion activo');
    return { allowed: false, reason: 'conversation_cooldown' };
  }

  await throttle(tenant);
  return { allowed: true };
}

async function afterSend(phone, payload, tenant, apiResult) {
  if (!antiBanEnabled()) return apiResult;
  if (payload?._antiBanBypass === true) return apiResult;
  await incrementOutboundWithoutReply(tenant, phone);
  return apiResult;
}

async function handleApiError(err, tenant, phone) {
  if (!antiBanEnabled()) return null;

  const error = err.response?.data?.error || err.response?.data?.errors?.[0] || err.response?.data;
  const code = Number(error?.code);
  const action = ERROR_ACTIONS[code];
  if (!action) return null;

  const state = getRateState(tenant);
  if (action.rateMultiplier) {
    state.currentRate = Math.max(10, state.currentRate * action.rateMultiplier);
  }
  if (action.pauseMs) {
    state.pausedUntil = Math.max(state.pausedUntil, Date.now() + action.pauseMs);
  }
  if (action.suppressReason) {
    await addSuppression(tenant, phone, action.suppressReason);
  }

  logger.warn({
    tenantSlug: getTenantSlug(tenant),
    phone: normalizePhone(phone),
    code,
    antiBanAction: action.action,
    currentRate: Math.round(state.currentRate),
  }, '[AntiBan] Error WhatsApp procesado');

  return action;
}

async function handleInboundMessage(tenant, phone, text) {
  if (!antiBanEnabled()) return { optOut: false, asksForHuman: asksForHuman(text) };

  await markInboundReply(tenant, phone);

  if (isOptOutText(text)) {
    await addSuppression(tenant, phone, 'opt_out');
    return { optOut: true, asksForHuman: false };
  }

  return { optOut: false, asksForHuman: asksForHuman(text) };
}

function _resetForTest() {
  MEMORY.suppression.clear();
  MEMORY.outbound.clear();
  MEMORY.rate.clear();
}

module.exports = {
  addSuppression,
  afterSend,
  asksForHuman,
  beforeSend,
  handleApiError,
  handleInboundMessage,
  isOptOutText,
  isSuppressed,
  isWithinSendWindow,
  markInboundReply,
  normalizePhone,
  _resetForTest,
};
