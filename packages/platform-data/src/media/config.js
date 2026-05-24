'use strict';

const DEFAULT_MEDIA_STORAGE_CONFIG = {
  enabled: false,
  importProductsEnabled: false,
  imageMaxWidth: 1280,
  outputFormat: 'jpeg',
  quality: 82,
  generateThumbnail: false,
  thumbnailWidth: 320,
  preserveExif: false,
  maxImageUploadMb: 8,
  maxAudioUploadMb: 16,
  allowedImageFormats: ['jpg', 'png', 'webp'],
  allowedAudioFormats: ['mp3', 'ogg', 'm4a', 'opus'],
};

const IMAGE_FORMATS = new Set(['jpg', 'png', 'webp']);
const AUDIO_FORMATS = new Set(['mp3', 'ogg', 'm4a', 'opus']);
const OUTPUT_FORMATS = new Set(['jpeg', 'webp', 'original']);

function numberInRange(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeList(value, allowed, fallback) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .map((item) => String(item || '').toLowerCase().trim())
    .filter((item) => allowed.has(item));
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : fallback;
}

function normalizeMediaStorageConfig(botConfig = {}) {
  const raw = botConfig.media_storage && typeof botConfig.media_storage === 'object'
    ? botConfig.media_storage
    : {};

  const outputFormat = OUTPUT_FORMATS.has(raw.outputFormat) ? raw.outputFormat : DEFAULT_MEDIA_STORAGE_CONFIG.outputFormat;

  return {
    enabled: Boolean(raw.enabled),
    importProductsEnabled: Boolean(raw.importProductsEnabled),
    imageMaxWidth: numberInRange(raw.imageMaxWidth, DEFAULT_MEDIA_STORAGE_CONFIG.imageMaxWidth, 64, 4096),
    outputFormat,
    quality: numberInRange(raw.quality, DEFAULT_MEDIA_STORAGE_CONFIG.quality, 1, 100),
    generateThumbnail: Boolean(raw.generateThumbnail),
    thumbnailWidth: numberInRange(raw.thumbnailWidth, DEFAULT_MEDIA_STORAGE_CONFIG.thumbnailWidth, 32, 2048),
    preserveExif: Boolean(raw.preserveExif),
    maxImageUploadMb: numberInRange(raw.maxImageUploadMb, DEFAULT_MEDIA_STORAGE_CONFIG.maxImageUploadMb, 1, 100),
    maxAudioUploadMb: numberInRange(raw.maxAudioUploadMb, DEFAULT_MEDIA_STORAGE_CONFIG.maxAudioUploadMb, 1, 200),
    allowedImageFormats: normalizeList(raw.allowedImageFormats, IMAGE_FORMATS, DEFAULT_MEDIA_STORAGE_CONFIG.allowedImageFormats),
    allowedAudioFormats: normalizeList(raw.allowedAudioFormats, AUDIO_FORMATS, DEFAULT_MEDIA_STORAGE_CONFIG.allowedAudioFormats),
  };
}

module.exports = {
  DEFAULT_MEDIA_STORAGE_CONFIG,
  normalizeMediaStorageConfig,
};
