'use strict';

const { analyze } = require('../../../ai-orchestrator/core/imageAnalyzer');

/**
 * buildServices — construye el objeto de capacidades AI disponibles para un flow.
 *
 * El flow declara qué necesita (aiCapabilities del registry).
 * El tenant declara qué tiene habilitado (tenantContext.features).
 * La intersección es lo que se provee.
 *
 * Si una capacidad no está disponible, el método correspondiente es null.
 * El flow solo debe chequear: if (services.ai?.analyzeImage) { ... }
 *
 * @param {object}   tenant          - Objeto tenant con .features y .wa_token
 * @param {string[]} aiCapabilities  - Capacidades que el flow puede usar
 * @returns {{ ai: object|null }}
 */
function buildServices(tenant, aiCapabilities = []) {
  if (!aiCapabilities.length || !tenant.features?.aiEnabled) {
    return { ai: null };
  }

  const canImage = aiCapabilities.includes('imageAnalysis')
    && tenant.features?.imageAnalysisEnabled;

  const ai = canImage
    ? { analyzeImage: (mediaId, mimeType) => analyze(tenant, mediaId, mimeType) }
    : null;

  return { ai };
}

module.exports = { buildServices };
