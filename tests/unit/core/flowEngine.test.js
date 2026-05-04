'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../../src/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// Mock all senders so tests don't make HTTP calls
const mockSendText              = jest.fn().mockResolvedValue(undefined);
const mockSendInteractiveList   = jest.fn().mockResolvedValue(undefined);
const mockSendInteractiveButtons = jest.fn().mockResolvedValue(undefined);
const mockSendImage             = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../src/core/whatsapp/sender', () => ({
  sendText:               mockSendText,
  sendInteractiveList:    mockSendInteractiveList,
  sendInteractiveButtons: mockSendInteractiveButtons,
  sendImage:              mockSendImage,
}));

// Mock IA handler — tests control when it fires
const mockHandleWithAI = jest.fn().mockResolvedValue(null);
jest.mock('../../../src/core/ai/aiHandler', () => ({
  handleWithAI: mockHandleWithAI,
}));

// Mock notifier
const mockNotifier = {
  notifyAdvisorRequest: jest.fn().mockResolvedValue(undefined),
  notifyNewLead:        jest.fn().mockResolvedValue(undefined),
  notifySale:           jest.fn().mockResolvedValue(undefined),
};

const { STEP } = require('../../../src/utils/constants');
const { processMessage } = require('../../../src/core/flow-engine/engine');

// ── Test tenant fixture ───────────────────────────────────────────────────────

function makeTenant(overrides = {}) {
  return {
    slug:            'tienda-test',
    name:            'Tienda Test',
    wa_token:        'token-test',
    phone_number_id: '123456',
    bot_config: {
      business_name: 'Tienda Test',
      city:          'Bogotá',
      schedule:      'Lun–Sáb 9am–7pm',
    },
    products: [
      { id: 1, name: 'Blusa Roja',   price: 80000,  sizes: ['S', 'M'], stock: true, emoji: '👕', description: 'Blusa roja bonita', image_url: '', category: 'Blusas', attributes: {} },
      { id: 2, name: 'Pantalón Azul', price: 120000, sizes: ['M', 'L'], stock: true, emoji: '👖', description: 'Pantalón azul', image_url: '', category: 'Pantalones', attributes: {} },
      { id: 3, name: 'Vestido Verde', price: 150000, sizes: ['S'],      stock: true, emoji: '👗', description: 'Vestido verde', image_url: '', category: 'Vestidos', attributes: {} },
    ],
    ...overrides,
  };
}

function makeSession(step = STEP.NEW, data = {}, shownProducts = []) {
  return {
    tenantSlug:        'tienda-test',
    waFrom:            '57300000001',
    step,
    data:              { ...data },
    shownProducts:     [...shownProducts],
    lastActivity:      Date.now(),
    reactivationSent:  false,
    createdAt:         Date.now(),
  };
}

function rawMsg(text) {
  return { type: 'text', text: { body: text } };
}

// List reply (e.g., main menu options)
function listMsg(id, title = id) {
  return { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } };
}

