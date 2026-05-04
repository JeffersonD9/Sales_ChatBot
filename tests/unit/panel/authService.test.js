'use strict';

/**
 * tests/unit/panel/authService.test.js
 *
 * Tests unitarios de src/panel/auth/service.js
 *
 * Mocks:
 *   · src/db.js    → función query simulada
 *   · bcrypt       → hash y compare
 *   · jsonwebtoken → sign y verify
 */

// ── Variables de entorno para tests ──────────────────────────────────────────
process.env.PANEL_JWT_SECRET     = 'test_panel_jwt_secret_min_64_chars_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.PANEL_REFRESH_SECRET = 'test_panel_refresh_secret_min_64_chars_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn();

jest.mock('../../../src/db', () => ({
  query: (...args) => mockQuery(...args),
}));

jest.mock('../../../src/redis', () => ({
  getRedis: jest.fn(() => null),
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ── Imports (después de los mocks) ────────────────────────────────────────────

const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const service = require('../../../src/panel/auth/service');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID    = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SESSION_ID = 'ffffffff-gggg-hhhh-iiii-jjjjjjjjjjjj';

async function makePasswordHash() {
  return bcrypt.hash('CorrectPassword123!', 12);
}

// Helper para simular rate limit limpio (sin bloqueo)
function mockRateLimitClear() {
  mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT panel_rate_limits → ningún registro
  mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT/UPDATE rate limit
}

// Helper para simular creación de sesión
function mockCreateSession() {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: SESSION_ID }] }); // INSERT panel_sessions
}

// ── Test 1: Login exitoso ─────────────────────────────────────────────────────

describe('service.login — exitoso', () => {
  beforeEach(() => jest.clearAllMocks());

  test('genera access token, refresh token y crea sesión en DB', async () => {
    const hash = await makePasswordHash();

    // 1. Rate limit check (sin registro previo)
    mockRateLimitClear();

    // 2. SELECT panel_users
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id:            USER_ID,
        username:      'jefferson',
        email:         'jefferson@test.com',
        role:          'super_admin',
        tenant_id:     null,
        password_hash: hash,
        is_active:     true,
      }],
    });

    // 3. DELETE rate limit (clear on success)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // 4. INSERT panel_sessions
    mockCreateSession();

    const result = await service.login('jefferson', 'CorrectPassword123!', '127.0.0.1', 'TestAgent');

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.refreshToken).toHaveLength(128); // hex de 64 bytes
    expect(result.user.username).toBe('jefferson');
    expect(result.user.role).toBe('super_admin');

    // Verificar que el access token es un JWT válido
    const payload = jwt.verify(result.accessToken, process.env.PANEL_JWT_SECRET);
    expect(payload.sub).toBe(USER_ID);
    expect(payload.username).toBe('jefferson');
    expect(payload.sid).toBe(SESSION_ID);
  });
});

// ── Test 2: Login con password incorrecto ─────────────────────────────────────

describe('service.login — password incorrecto', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rechaza sin revelar si el usuario existe', async () => {
    const hash = await makePasswordHash();

    mockRateLimitClear();

    mockQuery.mockResolvedValueOnce({
      rows: [{
        id:            USER_ID,
        username:      'jefferson',
        email:         'jefferson@test.com',
        role:          'super_admin',
        tenant_id:     null,
        password_hash: hash,
        is_active:     true,
      }],
    });

    // El DELETE de rate limit no se llama porque el login falló
    // Pero el servicio no vuelve a incrementar porque el rate limit ya fue
    // verificado al inicio (no hay intento fallido de update aquí en nuestro flujo)

    await expect(
      service.login('jefferson', 'WrongPassword!', '127.0.0.1', 'TestAgent')
    ).rejects.toMatchObject({ message: 'Credenciales inválidas', status: 401 });

    // Verificar que NO se creó sesión
    const sessionInsert = mockQuery.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO panel_sessions')
    );
    expect(sessionInsert).toBeUndefined();
  });

  test('rechaza aunque el usuario no exista (timing-safe)', async () => {
    mockRateLimitClear();

    // Usuario no encontrado
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      service.login('noexiste', 'AnyPassword!', '127.0.0.1', 'TestAgent')
    ).rejects.toMatchObject({ message: 'Credenciales inválidas', status: 401 });
  });
});

// ── Test 3: Rate limiting ─────────────────────────────────────────────────────

