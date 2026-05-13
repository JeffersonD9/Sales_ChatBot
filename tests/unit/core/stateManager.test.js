'use strict';

// ── Mock del cliente Drizzle ──────────────────────────────────────────────────

const { createMockDb } = require('../../helpers/mockDb');
const mockDb = createMockDb();
const mockSchema = require('../../../packages/platform-data/src/drizzle/schema');

jest.mock('../../../packages/platform-data', () => ({
  drizzle: { getDb: () => mockDb },
  schema: mockSchema,
}));
jest.mock('@whatsapp-saas/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const {
  getState,
  saveState,
  clearState,
  getActiveSessions,
  _resetForTest,
} = require('../../../apps/message-worker/core/state/manager');

beforeEach(() => {
  _resetForTest();
  jest.clearAllMocks();
  mockDb._clearQueue();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function sessionRow(overrides = {}) {
  return {
    step:              'MENU',
    data:              { name: 'Ana' },
    shown_products:    [1, 2],
    last_activity:     new Date('2026-01-01').toISOString(),
    reactivation_sent: false,
    created_at:        new Date('2026-01-01').toISOString(),
    ...overrides,
  };
}

// ── Demo / test mode (isDemo = true) ─────────────────────────────────────────

describe('getState — demo mode (NODE_ENV=test)', () => {
  test('returns default session for unknown user', async () => {
    const session = await getState('tienda-a', '57300000001');
    expect(session.step).toBe('NEW');
    expect(session.tenantSlug).toBe('tienda-a');
    expect(session.waFrom).toBe('57300000001');
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  test('returns cached session on second call', async () => {
    const s1 = await getState('tienda-a', '57300000002');
    s1.step = 'CATALOG_TALLA';
    const s2 = await getState('tienda-a', '57300000002');
    expect(s2.step).toBe('CATALOG_TALLA');
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  test('multitenant isolation — same phone, different tenants → different sessions', async () => {
    const a = await getState('tienda-a', '57300000003');
    const b = await getState('tienda-b', '57300000003');
    a.step = 'ORDER_NAME';
    expect(b.step).toBe('NEW');
  });
});

describe('saveState — demo mode', () => {
  test('updates L1 cache, skips DB', async () => {
    const session = await getState('tienda-a', '57300000004');
    session.step  = 'ORDER_ADDRESS';
    await saveState('tienda-a', '57300000004', session);
    const fetched = await getState('tienda-a', '57300000004');
    expect(fetched.step).toBe('ORDER_ADDRESS');
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  test('sets reactivationSent = false and updates lastActivity', async () => {
    const session = await getState('tienda-a', '57300000005');
    session.reactivationSent = true;
    const before = Date.now();
    await saveState('tienda-a', '57300000005', session);
    expect(session.reactivationSent).toBe(false);
    expect(session.lastActivity).toBeGreaterThanOrEqual(before);
  });
});

// ── Production mode ───────────────────────────────────────────────────────────

describe('getState — production mode', () => {
  beforeEach(() => {
    _resetForTest();
    mockDb._clearQueue();
    process.env.NODE_ENV  = 'production';
    process.env.DEMO_MODE = 'false';
  });

  afterEach(() => {
    process.env.NODE_ENV  = 'test';
    delete process.env.DEMO_MODE;
  });

  test('hydrates session from DB on cache miss', async () => {
    mockDb._enqueue([sessionRow()]);
    const session = await getState('tienda-b', '57300000010');
    expect(session.step).toBe('MENU');
    expect(session.data).toEqual({ name: 'Ana' });
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  test('returns default session when DB returns no rows', async () => {
    mockDb._enqueue([]);
    const session = await getState('tienda-b', '57300000011');
    expect(session.step).toBe('NEW');
  });

  test('returns default session when DB throws', async () => {
    mockDb._enqueue(Promise.reject(new Error('connection refused')));
    const session = await getState('tienda-b', '57300000012');
    expect(session.step).toBe('NEW');
  });

  test('uses L1 cache on second call — DB queried only once', async () => {
    mockDb._enqueue([sessionRow()]);
    await getState('tienda-b', '57300000013');
    await getState('tienda-b', '57300000013');
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  test('concurrent calls share one DB query (pending mutex)', async () => {
    let resolveDeferred;
    const deferred = new Promise((r) => { resolveDeferred = r; });

    // Enqueue a deferred row so the first call blocks until we resolve
    mockDb._enqueue(deferred.then(() => [sessionRow()]));

    const p1 = getState('tienda-b', '57300000014');
    const p2 = getState('tienda-b', '57300000014');

    resolveDeferred();

    const [s1, s2] = await Promise.all([p1, p2]);

    expect(s1).toBe(s2);
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  test('multitenant isolation in production — distinct DB queries per tenant', async () => {
    mockDb
      ._enqueue([sessionRow({ step: 'MENU' })])
      ._enqueue([sessionRow({ step: 'ORDER_NAME' })]);

    const a = await getState('tienda-c', '57300000015');
    const b = await getState('tienda-d', '57300000015');
    expect(a.step).toBe('MENU');
    expect(b.step).toBe('ORDER_NAME');
    expect(mockDb.select).toHaveBeenCalledTimes(2);
  });
});

describe('saveState — production mode', () => {
  beforeEach(() => {
    _resetForTest();
    mockDb._clearQueue();
    process.env.NODE_ENV  = 'production';
    process.env.DEMO_MODE = 'false';
  });

  afterEach(() => {
    process.env.NODE_ENV  = 'test';
    delete process.env.DEMO_MODE;
  });

  test('awaits DB write (not fire-and-forget)', async () => {
    const session = { step: 'ORDER_NAME', data: {}, shownProducts: [], reactivationSent: false };
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await saveState('tienda-e', '57300000020', session);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  test('does not throw when DB write fails — logs error', async () => {
    const session = { step: 'MENU', data: {}, shownProducts: [], reactivationSent: false };
    mockDb.execute.mockRejectedValueOnce(new Error('db down'));
    await expect(saveState('tienda-e', '57300000021', session)).resolves.toBeUndefined();
  });
});

// ── clearState ────────────────────────────────────────────────────────────────

describe('clearState', () => {
  test('removes session from L1 in demo mode', async () => {
    const s = await getState('tienda-f', '57300000030');
    s.step = 'ORDER_NAME';
    await clearState('tienda-f', '57300000030');
    const fresh = await getState('tienda-f', '57300000030');
    expect(fresh.step).toBe('NEW');
  });
});

// ── getActiveSessions ─────────────────────────────────────────────────────────

describe('getActiveSessions', () => {
  test('returns only sessions for the given tenant', async () => {
    await getState('tienda-g', '5730001');
    await getState('tienda-g', '5730002');
    await getState('tienda-h', '5730001');

    const result = getActiveSessions('tienda-g');
    expect(result).toHaveLength(2);
    expect(result.every((s) => s.tenantSlug === 'tienda-g')).toBe(true);
  });

  test('returns empty array for tenant with no sessions', () => {
    expect(getActiveSessions('no-such-tenant')).toEqual([]);
  });
});
