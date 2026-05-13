import cors from 'cors';
import loggerModule from '@whatsapp-saas/logger';

const { logger } = loggerModule;

function buildOriginList() {
  const raw = (process.env.ALLOWED_ORIGINS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((origin) => origin.trim()).filter(Boolean);
}

export function tenantApiCors() {
  const origins = buildOriginList();

  return cors({
    origin(requestOrigin, cb) {
      if (!requestOrigin) return cb(null, true);
      if (origins.length === 0) return cb(null, true);
      if (origins.includes(requestOrigin)) return cb(null, true);

      logger.warn({ origin: requestOrigin }, '[CORS] Origen rechazado en /api/whatsapp');
      return cb(Object.assign(new Error('CORS: origen no permitido'), { status: 403 }));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 600,
  });
}
