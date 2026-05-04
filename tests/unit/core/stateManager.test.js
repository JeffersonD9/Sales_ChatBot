'use strict';

const mockQuery = jest.fn();

jest.mock('../../../src/db', () => ({ query: mockQuery }));
jest.mock('../../../src/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const {
  getState,
  saveState,
  clearState,
  getActiveSessions,
  _resetForTest,
} = require('../../../src/core/state/manager');

beforeEach(() => {
  _resetForTest();
  mockQuery.mockReset();
  // NODE_ENV=test makes isDemo()=true by default — override for DB tests
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function dbRow(overrides = {}) {
  return {
    rows: [{
      step:              'MENU',
      data:              { name: 'Ana' },
      shown_products:    [1, 2],
      last_activity:     new Date('2026-01-01').toISOString(),
      reactivation_sent: false,
      created_at:        new Date('2026-01-01').toISOString(),
      ...overrides,
    }],
  };
}

// ── Demo / test mode (isDemo = true) ─────────────────────────────────────────

describe('getState — demo mode (NODE_ENV=test)', () => {
  test('returns default session for unknown user', async () => {
    const session = await getState('tienda-a', '57300000001');
    expect(session.step).toBe('NEW');
    expect(session.tenantSlug).toBe('tienda-a');
    expect(session.waFrom).toBe('57300000001');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns cached session on second call', async () => {
    const s1 = await getState('tienda-a', '57300000002');
    s1.step = 'CATALOG_TALLA';
    const s2 = await getState('tienda-a', '57300000002');
    expect(s2.step).toBe('CATALOG_TALLA');
    expect(mockQuery).not.toHaveBeenCalled();
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
    expect(mockQuery).not.toHaveBeenCalled();
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

// ── Production mode (DEMO_MODE=false, NODE_ENV overridden) ───────────────────

describe('getState — production mode', () => {
  beforeEach(() => {
    _resetForTest();
    // Temporarily override isDemo to false by setting NODE_ENV to production
    process.env.NODE_ENV  = 'production';
    process.env.DEMO_MODE = 'false';
  });

  afterEach(() => {
    process.env.NODE_ENV  = 'test';
    delete process.env.DEMO_MODE;
  });

  test('hydrates session from DB on cache miss', async () => {
    mockQuery.mockResolvedValueOnce(dbRow());
    const session = await getState('tienda-b', '57300000010');
    expect(session.step).toBe('MENU');
    expect(session.data).toEqual({ name: 'Ana' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('returns default session when DB returns no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const session = await getState('tienda-b', '57300000011');
    expect(session.step).toBe('NEW');
  });

  test('returns default session when DB throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const session = await getState('tienda-b', '57300000012');
    expect(session.step).toBe('NEW');
  });

  test('uses L1 cache on second call — DB queried only once', async () => {
    mockQuery.mockResolvedValue(dbRow());
    await getState('tienda-b', '57300000013');
    await getState('tienda-b', '57300000013');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('concurrent calls share one DB query (pending mutex)', async () => {
    let resolve;
    const deferred = new Promise((r) => { resolve = r; });
    mockQuery.mockReturnValueOnce(deferred.then(() => dbRow()));

    // Start both calls synchronously before either can resolve
    const p1 = getState('tienda-b', '57300000014');
    const p2 = getState('tienda-b', '57300000014');

    // Unblock the DB query
    resolve();

    const [s1, s2] = await Promise.all([p1, p2]);

    // Both should resolve to the same object (pending map deduplicated the query)
    expect(s1).toBe(s2);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('multitenant isolation in production — distinct DB queries per tenant', async () => {
    mockQuery
      .mockResolvedValueOnce(dbRow({ step: 'MENU' }))
      .mockResolvedValueOnce(dbRow({ step: 'ORDER_NAME' }));

    const a = await getState('tienda-c', '57300000015');
    const b = await getState('tienda-d', '57300000015');
    expect(a.step).toBe('MENU');
    expect(b.step).toBe('ORDER_NAME');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe('saveState — production mode', () => {
  beforeEach(() => {
    _resetForTest();
    process.env.NODE_ENV  = 'production';
    process.env.DEMO_MODE = 'false';
  });

  afterEach(() => {
    process.env.NODE_ENV  = 'test';
    delete process.env.DEMO_MODE;
  });

  test('awaits DB write (not fire-and-forget)', async () => {
    const session = { step: 'ORDER_NAME', data: {}, shownProducts: [], reactivationSent: false };
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await saveState('tienda-e', '57300000020', session);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO sessions');
  });

  test('does not throw when DB write fails — logs error', async () => {
    const session = { step: 'MENU', data: {}, shownProducts: [], reactivationSent: false };
    mockQuery.mockRejectedValueOnce(new Error('db down'));
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
    await getState('tienda-h', '5730001'); // different tenant, same phone

    const sessions = getActiveSessions('tienda-g');
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.tenantSlug === 'tienda-g')).toBe(true);
  });

  test('returns empty array for tenant with no sessions', () => {
    expect(getActiveSessions('no-such-tenant')).toEqual([]);
  });
});
