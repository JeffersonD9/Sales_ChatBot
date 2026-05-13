'use strict';

/**
 * tests/unit/tenants/configRepository.test.js
 *
 * Tests unitarios de packages/platform-data/src/tenant/repositories/whatsappConfigRepository.js
 *
 * Mocks:
 *   - packages/platform-data/src/drizzle/db: mock Drizzle con cola de resultados
 *   - packages/platform-data/src/redis.js: cliente Redis simulado
 */

// ── Mock del cliente Drizzle ──────────────────────────────────────────────────

const { createMockDb } = require('../../helpers/mockDb');
const mockDb = createMockDb();

jest.mock('../../../packages/platform-data/src/drizzle/db', () => ({ getDb: () => mockDb }));
jest.mock('../../../packages/platform-data/src/db', () => ({ getPool: jest.fn() }));

const mockRedis = {
  get:    jest.fn(),
  set:    jest.fn(),
  del:    jest.fn(),
  expire: jest.fn(),
};

jest.mock('../../../packages/platform-data/src/redis', () => ({
  getRedis: jest.fn(() => mockRedis),
}));

jest.mock('@whatsapp-saas/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ── Imports (después de los mocks) ────────────────────────────────────────────

const repo = require('../../../packages/platform-data/src/tenant/repositories/whatsappConfigRepository');

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

// ── Helpers de encolado ───────────────────────────────────────────────────────

// fromDB: tx.execute(SET LOCAL) + tx.execute(SELECT)
function enqueueDbRead(rows = [dbRow]) {
  mockDb
    ._enqueue({})                      // SET LOCAL execute
    ._enqueue({ rows, rowCount: rows.length }); // SELECT execute
}

// saveConfig: tx.execute(SET LOCAL) + tx.execute(UPSERT RETURNING)
function enqueueDbSave(row = dbRow) {
  mockDb
    ._enqueue({})                                   // SET LOCAL execute
    ._enqueue({ rows: [row], rowCount: 1 });         // UPSERT execute
}

// deleteConfig: tx.execute(SET LOCAL) + tx.delete().where() (thenable)
function enqueueDbDelete(rowCount = 1) {
  mockDb
    ._enqueue({})           // SET LOCAL execute
    ._enqueue({ rowCount }); // delete chain (dequeued via thenable)
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb._clearQueue();
});

// ── getConfig ─────────────────────────────────────────────────────────────────

describe('configRepository.getConfig', () => {
  test('retorna config desde Redis cuando hay cache hit', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(dbRow));

    const result = await repo.getConfig(TENANT_ID);

    expect(mockRedis.get).toHaveBeenCalledWith(`wa:config:${TENANT_ID}`);
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ tenant_id: TENANT_ID });
  });

  test('consulta DB en cache miss y guarda en Redis', async () => {
    mockRedis.get.mockResolvedValue(null);
    enqueueDbRead();

    const result = await repo.getConfig(TENANT_ID);

    expect(mockDb.execute).toHaveBeenCalled();
    expect(mockRedis.set).toHaveBeenCalledWith(
      `wa:config:${TENANT_ID}`, expect.any(String), 'EX', 300
    );
    expect(result).toMatchObject({ tenant_id: TENANT_ID });
  });

  test('degrada a solo DB cuando Redis.get lanza error', async () => {
    mockRedis.get.mockRejectedValue(new Error('Redis down'));
    enqueueDbRead();

    const result = await repo.getConfig(TENANT_ID);

    expect(result).toMatchObject({ tenant_id: TENANT_ID });
  });

  test('retorna null cuando el tenant no existe en DB', async () => {
    mockRedis.get.mockResolvedValue(null);
    enqueueDbRead([]);

    const result = await repo.getConfig(TENANT_ID);

    expect(result).toBeNull();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});

// ── saveConfig ────────────────────────────────────────────────────────────────

describe('configRepository.saveConfig', () => {
  test('guarda en DB e invalida cache Redis', async () => {
    mockRedis.del.mockResolvedValue(1);
    enqueueDbSave();

    const result = await repo.saveConfig(TENANT_ID, { bot_config: validBotConfig });

    expect(mockDb.execute).toHaveBeenCalled();
    expect(mockRedis.del).toHaveBeenCalledWith(`wa:config:${TENANT_ID}`);
    expect(result).toMatchObject({ tenant_id: TENANT_ID });
  });

  test('lanza error descriptivo cuando bot_config es inválido (Zod)', async () => {
    const invalid = {
      greeting: '',
      keyword_tree: {},
      escalation: { trigger_keywords: [], message: 'ok', notify_owner: true },
    };

    await expect(repo.saveConfig(TENANT_ID, { bot_config: invalid }))
      .rejects.toThrow('bot_config inválido');

    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  test('invalida cache aunque Redis.del falle (degraded gracefully)', async () => {
    mockRedis.del.mockRejectedValue(new Error('Redis down'));
    enqueueDbSave();

    await expect(repo.saveConfig(TENANT_ID, { bot_config: validBotConfig }))
      .resolves.toBeDefined();
  });
});

// ── deleteConfig ──────────────────────────────────────────────────────────────

describe('configRepository.deleteConfig', () => {
  test('elimina de DB y Redis, retorna true cuando existía', async () => {
    mockRedis.del.mockResolvedValue(1);
    enqueueDbDelete(1);

    const result = await repo.deleteConfig(TENANT_ID);

    expect(result).toBe(true);
    expect(mockRedis.del).toHaveBeenCalledWith(`wa:config:${TENANT_ID}`);
  });

  test('retorna false cuando la fila no existía en DB', async () => {
    mockRedis.del.mockResolvedValue(0);
    enqueueDbDelete(0);

    expect(await repo.deleteConfig(TENANT_ID)).toBe(false);
  });

  test('siempre invalida cache aunque no haya fila en DB', async () => {
    mockRedis.del.mockResolvedValue(0);
    enqueueDbDelete(0);

    await repo.deleteConfig(TENANT_ID);

    expect(mockRedis.del).toHaveBeenCalledWith(`wa:config:${TENANT_ID}`);
  });
});
