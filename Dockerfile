# syntax=docker/dockerfile:1

# Multi-stage so the runtime image carries no pnpm store, no dev dependencies
# and no source — just the built app, its production dependencies, and the
# custom server that hosts the WebSocket endpoint.

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable

# ---- dependencies ----------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# Cache mount keeps the pnpm store between builds without baking it into a layer.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS prod-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---- build -----------------------------------------------------------------
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runtime ---------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/wavelength.db

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs \
 && mkdir /data

COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/.next ./.next
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --chown=nextjs:nodejs package.json next.config.ts ./
COPY --chown=nextjs:nodejs server ./server

EXPOSE 3000
# Never run the server as root. It starts as root only because Fly mounts the
# volume at /data root-owned: take ownership of it, then drop to nextjs for
# good before Node starts.
CMD ["sh", "-c", "chown -R nextjs:nodejs /data && exec setpriv --reuid=nextjs --regid=nodejs --init-groups node --disable-warning=ExperimentalWarning server/index.mjs"]
