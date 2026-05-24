'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { detectMime } = require('./mime');
const { processImage } = require('./imagePipeline');

const SCOPE_RE = /^[a-z0-9_-]{1,40}$/i;

function getBasePath() {
  const value = process.env.MEDIA_STORAGE_BASE_PATH;
  if (!value) throw new Error('MEDIA_STORAGE_BASE_PATH no configurado');
  return path.resolve(value);
}

function getPublicBaseUrl() {
  const value = (process.env.MEDIA_STORAGE_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!value) throw new Error('MEDIA_STORAGE_PUBLIC_BASE_URL no configurado');
  return value;
}

function cleanPart(value, fallback) {
  const part = String(value || fallback || '').toLowerCase().trim();
  if (!SCOPE_RE.test(part)) return fallback;
  return part;
}

function assertInside(base, target) {
  const relative = path.relative(base, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path fuera del storage');
  }
}

function normalizeRelativePath(relativePath) {
  const cleaned = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..')) throw new Error('Path de media invalido');
  return cleaned;
}

class LocalVpsStorageAdapter {
  constructor(options = {}) {
    this.basePath = path.resolve(options.basePath || getBasePath());
    this.publicBaseUrl = (options.publicBaseUrl || getPublicBaseUrl()).replace(/\/+$/, '');
  }

  resolvePublicUrl(relativePath) {
    const clean = normalizeRelativePath(relativePath);
    return `${this.publicBaseUrl}/${clean.split('/').map(encodeURIComponent).join('/')}`;
  }

  relativePathFromPublicUrl(url) {
    const value = String(url || '');
    if (!value.startsWith(`${this.publicBaseUrl}/`)) return null;
    return decodeURIComponent(value.slice(this.publicBaseUrl.length + 1));
  }

  resolveFinalUrl(value) {
    const relative = this.relativePathFromPublicUrl(value);
    return relative ? this.resolvePublicUrl(relative) : value;
  }

  async saveImage({ tenantSlug, scope = 'uploads', buffer, config = {} }) {
    const processed = await processImage(buffer, config);
    const tenant = cleanPart(tenantSlug, 'tenant');
    const safeScope = cleanPart(scope, 'uploads');
    const dir = path.join(this.basePath, tenant, safeScope, 'images');
    assertInside(this.basePath, dir);
    await fsp.mkdir(dir, { recursive: true });

    const name = `${randomUUID()}.${processed.image.metadata.ext}`;
    const fullPath = path.join(dir, name);
    assertInside(this.basePath, fullPath);
    await pipeline(Readable.from(processed.image.buffer), fs.createWriteStream(fullPath, { flags: 'wx' }));

    let thumbnail = null;
    if (processed.thumbnail) {
      const thumbName = `${path.basename(name, path.extname(name))}-thumb.${processed.thumbnail.metadata.ext}`;
      const thumbPath = path.join(dir, thumbName);
      assertInside(this.basePath, thumbPath);
      await pipeline(Readable.from(processed.thumbnail.buffer), fs.createWriteStream(thumbPath, { flags: 'wx' }));
      const thumbRel = path.relative(this.basePath, thumbPath).replace(/\\/g, '/');
      thumbnail = {
        relativePath: thumbRel,
        url: this.resolvePublicUrl(thumbRel),
        metadata: processed.thumbnail.metadata,
      };
    }

    const relativePath = path.relative(this.basePath, fullPath).replace(/\\/g, '/');
    return {
      relativePath,
      url: this.resolvePublicUrl(relativePath),
      metadata: processed.image.metadata,
      source: processed.source,
      thumbnail,
    };
  }

  async saveAudio({ tenantSlug, scope = 'uploads', buffer, allowedFormats = [] }) {
    const detected = detectMime(buffer);
    if (!detected || detected.kind !== 'audio') {
      throw new Error('El archivo no es un audio valido');
    }
    if (allowedFormats.length > 0 && !allowedFormats.includes(detected.ext)) {
      throw new Error(`Formato de audio no permitido: ${detected.ext}`);
    }

    const tenant = cleanPart(tenantSlug, 'tenant');
    const safeScope = cleanPart(scope, 'uploads');
    const dir = path.join(this.basePath, tenant, safeScope, 'audio');
    assertInside(this.basePath, dir);
    await fsp.mkdir(dir, { recursive: true });

    const fullPath = path.join(dir, `${randomUUID()}.${detected.ext}`);
    assertInside(this.basePath, fullPath);
    await pipeline(Readable.from(buffer), fs.createWriteStream(fullPath, { flags: 'wx' }));

    const relativePath = path.relative(this.basePath, fullPath).replace(/\\/g, '/');
    return {
      relativePath,
      url: this.resolvePublicUrl(relativePath),
      metadata: { size: buffer.length, mime: detected.mime, ext: detected.ext },
    };
  }

  async list({ tenantSlug, type } = {}) {
    const tenant = cleanPart(tenantSlug, 'tenant');
    const root = path.join(this.basePath, tenant);
    assertInside(this.basePath, root);
    const items = [];
    await walk(root, async (filePath) => {
      const rel = path.relative(this.basePath, filePath).replace(/\\/g, '/');
      if (type === 'image' && !rel.includes('/images/')) return;
      if (type === 'audio' && !rel.includes('/audio/')) return;
      if (rel.includes('-thumb.')) return;
      const stat = await fsp.stat(filePath);
      items.push({
        relativePath: rel,
        url: this.resolvePublicUrl(rel),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      });
    });
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async delete(relativePath) {
    const clean = normalizeRelativePath(relativePath);
    const fullPath = path.join(this.basePath, clean);
    assertInside(this.basePath, fullPath);
    await fsp.rm(fullPath, { force: true });
    return { deleted: true };
  }
}

async function walk(dir, onFile) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, onFile);
    } else if (entry.isFile()) {
      await onFile(fullPath);
    }
  }
}

/*
class S3StorageAdapter {
  async saveImage() {}
  async saveAudio() {}
  async delete() {}
  resolvePublicUrl() {}
}
*/

function createLocalVpsStorageAdapter(options) {
  return new LocalVpsStorageAdapter(options);
}

module.exports = {
  LocalVpsStorageAdapter,
  createLocalVpsStorageAdapter,
};
