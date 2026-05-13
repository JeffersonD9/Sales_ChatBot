'use strict';

/**
 * flows/index.js — Registro de flujos de conversación
 *
 * Cómo agregar un flow nuevo:
 *   1. Crear flows/custom/<client-slug>/engine.js
 *   2. Exportar: { processMessage(phone, rawMsg, session, tenant, notifier, services) }
 *   3. Agregar la entrada en FLOWS_REGISTRY con aiCapabilities: []
 *
 * aiCapabilities declara qué puede usar el flow si el tenant lo tiene habilitado.
 * Opciones disponibles: 'imageAnalysis'
 * El flow recibe services.ai?.analyzeImage — null si no aplica.
 */

const FLOWS_REGISTRY = {
  sales_v1: {
    load:           () => require('./sales-v1/engine'),
    aiCapabilities: ['imageAnalysis'],
  },
  mayoristas: {
    load:           () => require('./custom/mayoristas/engine'),
    aiCapabilities: [],
  },
  hollywood_store: {
    load:           () => require('./custom/hollywood-store/engine'),
    aiCapabilities: ['imageAnalysis'],
  },
};

const DEFAULT_FLOW = 'sales_v1';

/**
 * @param {string|undefined} flowType
 * @returns {{ engine: object, aiCapabilities: string[] }}
 */
function getFlow(flowType) {
  const entry = FLOWS_REGISTRY[flowType] || FLOWS_REGISTRY[DEFAULT_FLOW];
  return { engine: entry.load(), aiCapabilities: entry.aiCapabilities };
}

module.exports = { getFlow, DEFAULT_FLOW };
