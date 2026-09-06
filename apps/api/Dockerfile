# Jawwid Chat API — production image.
# Owner: AI #7 (infrastructure).
#
# Build context is apps/api:
#   docker build -t jawwid-chat-api:dev apps/api
#
# The SAME image runs the API and the background worker. They are separate
# processes, not separate builds — one artifact means the worker can never be
# running a different commit than the API (see docs/infrastructure/decisions.md
# ADR-004). The process is chosen by the command:
#   API     : node dist/main.js
#   Worker  : node dist/worker.js
#
# The Node major version is pinned, and MUST match the version CI tests on
# (.github/workflows/ci.yml, env.NODE_VERSION). Testing on one major and
# shipping another means the runtime differences are discovered in production.

# ---------------------------------------------------------------- deps
FROM node:24.18.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci, not npm install: fails loudly if the lockfile and manifest disagree,
# which is what we want in a build rather than a silent dependency drift.
RUN npm ci --include=dev

# ---------------------------------------------------------------- build
FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src
# Generate the Prisma client before compiling: src imports types from it.
RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------- runtime deps
FROM node:24.18.0-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

# ---------------------------------------------------------------- runtime
FROM node:24.18.0-bookworm-slim AS runtime
# tini reaps zombies and forwards SIGTERM, which is what makes the graceful
# shutdown in docs/infrastructure/production-runbook.md actually happen. Without
# a real init, PID 1 ignores SIGTERM and the platform SIGKILLs us instead --
# dropping in-flight requests and in-flight jobs every single deploy.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--enable-source-maps"

WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/dist         ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node prisma ./prisma

# `node` is an unprivileged user that ships with the base image. The runtime
# needs no write access to its own code, so nothing here is owned by root.
USER node

EXPOSE 3000

# Liveness only. Deliberately NOT /health/ready: readiness depends on Postgres
# and Redis, and a container that is merely waiting for its database is not a
# container the runtime should kill and restart. See health.controller.ts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/health/live',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
