'use strict';

const { DEFAULT_MEDIA_STORAGE_CONFIG, normalizeMediaStorageConfig } = require('./config');
const { processImage } = require('./imagePipeline');
const { detectMime } = require('./mime');
const { LocalVpsStorageAdapter, createLocalVpsStorageAdapter } = require('./storage');

module.exports = {
  DEFAULT_MEDIA_STORAGE_CONFIG,
  LocalVpsStorageAdapter,
  createLocalVpsStorageAdapter,
  detectMime,
  normalizeMediaStorageConfig,
  processImage,
};
