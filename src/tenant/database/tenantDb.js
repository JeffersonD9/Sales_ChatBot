'use strict';

const { getTenantDb, getTenantPool } = require('../../platform/database/connectionManager');

async function getDbForTenant(tenantContext) {
  if (!tenantContext?.dbAllocation) {
    throw new Error('TenantContext sin dbAllocation');
  }
  return getTenantDb(tenantContext.dbAllocation);
}

async function getPoolForTenant(tenantContext) {
  if (!tenantContext?.dbAllocation) {
    throw new Error('TenantContext sin dbAllocation');
  }
  return getTenantPool(tenantContext.dbAllocation);
}

module.exports = { getDbForTenant, getPoolForTenant };
