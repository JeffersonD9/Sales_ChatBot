'use strict';

const request = require('supertest');
const express = require('express');

// ── Mock del cliente Drizzle ──────────────────────────────────────────────────

const { createMockDb } = require('../../helpers/mockDb');
const mockDb = createMockDb();

jest.mock('../../../src/drizzle/db', () => ({ getDb: () => mockDb }));
jest.mock('../../../src/db', () => ({ getPool: jest.fn(), healthCheck: jest.fn() }));

jest.mock('../../../src/admin/middleware', () => ({
  requireApiKey:   (_req, _res, next) => next(),
  adminMiddleware: [(_req, _res, next) => next()],
}));
jest.mock('../../../src/tenants/repository');
jest.mock('../../../src/tenants/loader', () => ({ invalidate: jest.fn() }));
jest.mock('../../../src/utils/crypto', () => ({ encrypt: jest.fn((v) => `enc:${v}`) }));
jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const repo        = require('../../../src/tenants/repository');
const adminRouter = require('../../../src/admin/router');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  return app;
}

const validTenantBody = {
  slug:            'tienda-uno',
  name:            'Tienda Uno',
  wa_token:        'EAAxxxxxxxxxx',
  phone_number_id: '12345',
  verify_token:    'verifytoken123',
  owner_phone:     '573001234567',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDb._clearQueue();
});

// ── POST /admin/tenants ────────────────────────────────────────────────────────

describe('POST /admin/tenants', () => {
  test('slug con caracteres inválidos → 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/admin/tenants')
      .send({ ...validTenantBody, slug: 'Tienda_INVALIDA' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Solo minúsculas/);
  });

  test('slug demasiado corto → 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/admin/tenants')
      .send({ ...validTenantBody, slug: 'ab' });
    expect(res.status).toBe(400);
  });

  test('owner_phone con letras → 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/admin/tenants')
      .send({ ...validTenantBody, owner_phone: '+57300abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Solo dígitos/);
  });

  test('slug duplicado → 409', async () => {
    mockDb._enqueue([{ id: 'existing-id' }]); // slug check → ocupado
    const app = buildApp();
    const res = await request(app)
      .post('/admin/tenants')
      .send(validTenantBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/tienda-uno/);
  });

  test('teléfono duplicado → 409', async () => {
    mockDb._enqueue([]);                   // slug check → libre
    mockDb._enqueue([{ id: 'other-id' }]); // phone check → ocupado
    const app = buildApp();
    const res = await request(app)
      .post('/admin/tenants')
      .send(validTenantBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/teléfono/);
  });

  test('datos válidos → 201 con tenant', async () => {
    mockDb._enqueue([]); // slug libre
    mockDb._enqueue([]); // phone libre
    repo.create.mockResolvedValue({ id: 'new-id', slug: 'tienda-uno', name: 'Tienda Uno', status: 'active' });
    const app = buildApp();
    const res = await request(app)
      .post('/admin/tenants')
      .send(validTenantBody);
    expect(res.status).toBe(201);
    expect(res.body.tenant.slug).toBe('tienda-uno');
  });
});

// ── PATCH /admin/tenants/:slug ─────────────────────────────────────────────────

describe('PATCH /admin/tenants/:slug', () => {
  test('status inválido → 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch('/admin/tenants/tienda-uno')
      .send({ status: 'deleted' });
    expect(res.status).toBe(400);
  });

  test('suspender tenant → 200', async () => {
    repo.update.mockResolvedValue({
      id: 'x', slug: 'tienda-uno', name: 'Tienda Uno', status: 'suspended', meta_live: false, meta_connected_at: null,
    });
    const app = buildApp();
    const res = await request(app)
      .patch('/admin/tenants/tienda-uno')
      .send({ status: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.tenant.status).toBe('suspended');
  });

  test('tenant no encontrado → 404', async () => {
    repo.update.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .patch('/admin/tenants/no-existe')
      .send({ name: 'Nuevo nombre' });
    expect(res.status).toBe(404);
  });

  test('cambiar teléfono a uno ya usado → 409', async () => {
    mockDb._enqueue([{ id: 'other' }]); // phone en uso
    const app = buildApp();
    const res = await request(app)
      .patch('/admin/tenants/tienda-uno')
      .send({ owner_phone: '573009999999' });
    expect(res.status).toBe(409);
  });
});

// ── PATCH /admin/tenants/:slug/status ─────────────────────────────────────────

