'use strict';

/**
 * tenantConfigEvents.js — Pub/sub para invalidación de caché de configuración de tenant
 *
 * Canal: "tenant:config:updated"
 * Payload: { slug, source, updatedAt }
 *
 * Patrón:
 *   - Publisher usa la conexión Redis compartida (normal commands).
 *   - Subscriber usa una conexión DEDICADA porque ioredis en modo subscriber
 *     no puede ejecutar otros comandos en la misma conexión.
 *   - Si Redis no está disponible → no-op con warn. El caché expira por TTL.
 *   - ioredis re-suscribe automáticamente si la conexión se cae y vuelve.
 */

const Redis      = require('ioredis');
const { logger } = require('@whatsapp-saas/logger');
const {
  getRedisUrl,
  getRedisConnectionOptions,
  isDemoOrTest,
} = require('@whatsapp-saas/config/infra.js');
const { getRedis } = require('../redis');

const CHANNEL = 'tenant:config:updated';

// ── Publisher ─────────────────────────────────────────────────────────────────

/**
 * Publica que la configuración de un tenant fue actualizada.
 * No-op si Redis no está disponible. No lanza excepción.
 *
 * @param {string} slug
 * @param {string} [source] - Servicio que originó la actualización ('dashboard', 'api-core', etc.)
 * @returns {Promise<void>}
 */
async function publishConfigUpdated(slug, source = 'unknown') {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.publish(CHANNEL, JSON.stringify({
      slug,
      source,
      updatedAt: new Date().toISOString(),
    }));
    logger.debug({ tenantSlug: slug, source }, '[TenantEvents] Config update published');
  } catch (err) {
    // No-crítico: el caché expirará por TTL en 5 min
    logger.warn({ tenantSlug: slug, err: err.message }, '[TenantEvents] Failed to publish config update');
  }
}

// ── Subscriber ────────────────────────────────────────────────────────────────

/**
 * Crea una conexión Redis dedicada para suscribirse a actualizaciones de config.
 * Llama a onUpdate(slug) cada vez que se publica en el canal.
 * Retorna un objeto con close() para apagado ordenado.
 *
 * @param {(slug: string) => void} onUpdate
 * @returns {{ close: () => Promise<void> } | null}
 */
function subscribeToConfigUpdated(onUpdate) {
  if (isDemoOrTest()) return null;

  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    logger.warn('[TenantEvents] REDIS_URL no configurado — invalidación de caché deshabilitada');
    return null;
  }

  // Conexión separada: los subscribers no pueden ejecutar comandos regulares
  const sub = new Redis(redisUrl, {
    ...getRedisConnectionOptions(),
    enableReadyCheck: true,
    // ioredis re-subscribe automáticamente en reconexión
    autoResubscribe: true,
  });

  sub.on('error', (err) => {
    logger.error({ err: err.message }, '[TenantEvents] Subscriber connection error');
  });

  sub.on('reconnecting', () => {
    logger.warn('[TenantEvents] Subscriber reconnecting...');
  });

  sub.on('ready', () => {
    logger.info({ channel: CHANNEL }, '[TenantEvents] Subscriber ready');
  });

  sub.subscribe(CHANNEL, (err) => {
    if (err) logger.error({ err: err.message }, '[TenantEvents] Subscribe failed');
  });

  sub.on('message', (channel, raw) => {
    if (channel !== CHANNEL) return;
    try {
      const { slug } = JSON.parse(raw);
      if (typeof slug === 'string' && slug) onUpdate(slug);
    } catch (err) {
      logger.warn({ err: err.message, raw }, '[TenantEvents] Invalid message payload');
    }
  });

  return {
    async close() {
      await sub.quit().catch(() => sub.disconnect());
    },
  };
}

module.exports = { publishConfigUpdated, subscribeToConfigUpdated, CHANNEL };
