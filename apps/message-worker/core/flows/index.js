'use strict';

/**
 * flows/index.js — Registro de flujos de conversación
 *
 * Cómo agregar un flow nuevo:
 *   1. Crear flows/custom/<client-slug>/engine.js
 *   2. Validar docs/meta-whatsapp-template-compliance-2026-05.md:
 *      opt-in/template correcto, salida humana, opt-out, maximo 3 outbounds
 *      sin respuesta, copy corto, categorias vigentes y sin marketing dentro
 *      de pasos utility.
 *   3. Exportar: { processMessage(phone, rawMsg, session, tenant, notifier, services) }
 *   4. Agregar la entrada en FLOWS_REGISTRY con aiCapabilities: []
 *
 * aiCapabilities declara qué puede usar el flow si el tenant lo tiene habilitado.
 * Opciones disponibles: 'imageAnalysis'
 * El flow recibe services.ai?.analyzeImage — null si no aplica.
 *
 * Todo outbound debe pasar por sender.js para que antiBanGuard pueda filtrar
 * suppression list, ventana horaria, circuit breaker y errores Meta.
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

function listFlows() {
  return Object.keys(FLOWS_REGISTRY);
}

module.exports = { getFlow, listFlows, DEFAULT_FLOW };
