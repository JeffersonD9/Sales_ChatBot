'use strict';

const { filterProducts, getAlternatives, getStoreInfo, getOffers } = require('../../../apps/message-worker/core/catalog');

const PRODUCTS = [
  { id: '1', name: 'Vestido Rojo',   price: 80000,  sizes: ['S', 'M'],      stock: true  },
  { id: '2', name: 'Blusa Azul',     price: 45000,  sizes: ['M', 'L'],      stock: true  },
  { id: '3', name: 'Falda Verde',    price: 60000,  sizes: ['S', 'M', 'L'], stock: true  },
  { id: '4', name: 'Chaqueta Negra', price: 120000, sizes: ['M'],           stock: false },
  { id: '5', name: 'Pantalon',       price: 75000,  sizes: ['S'],           stock: true  },
];

describe('filterProducts', () => {
  it('filtra por talla y presupuesto', () => {
    const result = filterProducts(PRODUCTS, 'M', 90000);
    expect(result.every(p => p.sizes.includes('M'))).toBe(true);
    expect(result.every(p => p.price <= 90000)).toBe(true);
  });

  it('excluye productos sin stock', () => {
    const result = filterProducts(PRODUCTS, 'M', 200000);
    expect(result.find(p => p.id === '4')).toBeUndefined();
  });

  it('ordena por precio descendente', () => {
    const result = filterProducts(PRODUCTS, 'M', 200000);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].price).toBeGreaterThanOrEqual(result[i + 1].price);
    }
  });

  it('devuelve maximo 3 productos', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: String(i), name: `P${i}`, price: 50000, sizes: ['M'], stock: true,
    }));
    expect(filterProducts(many, 'M', 100000).length).toBe(3);
  });

  it('devuelve [] si no hay coincidencias', () => {
    expect(filterProducts(PRODUCTS, 'XL', 200000)).toEqual([]);
  });

  it('devuelve [] con array vacio', () => {
    expect(filterProducts([], 'M', 100000)).toEqual([]);
  });

  it('devuelve [] con null', () => {
    expect(filterProducts(null, 'M', 100000)).toEqual([]);
  });
});

describe('getAlternatives', () => {
  it('excluye ids ya mostrados', () => {
    const result = getAlternatives(PRODUCTS, 'M', ['1', '2']);
    expect(result.find(p => p.id === '1' || p.id === '2')).toBeUndefined();
  });

  it('excluye productos sin stock', () => {
    const result = getAlternatives(PRODUCTS, 'M', []);
    expect(result.find(p => p.id === '4')).toBeUndefined();
  });

  it('respeta el limite por defecto de 2', () => {
    expect(getAlternatives(PRODUCTS, 'M', []).length).toBeLessThanOrEqual(2);
  });

  it('respeta un limite custom', () => {
    expect(getAlternatives(PRODUCTS, 'M', [], 1).length).toBeLessThanOrEqual(1);
  });
});

describe('getStoreInfo', () => {
  it('devuelve datos del bot_config', () => {
    const tenant = { name: 'Tienda', bot_config: { business_name: 'Boutique Ana', city: 'Bucaramanga', schedule: 'Lun-Sab' } };
    const info = getStoreInfo(tenant);
    expect(info.name).toBe('Boutique Ana');
    expect(info.city).toBe('Bucaramanga');
    expect(info.schedule).toBe('Lun-Sab');
  });

  it('usa defaults si no hay bot_config', () => {
    const info = getStoreInfo({});
    expect(info.name).toBe('La Tienda');
    expect(info.city).toBe('Colombia');
  });

  it('usa tenant.name si no hay business_name', () => {
    const info = getStoreInfo({ name: 'Mi Tienda', bot_config: {} });
    expect(info.name).toBe('Mi Tienda');
  });

  it('maneja tenant null/undefined', () => {
    expect(() => getStoreInfo(null)).not.toThrow();
    expect(() => getStoreInfo(undefined)).not.toThrow();
  });
});

describe('getOffers', () => {
  it('devuelve offers del bot_config', () => {
    const tenant = { bot_config: { offers: [{ id: 1 }] } };
    expect(getOffers(tenant)).toEqual([{ id: 1 }]);
  });

  it('devuelve [] si no hay offers', () => {
    expect(getOffers({ bot_config: {} })).toEqual([]);
  });

  it('devuelve [] si no hay tenant', () => {
    expect(getOffers(null)).toEqual([]);
    expect(getOffers(undefined)).toEqual([]);
  });
});
