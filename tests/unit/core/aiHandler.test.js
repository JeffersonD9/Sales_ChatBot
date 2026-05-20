'use strict';

/**
 * tests/unit/core/aiHandler.test.js
 *
 * Mocks:
 *   · @anthropic-ai/sdk  → cliente simulado con messages.create configurable
 *   · platform-data Redis → getRedis retorna null (sin Redis en tests)
 *   · src/utils/logger   → silencia logs
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

jest.mock('../../../packages/platform-data', () => ({
  redis: {
    getRedis: jest.fn(() => null),
  },
}));

jest.mock('@whatsapp-saas/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── Módulo bajo test ──────────────────────────────────────────────────────────

const { handleWithAI, _resetClientForTest } = require('../../../apps/ai-orchestrator/core/aiHandler');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const tenant = {
  slug:       'test-store',
  name:       'Test Store',
  products:   [{ name: 'Blusa Floral', description: 'Liviana', price: 45000, sizes: ['S', 'M'] }],
  bot_config: { business_name: 'Test Store', city: 'Bogotá', schedule: 'L-V 9am-6pm' },
};

const makeSession = (aiHistory = []) => ({ data: { aiHistory } });

const mockSuccess = (text = 'Hola, con gusto te ayudo.') => {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
    usage:   { input_tokens: 600, output_tokens: 25, cache_read_input_tokens: 500 },
  });
};

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  _resetClientForTest();
  mockCreate.mockReset();
  global.fetch = jest.fn();
  process.env.AI_ENABLED      = 'true';
  process.env.AI_PROVIDER = 'anthropic';
  process.env.ANTHROPIC_API_KEY = 'sk-test-key';
});

afterEach(() => {
  delete global.fetch;
  delete process.env.AI_PROVIDER;
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_ENABLED;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleWithAI', () => {
  describe('condiciones de retorno null', () => {
    test('retorna null cuando AI_ENABLED=false', async () => {
      process.env.AI_ENABLED = 'false';
      const result = await handleWithAI('573001', 'hola', makeSession(), tenant);
      expect(result).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('retorna null cuando ANTHROPIC_API_KEY no está definida', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const result = await handleWithAI('573001', 'hola', makeSession(), tenant);
      expect(result).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('retorna null cuando la API lanza error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Rate limit exceeded'));
      const result = await handleWithAI('573001', 'hola', makeSession(), tenant);
      expect(result).toBeNull();
    });

    test('retorna null cuando la respuesta no tiene contenido de texto', async () => {
      mockCreate.mockResolvedValueOnce({ content: [], usage: {} });
      const result = await handleWithAI('573001', 'hola', makeSession(), tenant);
      expect(result).toBeNull();
    });
  });

  describe('respuesta exitosa', () => {
    test('retorna el texto generado por Haiku', async () => {
      mockSuccess('Tenemos blusas en tallas S y M desde $45.000.');
      const result = await handleWithAI('573001', '¿tienen blusas?', makeSession(), tenant);
      expect(result).toBe('Tenemos blusas en tallas S y M desde $45.000.');
    });

    test('guarda user + assistant en session.data.aiHistory', async () => {
      mockSuccess('Claro, tenemos varias opciones.');
      const session = makeSession();
      await handleWithAI('573001', '¿qué tienen?', session, tenant);
      expect(session.data.aiHistory).toHaveLength(2);
      expect(session.data.aiHistory[0].role).toBe('user');
      expect(session.data.aiHistory[1].role).toBe('assistant');
      expect(session.data.aiHistory[1].content).toBe('Claro, tenemos varias opciones.');
    });

    test('pasa el historial existente como contexto a la API', async () => {
      mockSuccess('Sí, el Blazer está en $145.000.');
      const history = [
        { role: 'user',      content: '¿tienen chaquetas?' },
        { role: 'assistant', content: 'Sí, tenemos el Blazer Elegante.' },
      ];
      const session = makeSession(history);
      await handleWithAI('573001', '¿cuánto cuesta?', session, tenant);

      const callArgs = mockCreate.mock.calls[0][0];
      // Los dos mensajes de historial + el nuevo = 3 mensajes
      expect(callArgs.messages).toHaveLength(3);
      expect(callArgs.messages[0].role).toBe('user');
      expect(callArgs.messages[2].role).toBe('user');
      expect(callArgs.messages[2].content).toBe('¿cuánto cuesta?');
    });
  });

  describe('límites del historial', () => {
    test('el historial no supera MAX_HISTORY (6 entradas) después de múltiples turnos', async () => {
      const historialPrevio = [
        { role: 'user',      content: 'msg1' },
        { role: 'assistant', content: 'res1' },
        { role: 'user',      content: 'msg2' },
        { role: 'assistant', content: 'res2' },
        { role: 'user',      content: 'msg3' },
        { role: 'assistant', content: 'res3' },
      ];
      const session = makeSession(historialPrevio);
      mockSuccess('Respuesta al msg4.');
      await handleWithAI('573001', 'msg4', session, tenant);
      expect(session.data.aiHistory.length).toBeLessThanOrEqual(6);
    });

    test('trunca mensajes largos en el historial guardado (máx 500 chars)', async () => {
      mockSuccess('ok');
      const textoLargo = 'a'.repeat(600);
      const session    = makeSession();
      await handleWithAI('573001', textoLargo, session, tenant);
      const userEntry = session.data.aiHistory.find((m) => m.role === 'user');
      expect(userEntry.content.length).toBeLessThanOrEqual(503); // 500 + '...'
    });
  });

  describe('proveedor Gemini', () => {
    test('usa Gemini por defecto y retorna el texto generado', async () => {
      delete process.env.AI_PROVIDER;
      delete process.env.ANTHROPIC_API_KEY;
      process.env.GEMINI_API_KEY = 'gemini-test-key';
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Tenemos blusas disponibles.' }] } }],
          usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 8 },
        }),
      });

      const result = await handleWithAI('573001', 'hola', makeSession(), tenant);

      expect(result).toBe('Tenemos blusas disponibles.');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][0]).toContain('gemini-2.5-flash-lite:generateContent');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('retorna null cuando Gemini no tiene API key', async () => {
      delete process.env.AI_PROVIDER;
      delete process.env.ANTHROPIC_API_KEY;

      const result = await handleWithAI('573001', 'hola', makeSession(), tenant);

      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('system prompt personalizable', () => {
    test('incluye ai_system_prompt del tenant en el system content', async () => {
      mockSuccess('Respuesta con tono formal.');
      const tenantConPrompt = {
        ...tenant,
        bot_config: {
          ...tenant.bot_config,
          ai_system_prompt: 'Usa siempre un tono formal y profesional.',
        },
      };
      const session = makeSession();
      await handleWithAI('573001', 'hola', session, tenantConPrompt);

      const callArgs   = mockCreate.mock.calls[0][0];
      const systemText = callArgs.system[0].text;
      expect(systemText).toContain('Usa siempre un tono formal y profesional.');
    });

    test('funciona sin ai_system_prompt (campo opcional)', async () => {
      mockSuccess('Respuesta normal.');
      const session = makeSession();
      const result  = await handleWithAI('573001', 'hola', session, tenant);
      expect(result).toBe('Respuesta normal.');
    });
  });
});
