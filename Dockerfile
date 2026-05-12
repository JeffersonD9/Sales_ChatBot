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

FROM base AS dev

RUN npm ci

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000 3001
ENTRYPOINT ["./entrypoint.sh"]
CMD ["npm", "run", "dev"]

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
CMD ["node", "src/server.js"]
