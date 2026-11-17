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
FROM node:24.18.0-bookworm-slim AS build
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
# PD-29 audio: the lessons site's origin. Only a frame on it is handed Quran
# audio (src/features/materials/lessonAudio.ts); unset = no lesson gets audio.
ARG VITE_LESSONS_ORIGIN
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_REALTIME_URL=$VITE_REALTIME_URL \
    VITE_APP_ENV=$VITE_APP_ENV \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_BUILD_VERSION=$VITE_BUILD_VERSION \
    VITE_GIT_COMMIT=$VITE_GIT_COMMIT \
    VITE_LESSONS_ORIGIN=$VITE_LESSONS_ORIGIN

RUN test -n "$VITE_API_BASE_URL" || (echo "VITE_API_BASE_URL is required" && exit 1)
RUN npm run build

# ---------------------------------------------------------------- runtime
FROM nginx:1.27-alpine AS runtime

# The official image runs envsubst over /etc/nginx/templates/*.template at
# startup, so the Content-Security-Policy can name this environment's real API
# and realtime origins instead of being loosened to a wildcard.
COPY infra-nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
# PD-28: the teacher web portal, built beforehand by
# scripts/mobile/build-teacher-web.sh into teacher-web/ (the Flutter app needs the
# repository root, which is not this image's build context). Without that step
# only the placeholder is copied and /teacher/ answers 404; the deploy workflows
# always run it.
COPY teacher-web/ /usr/share/nginx/html/teacher/
# LR-04: the public legal pages, rendered and committed by
# scripts/legal/legal_pages.py (docs/release/legal-pages-hosting.md, Option A).
# While publication is switched off (docs/legal/publication.json) legal-web/
# holds only .gitkeep: it is deleted, the then-empty directory is removed, and
# nginx answers 404 at /legal/. The build REFUSES an image that would serve a
# page still carrying a placeholder or a review marker (grep exit 0 = a match,
# 2 = an error: both refuse; only 1, no match, builds). The generator and its
# CI guard (scripts/qa/guards.sh web-env) check far more; this is the backstop.
COPY legal-web/ /usr/share/nginx/html/legal/
RUN set -eu; d=/usr/share/nginx/html/legal; rm -f "$d/.gitkeep"; rc=0; \
    grep -rlF -e '{{' -e 'TO CONFIRM' -e 'legal review' -e 'Drafting note' -e 'مراجعة قانونية' "$d" || rc=$?; \
    if [ "$rc" -ne 1 ]; then echo "refusing to serve unfinished legal pages under /legal/ (grep exit $rc)" >&2; exit 1; fi; \
    rmdir "$d" 2>/dev/null || true

# LIVEKIT_ORIGIN: the media server the call screen connects to (wss://...),
# from the API's LIVEKIT_URL. Empty means calls cannot connect media.
# STORAGE_ORIGIN: the object store's origin (https://...), the host of the
# API's signed upload and download URLs. Empty means voice notes upload and
# play only when the store is served from API_ORIGIN (the local driver).
# MATERIALS_FRAME_ORIGINS (PD-29): the https origins a Materials link may be
# framed from (the lessons site), space-separated. Empty: only packages from
# API_ORIGIN are framed.
ENV API_ORIGIN="" \
    REALTIME_ORIGIN="" \
    LIVEKIT_ORIGIN="" \
    STORAGE_ORIGIN="" \
    MATERIALS_FRAME_ORIGINS="" \
    NGINX_PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${NGINX_PORT}/healthz" >/dev/null 2>&1 || exit 1
