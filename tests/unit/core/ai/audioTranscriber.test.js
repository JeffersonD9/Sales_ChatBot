'use strict';

jest.mock('axios');
const axios = require('axios');
const { transcribe, FALLBACK_MSG } = require('../../../../src/core/ai/audioTranscriber');

const TENANT = {
  slug:     'test-store',
  plan:     'premium',
  wa_token: 'TEST_TOKEN',
};

const MEDIA_ID = 'media_abc123';

beforeEach(() => {
  jest.resetAllMocks();
  process.env.OPENAI_API_KEY = 'sk-test-key';
  global.fetch = jest.fn();
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete global.fetch;
});

describe('audioTranscriber.transcribe', () => {
  test('retorna texto transcrito cuando Whisper responde OK', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { url: 'https://cdn.meta.example/audio.ogg' } })
      .mockResolvedValueOnce({ data: Buffer.from('audio-bytes') });

    global.fetch.mockResolvedValueOnce({
      ok:   true,
      text: async () => 'hola quiero ver los vestidos rojos',
    });

    const result = await transcribe(TENANT, MEDIA_ID);

    expect(result).toBe('hola quiero ver los vestidos rojos');
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining(MEDIA_ID),
      expect.objectContaining({ headers: { Authorization: `Bearer ${TENANT.wa_token}` } })
    );
  });

  test('retorna null si OPENAI_API_KEY no está configurada', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await transcribe(TENANT, MEDIA_ID);
    expect(result).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('retorna null si Meta no retorna URL de media', async () => {
    axios.get.mockResolvedValueOnce({ data: {} });
    const result = await transcribe(TENANT, MEDIA_ID);
    expect(result).toBeNull();
  });

  test('retorna null si Whisper responde con error HTTP', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { url: 'https://cdn.meta.example/audio.ogg' } })
      .mockResolvedValueOnce({ data: Buffer.from('audio-bytes') });

    global.fetch.mockResolvedValueOnce({
      ok:   false,
      status: 429,
      text: async () => 'rate limited',
    });

    const result = await transcribe(TENANT, MEDIA_ID);
    expect(result).toBeNull();
  });

  test('retorna null si axios falla por error de red', async () => {
    axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await transcribe(TENANT, MEDIA_ID);
    expect(result).toBeNull();
  });

  test('FALLBACK_MSG está definido y no está vacío', () => {
    expect(typeof FALLBACK_MSG).toBe('string');
    expect(FALLBACK_MSG.length).toBeGreaterThan(0);
  });
});
