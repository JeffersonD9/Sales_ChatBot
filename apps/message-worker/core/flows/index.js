'use strict';

/**
 * flows/index.js — Registro de flujos de conversación
 *
 * Cada entrada mapea un valor de `tenant.bot_config.flow_type` a su engine.
 * El engine debe exportar: { processMessage(phone, rawMsg, session, tenant, notifier) }
 *
 * Para agregar un flow nuevo:
 *   1. Crear la carpeta flows/<nombre>/ con su engine.js
 *   2. Agregar la entrada en FLOWS_REGISTRY
 *
 * Para un cliente con flow custom:
 *   flows/custom/<client-slug>/engine.js
 */

const FLOWS_REGISTRY = {
  sales_v1:        () => require('./sales-v1/engine'),
  mayoristas:      () => require('./custom/mayoristas/engine'),
  hollywood_store: () => require('./custom/hollywood-store/engine'),
};

const DEFAULT_FLOW = 'sales_v1';

/**
 * Retorna el engine del flow correspondiente al tenant.
 * Si el flow_type no existe en el registro, usa el flow por defecto.
 *
 * @param {string|undefined} flowType - valor de tenant.bot_config?.flow_type
 * @returns {{ processMessage: Function }}
 */
function getFlow(flowType) {
  const loader = FLOWS_REGISTRY[flowType] || FLOWS_REGISTRY[DEFAULT_FLOW];
  return loader();
}

module.exports = { getFlow, DEFAULT_FLOW };
