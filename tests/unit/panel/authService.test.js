'use strict';

/**
 * tests/unit/panel/authService.test.js
 *
 * Tests unitarios de src/panel/auth/service.js
 *
 * Mocks:
 *   · src/drizzle/db → mock Drizzle con cola de resultados
 *   · bcrypt         → hash y compare reales (cost 1 para velocidad)
 *   · jsonwebtoken   → comportamiento real
 */

process.env.PANEL_JWT_SECRET     = 'test_panel_jwt_secret_min_64_chars_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.PANEL_REFRESH_SECRET = 'test_panel_refresh_secret_min_64_chars_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

// ── Mock del cliente Drizzle ──────────────────────────────────────────────────

const { createMockDb } = require('../../helpers/mockDb');
const mockDb = createMockDb();

jest.mock('../../../src/drizzle/db', () => ({ getDb: () => mockDb }));
jest.mock('../../../src/db', () => ({ getPool: jest.fn() }));
jest.mock('../../../src/redis', () => ({ getRedis: jest.fn(() => null) }));
jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const service = require('../../../src/panel/auth/service');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID    = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SESSION_ID = 'ffffffff-0000-1111-2222-333333333333';

async function makePasswordHash() {
  return bcrypt.hash('CorrectPassword123!', 1); // cost 1 para velocidad en tests
}

// Sin registro de rate limit previo (permite el login)
function enqueueRateLimitClear() {
  mockDb._enqueue([]); // SELECT panel_rate_limits → ningún registro
  mockDb._enqueue([]);  // INSERT rate limit
}

// Sesión insertada correctamente
function enqueueCreateSession(sessionId = SESSION_ID) {
  mockDb._enqueue([{ id: sessionId }]); // INSERT panel_sessions
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb._clearQueue();
});

// ── Login exitoso ─────────────────────────────────────────────────────────────

describe('service.login — exitoso', () => {
  test('genera access token, refresh token y crea sesión en DB', async () => {
    const hash = await makePasswordHash();

    enqueueRateLimitClear();

    mockDb._enqueue([{
      id:            USER_ID,
      username:      'jefferson',
      email:         'jefferson@test.com',
      role:          'super_admin',
      tenant_id:     null,
      password_hash: hash,
      is_active:     true,
    }]);

    mockDb._enqueue([]); // DELETE rate limit (clear on success)
    enqueueCreateSession();

    const result = await service.login('jefferson', 'CorrectPassword123!', '127.0.0.1', 'TestAgent');

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.refreshToken).toHaveLength(128); // hex de 64 bytes
    expect(result.user.username).toBe('jefferson');
    expect(result.user.role).toBe('super_admin');

    const payload = jwt.verify(result.accessToken, process.env.PANEL_JWT_SECRET);
    expect(payload.sub).toBe(USER_ID);
    expect(payload.username).toBe('jefferson');
    expect(payload.sid).toBe(SESSION_ID);
  });
});

// ── Login con password incorrecto ─────────────────────────────────────────────

