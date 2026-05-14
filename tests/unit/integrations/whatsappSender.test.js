'use strict';

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.test' }] } }),
}));

jest.mock('@whatsapp-saas/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const axios = require('axios');
const sender = require('../../../packages/platform-data/src/integrations/whatsapp/sender');

describe('whatsapp sender provider routing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.WHATSAPP_PROVIDER;
    delete process.env.D360_API_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('usa Meta por defecto con Authorization Bearer y phone_number_id', async () => {
    await sender.sendText('573001112233', 'Hola', {
      slug: 'meta-tenant',
      wa_token: 'META_TOKEN',
      phone_number_id: '123456789',
      bot_config: {},
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/123456789/messages',
      {
        messaging_product: 'whatsapp',
        to: '573001112233',
        type: 'text',
        text: { body: 'Hola', preview_url: false },
      },
      {
        headers: {
          Authorization: 'Bearer META_TOKEN',
          'Content-Type': 'application/json',
        },
      }
    );
  });

  it('usa 360dialog con D360-API-KEY y endpoint /messages', async () => {
    await sender.sendText('573001112233', 'Hola', {
      slug: 'd360-tenant',
      wa_token: 'D360_TOKEN',
      bot_config: { whatsapp_provider: '360dialog' },
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://waba-v2.360dialog.io/messages',
      {
        messaging_product: 'whatsapp',
        to: '573001112233',
        type: 'text',
        text: { body: 'Hola', preview_url: false },
      },
      {
        headers: {
          'D360-API-KEY': 'D360_TOKEN',
          'Content-Type': 'application/json',
        },
      }
    );
  });
});

