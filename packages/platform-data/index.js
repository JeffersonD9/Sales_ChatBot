'use strict';

const db = require('./src/db');
const redis = require('./src/redis');
const schema = require('./src/drizzle/schema');
const platformSchema = require('./src/drizzle/platformSchema');
const tenantSchema = require('./src/drizzle/tenantSchema');
const drizzle = require('./src/drizzle/db');
const platformDb = require('./src/platform/database/platformDb');
const connectionManager = require('./src/platform/database/connectionManager');
const tenantLoader = require('./src/platform/tenancy/loader');
const tenantResolver = require('./src/platform/tenancy/tenantResolver');
const tenantRepository = require('./src/platform/tenancy/repository');
const tenantProvisioning = require('./src/platform/tenancy/provisioning');
const tenantAuth = require('./src/platform/auth/tenantAuthMiddleware');
const billingService = require('./src/platform/billing/billingService');
const usageRepository = require('./src/platform/usage/usageRepository');
const usagePolicy = require('./src/platform/usage/usagePolicy');
const tenantDb = require('./src/tenant/database/tenantDb');
const catalogRepository = require('./src/tenant/repositories/catalogRepository');
const whatsappConfigRepository = require('./src/tenant/repositories/whatsappConfigRepository');
const whatsappSender = require('./src/integrations/whatsapp/sender');
const tenantConfigEvents = require('./src/events/tenantConfigEvents');
const media = require('./src/media');

module.exports = {
  db,
  redis,
  schema,
  platformSchema,
  tenantSchema,
  drizzle,
  platformDb,
  connectionManager,
  tenantLoader,
  tenantResolver,
  tenantRepository,
  tenantProvisioning,
  tenantAuth,
  billingService,
  usageRepository,
  usagePolicy,
  tenantDb,
  catalogRepository,
  whatsappConfigRepository,
  whatsappSender,
  tenantConfigEvents,
  media,
};
