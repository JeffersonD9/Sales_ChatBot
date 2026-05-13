'use strict';

/**
 * tests/integration/webhook.test.js
 *
 * Integration tests for POST /webhook/:slug using supertest.
 * Tests the full request pipeline: HMAC verification → dispatcher → 200 response.
 *
 * The dispatcher and flow engine are mocked so we test only the HTTP layer.
 * A real Express app instance is used from the WhatsApp ESM boundary.
 */

const { createHmac } = require('crypto');
const supertest      = require('supertest');

// ── Mocks: block all I/O that app.js would normally open ─────────────────────

const mockTenantLoader = {
  get: jest.fn().mockResolvedValue({
    slug: 'test-tenant',
    verify_token: 'my-verify-token',
    wa_token: 'wa-token',
    bot_config: {},
    products: [],
  }),
  cachedSlugs: jest.fn().mockReturnValue([]),
  invalidate: jest.fn(),
};

const mockPlatformData = {
  db: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    healthCheck: jest.fn().mockResolvedValue(true),
    isDbConnectionError: jest.fn().mockReturnValue(false),
  },
  redis: {
    getRedis: jest.fn(() => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() })),
    redisHealthCheck: jest.fn().mockResolvedValue(true),
  },
  platformDb: {
    platformHealthCheck: jest.fn().mockResolvedValue(true),
  },
  connectionManager: {
    getDefaultTenantAllocation: jest.fn(() => ({
      allocationId: 'primary',
      clusterId: 'primary-shared',
      strategy: 'shared-low',
      databaseUrl: 'postgres://test',
    })),
  },
  tenantLoader: mockTenantLoader,
};

jest.unstable_mockModule('../../packages/platform-data/index.js', () => ({
  default: mockPlatformData,
}));

jest.unstable_mockModule('@whatsapp-saas/logger', () => ({
  default: { logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } },
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// Mock queue producer so background processing doesn't run
const mockEnqueue = jest.fn().mockResolvedValue({ id: 'job-1' });
jest.unstable_mockModule('../../apps/wa-session-manager/producers/whatsappInboundProducer.js', () => ({
  enqueueInboundWebhook: mockEnqueue,
}));

// Mock tenant loader — returns a tenant so verification passes
// ── Helpers ───────────────────────────────────────────────────────────────────

const APP_SECRET = 'test-app-secret-32chars-xxxxxxxx';

function signBody(body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = createHmac('sha256', APP_SECRET).update(payload).digest('hex');
  return `sha256=${sig}`;
}

function metaPayload(waFrom = '57300000001') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          messages: [{
            from: waFrom,
            id:   'wamid.abc123',
            type: 'text',
            text: { body: 'hola' },
            timestamp: String(Math.floor(Date.now() / 1000)),
          }],
          metadata: { phone_number_id: '123456', display_phone_number: '+57300000000' },
        },
        field: 'messages',
      }],
    }],
  };
}

// ── App setup ─────────────────────────────────────────────────────────────────

let app;
beforeAll(() => {
  process.env.META_APP_SECRET = APP_SECRET;
  process.env.DEMO_MODE       = 'false';
  process.env.NODE_ENV        = 'test';
});

beforeAll(async () => {
  ({ default: app } = await import('../../apps/wa-session-manager/app.js'));
});

afterAll(() => {
  delete process.env.META_APP_SECRET;
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── GET /webhook/:slug — verification handshake ───────────────────────────────

describe('GET /webhook/:slug', () => {
  test('returns 200 and challenge when token matches', async () => {
    const res = await supertest(app)
      .get('/webhook/test-tenant')
      .query({
        'hub.mode':         'subscribe',
        'hub.verify_token': 'my-verify-token',
        'hub.challenge':    'challenge-xyz',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge-xyz');
  });

  test('returns 403 when verify_token is wrong', async () => {
    const res = await supertest(app)
      .get('/webhook/test-tenant')
      .query({
        'hub.mode':         'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge':    'challenge-xyz',
      });

    expect(res.status).toBe(403);
  });

  test('returns 400 when hub.mode is not subscribe', async () => {
    const res = await supertest(app)
      .get('/webhook/test-tenant')
      .query({
        'hub.mode':         'unsubscribe',
        'hub.verify_token': 'my-verify-token',
        'hub.challenge':    'challenge-xyz',
      });

    expect(res.status).toBe(400);
  });
});

// ── POST /webhook/:slug — message delivery ─────────────────────────────────────

describe('POST /webhook/:slug', () => {
  test('returns 200 immediately with valid HMAC', async () => {
    const body = metaPayload();
    const sig  = signBody(body);

    const res = await supertest(app)
      .post('/webhook/test-tenant')
      .set('x-hub-signature-256', sig)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(200);
  });

  test('enqueues message in background after 200', async () => {
    const body = metaPayload();
    const sig  = signBody(body);

    await supertest(app)
      .post('/webhook/test-tenant')
      .set('x-hub-signature-256', sig)
      .set('Content-Type', 'application/json')
      .send(body);

    // enqueue is called via setImmediate — wait one tick
    await new Promise((r) => setImmediate(r));
    expect(mockEnqueue).toHaveBeenCalledWith('test-tenant', expect.any(Object));
  });

  test('returns 401 when HMAC signature is missing', async () => {
    const body = metaPayload();

    const res = await supertest(app)
      .post('/webhook/test-tenant')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(401);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test('returns 401 when HMAC signature is wrong', async () => {
    const body = metaPayload();

    const res = await supertest(app)
      .post('/webhook/test-tenant')
      .set('x-hub-signature-256', 'sha256=deadbeefdeadbeef')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(401);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test('returns 200 even when META_APP_SECRET is not set (no signature check)', async () => {
    delete process.env.META_APP_SECRET;
    const body = metaPayload();

    const res = await supertest(app)
      .post('/webhook/test-tenant')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(200);
    process.env.META_APP_SECRET = APP_SECRET;
  });
});

// ── GET /health ───────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns 200 with status field', async () => {
    const res = await supertest(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
  });
});

// ── GET /metrics — protegido por ADMIN_API_KEY ────────────────────────────────

describe('GET /metrics', () => {
  const ADMIN_KEY = 'test-admin-api-key-32chars-xxxxxxx';

  beforeAll(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  test('returns 401 without X-Api-Key', async () => {
    const res = await supertest(app).get('/metrics');
    expect(res.status).toBe(401);
  });

  test('returns 401 with wrong X-Api-Key', async () => {
    const res = await supertest(app)
      .get('/metrics')
      .set('x-api-key', 'wrong-key');
    expect(res.status).toBe(401);
  });

  test('returns 200 with correct X-Api-Key', async () => {
    const res = await supertest(app)
      .get('/metrics')
      .set('x-api-key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.text).toContain('whatsapp_saas_uptime_seconds');
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────

describe('404 handler', () => {
  test('unknown route returns 404', async () => {
    const res = await supertest(app).get('/no-such-route');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});
