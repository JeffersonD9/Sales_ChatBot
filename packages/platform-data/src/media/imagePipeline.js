'use strict';

const sharp = require('sharp');
const { detectMime, extensionForMime } = require('./mime');
const { normalizeMediaStorageConfig } = require('./config');

function normalizeOutputFormat(format, sourceExt) {
  if (format === 'webp') return 'webp';
  if (format === 'jpeg') return 'jpeg';
  if (sourceExt === 'png') return 'png';
  if (sourceExt === 'webp') return 'webp';
  return 'jpeg';
}

async function renderImage(input, format, config, width) {
  let image = sharp(input, { failOn: 'error' }).rotate();
  if (width) {
    image = image.resize({ width, withoutEnlargement: true });
  }
  if (config.preserveExif) {
    image = image.keepMetadata();
  }

  if (format === 'webp') {
    image = image.webp({ quality: config.quality });
  } else if (format === 'png') {
    image = image.png({ quality: config.quality, compressionLevel: 9 });
  } else {
    image = image.jpeg({ quality: config.quality, mozjpeg: true });
  }

  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    metadata: {
      width: info.width,
      height: info.height,
      size: data.length,
      mime: format === 'webp' ? 'image/webp' : format === 'png' ? 'image/png' : 'image/jpeg',
      ext: format === 'webp' ? 'webp' : format === 'png' ? 'png' : 'jpg',
    },
  };
}

async function processImage(buffer, rawConfig = {}) {
  const detected = detectMime(buffer);
  if (!detected || detected.kind !== 'image') {
    throw new Error('El archivo no es una imagen valida');
  }

  const config = normalizeMediaStorageConfig({ media_storage: rawConfig });
  if (!config.allowedImageFormats.includes(detected.ext)) {
    throw new Error(`Formato de imagen no permitido: ${detected.ext}`);
  }

  const format = normalizeOutputFormat(config.outputFormat, extensionForMime(detected.mime));
  const original = await sharp(buffer, { failOn: 'error' }).metadata();
  const image = await renderImage(buffer, format, config, config.imageMaxWidth);
  const thumbnail = config.generateThumbnail
    ? await renderImage(buffer, format, config, config.thumbnailWidth)
    : null;

  return {
    image,
    thumbnail,
    source: {
      width: original.width || null,
      height: original.height || null,
      size: buffer.length,
      mime: detected.mime,
      ext: detected.ext,
    },
  };
}

module.exports = { processImage };
