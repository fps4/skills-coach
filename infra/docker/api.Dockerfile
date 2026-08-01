# The api image. Build context is the repository root (compose sets `context: ../..`).
#
# Two stages, and the first one is the gate: it typechecks, lints and compiles. A `docker build`
# with no `--target` runs through to `runtime`, which copies from `build` — so the same Dockerfile
# both gates and ships, and CI cannot accidentally publish something that did not pass.

# --- build stage: the gate ---
FROM node:20-bookworm-slim AS build
WORKDIR /api

# Dependencies first, from the committed lockfile, so this layer caches across source changes.
COPY api/package.json api/package-lock.json ./
RUN npm ci

COPY api/ ./
RUN npm run typecheck && npm run lint && npm run build

# Production dependencies only, for the runtime stage.
RUN npm ci --omit=dev

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /api

# Run as the image's unprivileged user rather than root.
COPY --from=build --chown=node:node /api/node_modules ./node_modules
COPY --from=build --chown=node:node /api/dist ./dist
COPY --from=build --chown=node:node /api/package.json ./package.json

USER node
EXPOSE 8000
ENV PORT=8000 HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:8000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