describe('service.login — rate limiting', () => {
  beforeEach(() => jest.clearAllMocks());

  test('bloquea en el 6to intento dentro de la ventana de 15 min', async () => {
    const now = new Date();
    const firstAttempt = new Date(now.getTime() - 5 * 60 * 1000); // 5 min atrás (dentro de ventana)

    // Simular 5 intentos previos dentro de la ventana → cuenta = 5 → se bloquea
    mockQuery.mockResolvedValueOnce({
      rows: [{
        count:            5,
        first_attempt_at: firstAttempt,
        blocked_until:    null,
      }],
    });

    // UPDATE para setear blocked_until
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      service.login('jefferson', 'AnyPassword!', '192.168.1.1', 'TestAgent')
    ).rejects.toMatchObject({ status: 429 });
  });

  test('rechaza inmediatamente si ya está bloqueado', async () => {
    const blockedUntil = new Date(Date.now() + 10 * 60 * 1000); // bloqueado 10 min más

    mockQuery.mockResolvedValueOnce({
      rows: [{
        count:            6,
        first_attempt_at: new Date(Date.now() - 5 * 60 * 1000),
        blocked_until:    blockedUntil,
      }],
    });

    await expect(
      service.login('jefferson', 'AnyPassword!', '10.0.0.1', 'TestAgent')
    ).rejects.toMatchObject({ status: 429 });

    // No debe haber llegado a consultar panel_users
    const userQuery = mockQuery.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('panel_users')
    );
    expect(userQuery).toBeUndefined();
  });
});

// ── Test 4: Refresh — rotación de tokens ─────────────────────────────────────

describe('service.refresh — rotación', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rota tokens: revoca sesión vieja y crea una nueva', async () => {
    // Generar un refresh token real para poder hacer el HMAC
    const crypto = require('crypto');
    const fakeRefreshToken = crypto.randomBytes(64).toString('hex');

    const oldSessionId = 'old-session-id-aaaa';
    const newSessionId = 'new-session-id-bbbb';

    // SELECT panel_sessions JOIN panel_users
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id:          oldSessionId,
        user_id:     USER_ID,
        expires_at:  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días en el futuro
        is_active:   true,
        username:    'jefferson',
        role:        'super_admin',
        tenant_id:   null,
        user_active: true,
      }],
    });

    // UPDATE revocar sesión vieja
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // INSERT nueva sesión
    mockQuery.mockResolvedValueOnce({ rows: [{ id: newSessionId }] });

    const result = await service.refresh(fakeRefreshToken, '127.0.0.1');

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.refreshToken).not.toBe(fakeRefreshToken); // es un token nuevo

    // Verificar que se revocó la sesión vieja
    const revokeCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes("revoke_reason = 'rotated'")
    );
    expect(revokeCall).toBeDefined();
    expect(revokeCall[1][0]).toBe(oldSessionId);

    // Verificar que el nuevo token apunta a la nueva sesión
    const payload = jwt.verify(result.accessToken, process.env.PANEL_JWT_SECRET);
    expect(payload.sid).toBe(newSessionId);
  });

  test('rechaza si el refresh token no existe en DB', async () => {
    const crypto = require('crypto');
    const fakeToken = crypto.randomBytes(64).toString('hex');

    mockQuery.mockResolvedValueOnce({ rows: [] }); // sesión no encontrada

    await expect(service.refresh(fakeToken, '127.0.0.1'))
      .rejects.toMatchObject({ status: 401 });
  });
});

// ── Test 5: validateAccessToken — token expirado ──────────────────────────────

describe('service.validateAccessToken — token expirado', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rechaza un JWT expirado', async () => {
    // Generar un token ya expirado
    const expiredToken = jwt.sign(
      { sub: USER_ID, username: 'jefferson', role: 'super_admin', tenant_id: null, sid: SESSION_ID },
      process.env.PANEL_JWT_SECRET,
      { expiresIn: -1 } // expirado
    );

    await expect(service.validateAccessToken(expiredToken))
      .rejects.toMatchObject({ status: 401 });

    // No debe haber consultado la DB
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ── Test 6: validateAccessToken — sesión revocada en DB ──────────────────────

describe('service.validateAccessToken — sesión revocada', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rechaza aunque el JWT sea válido si la sesión fue revocada en DB', async () => {
    const validToken = jwt.sign(
      { sub: USER_ID, username: 'jefferson', role: 'super_admin', tenant_id: null, sid: SESSION_ID },
      process.env.PANEL_JWT_SECRET,
      { expiresIn: '15m' }
    );

    // DB responde: sesión no existe (fue revocada)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(service.validateAccessToken(validToken))
      .rejects.toMatchObject({ status: 401, message: 'Sesión revocada o expirada' });

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
