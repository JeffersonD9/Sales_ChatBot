'use strict';

const { eq, and, sql } = require('drizzle-orm');
const { products } = require('../../drizzle/schema');
const { getDbForTenant } = require('../database/tenantDb');

async function listActiveProducts(tenantContext) {
  const db = await getDbForTenant(tenantContext);

  return db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      price: products.price,
      sizes: products.sizes,
      attributes: products.attributes,
      image_url: products.image_url,
      emoji: products.emoji,
      category: products.category,
      stock: products.active,
    })
    .from(products)
    .where(and(eq(products.tenant_id, tenantContext.tenantId), eq(products.active, true)))
    .orderBy(sql`${products.price} DESC`);
}

module.exports = { listActiveProducts };
