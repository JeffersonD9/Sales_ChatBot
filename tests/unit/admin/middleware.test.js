'use strict';

// Mock Redis → null para que progressiveBackoff use el fallback en memoria
jest.mock('../../../src/redis', () => ({ getRedis: () => null }));

jest.mock('../../../src/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function makeReqRes(apiKey, ip = '127.0.0.1') {
  const req = {
    headers:  { 'x-api-key': apiKey, 'user-agent': 'test' },
    ip,
    path:     '/admin/tenants',
    socket:   { remoteAddress: ip },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json:   jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

beforeEach(() => {
  process.env.ADMIN_API_KEY = 'supersecretkey';
  jest.resetModules();
  // Re-aplicar mocks después de resetModules
  jest.mock('../../../src/redis', () => ({ getRedis: () => null }));
  jest.mock('../../../src/utils/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
  }));
});

describe('requireApiKey', () => {
  test('allows request with correct API key', async () => {
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    const { req, res, next } = makeReqRes('supersecretkey');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects request with wrong API key — 401', async () => {
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    const { req, res, next } = makeReqRes('wrongkey');
    await mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  test('rejects request with no API key — 401', async () => {
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    const { req, res, next } = makeReqRes(undefined);
    await mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('rejects request with empty API key — 401', async () => {
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    const { req, res, next } = makeReqRes('');
    await mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('uses timing-safe comparison — prefix of real key is still rejected', async () => {
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    const { req, res, next } = makeReqRes('supersecret'); // prefix, not the full key
    await mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('blocks after maxAttempts failed requests from same IP — 429', async () => {
    const { requireApiKey: mw, adminMiddleware } = require('../../../src/admin/middleware');

    const MAX = 5; // progressiveBackoff maxAttempts default

    // Primeros MAX intentos: rechazados con 401 pero no bloqueados aún
    for (let i = 0; i < MAX; i++) {
      const { req, res, next } = makeReqRes('wrongkey', '10.0.0.1');
      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    }

    // El backoff.middleware() debería bloquear con 429 en la siguiente petición
    const backoffMw = adminMiddleware[2]; // [whitelist, headers, backoff.middleware(), requireApiKey]
    const { req, res, next } = makeReqRes('wrongkey', '10.0.0.1');
    await backoffMw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  test('block is per-IP — different IP passes after another IP is blocked', async () => {
    const { requireApiKey: mw, adminMiddleware } = require('../../../src/admin/middleware');

    // Agotar intentos para IP A
    for (let i = 0; i < 5; i++) {
      const { req, res } = makeReqRes('wrongkey', '10.0.0.10');
      await mw(req, res, jest.fn());
    }

    // IP B con key correcta debe pasar sin problema
    const backoffMw = adminMiddleware[2];
    const { req, res, next } = makeReqRes('supersecretkey', '10.0.0.11');
    await backoffMw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects empty key even when ADMIN_API_KEY is not set', async () => {
    delete process.env.ADMIN_API_KEY;
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    const { req, res, next } = makeReqRes('');
    await mw(req, res, next);
    // keyBuf.length === 0 → explícitamente rechazado
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
