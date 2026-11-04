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
# `prisma generate` picks the query engine by the OpenSSL it finds, and the
# slim base has none: without this it falls back to the openssl-1.1.x engine,
# while the runtime below has OpenSSL 3 (ca-certificates depends on it), and
# the API dies at boot with "could not locate the Query Engine". This stage's
# node_modules is what the runtime ships, so it must see the runtime's OpenSSL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
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
# PD-27: the invoice PDF's typeface (IBM Plex Sans Arabic, OFL), read at render time.
COPY --chown=node:node assets ./assets

# `node` is an unprivileged user that ships with the base image. The runtime
# needs no write access to its own code, so nothing here is owned by root.
USER node

# Fail the BUILD, not the first boot, if Prisma cannot load its engine here: it
# connects through Prisma's own engine lookup to a port nothing listens on.
# P1001 ("can't reach database server") means the engine loaded; anything else
# (the engine missing or built for another OpenSSL) stops the build.
RUN node -e "const {PrismaClient}=require('@prisma/client');new PrismaClient({datasourceUrl:'postgresql://check@127.0.0.1:1/check'}).\$connect().then(()=>process.exit(1),e=>{if(e.errorCode==='P1001')process.exit(0);console.error('Prisma engine check failed:',e.message);process.exit(1)})"

EXPOSE 3000

# Liveness only. Deliberately NOT /health/ready: readiness depends on Postgres
# and Redis, and a container that is merely waiting for its database is not a
# container the runtime should kill and restart. See health.controller.ts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/health/live',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
