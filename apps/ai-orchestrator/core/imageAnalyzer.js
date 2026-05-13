'use strict';

const axios      = require('axios');
const Anthropic  = require('@anthropic-ai/sdk');
const { logger } = require('@whatsapp-saas/logger');

const BASE_URL     = 'https://graph.facebook.com/v20.0';
const FALLBACK_MSG = 'No pude ver bien tu foto. ¿Puedes describir qué estás buscando?';

let _client = null;
function _getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  _client = new Anthropic({ apiKey: key });
  return _client;
}

async function _downloadMedia(mediaId, waToken) {
  const metaRes = await axios.get(`${BASE_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${waToken}` },
  });
  const mediaUrl = metaRes.data?.url;
  if (!mediaUrl) throw new Error('Meta no retornó URL de media');

  const dataRes = await axios.get(mediaUrl, {
    headers:      { Authorization: `Bearer ${waToken}` },
    responseType: 'arraybuffer',
  });
  return Buffer.from(dataRes.data);
}

/**
 * Analiza una imagen enviada por el cliente y retorna una descripción
 * del producto para que el aiHandler busque lo más parecido en el catálogo.
 *
 * Solo activo en planes premium/enterprise.
 * Retorna null en cualquier error — el caller envía FALLBACK_MSG.
 *
 * @param {object} tenant   - Objeto tenant
 * @param {string} mediaId  - ID de la imagen en Meta Cloud API
 * @param {string} mimeType - MIME type (ej: "image/jpeg")
 * @returns {Promise<string|null>}
 */
async function analyze(tenant, mediaId, mimeType = 'image/jpeg') {
  const client = _getClient();
  if (!client) return null;

  try {
    const imgBuffer = await _downloadMedia(mediaId, tenant.wa_token);
    const base64    = imgBuffer.toString('base64');

    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const safeType   = validTypes.includes(mimeType) ? mimeType : 'image/jpeg';

    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system:     'Eres un asistente de ventas. Tu único rol es analizar imágenes en el contexto de este negocio. Describe brevemente el tipo de producto, colores, estilo y uso probable para ayudar al cliente a encontrar algo en el catálogo. Si la imagen no es de un producto (ej: personas, paisajes, documentos, memes), responde: "No pude identificar un producto en la imagen. ¿Puedes describirme qué estás buscando?". Sé conciso, máximo 2 oraciones.',
      messages: [{
        role:    'user',
        content: [{
          type:   'image',
          source: { type: 'base64', media_type: safeType, data: base64 },
        }],
      }],
    });

    const description = response.content?.[0]?.text?.trim() ?? null;
    logger.info({ tenantSlug: tenant.slug, mediaId }, '[Image] Análisis completado');
    return description || null;

  } catch (err) {
    logger.warn({ tenantSlug: tenant.slug, mediaId, err: err.message }, '[Image] Error analizando — fallback');
    return null;
  }
}

/** Solo para tests — resetea el singleton. */
function _resetClientForTest() { _client = null; }

module.exports = { analyze, FALLBACK_MSG, _resetClientForTest };
