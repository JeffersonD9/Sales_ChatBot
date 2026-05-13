'use strict';

const Anthropic  = require('@anthropic-ai/sdk');
const { sendText } = require('../../message-worker/core/whatsapp/sender');
const { logger } = require('@whatsapp-saas/logger');

let _client = null;
function _getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  _client = new Anthropic({ apiKey: key });
  return _client;
}

const ESCALATION_REASONS = {
  queja:                 'queja o insatisfacción',
  negociacion:           'intento de negociación',
  pregunta_sin_respuesta: 'pregunta que el bot no puede responder',
};

/**
 * Evalúa si la conversación necesita atención humana.
 *
 * Si detecta escalada:
 *   1. Notifica al dueño del negocio por WhatsApp con resumen
 *   2. Marca session.data.escalated = true para evitar notificaciones repetidas
 *   3. Retorna el mensaje de respuesta al cliente (o null si no hay escalada)
 *
 * Solo activo en planes premium/enterprise.
 * Fire-and-forget seguro: cualquier error se loguea y se ignora.
 *
 * @param {object} tenant       - Config del tenant
 * @param {object} session      - Estado mutable de la conversación
 * @param {string} phone        - Número del cliente
 * @param {string} userMessage  - Último mensaje del cliente
 * @returns {Promise<string|null>} Mensaje para el cliente si se escala, null si no
 */
async function check(tenant, session, phone, userMessage) {
  if (session.data.escalated) return null;

  const client = _getClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role:    'user',
        content: `Analiza este mensaje de un cliente de WhatsApp. Responde SOLO con JSON válido sin markdown:\n{"escalate": boolean, "reason": "queja|negociacion|pregunta_sin_respuesta|ninguno"}\n\nMensaje: "${userMessage.replace(/"/g, '\\"')}"`,
      }],
    });

    const rawText = response.content?.[0]?.text?.trim() ?? '';
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return null;
    }

    if (!parsed.escalate || parsed.reason === 'ninguno') return null;

    const reasonLabel = ESCALATION_REASONS[parsed.reason] || parsed.reason;
    const storeName   = tenant.bot_config?.business_name || tenant.name;
    const ownerMsg    =
      `⚠️ *${storeName} — Atención requerida*\n\n` +
      `📱 Cliente: ${phone}\n` +
      `🔔 Motivo: ${reasonLabel}\n` +
      `💬 Último mensaje: "${userMessage.slice(0, 200)}"\n` +
      `📍 Paso del bot: ${session.step}\n\n` +
      `_Respóndele en: wa.me/${phone}_`;

    await sendText(tenant.owner_phone, ownerMsg, tenant);
    session.data.escalated = true;

    logger.info(
      { tenantSlug: tenant.slug, phone, reason: parsed.reason },
      '[Escalation] Notificación enviada al dueño'
    );

    return 'Entendido 🙏 Voy a conectarte con un asesor. Te van a contactar muy pronto.';

  } catch (err) {
    logger.warn({ tenantSlug: tenant.slug, phone, err: err.message }, '[Escalation] Error — ignorando');
    return null;
  }
}

/** Solo para tests. */
function _resetClientForTest() { _client = null; }

module.exports = { check, _resetClientForTest };
