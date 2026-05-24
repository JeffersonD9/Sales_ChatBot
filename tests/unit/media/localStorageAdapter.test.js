'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { LocalVpsStorageAdapter } = require('../../../packages/platform-data/src/media/storage');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

describe('LocalVpsStorageAdapter', () => {
  let dir;
  let adapter;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-storage-'));
    adapter = new LocalVpsStorageAdapter({
      basePath: dir,
      publicBaseUrl: 'https://media.example.test',
    });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('saves and lists an image', async () => {
    const saved = await adapter.saveImage({
      tenantSlug: 'tenant-a',
      scope: 'products',
      buffer: PNG_1X1,
      config: { allowedImageFormats: ['png'], outputFormat: 'jpeg' },
    });

    expect(saved.relativePath).toMatch(/^tenant-a\/products\/images\//);
    expect(saved.url).toMatch(/^https:\/\/media\.example\.test\/tenant-a\/products\/images\//);

    const items = await adapter.list({ tenantSlug: 'tenant-a', type: 'image' });
    expect(items).toHaveLength(1);
    expect(items[0].relativePath).toBe(saved.relativePath);
  });

  test('rejects path traversal on delete', async () => {
    await expect(adapter.delete('../outside.jpg')).rejects.toThrow(/path/i);
  });
});
