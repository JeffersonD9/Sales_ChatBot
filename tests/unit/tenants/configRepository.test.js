/**
 * tests/unit/tenants/configRepository.test.js
 *
 * Tests unitarios de src/tenants/configRepository.js
 *
 * Mocks:
 *   · src/db.js    → pool con client simulado
 *   · src/redis.js → cliente Redis simulado
 */

'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockClient = {
  query:   jest.fn(),
  release: jest.fn(),
};

const mockPool = {
  connect: jest.fn().mockResolvedValue(mockClient),
};

jest.mock('../../../src/db', () => ({
  getPool: jest.fn(() => mockPool),
}));

const mockRedis = {
  get:    jest.fn(),
  set:    jest.fn(),
  del:    jest.fn(),
  expire: jest.fn(),
};

jest.mock('../../../src/redis', () => ({
  getRedis: jest.fn(() => mockRedis),
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ── Imports (después de los mocks) ────────────────────────────────────────────

const repo = require('../../../src/tenants/configRepository');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
process.env.APP_SECRET = 'test-secret-key-32-chars-minimum!!';

const validBotConfig = {
  greeting: 'Hola, ¿en qué te puedo ayudar?',
  keyword_tree: {
    precio: { response: 'Nuestros precios van desde $50.000' },
  },
  escalation: {
    trigger_keywords: ['hablar con asesor'],
    message: 'Te conecto con un asesor.',
    notify_owner: true,
  },
};

const dbRow = {
  tenant_id:      TENANT_ID,
  session_data:   'decrypted-session',
  bot_config:     validBotConfig,
  webhook_secret: 'decrypted-secret',
  is_active:      true,
  created_at:     new Date(),
  updated_at:     new Date(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupDbRead(rows = [dbRow]) {
  mockClient.query
    .mockResolvedValueOnce({})           // BEGIN
    .mockResolvedValueOnce({})           // SET LOCAL
    .mockResolvedValueOnce({ rows })     // SELECT
    .mockResolvedValueOnce({});          // COMMIT
}

function setupDbSave(row = dbRow) {
  mockClient.query
    .mockResolvedValueOnce({})                       // BEGIN
    .mockResolvedValueOnce({})                       // SET LOCAL
    .mockResolvedValueOnce({ rows: [row], rowCount: 1 }) // UPSERT RETURNING
    .mockResolvedValueOnce({});                      // COMMIT
}

function setupDbDelete(rowCount = 1) {
  mockClient.query
    .mockResolvedValueOnce({})           // BEGIN
    .mockResolvedValueOnce({})           // SET LOCAL
    .mockResolvedValueOnce({ rowCount }) // DELETE
    .mockResolvedValueOnce({});          // COMMIT
}

// ── getConfig ─────────────────────────────────────────────────────────────────

describe('configRepository.getConfig', () => {
  beforeEach(() => jest.clearAllMocks());

  test('retorna config desde Redis cuando hay cache hit', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(dbRow));

    const result = await repo.getConfig(TENANT_ID);

    expect(mockRedis.get).toHaveBeenCalledWith(`wa:config:${TENANT_ID}`);
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ tenant_id: TENANT_ID });
  });

  test('consulta DB en cache miss y guarda en Redis', async () => {
    mockRedis.get.mockResolvedValue(null);
    setupDbRead();

    const result = await repo.getConfig(TENANT_ID);

    expect(mockPool.connect).toHaveBeenCalled();
    expect(mockRedis.set).toHaveBeenCalledWith(
      `wa:config:${TENANT_ID}`, expect.any(String), 'EX', 300
    );
    expect(result).toMatchObject({ tenant_id: TENANT_ID });
  });

  test('degrada a solo DB cuando Redis.get lanza error', async () => {
    mockRedis.get.mockRejectedValue(new Error('Redis down'));
    setupDbRead();

    const result = await repo.getConfig(TENANT_ID);

    expect(result).toMatchObject({ tenant_id: TENANT_ID });
  });

  test('retorna null cuando el tenant no existe en DB', async () => {
    mockRedis.get.mockResolvedValue(null);
    setupDbRead([]);

    const result = await repo.getConfig(TENANT_ID);

    expect(result).toBeNull();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});

// ── saveConfig ────────────────────────────────────────────────────────────────

describe('configRepository.saveConfig', () => {
  beforeEach(() => jest.clearAllMocks());

  test('guarda en DB e invalida cache Redis', async () => {
    mockRedis.del.mockResolvedValue(1);
    setupDbSave();

    const result = await repo.saveConfig(TENANT_ID, { bot_config: validBotConfig });

    expect(mockPool.connect).toHaveBeenCalled();
    expect(mockRedis.del).toHaveBeenCalledWith(`wa:config:${TENANT_ID}`);
    expect(result).toMatchObject({ tenant_id: TENANT_ID });
  });

  test('lanza error descriptivo cuando bot_config es inválido (Zod)', async () => {
    const invalid = {
      greeting: '',                          // vacío → inválido
      keyword_tree: {},
      escalation: { trigger_keywords: [], message: 'ok', notify_owner: true }, // array vacío
    };

    await expect(repo.saveConfig(TENANT_ID, { bot_config: invalid }))
      .rejects.toThrow('bot_config inválido');

    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  test('invalida cache aunque Redis.del falle (degraded gracefully)', async () => {
    mockRedis.del.mockRejectedValue(new Error('Redis down'));
    setupDbSave();

    await expect(repo.saveConfig(TENANT_ID, { bot_config: validBotConfig }))
      .resolves.toBeDefined();
  });
});

// ── deleteConfig ──────────────────────────────────────────────────────────────

describe('configRepository.deleteConfig', () => {
  beforeEach(() => jest.clearAllMocks());

  test('elimina de DB y Redis, retorna true cuando existía', async () => {
    mockRedis.del.mockResolvedValue(1);
    setupDbDelete(1);

    const result = await repo.deleteConfig(TENANT_ID);

    expect(result).toBe(true);
    expect(mockRedis.del).toHaveBeenCalledWith(`wa:config:${TENANT_ID}`);
  });

  test('retorna false cuando la fila no existía en DB', async () => {
    mockRedis.del.mockResolvedValue(0);
    setupDbDelete(0);

    expect(await repo.deleteConfig(TENANT_ID)).toBe(false);
  });

  test('siempre invalida cache aunque no haya fila en DB', async () => {
    mockRedis.del.mockResolvedValue(0);
    setupDbDelete(0);

    await repo.deleteConfig(TENANT_ID);

    expect(mockRedis.del).toHaveBeenCalledWith(`wa:config:${TENANT_ID}`);
  });
});
