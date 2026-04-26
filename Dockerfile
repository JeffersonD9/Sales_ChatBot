# ══════════════════════════════════════════════════════
#  WhatsApp SaaS — Dockerfile multi-stage
#
#  Stages:
#    base    → node + package.json (compartido)
#    dev     → nodemon + devDependencies (hot reload)
#    deps    → solo dependencias de producción
#    runner  → imagen final de producción (mínima)
#
#  Uso:
#    Development:  docker compose -f docker-compose.yml -f docker-compose.dev.yml up
#    Production:   docker compose up
# ══════════════════════════════════════════════════════

# ── Stage base: node + manifiestos ────────────────────────────────────────────
FROM node:20-alpine AS base

WORKDIR /app
COPY package*.json ./

# ── Stage dev: todas las deps + hot reload ────────────────────────────────────
FROM base AS dev

RUN npm ci

# El código se monta como volumen en docker-compose.dev.yml
# (no se copia aquí para que los cambios locales se reflejen en vivo)
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ── Stage deps: solo dependencias de producción ───────────────────────────────
FROM base AS deps

RUN npm ci --omit=dev

# ── Stage runner: imagen final de producción ──────────────────────────────────
FROM node:20-alpine AS runner

# Usuario sin privilegios (seguridad)
RUN addgroup -S botgroup && adduser -S botuser -G botgroup

WORKDIR /app

# Copiar dependencias de producción y código fuente
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN chown -R botuser:botgroup /app

USER botuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
