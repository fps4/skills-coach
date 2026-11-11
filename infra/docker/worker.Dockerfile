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

# As in api.Dockerfile: Debian's security fixes, and no npm (its bundled `tar` is what the image scan
# in publish-images blocks on). The runtime runs `node` and nothing else.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build --chown=node:node /worker/node_modules ./node_modules
COPY --from=build --chown=node:node /worker/dist ./dist
COPY --from=build --chown=node:node /worker/package.json ./package.json

USER node
CMD ["node", "dist/index.js"]
