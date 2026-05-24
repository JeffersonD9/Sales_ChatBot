'use strict';

const { processImage } = require('../../../packages/platform-data/src/media/imagePipeline');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

describe('media image pipeline', () => {
  test('processes an image and generates a thumbnail', async () => {
    const result = await processImage(PNG_1X1, {
      allowedImageFormats: ['png'],
      outputFormat: 'webp',
      quality: 80,
      imageMaxWidth: 1280,
      generateThumbnail: true,
      thumbnailWidth: 320,
    });

    expect(result.image.buffer.length).toBeGreaterThan(0);
    expect(result.image.metadata.mime).toBe('image/webp');
    expect(result.thumbnail.metadata.mime).toBe('image/webp');
  });

  test('rejects non-image input', async () => {
    await expect(processImage(Buffer.from('not an image'), {})).rejects.toThrow(/imagen/i);
  });
});
