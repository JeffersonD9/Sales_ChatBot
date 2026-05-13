'use strict';

const db = require('./src/db');
const redis = require('./src/redis');
const schema = require('./src/drizzle/schema');
const drizzle = require('./src/drizzle/db');
const platformDb = require('./src/platform/database/platformDb');
const connectionManager = require('./src/platform/database/connectionManager');
const tenantLoader = require('./src/platform/tenancy/loader');
const tenantResolver = require('./src/platform/tenancy/tenantResolver');
const tenantRepository = require('./src/platform/tenancy/repository');
const tenantAuth = require('./src/platform/auth/tenantAuthMiddleware');
const billingService = require('./src/platform/billing/billingService');
const tenantDb = require('./src/tenant/database/tenantDb');
const catalogRepository = require('./src/tenant/repositories/catalogRepository');
const whatsappConfigRepository = require('./src/tenant/repositories/whatsappConfigRepository');
const whatsappSender = require('./src/integrations/whatsapp/sender');

module.exports = {
  db,
  redis,
  schema,
  drizzle,
  platformDb,
  connectionManager,
  tenantLoader,
  tenantResolver,
  tenantRepository,
  tenantAuth,
  billingService,
  tenantDb,
  catalogRepository,
  whatsappConfigRepository,
  whatsappSender,
};
