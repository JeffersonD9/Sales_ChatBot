import { getRedisClient } from './redis'

const CHANNEL = 'tenant:config:updated'

/**
 * Publica invalidación de caché de configuración de tenant.
 * No-op si Redis no está disponible — el caché expira por TTL.
 */
export async function publishTenantConfigUpdated(slug: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    await redis.publish(
      CHANNEL,
      JSON.stringify({ slug, source: 'dashboard', updatedAt: new Date().toISOString() }),
    )
  } catch {
    // No crítico — el caché del message-worker expirará por TTL en 5 min
  }
}
