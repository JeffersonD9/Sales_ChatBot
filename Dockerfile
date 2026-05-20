# WhatsApp SaaS Dockerfile
#
# Stages:
#   base   - shared Node workspace
#   dev    - devDependencies and nodemon
#   deps   - production dependencies
#   runner - production runtime image

FROM node:20-alpine AS base

WORKDIR /app
COPY package*.json ./
# Copiamos los package.json de cada workspace ANTES de npm ci para que
# npm pueda enlazar correctamente los paquetes locales (@whatsapp-saas/*).
COPY packages/config/package.json ./packages/config/package.json
COPY packages/http-runtime/package.json ./packages/http-runtime/package.json
COPY packages/logger/package.json ./packages/logger/package.json
COPY packages/notifications/package.json ./packages/notifications/package.json
COPY packages/platform-data/package.json ./packages/platform-data/package.json
COPY packages/queues/package.json ./packages/queues/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/shared-utils/package.json ./packages/shared-utils/package.json

FROM base AS dev

RUN npm ci

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000 3001
ENTRYPOINT ["./entrypoint.sh"]
CMD ["npm", "run", "dev:api"]

FROM base AS deps

RUN npm ci --omit=dev

FROM node:20-alpine AS runner

RUN addgroup -S botgroup && adduser -S botuser -G botgroup

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN chmod +x entrypoint.sh && chown -R botuser:botgroup /app

USER botuser

EXPOSE 3000 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "const p=process.env.HEALTHCHECK_PORT||process.env.PORT||process.env.API_PORT||process.env.WHATSAPP_PORT||3000;require('http').get('http://localhost:'+p+'/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["npm", "run", "start:api"]
