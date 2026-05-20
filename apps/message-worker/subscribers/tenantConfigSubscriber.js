import platformData from '../../../packages/platform-data/index.js';
import loggerModule from '@whatsapp-saas/logger';

const { logger } = loggerModule;
const { tenantConfigEvents } = platformData;
const tenantLoader = platformData.tenantLoader;

let subscriberHandle = null;

export function setupTenantConfigSubscriber() {
  subscriberHandle = tenantConfigEvents.subscribeToConfigUpdated((slug) => {
    tenantLoader.invalidate(slug);
    logger.info({ tenantSlug: slug, service: 'worker' }, '[TenantConfig] Cache invalidado por evento pub/sub');
  });

  if (subscriberHandle) {
    logger.info({ service: 'worker' }, '[TenantConfig] Suscripción a config updates activa');
  }
}

export async function closeTenantConfigSubscriber() {
  if (subscriberHandle) {
    await subscriberHandle.close();
    subscriberHandle = null;
  }
}
