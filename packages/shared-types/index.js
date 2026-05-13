'use strict';

/**
 * Contratos compartidos del monorepo.
 *
 * Por ahora son typedefs JSDoc para documentar payloads entre servicios sin
 * meter TypeScript de golpe. Cuando el repo adopte TS, este paquete sera el
 * lugar natural para los tipos compilados.
 */

/**
 * @typedef {object} WhatsAppInboundPayload
 * @property {string} tenantSlug
 * @property {object} webhookBody
 * @property {string} receivedAt
 */

/**
 * @typedef {object} AIRequestPayload
 * @property {string} phone
 * @property {string} text
 * @property {object} session
 * @property {object} tenant
 */

module.exports = {};
