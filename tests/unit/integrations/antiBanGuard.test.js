const guard = require('../../../packages/platform-data/src/integrations/whatsapp/antiBanGuard');

describe('antiBanGuard', () => {
  const tenant = {
    slug: 'tenant-test',
    phone_number_id: 'phone-1',
    bot_config: {
      send_window_start: 0,
      send_window_end: 24,
      whatsapp_tier: 1,
    },
  };

  beforeEach(() => {
    process.env.WHATSAPP_ANTIBAN_TEST_ENABLED = 'true';
    process.env.WHATSAPP_MAX_OUTBOUND_WITHOUT_REPLY = '3';
    guard._resetForTest();
  });

  afterEach(() => {
    delete process.env.WHATSAPP_ANTIBAN_TEST_ENABLED;
    delete process.env.WHATSAPP_MAX_OUTBOUND_WITHOUT_REPLY;
    delete process.env.WHATSAPP_SEND_WINDOW_ENABLED;
    guard._resetForTest();
  });

  test('detecta opt-out y bloquea futuros envios', async () => {
    const result = await guard.handleInboundMessage(tenant, '573001112233', 'No me escribas mas');

    expect(result.optOut).toBe(true);
    expect(await guard.isSuppressed(tenant, '573001112233')).toBe(true);

    const sendCheck = await guard.beforeSend('573001112233', { type: 'text' }, tenant);
    expect(sendCheck).toEqual({ allowed: false, reason: 'suppressed' });
  });

  test('reinicia el contador de salidas cuando llega una respuesta', async () => {
    await guard.afterSend('573001112233', { type: 'text' }, tenant, {});
    await guard.afterSend('573001112233', { type: 'text' }, tenant, {});

    await guard.handleInboundMessage(tenant, '573001112233', 'Hola');

    const sendCheck = await guard.beforeSend('573001112233', { type: 'text' }, tenant);
    expect(sendCheck.allowed).toBe(true);
  });

  test('activa circuito de conversacion tras 3 mensajes sin respuesta', async () => {
    await guard.afterSend('573001112233', { type: 'text' }, tenant, {});
    await guard.afterSend('573001112233', { type: 'text' }, tenant, {});
    await guard.afterSend('573001112233', { type: 'text' }, tenant, {});

    const sendCheck = await guard.beforeSend('573001112233', { type: 'text' }, tenant);
    expect(sendCheck).toEqual({ allowed: false, reason: 'conversation_cooldown' });
  });

  test('puede omitir la ventana horaria para mensajes operativos con bypass', async () => {
    process.env.WHATSAPP_SEND_WINDOW_ENABLED = 'true';
    const restrictedTenant = {
      ...tenant,
      bot_config: { ...tenant.bot_config, send_window_start: 25, send_window_end: 26 },
    };

    const blocked = await guard.beforeSend('573001112233', { type: 'text' }, restrictedTenant);
    expect(blocked).toEqual({ allowed: false, reason: 'outside_send_window' });

    const sendCheck = await guard.beforeSend(
      '573001112233',
      { type: 'text', _antiBanBypass: true },
      restrictedTenant
    );

    expect(sendCheck.allowed).toBe(true);
  });
});
