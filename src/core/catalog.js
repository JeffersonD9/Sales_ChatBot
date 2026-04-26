/**
 * core/catalog.js — Funciones puras de catálogo
 *
 * CAMBIO vs. el original (catalogService.js):
 * Ya no carga products.json del disco. Recibe el array de productos
 * del objeto `tenant` (cargado desde PostgreSQL por el tenant loader).
 *
 * Todas las funciones son puras: misma entrada → misma salida, sin efectos secundarios.
 */

const MAX_PRODUCTS_SHOWN = 3;

/**
 * Filtra productos por talla y presupuesto máximo.
 * Ordena por precio descendente (maximiza ticket promedio).
 * Devuelve máximo MAX_PRODUCTS_SHOWN resultados.
 *
 * @param {object[]} products - tenant.products
 * @param {string}   talla
 * @param {number}   budget   - Presupuesto en COP
 * @returns {object[]}
 */
function filterProducts(products, talla, budget) {
  return (products || [])
    .filter((p) => p.stock && p.sizes.includes(talla) && p.price <= budget)
    .sort((a, b) => b.price - a.price)
    .slice(0, MAX_PRODUCTS_SHOWN);
}

/**
 * Retorna productos alternativos (excluye los ya mostrados).
 *
 * @param {object[]} products
 * @param {string}   talla
 * @param {string[]} excludeIds
 * @param {number}   [limit=2]
 * @returns {object[]}
 */
function getAlternatives(products, talla, excludeIds = [], limit = 2) {
  return (products || [])
    .filter((p) => p.stock && p.sizes.includes(talla) && !excludeIds.includes(p.id))
    .slice(0, limit);
}

/**
 * Retorna la información de la tienda desde bot_config.
 * @param {object} tenant
 * @returns {{ name:string, city:string, schedule:string }}
 */
function getStoreInfo(tenant) {
  const cfg = tenant?.bot_config || {};
  return {
    name:     cfg.business_name || tenant?.name || 'La Tienda',
    city:     cfg.city          || 'Colombia',
    schedule: cfg.schedule      || 'Lun\u2013S\u00e1b 9am\u20137pm',
  };
}

/**
 * Retorna las ofertas del día desde bot_config.
 * @param {object} tenant
 * @returns {object[]}
 */
function getOffers(tenant) {
  return tenant?.bot_config?.offers || [];
}

module.exports = { filterProducts, getAlternatives, getStoreInfo, getOffers };
