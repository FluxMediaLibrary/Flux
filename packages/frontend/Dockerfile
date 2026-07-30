# syntax=docker/dockerfile:1
# Flux frontend — multi-stage build producing a Next.js standalone server.
# Build context is the REPO ROOT (see docker-compose.yml: context: .), so paths
# below are relative to the monorepo root and include `shared/`.

# ── Stage 1: install workspace dependencies ──────────────────────────────────
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS deps
WORKDIR /app

# Workspace manifests only, for a cacheable dependency layer.
COPY package.json ./
COPY shared/package.json ./shared/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/backend/package.json ./packages/backend/

# Install only the frontend + shared workspaces (skip backend's heavy deps).
RUN npm install -w @flux/frontend -w @flux/shared

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Public API base URL is baked into the client bundle at build time.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY packages/frontend ./packages/frontend

# Build the shared contract (belt-and-suspenders for node resolution), then the app.
RUN npm run build -w @flux/shared \
  && npm run build -w @flux/frontend

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4938
ENV HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Standalone output mirrors the monorepo layout (outputFileTracingRoot = repo root).
COPY --from=builder --chown=nextjs:nodejs /app/packages/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/frontend/.next/static ./packages/frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/packages/frontend/public ./packages/frontend/public

USER nextjs
EXPOSE 4938

CMD ["node", "packages/frontend/server.js"]
