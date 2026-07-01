# syntax=docker/dockerfile:1
# Multi-stage build for self-hosted (VPS / docker compose) deployment.
# Ships full node_modules so the better-sqlite3 native binding works reliably.

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- deps ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- build ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runtime ---
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/app/data/game.db
RUN useradd -m -u 1001 nextjs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

# SQLite lives here; mount a volume at /app/data so games survive restarts.
RUN mkdir -p /app/data && chown -R nextjs:nextjs /app

USER nextjs
EXPOSE 3000
CMD ["npm", "start"]
