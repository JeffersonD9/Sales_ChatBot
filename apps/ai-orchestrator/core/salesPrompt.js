'use strict';

/**
 * Filtra y ordena los productos del tenant para incluir en el prompt de Claude.
 *
 * Prioridad:
 * 1. featured_ids → aparecen primero, en el orden especificado
 * 2. Resto del catálogo filtrado por talla/precio/stock, hasta completar max_products
 * 3. Sin product_filter → primeros 10 productos activos
 */
function selectProducts(products, filter = {}) {
  const {
    featured_ids,
    sizes,
    min_price,
    max_price,
    in_stock_only = true,
    max_products  = 10,
  } = filter;

  let pool = products.filter((p) => !in_stock_only || p.stock !== false);

  if (sizes?.length)     pool = pool.filter((p) => p.sizes?.some((s) => sizes.includes(s)));
  if (min_price != null) pool = pool.filter((p) => p.price >= min_price);
  if (max_price != null) pool = pool.filter((p) => p.price <= max_price);

  if (featured_ids?.length) {
    const featured = featured_ids
      .map((id) => products.find((p) => p.id === id))
      .filter(Boolean);
    const rest = pool.filter((p) => !featured_ids.includes(p.id));
    return [...featured, ...rest].slice(0, max_products);
  }

  return pool.slice(0, max_products);
}

const TONE_GUIDES = {
  casual:       'Habla de forma relajada y cercana, como una amiga. Usa emojis naturalmente.',
  friendly:     'Sé cálido/a y entusiasta, pero profesional. Algunos emojis cuando sea natural.',
  professional: 'Mantén un tono formal y claro. Sin emojis salvo en saludos.',
};

/**
 * Compila el system prompt completo para Claude a partir de la configuración
 * del tenant (sales_persona + catálogo filtrado + notas extra).
 *
 * Es una función pura: mismo input → mismo output, sin efectos secundarios.
 */
function buildSalesPrompt(tenant) {
  const cfg     = tenant.bot_config || {};
  const persona = cfg.sales_persona  || {};
  const filter  = persona.product_filter;

  const name   = persona.persona_name || 'el asistente virtual';
  const biz    = cfg.business_name    || tenant.name;
  const city   = cfg.city             || 'Colombia';
  const sched  = cfg.schedule         || 'horario de atención';
  const tone   = persona.tone         || 'friendly';

  // ── Sección 1: Identidad ──────────────────────────────────────────────────
  let prompt = `Eres ${name}, asistente de ventas de ${biz}, en ${city}.\n`;

  if (persona.persona_description) {
    prompt += `${persona.persona_description}\n`;
  }

  // ── Sección 2: Estilo de comunicación ─────────────────────────────────────
  prompt += `\nEstilo: ${TONE_GUIDES[tone] || TONE_GUIDES.friendly}\n`;
  prompt += `Formato: Mensajes CORTOS (esto es WhatsApp, no email). Máximo 3 oraciones por respuesta.\n`;

  // ── Sección 3: Contexto del negocio ───────────────────────────────────────
  if (persona.business_description) {
    prompt += `\nSobre el negocio: ${persona.business_description}\n`;
  }
  prompt += `Horario: ${sched}\n`;

  // ── Sección 4: Catálogo filtrado ──────────────────────────────────────────
  const products = selectProducts(tenant.products || [], filter);
  if (products.length > 0) {
    prompt += `\nProductos disponibles:\n`;
    products.forEach((p) => {
      const tallas = p.sizes?.length ? ` — Tallas: ${p.sizes.join(', ')}` : '';
      const precio = p.price != null
        ? ` — $${Number(p.price).toLocaleString('es-CO')}`
        : '';
      prompt += `• ${p.emoji || ''}${p.name}${precio}${tallas}\n`;
      if (p.description) prompt += `  ${p.description}\n`;
    });
  } else {
    prompt += `\nProductos: consultar disponibilidad directamente.\n`;
  }

  // ── Sección 5: Manejo de objeciones ───────────────────────────────────────
  const objections = [];
  if (persona.objection_price)    objections.push(`Cuando digan "está caro": ${persona.objection_price}`);
  if (persona.objection_delivery) objections.push(`Sobre tiempos de entrega: ${persona.objection_delivery}`);
  if (objections.length) {
    prompt += `\nCómo manejar situaciones frecuentes:\n`;
    objections.forEach((o) => { prompt += `• ${o}\n`; });
  }

  // ── Sección 6: Tips de ventas ──────────────────────────────────────────────
  if (persona.sales_tips?.length) {
    prompt += `\nConsejos de ventas para este negocio:\n`;
    persona.sales_tips.forEach((tip) => { prompt += `• ${tip}\n`; });
  }

  // ── Sección 7: Reglas fijas ────────────────────────────────────────────────
  prompt += `\nReglas obligatorias:\n`;
  prompt += `• NUNCA inventes productos, precios ni disponibilidad que no estén en el catálogo\n`;
  prompt += `• Para comprar → pídeles que escriban "catálogo" para ver opciones\n`;
  prompt += `• Si no sabes algo → di que consultarás con la tienda\n`;
  prompt += `• No repitas el saludo en cada mensaje\n`;
  prompt += `• Responde en el mismo idioma del cliente\n`;

  // ── Guardrail de contexto ──────────────────────────────────────────────────
  const redirectMsg = persona.off_topic_redirect ||
    `Solo puedo ayudarte con temas de ${biz}: productos, pedidos, precios y atención al cliente. ¿En qué te puedo ayudar hoy?`;
  prompt += `\nLímite de contexto (CRÍTICO):\n`;
  prompt += `• Tu único rol es asistente de ventas de ${biz}. SOLO puedes responder sobre: productos del catálogo, pedidos, precios, tallas, disponibilidad, tiempos de entrega, formas de pago y atención al cliente de este negocio.\n`;
  prompt += `• Si el cliente pregunta algo fuera de ese contexto (recetas, código, historia, política, deportes, entretenimiento, consejos personales, temas generales de cualquier tipo u otro negocio), NO respondas el tema. Redirígelo amablemente con: "${redirectMsg}"\n`;
  prompt += `• NUNCA actúes como asistente general, ChatGPT, enciclopedia ni motor de búsqueda.\n`;
  prompt += `• Si el cliente insiste en temas fuera de contexto, repite la redirección con amabilidad pero sin ceder.\n`;

  if (persona.forbidden_topics?.length) {
    prompt += `• Temas que NO debes mencionar: ${persona.forbidden_topics.join(', ')}\n`;
  }

  // ── Sección 8: Notas extra (retrocompatibilidad con ai_system_prompt) ─────
  if (cfg.ai_system_prompt) {
    prompt += `\nInstrucciones adicionales del negocio:\n${cfg.ai_system_prompt}\n`;
  }

  return prompt.trim();
}

module.exports = { buildSalesPrompt, selectProducts };
