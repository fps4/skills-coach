# The word worker's image (ADR-0034). Build context is the repository root, like the api's.
#
# Same two-stage shape as api.Dockerfile: the build stage is the gate (typecheck, lint, tests,
# compile) and the runtime stage copies from it, so nothing that did not pass can ship.

# --- build stage: the gate ---
FROM node:20-bookworm-slim AS build
WORKDIR /worker

COPY worker/package.json worker/package-lock.json ./
RUN npm ci

COPY worker/ ./
RUN npm run typecheck && npm run lint && npm test && npm run build

RUN npm ci --omit=dev

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /worker

COPY --from=build --chown=node:node /worker/node_modules ./node_modules
COPY --from=build --chown=node:node /worker/dist ./dist
COPY --from=build --chown=node:node /worker/package.json ./package.json

# uid 1000 — the owner of the key file on the host, which is mounted read-only.
USER node
CMD ["node", "dist/index.js"]
