/**
 * tenants/loader.js — Cache en memoria de configuración de tenants
 *
 * Estrategia: Map en proceso con TTL de 5 minutos.
 * Efecto: 1 query a PostgreSQL por tenant cada 5 min, sin importar
 * el volumen de mensajes entrantes.
 *
 * En DEMO_MODE: retorna un tenant hardcodeado desde variables de entorno
 * (sin DB). Útil para desarrollo y demos a clientes.
 */

const { findBySlug } = require('./repository');
const { logger }     = require('@whatsapp-saas/logger');

const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/** @type {Map<string, { data: object, expiresAt: number }>} */
const cache = new Map();

/**
 * Retorna la configuración de un tenant por slug.
 * Primero busca en cache, luego en DB, luego retorna null si no existe.
 *
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
async function get(slug) {
  // ── Demo mode: tenant hardcodeado desde env vars ──────────────────────
  if (process.env.DEMO_MODE === 'true') {
    return getDemoTenant(slug);
  }

  // ── Cache hit ─────────────────────────────────────────────────────────
  const cached = cache.get(slug);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // ── Cache miss: cargar desde DB ───────────────────────────────────────
  try {
    const tenant = await findBySlug(slug);
    if (!tenant) {
      logger.warn({ tenantSlug: slug }, '[Loader] Tenant no encontrado');
      return null;
    }
    cache.set(slug, { data: tenant, expiresAt: Date.now() + CACHE_TTL });
    logger.debug({ tenantSlug: slug }, '[Loader] Tenant cargado desde DB');
    return tenant;
  } catch (err) {
    logger.error({ tenantSlug: slug, err: err.message }, '[Loader] Error cargando tenant');
    return null;
  }
}

/**
 * Invalida el cache de un tenant (llamar después de actualizar en admin API).
 * @param {string} slug
 */
function invalidate(slug) {
  cache.delete(slug);
  logger.debug({ tenantSlug: slug }, '[Loader] Cache invalidado');
}

/**
 * Retorna todos los slugs actualmente en cache.
 * @returns {string[]}
 */
function cachedSlugs() {
  return Array.from(cache.keys());
}

// ── Demo tenant ───────────────────────────────────────────────────────────

function getDemoTenant(slug) {
  // En demo mode, el slug del .env o cualquier slug sirve
  const demoSlug = process.env.DEMO_SLUG || 'demo-store';
  return {
    id:              'demo-uuid',
    slug:            slug || demoSlug,
    name:            process.env.DEMO_BUSINESS_NAME || 'Demo Store',
    status:          'active',
    wa_token:        'DEMO_TOKEN',
    phone_number_id: 'DEMO_PHONE_ID',
    verify_token:    process.env.VERIFY_TOKEN || 'demo_verify_token',
    owner_phone:     process.env.DEMO_OWNER_PHONE || '573001234567',
    owner_email:     null,
    bot_config: {
      business_name: process.env.DEMO_BUSINESS_NAME || 'Glamour Store (Demo)',
      city:          process.env.DEMO_CITY || 'Bucaramanga',
      schedule:      process.env.DEMO_SCHEDULE || 'Lun-S\u00e1b 9am-7pm',
      offers: [
        { id: 'O1', text: '\uD83D\uDD25 *Oferta del d\u00eda:* Blusa Floral al 30% OFF' },
      ],
      flow_type: 'sales_v1',
    },
    // Catálogo demo (igual que products.json del proyecto original)
    products: getDemoProducts(),
  };
}

function getDemoProducts() {
  return [
    { id: 'P001', name: 'Blusa Floral Manga Corta',  description: 'Tela chiffon liviana.',          price: 45000,  sizes: ['S','M','L','XL'], image_url: 'https://picsum.photos/seed/blusa001/400/500',  emoji: '\uD83D\uDC5A', category: 'blusas',    stock: true },
    { id: 'P002', name: 'Jeans Skinny Cl\u00e1sico',         description: 'Corte ajustado strech.',         price: 89000,  sizes: ['S','M','L','XL'], image_url: 'https://picsum.photos/seed/jeans002/400/500',  emoji: '\uD83D\uDC56', category: 'pantalones', stock: true },
    { id: 'P003', name: 'Vestido Casual Verano',     description: 'Estampado floral midi.',         price: 75000,  sizes: ['S','M','L'],      image_url: 'https://picsum.photos/seed/vestido003/400/500', emoji: '\uD83D\uDC57', category: 'vestidos',  stock: true },
    { id: 'P004', name: 'Conjunto Deportivo',        description: 'Top + licra transpirable.',      price: 68000,  sizes: ['S','M','L','XL'], image_url: 'https://picsum.photos/seed/deporte004/400/500', emoji: '\uD83C\uDFC3\u200D\u2640\uFE0F', category: 'deportivo', stock: true },
    { id: 'P005', name: 'Camisa Oversize B\u00e1sica',       description: '100% algod\u00f3n holgado.',          price: 52000,  sizes: ['S','M','L','XL'], image_url: 'https://picsum.photos/seed/camisa005/400/500', emoji: '\uD83D\uDC55', category: 'camisas',  stock: true },
    { id: 'P006', name: 'Falda Plisada Midi',        description: 'Tela satinada elegante.',        price: 58000,  sizes: ['S','M','L'],      image_url: 'https://picsum.photos/seed/falda006/400/500',  emoji: '\uD83D\uDC58', category: 'faldas',   stock: true },
    { id: 'P007', name: 'Blazer Elegante',           description: 'Slim fit negro y beige.',        price: 145000, sizes: ['S','M','L','XL'], image_url: 'https://picsum.photos/seed/blazer007/400/500', emoji: '\uD83E\uDDE5', category: 'chaquetas', stock: true },
    { id: 'P008', name: 'Top Cropped Liso',          description: 'B\u00e1sico ajustado, pack de 3.',     price: 28000,  sizes: ['S','M','L','XL'], image_url: 'https://picsum.photos/seed/top008/400/500',    emoji: '\uD83D\uDC5A', category: 'tops',     stock: true },
    { id: 'P009', name: 'Pantaloneta Jean',          description: 'Short de mezclilla juvenil.',   price: 48000,  sizes: ['S','M','L'],      image_url: 'https://picsum.photos/seed/short009/400/500',  emoji: '\uD83E\uDE73', category: 'pantalones', stock: true },
    { id: 'P010', name: 'Chaqueta Denim',            description: 'Jean oversize cl\u00e1sico.',         price: 120000, sizes: ['S','M','L','XL'], image_url: 'https://picsum.photos/seed/denim010/400/500',  emoji: '\uD83E\uDDE5', category: 'chaquetas', stock: true },
  ];
}

module.exports = { get, invalidate, cachedSlugs };
