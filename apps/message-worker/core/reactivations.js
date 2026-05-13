'use strict';

/**
 * core/reactivations.js — Reactivación de usuarios inactivos
 *
 * Utilidad cross-flow: independiente del tipo de negocio.
 * Llamado desde index.js cada hora para todos los tenants activos.
 */

const { STEP }      = require('@whatsapp-saas/shared-utils');
const { sendText }  = require('./whatsapp/sender');

/**
 * Envía mensajes de reactivación a usuarios inactivos de un tenant.
 *
 * @param {object} tenant
 * @param {Function} getActiveSessions - de core/state/manager.js
 * @param {Function} saveState         - de core/state/manager.js
 * @returns {Promise<number>} cantidad de mensajes enviados
 */
async function checkReactivations(tenant, getActiveSessions, saveState) {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const sessions      = getActiveSessions(tenant.slug);
  const storeName     = tenant.bot_config?.business_name || tenant.name;
  let count           = 0;

  for (const session of sessions) {
    const hadInteraction = session.step && session.step !== STEP.NEW;
    const isInactive     = session.lastActivity && session.lastActivity < thirtyDaysAgo;

    if (hadInteraction && isInactive && !session.reactivationSent) {
      try {
        await sendText(session.waFrom,
          `👋 ¡Hola! Han pasado 30 días desde tu última visita a *${storeName}*.\n\n` +
          `Tenemos novedades y ofertas especiales 🛍️\n\n` +
          `Escribe *Hola* para ver el catálogo actualizado.`,
          tenant
        );
        session.reactivationSent = true;
        await saveState(tenant.slug, session.waFrom, session);
        count++;
      } catch {
        // No propagar errores de reactivación — continuar con el siguiente
      }
    }
  }

  return count;
}

module.exports = { checkReactivations };
