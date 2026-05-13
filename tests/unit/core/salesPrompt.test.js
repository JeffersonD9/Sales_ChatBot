'use strict';

const { buildSalesPrompt, selectProducts } = require('../../../apps/ai-orchestrator/core/salesPrompt');

// ── Fixtures ───────────────────────────────────────────────────────────────────

const makeProduct = (overrides = {}) => ({
  id:          'uuid-1',
  name:        'Vestido Floral',
  description: 'Diseño fresco ideal para salidas.',
  price:       89000,
  sizes:       ['S', 'M', 'L'],
  emoji:       '👗',
  stock:       true,
  ...overrides,
});

const makeTenant = (overrides = {}) => ({
  slug:       'tienda-test',
  name:       'Tienda Test',
  products:   [makeProduct()],
  bot_config: {
    greeting:   'Hola',
    escalation: { trigger_keywords: ['humano'], message: 'Te conecto.', notify_owner: true },
  },
  ...overrides,
});

// ── selectProducts ─────────────────────────────────────────────────────────────

describe('selectProducts', () => {
  const p1 = makeProduct({ id: 'a', name: 'A', price: 50000, sizes: ['S'],  stock: true  });
  const p2 = makeProduct({ id: 'b', name: 'B', price: 100000, sizes: ['M'], stock: true  });
  const p3 = makeProduct({ id: 'c', name: 'C', price: 200000, sizes: ['L'], stock: false });
  const all = [p1, p2, p3];

  test('sin filtro retorna primeros 10 activos', () => {
    const result = selectProducts(all, {});
    expect(result).toHaveLength(2); // p3 sin stock queda fuera (in_stock_only default true)
    expect(result.map((p) => p.id)).toEqual(['a', 'b']);
  });

  test('respeta max_products como límite total', () => {
    const result = selectProducts(all, { max_products: 1 });
    expect(result).toHaveLength(1);
  });

  test('featured_ids aparecen primero en el orden dado', () => {
    const result = selectProducts(all, { featured_ids: ['b', 'a'] });
    expect(result[0].id).toBe('b');
    expect(result[1].id).toBe('a');
  });

  test('featured_ids + max_products respeta el límite', () => {
    const result = selectProducts(all, { featured_ids: ['b'], max_products: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  test('filtra por talla correctamente', () => {
    const result = selectProducts(all, { sizes: ['S'] });
    expect(result.every((p) => p.sizes.includes('S'))).toBe(true);
    expect(result.map((p) => p.id)).toEqual(['a']);
  });

  test('filtra por precio mínimo', () => {
    const result = selectProducts(all, { min_price: 80000 });
    expect(result.every((p) => p.price >= 80000)).toBe(true);
    expect(result.map((p) => p.id)).toEqual(['b']);
  });

  test('filtra por precio máximo', () => {
    const result = selectProducts(all, { max_price: 60000 });
    expect(result.map((p) => p.id)).toEqual(['a']);
  });

  test('in_stock_only=false incluye productos sin stock', () => {
    const result = selectProducts(all, { in_stock_only: false });
    expect(result.map((p) => p.id)).toContain('c');
  });

  test('featured_ids con id inexistente no rompe', () => {
    const result = selectProducts(all, { featured_ids: ['uuid-no-existe', 'a'] });
    expect(result[0].id).toBe('a');
  });
});

// ── buildSalesPrompt ───────────────────────────────────────────────────────────

describe('buildSalesPrompt', () => {
  test('genera prompt con persona completa', () => {
    const tenant = makeTenant({
      bot_config: {
        greeting:   'Hola',
        escalation: { trigger_keywords: ['humano'], message: '.', notify_owner: true },
        business_name: 'Hollywood Store',
        city:          'Bucaramanga',
        schedule:      'Lun-Sab 9am-7pm',
        sales_persona: {
          persona_name:        'Valeria',
          persona_description: 'Soy asesora de moda.',
          tone:                'casual',
          business_description: 'Boutique femenina.',
          objection_price:     'Calidad garantizada.',
          objection_delivery:  '2-3 días hábiles.',
          sales_tips:          ['Pregunta la talla'],
          forbidden_topics:    ['política'],
        },
      },
    });

    const prompt = buildSalesPrompt(tenant);

    expect(prompt).toContain('Valeria');
    expect(prompt).toContain('Hollywood Store');
    expect(prompt).toContain('Bucaramanga');
    expect(prompt).toContain('Soy asesora de moda.');
    expect(prompt).toContain('Calidad garantizada.');
    expect(prompt).toContain('2-3 días hábiles.');
    expect(prompt).toContain('Pregunta la talla');
    expect(prompt).toContain('política');
  });

  test('fallback a nombre genérico si sin sales_persona', () => {
    const prompt = buildSalesPrompt(makeTenant());
    expect(prompt).toContain('el asistente virtual');
  });

  test('incluye ai_system_prompt al final (retrocompatibilidad)', () => {
    const tenant = makeTenant({
      bot_config: {
        greeting:        'Hola',
        escalation:      { trigger_keywords: ['humano'], message: '.', notify_owner: true },
        ai_system_prompt: 'Notas especiales del negocio.',
      },
    });
    const prompt = buildSalesPrompt(tenant);
    expect(prompt).toContain('Notas especiales del negocio.');
    // Debe aparecer al final
    const idx = prompt.indexOf('Notas especiales del negocio.');
    expect(idx).toBeGreaterThan(prompt.indexOf('Reglas obligatorias'));
  });

  test('tono professional menciona sin emojis', () => {
    const tenant = makeTenant({
      bot_config: {
        greeting:   'Hola',
        escalation: { trigger_keywords: ['humano'], message: '.', notify_owner: true },
        sales_persona: { persona_name: 'Carlos', tone: 'professional' },
      },
    });
    const prompt = buildSalesPrompt(tenant);
    expect(prompt).toContain('Sin emojis');
  });

  test('tono casual menciona emojis naturalmente', () => {
    const tenant = makeTenant({
      bot_config: {
        greeting:   'Hola',
        escalation: { trigger_keywords: ['humano'], message: '.', notify_owner: true },
        sales_persona: { persona_name: 'Ana', tone: 'casual' },
      },
    });
    const prompt = buildSalesPrompt(tenant);
    expect(prompt).toContain('emojis');
  });

  test('catálogo incluye precio en formato colombiano', () => {
    const prompt = buildSalesPrompt(makeTenant());
    expect(prompt).toContain('89.000'); // toLocaleString('es-CO') de 89000
  });

  test('forbidden_topics aparece en reglas obligatorias', () => {
    const tenant = makeTenant({
      bot_config: {
        greeting:   'Hola',
        escalation: { trigger_keywords: ['humano'], message: '.', notify_owner: true },
        sales_persona: { persona_name: 'Ana', forbidden_topics: ['política', 'religion'] },
      },
    });
    const prompt = buildSalesPrompt(tenant);
    expect(prompt).toContain('política');
    expect(prompt).toContain('religion');
  });

  test('product_filter limita los productos en el prompt', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      makeProduct({ id: `p${i}`, name: `Prod ${i}`, price: 10000 * (i + 1) })
    );
    const tenant = makeTenant({
      products: many,
      bot_config: {
        greeting:   'Hola',
        escalation: { trigger_keywords: ['humano'], message: '.', notify_owner: true },
        sales_persona: {
          persona_name: 'Bot',
          product_filter: { max_products: 3 },
        },
      },
    });
    const prompt = buildSalesPrompt(tenant);
    // Solo 3 productos deben aparecer → contar ocurrencias de "Prod "
    const matches = prompt.match(/Prod \d+/g) || [];
    expect(matches).toHaveLength(3);
  });

  test('sin productos muestra mensaje de consulta', () => {
    const tenant = makeTenant({ products: [] });
    const prompt = buildSalesPrompt(tenant);
    expect(prompt).toContain('consultar disponibilidad');
  });
});
