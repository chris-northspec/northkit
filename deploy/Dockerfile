# Build context is the repo root (see docker-compose.yml). Copied from NorthCore WMS.
FROM node:22-bookworm-slim AS base
RUN npm install -g pnpm@10.34.9
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY packages/licence/package.json packages/licence/
RUN pnpm install --frozen-lockfile

# Migrations, the worker and the CLI tools run from TypeScript source through tsx.
FROM deps AS tools
COPY . .
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@northkit/worker", "start"]

FROM deps AS build
COPY . .
RUN pnpm --filter @northkit/web build

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
# Records each request's connecting address before Next.js sees it (D15).
COPY --from=build --chown=node:node /app/apps/web/server/peer-address.mjs ./apps/web/peer-address.mjs
COPY --chown=node:node LICENCES ./LICENCES
# The photos volume mounts here; owned by the app user so a fresh volume is writable.
RUN mkdir -p /data/files && chown node:node /data/files
USER node
EXPOSE 3000
CMD ["node", "--import", "./apps/web/peer-address.mjs", "apps/web/server.js"]
