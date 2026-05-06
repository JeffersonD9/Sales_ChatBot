'use strict';

jest.mock('@anthropic-ai/sdk');
jest.mock('../../../../src/core/whatsapp/sender');

const Anthropic  = require('@anthropic-ai/sdk');
const { sendText } = require('../../../../src/core/whatsapp/sender');
const { check, _resetClientForTest } = require('../../../../src/core/ai/escalationDetector');

const TENANT = {
  slug:        'test-store',
  plan:        'premium',
  wa_token:    'TEST_TOKEN',
  owner_phone: '573001234567',
  phone_number_id: '123',
  bot_config:  { business_name: 'Test Store' },
};

const PHONE = '573109876543';

function makeSession(escalated = false) {
  return { step: 'MENU', data: { escalated } };
}

function mockAnthropicResponse(json) {
  const mockCreate = jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(json) }],
  });
  Anthropic.mockImplementation(() => ({ messages: { create: mockCreate } }));
  return mockCreate;
}

beforeEach(() => {
  jest.resetAllMocks();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  _resetClientForTest();
  sendText.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('escalationDetector.check', () => {
  test('detecta queja y notifica al dueño', async () => {
    mockAnthropicResponse({ escalate: true, reason: 'queja' });
    const session = makeSession();

    const result = await check(TENANT, session, PHONE, 'esto es una porquería, muy mala calidad');

    expect(result).toBeTruthy();
    expect(result).toContain('asesor');
    expect(sendText).toHaveBeenCalledWith(
      TENANT.owner_phone,
      expect.stringContaining('Atención requerida'),
      expect.objectContaining({ slug: TENANT.slug })
    );
    expect(session.data.escalated).toBe(true);
  });

  test('detecta negociación y notifica al dueño', async () => {
    mockAnthropicResponse({ escalate: true, reason: 'negociacion' });
    const session = makeSession();

    const result = await check(TENANT, session, PHONE, 'si me das 20% de descuento te compro todo');

    expect(result).toBeTruthy();
    expect(session.data.escalated).toBe(true);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  test('no escala ni notifica para mensajes normales', async () => {
    mockAnthropicResponse({ escalate: false, reason: 'ninguno' });
    const session = makeSession();

    const result = await check(TENANT, session, PHONE, 'tienen blusa talla M?');

    expect(result).toBeNull();
    expect(sendText).not.toHaveBeenCalled();
    expect(session.data.escalated).toBeFalsy();
  });

  test('no vuelve a notificar si ya escaló (session.data.escalated = true)', async () => {
    const session = makeSession(true);

    const result = await check(TENANT, session, PHONE, 'esto es horrible');

    expect(result).toBeNull();
    expect(sendText).not.toHaveBeenCalled();
    // No debe llamar a Anthropic
    expect(Anthropic).not.toHaveBeenCalled();
  });

  test('retorna null si ANTHROPIC_API_KEY no está configurada', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    _resetClientForTest();
    const session = makeSession();

    const result = await check(TENANT, session, PHONE, 'queja grave');

    expect(result).toBeNull();
    expect(sendText).not.toHaveBeenCalled();
  });

  test('retorna null si Claude devuelve JSON inválido', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'texto que no es JSON' }],
    });
    Anthropic.mockImplementation(() => ({ messages: { create: mockCreate } }));
    const session = makeSession();

    const result = await check(TENANT, session, PHONE, 'mensaje');

    expect(result).toBeNull();
    expect(sendText).not.toHaveBeenCalled();
  });

  test('retorna null si Claude lanza error', async () => {
    const mockCreate = jest.fn().mockRejectedValue(new Error('API timeout'));
    Anthropic.mockImplementation(() => ({ messages: { create: mockCreate } }));
    const session = makeSession();

    const result = await check(TENANT, session, PHONE, 'mensaje');

    expect(result).toBeNull();
  });
});
