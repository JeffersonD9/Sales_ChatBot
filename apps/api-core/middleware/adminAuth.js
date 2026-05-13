import loggerModule from '@whatsapp-saas/logger';

const { logger } = loggerModule;

export function requireAdminKey(req, res, next) {
  const key = process.env.ADMIN_API_KEY;
  if (!key) {
    logger.warn({ path: req.path }, '[Admin] ADMIN_API_KEY no configurada');
    return res.status(503).json({ error: 'Admin API no disponible' });
  }

  const provided =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.replace(/^Bearer\s+/i, '');

  if (!provided || provided !== key) {
    return res.status(401).json({ error: 'API key inválida' });
  }

  next();
}
