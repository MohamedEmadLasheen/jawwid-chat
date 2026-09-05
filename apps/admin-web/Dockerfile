# Jawwid Chat Admin Web — production image. Owner: AI #7 (infrastructure).
#
#   docker build -t jawwid-chat-admin:dev \
#     --build-arg VITE_API_BASE_URL=https://api.staging.jawwid.example/api/v1 \
#     --build-arg VITE_REALTIME_URL=wss://api.staging.jawwid.example \
#     apps/admin-web
#
# EVERY BUILD ARG BELOW ENDS UP IN THE BROWSER BUNDLE.
# Vite inlines `import.meta.env.VITE_*` at build time; the values are plain text
# in the shipped JavaScript. Nothing secret may be passed here -- not an API
# key, not a LiveKit secret, not a service_role token. Enforced in CI by
# scripts/infra/check-web-env.sh.
#
# One consequence worth stating: the image is environment-specific. A staging
# bundle cannot be promoted to production, because the API URL is compiled in.
# Production builds its own image from the same commit (ADR-006).

# ---------------------------------------------------------------- build
FROM node:22.14.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ARG VITE_API_BASE_URL
ARG VITE_REALTIME_URL
ARG VITE_APP_ENV=production
ARG VITE_SENTRY_DSN
ARG VITE_BUILD_VERSION
ARG VITE_GIT_COMMIT
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_REALTIME_URL=$VITE_REALTIME_URL \
    VITE_APP_ENV=$VITE_APP_ENV \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_BUILD_VERSION=$VITE_BUILD_VERSION \
    VITE_GIT_COMMIT=$VITE_GIT_COMMIT

RUN test -n "$VITE_API_BASE_URL" || (echo "VITE_API_BASE_URL is required" && exit 1)
RUN npm run build

# ---------------------------------------------------------------- runtime
FROM nginx:1.27-alpine AS runtime

# The official image runs envsubst over /etc/nginx/templates/*.template at
# startup, so the Content-Security-Policy can name this environment's real API
# and realtime origins instead of being loosened to a wildcard.
COPY infra-nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

ENV API_ORIGIN="" \
    REALTIME_ORIGIN="" \
    NGINX_PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${NGINX_PORT}/healthz" >/dev/null 2>&1 || exit 1
