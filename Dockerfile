# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM dependencies AS builder
ARG NEXT_PUBLIC_APP_URL=https://synapth.localhost8081.ru
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    SYNAPTH_STANDALONE=1
COPY . .
RUN npm run build

# This target contains only the Prisma CLI and is run once before each application update.
FROM base AS migrator
ARG PRISMA_VERSION=6.19.3
ENV NODE_ENV=production
RUN npm install --no-save "prisma@${PRISMA_VERSION}" \
    && npm cache clean --force
COPY prisma ./prisma
COPY scripts/db-sync.mjs ./scripts/db-sync.mjs
USER node
CMD ["node", "scripts/db-sync.mjs"]

FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && mkdir -p /app/data /app/.next/cache \
    && chown -R nextjs:nodejs /app

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
