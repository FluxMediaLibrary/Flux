# Flux backend — multi-stage build.
# Build context is the REPO ROOT (see docker-compose: context: .), so COPY paths
# are repo-root-relative and include shared/ + packages/backend/.

# ─── Base ─────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ─── Dependencies (all workspaces, incl. dev deps for building) ───────────────
FROM base AS deps
ENV NODE_ENV=development
# Root manifest + workspace manifests for a cached install layer.
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/package.json
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/frontend/package.json ./packages/frontend/package.json
# Prisma schema is needed for `prisma generate` during postinstall/build.
COPY packages/backend/prisma ./packages/backend/prisma
# Use npm ci when a lockfile exists, else fall back to install.
RUN npm ci || npm install

# ─── Build shared + backend ───────────────────────────────────────────────────
FROM deps AS build
COPY shared ./shared
COPY packages/backend ./packages/backend
# Build the shared contract first (backend imports @flux/shared), then generate
# the Prisma client and compile the backend to dist/.
RUN npm run build --workspace @flux/shared \
  && npm run build --workspace @flux/backend

# ─── Production dependencies only ─────────────────────────────────────────────
FROM base AS proddeps
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/package.json
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/frontend/package.json ./packages/frontend/package.json
COPY packages/backend/prisma ./packages/backend/prisma
RUN (npm ci --omit=dev || npm install --omit=dev) \
  && npm cache clean --force

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM base AS runtime
# FFmpeg for transcoding + libchromaprint-tools (fpcalc) for intro detection.
# Installed in the runtime image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libchromaprint-tools ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Production node_modules (workspace symlinks preserved).
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=proddeps /app/package.json ./package.json

# Built shared package (dist + manifest for @flux/shared resolution).
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist

# Built backend + prisma schema/migrations + generated client.
COPY --from=build /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=build /app/packages/backend/dist ./packages/backend/dist
COPY --from=build /app/packages/backend/prisma ./packages/backend/prisma
# The generated Prisma client lives in the root node_modules/@prisma/client and
# node_modules/.prisma — already copied via proddeps + regenerated below to be safe.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

WORKDIR /app/packages/backend
EXPOSE 6948

# Apply migrations, then start. `prisma migrate deploy` is idempotent.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