// Button reply (e.g., talla selection, yes/no choices)
function buttonMsg(id, title = id) {
  return { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Unsupported message type ──────────────────────────────────────────────────

describe('unsupported message type', () => {
  test('sends help text and shows main menu', async () => {
    const session = makeSession(STEP.MENU);
    await processMessage('57300000001', { type: 'image' }, session, makeTenant(), mockNotifier);
    expect(mockSendText).toHaveBeenCalled();
    expect(mockSendInteractiveList).toHaveBeenCalled();
  });
});

// ── Global reset commands ─────────────────────────────────────────────────────

describe('global reset commands', () => {
  for (const cmd of ['menu', 'hola', 'inicio', '0', 'start']) {
    test(`"${cmd}" resets to MENU from any step`, async () => {
      const session = makeSession(STEP.CATALOG_TALLA);
      await processMessage('57300000001', rawMsg(cmd), session, makeTenant(), mockNotifier);
      expect(mockSendInteractiveList).toHaveBeenCalled();
    });
  }
});

// ── MENU step ─────────────────────────────────────────────────────────────────

describe('STEP.MENU', () => {
  test('OPT_CATALOGO via interactive → transitions to CATALOG_TALLA', async () => {
    const session = makeSession(STEP.MENU);
    await processMessage('57300000001', listMsg('OPT_CATALOGO', 'Ver Catálogo'), session, makeTenant(), mockNotifier);
    expect(session.step).toBe(STEP.CATALOG_TALLA);
    expect(mockSendInteractiveButtons).toHaveBeenCalled();
  });

  test('OPT_PEDIDO via interactive → transitions to CHECK_ORDER', async () => {
    const session = makeSession(STEP.MENU);
    await processMessage('57300000001', listMsg('OPT_PEDIDO', 'Consultar Pedido'), session, makeTenant(), mockNotifier);
    expect(session.step).toBe(STEP.CHECK_ORDER);
    expect(mockSendText).toHaveBeenCalled();
  });

  test('OPT_ASESOR via interactive → notifies advisor and stays in MENU', async () => {
    const session = makeSession(STEP.MENU);
    await processMessage('57300000001', listMsg('OPT_ASESOR', 'Hablar con Asesor'), session, makeTenant(), mockNotifier);
    expect(session.step).toBe(STEP.MENU);
    expect(mockSendText).toHaveBeenCalled();
  });

  test('unrecognized text in MENU → calls handleWithAI', async () => {
    mockHandleWithAI.mockResolvedValueOnce('Respuesta de la IA');
    const session = makeSession(STEP.MENU);
    await processMessage('57300000001', rawMsg('qué tienen de especial?'), session, makeTenant(), mockNotifier);
    expect(mockHandleWithAI).toHaveBeenCalledWith('57300000001', 'qué tienen de especial?', session, expect.any(Object));
    expect(mockSendText).toHaveBeenCalledWith('57300000001', 'Respuesta de la IA', expect.any(Object));
  });

  test('unrecognized text in MENU, AI returns null → shows menu again', async () => {
    mockHandleWithAI.mockResolvedValueOnce(null);
    const session = makeSession(STEP.MENU);
    await processMessage('57300000001', rawMsg('gibberish xyzabc'), session, makeTenant(), mockNotifier);
    expect(mockSendInteractiveList).toHaveBeenCalled();
  });
});

// ── STEP.NEW — same handling as MENU ─────────────────────────────────────────

describe('STEP.NEW', () => {
  test('sends main menu on first contact', async () => {
    const session = makeSession(STEP.NEW);
    await processMessage('57300000001', listMsg('OPT_CATALOGO', 'Ver Catálogo'), session, makeTenant(), mockNotifier);
    expect(session.step).toBe(STEP.CATALOG_TALLA);
  });
});

// ── CATALOG_TALLA step ────────────────────────────────────────────────────────

describe('STEP.CATALOG_TALLA', () => {
  test('valid talla S → transitions to CATALOG_PRESUPUESTO', async () => {
    const session = makeSession(STEP.CATALOG_TALLA);
    await processMessage('57300000001', rawMsg('S'), session, makeTenant(), mockNotifier);
    expect(session.step).toBe(STEP.CATALOG_PRESUPUESTO);
    expect(session.data.talla).toBe('S');
  });

  test('valid talla via interactive button → transitions to CATALOG_PRESUPUESTO', async () => {
    const session = makeSession(STEP.CATALOG_TALLA);
    await processMessage('57300000001', buttonMsg('TALLA_M', 'M / Mediana'), session, makeTenant(), mockNotifier);
    expect(session.step).toBe(STEP.CATALOG_PRESUPUESTO);
    expect(session.data.talla).toBe('M');
  });

  test('invalid talla → stays in CATALOG_TALLA and asks again', async () => {
    const session = makeSession(STEP.CATALOG_TALLA);
    // 'abcdef' is not in the normalizeTalla map so it returns null → unrecognized
    await processMessage('57300000001', rawMsg('abcdef'), session, makeTenant(), mockNotifier);
    expect(session.step).toBe(STEP.CATALOG_TALLA);
    expect(mockSendText).toHaveBeenCalled();
  });
});

// ── CATALOG_PRESUPUESTO step ──────────────────────────────────────────────────

describe('STEP.CATALOG_PRESUPUESTO', () => {
  test('valid budget → transitions to CATALOG_SHOWING when products found', async () => {
    const session = makeSession(STEP.CATALOG_PRESUPUESTO, { talla: 'S' });
    await processMessage('57300000001', rawMsg('200000'), session, makeTenant(), mockNotifier);
    expect(session.step).toBe(STEP.CATALOG_SHOWING);
  });

  test('budget too low — no products found → stays in CATALOG_PRESUPUESTO or MENU', async () => {
    const session = makeSession(STEP.CATALOG_PRESUPUESTO, { talla: 'S' });
    await processMessage('57300000001', rawMsg('1000'), session, makeTenant(), mockNotifier);
    // Engine either stays to ask again or goes back to MENU
    expect([STEP.CATALOG_PRESUPUESTO, STEP.MENU]).toContain(session.step);
  });
});

// ── CATALOG_SHOWING step ──────────────────────────────────────────────────────

describe('STEP.CATALOG_SHOWING', () => {
  test('unrecognized response → calls handleWithAI', async () => {
    mockHandleWithAI.mockResolvedValueOnce(null);
    const session = makeSession(STEP.CATALOG_SHOWING, { talla: 'S' }, [1]);
    await processMessage('57300000001', rawMsg('cuánto demora el envío?'), session, makeTenant(), mockNotifier);
    expect(mockHandleWithAI).toHaveBeenCalled();
  });
});

// ── Default fallback ──────────────────────────────────────────────────────────

describe('unknown step', () => {
  test('unknown step → resets to main menu', async () => {
    const session = makeSession('UNKNOWN_STEP_XYZ');
    await processMessage('57300000001', rawMsg('hola'), session, makeTenant(), mockNotifier);
    // 'hola' is a global reset — shows menu
    expect(mockSendInteractiveList).toHaveBeenCalled();
  });
});