describe('PATCH /admin/tenants/:slug/status', () => {
  test('status válido → 200', async () => {
    repo.update.mockResolvedValue({
      id: 'x', slug: 'tienda-uno', name: 'T', status: 'suspended', meta_live: false, meta_connected_at: null,
    });
    const app = buildApp();
    const res = await request(app)
      .patch('/admin/tenants/tienda-uno/status')
      .send({ status: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.tenant.status).toBe('suspended');
    expect(repo.update).toHaveBeenCalledWith('tienda-uno', { status: 'suspended' });
  });

  test('sin status en body → 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch('/admin/tenants/tienda-uno/status')
      .send({});
    expect(res.status).toBe(400);
  });

  test('tenant no existe → 404', async () => {
    repo.update.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .patch('/admin/tenants/no-existe/status')
      .send({ status: 'active' });
    expect(res.status).toBe(404);
  });
});

// ── PATCH /admin/tenants/:slug/meta-status ────────────────────────────────────

describe('PATCH /admin/tenants/:slug/meta-status', () => {
  test('meta_live: true → meta_connected_at en respuesta', async () => {
    const connectedAt = new Date().toISOString();
    repo.update.mockResolvedValue({
      slug: 'tienda-uno', meta_live: true, meta_connected_at: connectedAt,
    });
    const app = buildApp();
    const res = await request(app)
      .patch('/admin/tenants/tienda-uno/meta-status')
      .send({ meta_live: true });
    expect(res.status).toBe(200);
    expect(res.body.meta_live).toBe(true);
    expect(res.body.meta_connected_at).toBe(connectedAt);
    expect(repo.update).toHaveBeenCalledWith('tienda-uno', { meta_live: true });
  });

  test('meta_live: false → no borrar meta_connected_at (historial)', async () => {
    const connectedAt = '2026-01-01T00:00:00Z';
    repo.update.mockResolvedValue({
      slug: 'tienda-uno', meta_live: false, meta_connected_at: connectedAt,
    });
    const app = buildApp();
    const res = await request(app)
      .patch('/admin/tenants/tienda-uno/meta-status')
      .send({ meta_live: false });
    expect(res.status).toBe(200);
    expect(res.body.meta_connected_at).toBe(connectedAt);
  });

  test('sin meta_live → 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch('/admin/tenants/tienda-uno/meta-status')
      .send({});
    expect(res.status).toBe(400);
  });

  test('tenant no existe → 404', async () => {
    repo.update.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .patch('/admin/tenants/no-existe/meta-status')
      .send({ meta_live: true });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /admin/tenants/:slug/products/:id ──────────────────────────────────

describe('DELETE /admin/tenants/:slug/products/:id', () => {
  test('producto existe → active=false, 200', async () => {
    mockDb._enqueue([{ id: 'tenant-uuid' }]); // tenant lookup
    mockDb._enqueue([{ id: 'prod-1' }]);       // UPDATE products returning
    const app = buildApp();
    const res = await request(app)
      .delete('/admin/tenants/tienda-uno/products/prod-1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Verifica que se llamó update (soft delete) y no delete
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  test('producto no encontrado → 404', async () => {
    mockDb._enqueue([{ id: 'tenant-uuid' }]); // tenant lookup
    mockDb._enqueue([]);                        // UPDATE no matcheó
    const app = buildApp();
    const res = await request(app)
      .delete('/admin/tenants/tienda-uno/products/no-existe');
    expect(res.status).toBe(404);
  });
});

// ── PUT /admin/tenants/:slug/products/:id ─────────────────────────────────────

describe('PUT /admin/tenants/:slug/products/:id', () => {
  test('productId de otro tenant → 404', async () => {
    mockDb._enqueue([{ id: 'tenant-uuid' }]); // tenant lookup
    mockDb._enqueue([]);                        // UPDATE no matcheó (tenant_id distinto)
    const app = buildApp();
    const res = await request(app)
      .put('/admin/tenants/tienda-uno/products/prod-otro')
      .send({ name: 'Otro nombre', price: 50000 });
    expect(res.status).toBe(404);
  });

  test('precio negativo → 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .put('/admin/tenants/tienda-uno/products/prod-1')
      .send({ price: -100 });
    expect(res.status).toBe(400);
  });

  test('actualización válida → 200', async () => {
    mockDb._enqueue([{ id: 'tenant-uuid' }]);                              // tenant lookup
    mockDb._enqueue([{ id: 'prod-1', name: 'Vestido rojo', price: 80000 }]); // UPDATE returning
    const app = buildApp();
    const res = await request(app)
      .put('/admin/tenants/tienda-uno/products/prod-1')
      .send({ name: 'Vestido rojo', price: 80000 });
    expect(res.status).toBe(200);
    expect(res.body.product.name).toBe('Vestido rojo');
  });
});
