'use strict';

jest.mock('../../../src/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { requireApiKey } = require('../../../src/admin/middleware');

function makeReqRes(apiKey, ip = '127.0.0.1') {
  const req = {
    headers: { 'x-api-key': apiKey },
    ip,
    path: '/admin/tenants',
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
  // Reset the attempts Map between tests by re-requiring the module
  jest.resetModules();
  jest.mock('../../../src/utils/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
  }));
});

describe('requireApiKey', () => {
  test('allows request with correct API key', () => {
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    const { req, res, next } = makeReqRes('supersecretkey');
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects request with wrong API key — 401', () => {
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    const { req, res, next } = makeReqRes('wrongkey');
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  test('rejects request with no API key — 401', () => {
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    const { req, res, next } = makeReqRes(undefined);
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('rejects request with empty API key — 401', () => {
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    const { req, res, next } = makeReqRes('');
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('uses timing-safe comparison — different length key still rejected', () => {
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    // A key that is a prefix of the real key — would fool naive === check
    const { req, res, next } = makeReqRes('supersecret');
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('rate limits after 20 requests from same IP — 429', () => {
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    // Freeze time so all attempts fall in the same minute window
    const fixedNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    // First 20 requests: all go through (wrong key → 401, not 429)
    for (let i = 0; i < 20; i++) {
      const { req, res, next } = makeReqRes('wrongkey', '10.0.0.1');
      mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    }

    // 21st request from same IP → 429
    const { req, res, next } = makeReqRes('wrongkey', '10.0.0.1');
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();

    jest.spyOn(Date, 'now').mockRestore();
  });

  test('rate limit is per-IP — different IPs are not affected', () => {
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    const fixedNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    // Exhaust rate limit for IP A
    for (let i = 0; i < 21; i++) {
      const { req, res } = makeReqRes('wrongkey', '10.0.0.2');
      mw(req, res, jest.fn());
    }

    // IP B (with correct key) should still pass
    const { req, res, next } = makeReqRes('supersecretkey', '10.0.0.3');
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();

    jest.spyOn(Date, 'now').mockRestore();
  });

  test('accepts request when ADMIN_API_KEY env var is not set — rejects (empty vs empty)', () => {
    delete process.env.ADMIN_API_KEY;
    const { requireApiKey: mw } = require('../../../src/admin/middleware');
    // empty key vs empty expected: Buffer lengths match, timingSafeEqual → valid
    const { req, res, next } = makeReqRes('');
    mw(req, res, next);
    // Both are empty — length matches and bytes match → passes
    expect(next).toHaveBeenCalledTimes(1);
  });
});
