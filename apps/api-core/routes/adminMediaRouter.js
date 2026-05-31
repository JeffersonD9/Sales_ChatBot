import express from 'express';
import platformData from '../../../packages/platform-data/index.js';
import loggerModule from '@whatsapp-saas/logger';
import sharedUtils from '@whatsapp-saas/shared-utils';

const { logger } = loggerModule;
const { media, tenantRepository } = platformData;
const { safeFetch } = sharedUtils;

const router = express.Router({ mergeParams: true });

// Límite alto: el tope real lo impone la config del tenant (maxAudioUploadMb).
// Solo aplica a binarios; el JSON global ya parseó las rutas que sí son JSON.
const rawBody = express.raw({ type: () => true, limit: '210mb' });

async function loadTenantConfig(slug) {
  const tenant = await tenantRepository.findBySlug(slug);
  if (!tenant) return null;
  return { tenant, config: media.normalizeMediaStorageConfig(tenant.bot_config) };
}

function cleanScope(value) {
  const scope = String(value || 'uploads').toLowerCase().trim();
  return /^[a-z0-9_-]{1,40}$/.test(scope) ? scope : 'uploads';
}

// GET /:slug?type=image|audio — lista archivos del tenant + config efectiva
router.get('/:slug', async (req, res) => {
  const loaded = await loadTenantConfig(req.params.slug);
  if (!loaded) return res.status(404).json({ error: 'Tenant no encontrado' });
  try {
    const adapter = media.createLocalVpsStorageAdapter();
    const items = await adapter.list({ tenantSlug: req.params.slug, type: req.query.type });
    return res.json({ items, config: loaded.config });
  } catch (err) {
    logger.error({ slug: req.params.slug, err: err.message }, '[Media] list falló');
    return res.status(500).json({ error: 'No se pudo listar media' });
  }
});

// POST /:slug?scope= — sube un binario (imagen o audio, autodetectado por mime)
router.post('/:slug', rawBody, async (req, res) => {
  const loaded = await loadTenantConfig(req.params.slug);
  if (!loaded) return res.status(404).json({ error: 'Tenant no encontrado' });
  const { config } = loaded;
  if (!config.enabled) return res.status(400).json({ error: 'Almacenamiento local desactivado' });

  const buffer = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buffer || buffer.length === 0) return res.status(400).json({ error: 'Archivo requerido' });

  const detected = media.detectMime(buffer);
  if (!detected) return res.status(400).json({ error: 'Tipo de archivo no reconocido' });

  const maxMb = detected.kind === 'audio' ? config.maxAudioUploadMb : config.maxImageUploadMb;
  if (buffer.length > maxMb * 1024 * 1024) {
    return res.status(413).json({ error: `El archivo supera el límite de ${maxMb} MB` });
  }

  const scope = cleanScope(req.query.scope);
  try {
    const adapter = media.createLocalVpsStorageAdapter();
    if (detected.kind === 'image') {
      const saved = await adapter.saveImage({ tenantSlug: req.params.slug, scope, buffer, config });
      return res.status(201).json(saved);
    }
    const saved = await adapter.saveAudio({
      tenantSlug: req.params.slug,
      scope,
      buffer,
      allowedFormats: config.allowedAudioFormats,
    });
    return res.status(201).json(saved);
  } catch (err) {
    logger.error({ slug: req.params.slug, err: err.message }, '[Media] upload falló');
    return res.status(500).json({ error: err.message || 'No se pudo guardar el archivo' });
  }
});

// DELETE /:slug?path=<relativePath> — borra un archivo del tenant
router.delete('/:slug', async (req, res) => {
  const slug = req.params.slug;
  const relativePath = req.query.path;
  if (!relativePath || !String(relativePath).startsWith(`${slug}/`)) {
    return res.status(400).json({ error: 'Path de media inválido' });
  }
  try {
    const adapter = media.createLocalVpsStorageAdapter();
    return res.json(await adapter.delete(String(relativePath)));
  } catch (err) {
    logger.error({ slug, err: err.message }, '[Media] delete falló');
    return res.status(500).json({ error: 'No se pudo borrar el archivo' });
  }
});

// POST /:slug/localize — descarga imágenes externas y las guarda localmente.
// Body JSON: { urls: string[] }. Devuelve { map: { <urlExterna>: <urlLocal> } }.
router.post('/:slug/localize', async (req, res) => {
  const loaded = await loadTenantConfig(req.params.slug);
  if (!loaded) return res.status(404).json({ error: 'Tenant no encontrado' });
  const { config } = loaded;
  if (!config.enabled || !config.importProductsEnabled) {
    return res.status(400).json({ error: 'Importación local desactivada' });
  }

  const urls = Array.isArray(req.body?.urls) ? req.body.urls : null;
  if (!urls) return res.status(400).json({ error: 'urls requerido' });

  const maxBytes = config.maxImageUploadMb * 1024 * 1024;
  const adapter = media.createLocalVpsStorageAdapter();
  const map = {};
  const errors = {};

  await Promise.all(urls.map(async (url) => {
    if (!/^https?:\/\//i.test(String(url))) {
      errors[url] = 'Protocolo no permitido';
      return;
    }
    try {
      // SSRF-safe: valida hostname (no IPs privadas), bloquea redirects, timeout,
      // y aborta si supera maxBytes en streaming.
      const { buffer } = await safeFetch(url, { maxBytes, timeoutMs: 15000 });
      const saved = await adapter.saveImage({
        tenantSlug: req.params.slug,
        scope: 'products',
        buffer,
        config,
      });
      map[url] = String(saved.url);
    } catch (err) {
      errors[url] = err.message;
    }
  }));

  return res.json({ map, errors });
});

export default router;
