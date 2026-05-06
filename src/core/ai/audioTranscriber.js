'use strict';

const axios          = require('axios');
const { logger }     = require('../../utils/logger');

const BASE_URL       = 'https://graph.facebook.com/v20.0';
const WHISPER_URL    = 'https://api.openai.com/v1/audio/transcriptions';
const FALLBACK_MSG   = 'No pude escuchar tu audio, ¿puedes escribirme lo que necesitas?';

/**
 * Descarga un archivo de media de la Meta Cloud API como Buffer.
 * Paso 1: GET /v20.0/{mediaId} → { url }
 * Paso 2: GET {url} con Authorization → bytes
 */
async function _downloadMedia(mediaId, waToken) {
  const metaRes = await axios.get(`${BASE_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${waToken}` },
  });
  const mediaUrl = metaRes.data?.url;
  if (!mediaUrl) throw new Error('Meta no retornó URL de media');

  const dataRes = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${waToken}` },
    responseType: 'arraybuffer',
  });
  return Buffer.from(dataRes.data);
}

/**
 * Transcribe una nota de voz usando OpenAI Whisper.
 *
 * Solo se activa para planes premium/enterprise.
 * Retorna null en cualquier error — el caller envía el FALLBACK_MSG.
 *
 * @param {object} tenant  - Objeto tenant con wa_token y plan
 * @param {string} mediaId - ID del audio en Meta Cloud API
 * @returns {Promise<string|null>}
 */
async function transcribe(tenant, mediaId) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const audioBuffer = await _downloadMedia(mediaId, tenant.wa_token);

    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'audio.ogg');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'text');

    const res = await fetch(WHISPER_URL, {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    formData,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Whisper HTTP ${res.status}: ${err}`);
    }

    const transcript = (await res.text()).trim();
    logger.info({ tenantSlug: tenant.slug, mediaId, chars: transcript.length }, '[Audio] Transcripción exitosa');
    return transcript || null;

  } catch (err) {
    logger.warn({ tenantSlug: tenant.slug, mediaId, err: err.message }, '[Audio] Error transcribiendo — fallback');
    return null;
  }
}

module.exports = { transcribe, FALLBACK_MSG };
