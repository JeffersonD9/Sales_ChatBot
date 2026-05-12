'use strict';

const crypto = require('crypto');

jest.mock('../../../src/utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

let verifyMetaSignature;

const SECRET = 'test_secret_1234567890abcdef';
const BODY   = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

function makeReq({ signature, rawBody } = {}) {
  return {
    path: '/webhook/test',
    rawBody: rawBody !== undefined ? rawBody : BODY,
    headers: signature !== undefined ? { 'x-hub-signature-256': signature } : {},
  };
}

function sign(body, secret = SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyMetaSignature', () => {
  beforeAll(async () => {
    ({ verifyMetaSignature } = await import('../../../src/services/whatsapp/webhooks/verifier.js'));
  });

  it('retorna true con firma valida', () => {
    const req = makeReq({ signature: sign(BODY) });
    expect(verifyMetaSignature(req, SECRET)).toBe(true);
  });

  it('retorna false sin header de firma', () => {
    const req = makeReq({ signature: undefined });
    expect(verifyMetaSignature(req, SECRET)).toBe(false);
  });

  it('retorna false con firma de secret incorrecto', () => {
    const req = makeReq({ signature: sign(BODY, 'wrong_secret') });
    expect(verifyMetaSignature(req, SECRET)).toBe(false);
  });

  it('retorna false con body alterado', () => {
    const req = makeReq({ signature: sign(BODY), rawBody: BODY + ' ' });
    expect(verifyMetaSignature(req, SECRET)).toBe(false);
  });

  it('retorna false sin rawBody', () => {
    const req = makeReq({ signature: sign(BODY), rawBody: '' });
    expect(verifyMetaSignature(req, SECRET)).toBe(false);
  });

  it('retorna false con firma malformada (sin prefijo sha256=)', () => {
    const req = makeReq({
      signature: crypto.createHmac('sha256', SECRET).update(BODY).digest('hex'),
    });
    expect(verifyMetaSignature(req, SECRET)).toBe(false);
  });

  it('retorna false con firma truncada (distinto largo)', () => {
    const req = makeReq({ signature: 'sha256=abc123' });
    expect(verifyMetaSignature(req, SECRET)).toBe(false);
  });
});
