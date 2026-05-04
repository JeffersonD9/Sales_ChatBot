'use strict';

const Anthropic        = require('@anthropic-ai/sdk');
const { logger }       = require('../../utils/logger');
const { increment }    = require('./aiMetrics');

// 3 turnos completos (user + assistant) = 6 entradas
const MAX_HISTORY     = 6;
// Máximo de caracteres por mensaje al almacenar en historial
const MAX_MSG_CHARS   = 500;

/**
 * Construye el system content con info del negocio y catálogo.
 * Se cachea en Anthropic con cache_control: ephemeral porque es estático
 * por tenant y puede ser largo (catálogo completo).
 *
 * Si el tenant tiene bot_config.ai_system_prompt, se añade al final
 * como instrucciones adicionales personalizadas.
 */
function _buildSystemContent(tenant) {
  const cfg = tenant.bot_config || {};

  const productList = (tenant.products || [])
    .map((p, i) =>
      `${i + 1}. ${p.name}: ${p.description || ''} | ` +
      `Precio: $${p.price} | Tallas: ${(p.sizes || []).join(', ')}`
    )
    .join('\n');

  let text =
    `Eres el asistente de ventas de *${cfg.business_name || tenant.name}*, ` +
    `ubicado en ${cfg.city || 'Colombia'}. ` +
    `Horario: ${cfg.schedule || 'consultar con el equipo'}.\n\n` +
    `Catálogo disponible:\n${productList || 'Sin productos cargados.'}\n\n` +
    `Reglas:\n` +
    `1. Responde en máximo 3 oraciones claras y amigables.\n` +
    `2. Si el cliente quiere comprar o ver productos, dile que escriba *catálogo* o elija esa opción en el menú.\n` +
    `3. No inventes productos, precios ni políticas que no estén en el catálogo.\n` +
    `4. No repitas el saludo si ya hay historial de conversación.\n` +
    `5. Responde siempre en el mismo idioma del cliente.`;

  if (cfg.ai_system_prompt) {
    text += `\n\nInstrucciones adicionales del negocio:\n${cfg.ai_system_prompt}`;
  }

  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

function _truncate(str) {
  if (typeof str === 'string' && str.length > MAX_MSG_CHARS) {
    return str.slice(0, MAX_MSG_CHARS) + '…';
  }
  return str;
}

let _client = null;

function _getClient() {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _client = new Anthropic({ apiKey });
  return _client;
}

/**
 * Intenta responder con Claude Haiku cuando el flow determinístico no
 * reconoció el input del usuario.
 *
 * Contrato de fallo: retorna null en cualquier error (API caída, timeout,
 * clave ausente, AI_ENABLED=false). El caller es responsable del fallback.
 *
 * @param {string} phone    - Número del remitente (solo para logging)
 * @param {string} text     - Mensaje del usuario
 * @param {object} session  - Estado mutable de la conversación
 * @param {object} tenant   - Config del tenant (products, bot_config, slug)
 * @returns {Promise<string|null>}
 */
async function handleWithAI(phone, text, session, tenant) {
  if (process.env.AI_ENABLED === 'false') return null;

  const client = _getClient();
  if (!client) return null;

  // Historial acotado con truncado de mensajes largos para evitar acumulación
  const history  = (session.data.aiHistory || []).slice(-MAX_HISTORY);
  const messages = [
    ...history.map((m) => ({ ...m, content: _truncate(m.content) })),
    { role: 'user', content: text },
  ];

  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system:     _buildSystemContent(tenant),
      messages,
    });

    const reply = response.content?.[0]?.text ?? null;
    if (!reply) return null;

    const inputTokens  = response.usage?.input_tokens  || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const cacheHit     = (response.usage?.cache_read_input_tokens || 0) > 0;

    logger.info(
      { phone, tenantSlug: tenant.slug, inputTokens, outputTokens, cacheHit },
      '[AI] Respuesta generada'
    );

    // Guardar en historial con texto del usuario truncado (no la respuesta IA)
    session.data.aiHistory = [
      ...history,
      { role: 'user',      content: _truncate(text) },
      { role: 'assistant', content: reply            },
    ].slice(-MAX_HISTORY);

    // Contabilizar la llamada en Redis (fire-and-forget)
    increment(tenant.slug).catch(() => {});

    return reply;

  } catch (err) {
    logger.warn(
      { phone, tenantSlug: tenant.slug, err: err.message },
      '[AI] Error llamando Anthropic — usando fallback'
    );
    return null;
  }
}

/** Solo para uso en tests — resetea el singleton del cliente. */
function _resetClientForTest() {
  _client = null;
}

module.exports = { handleWithAI, _resetClientForTest };