describe('service.login — password incorrecto', () => {
  test('rechaza sin revelar si el usuario existe', async () => {
    const hash = await makePasswordHash();

    enqueueRateLimitClear();

    mockDb._enqueue([{
      id:            USER_ID,
      username:      'jefferson',
      email:         'jefferson@test.com',
      role:          'super_admin',
      tenant_id:     null,
      password_hash: hash,
      is_active:     true,
    }]);

    await expect(
      service.login('jefferson', 'WrongPassword!', '127.0.0.1', 'TestAgent')
    ).rejects.toMatchObject({ message: 'Credenciales inválidas', status: 401 });

    // Solo el insert del rate limit (1 call), no el de panel_sessions
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  test('rechaza aunque el usuario no exista (timing-safe)', async () => {
    enqueueRateLimitClear();
    mockDb._enqueue([]); // SELECT panel_users → vacío

    await expect(
      service.login('noexiste', 'AnyPassword!', '127.0.0.1', 'TestAgent')
    ).rejects.toMatchObject({ message: 'Credenciales inválidas', status: 401 });
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe('service.login — rate limiting', () => {
  test('bloquea en el 6to intento dentro de la ventana de 15 min', async () => {
    const now          = new Date();
    const firstAttempt = new Date(now.getTime() - 5 * 60 * 1000);

    // 5 intentos previos → se bloquea al incrementar
    mockDb._enqueue([{ count: 5, first_attempt_at: firstAttempt, blocked_until: null }]);
    mockDb._enqueue([]); // UPDATE blocked_until

    await expect(
      service.login('jefferson', 'AnyPassword!', '192.168.1.1', 'TestAgent')
    ).rejects.toMatchObject({ status: 429 });
  });

  test('rechaza inmediatamente si ya está bloqueado', async () => {
    const blockedUntil = new Date(Date.now() + 10 * 60 * 1000);

    mockDb._enqueue([{
      count:            6,
      first_attempt_at: new Date(Date.now() - 5 * 60 * 1000),
      blocked_until:    blockedUntil,
    }]);

    await expect(
      service.login('jefferson', 'AnyPassword!', '10.0.0.1', 'TestAgent')
    ).rejects.toMatchObject({ status: 429 });

    // No llegó a consultar panel_users
    expect(mockDb.select).toHaveBeenCalledTimes(1); // solo el rate limit check
  });
});

// ── Refresh — rotación de tokens ──────────────────────────────────────────────

describe('service.refresh — rotación', () => {
  test('rota tokens: revoca sesión vieja y crea una nueva', async () => {
    const crypto           = require('crypto');
    const fakeRefreshToken = crypto.randomBytes(64).toString('hex');
    const oldSessionId     = 'old-session-id-aaaa';
    const newSessionId     = 'new-session-id-bbbb';

    // SELECT panel_sessions JOIN panel_users
    mockDb._enqueue([{
      id:          oldSessionId,
      user_id:     USER_ID,
      expires_at:  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      is_active:   true,
      username:    'jefferson',
      role:        'super_admin',
      tenant_id:   null,
      user_active: true,
    }]);

    mockDb._enqueue([]);                      // UPDATE revocar sesión vieja
    mockDb._enqueue([{ id: newSessionId }]);  // INSERT nueva sesión

    const result = await service.refresh(fakeRefreshToken, '127.0.0.1');

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.refreshToken).not.toBe(fakeRefreshToken);

    // Verificar que se revocó la sesión (update fue llamado)
    expect(mockDb.update).toHaveBeenCalledTimes(1);

    const payload = jwt.verify(result.accessToken, process.env.PANEL_JWT_SECRET);
    expect(payload.sid).toBe(newSessionId);
  });

  test('rechaza si el refresh token no existe en DB', async () => {
    const crypto    = require('crypto');
    const fakeToken = crypto.randomBytes(64).toString('hex');

    mockDb._enqueue([]); // sesión no encontrada

    await expect(service.refresh(fakeToken, '127.0.0.1'))
      .rejects.toMatchObject({ status: 401 });
  });
});

// ── validateAccessToken — token expirado ──────────────────────────────────────

describe('service.validateAccessToken — token expirado', () => {
  test('rechaza un JWT expirado', async () => {
    const expiredToken = jwt.sign(
      { sub: USER_ID, username: 'jefferson', role: 'super_admin', tenant_id: null, sid: SESSION_ID },
      process.env.PANEL_JWT_SECRET,
      { expiresIn: -1 }
    );

    await expect(service.validateAccessToken(expiredToken))
      .rejects.toMatchObject({ status: 401 });

    // No consultó la DB porque el JWT ya falló antes
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

// ── validateAccessToken — sesión revocada en DB ───────────────────────────────

describe('service.validateAccessToken — sesión revocada', () => {
  test('rechaza aunque el JWT sea válido si la sesión fue revocada en DB', async () => {
    const validToken = jwt.sign(
      { sub: USER_ID, username: 'jefferson', role: 'super_admin', tenant_id: null, sid: SESSION_ID },
      process.env.PANEL_JWT_SECRET,
      { expiresIn: '15m' }
    );

    mockDb._enqueue([]); // sesión no encontrada en DB (fue revocada)

    await expect(service.validateAccessToken(validToken))
      .rejects.toMatchObject({ status: 401, message: 'Sesión revocada o expirada' });

    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });
});
