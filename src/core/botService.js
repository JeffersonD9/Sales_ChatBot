'use strict';

// Lógica del bot por tenant: procesar mensajes, init y actualizar config
const { getConfig, saveConfig } = require('../tenants/configRepository');
const { sendText }              = require('./whatsapp/sender');
const { notifyAdvisorRequest }  = require('../notifications/notifier');
const { query }                 = require('../db');
const { logger }                = require('../utils/logger');

function sanitizeInput(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

async function loadTenantCredentials(tenantId) {
  const { rows } = await query(
    `SELECT t.id, t.slug, t.name, t.phone_number_id, t.owner_phone, t.owner_email, t.bot_config,
            pgp_sym_decrypt(t.wa_token_encrypted::bytea, $2) AS wa_token
     FROM tenants t WHERE t.id = $1 AND t.status = 'active'`,
    [tenantId, process.env.APP_SECRET]
  );
  return rows[0] || null;
}

async function initializeBotForTenant(tenantId) {
  const config = await getConfig(tenantId);
  if (!config)          throw new Error(`Bot no configurado para tenant ${tenantId}`);
  if (!config.is_active) throw new Error(`Bot desactivado para tenant ${tenantId}`);
  logger.info({ tenantId }, '[BotService] Bot inicializado');
  return config;
}

async function handleIncomingMessage(tenantId, waFrom, message) {
  try {
    const text = sanitizeInput(message?.text?.body ?? message?.body ?? '');
    if (!text) return;

    const normalized = text.toLowerCase().trim();
    const [config, tenant] = await Promise.all([
      getConfig(tenantId),
      loadTenantCredentials(tenantId),
    ]);

    if (!config?.is_active || !tenant) return;

    const { bot_config: bc } = config;
    const escalationKws = (bc.escalation?.trigger_keywords || []).map((k) => k.toLowerCase());

    if (escalationKws.some((kw) => normalized.includes(kw))) {
      if (bc.escalation?.message) await sendText(waFrom, bc.escalation.message, tenant);
      if (bc.escalation?.notify_owner !== false) {
        setImmediate(() => notifyAdvisorRequest(waFrom, tenant));
      }
      return;
    }

    const match = Object.entries(bc.keyword_tree || {})
      .find(([kw]) => normalized.includes(kw.toLowerCase()));

    const reply = match
      ? match[1].response
      : (bc.fallback_message || bc.greeting);

    if (reply) await sendText(waFrom, reply, tenant);
  } catch (err) {
    logger.error({ tenantId, waFrom, err: err.message }, '[BotService] Error procesando mensaje');
  }
}

async function updateBotConfig(tenantId, newConfig) {
  const updated = await saveConfig(tenantId, newConfig);
  logger.info({ tenantId }, '[BotService] Config actualizada');
  return updated;
}

module.exports = { initializeBotForTenant, handleIncomingMessage, updateBotConfig };
