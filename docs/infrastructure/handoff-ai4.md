# Handoff → AI #4 (Admin Web)

From AI #7 (infrastructure) · 2026-09-06

## 1. How it is deployed

`apps/admin-web/Dockerfile` builds the Vite bundle and serves it from nginx on
port 8080. A static host (Cloudflare Pages, S3+CDN) is equally valid and cheaper;
the nginx image exists so the delivery behaviour is portable and testable rather
than defined by a hosting provider's dashboard.

## 2. The one thing that will surprise you

**The image is environment-specific and cannot be promoted.** Vite inlines
`import.meta.env.VITE_*` at build time — the API URL is compiled into the
JavaScript. Staging and production build separate images from the same commit
(ADR-006). A "promoted" staging bundle would talk to the staging API from the
production domain, and it would look like a caching bug.

If you would rather have one artifact for all environments, ask: fetching a
small `config.json` at boot removes this trade-off entirely, and is a change I
would happily make.

## 3. Build-time variables

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | required; build fails without it |
| `VITE_REALTIME_URL` | Socket.IO origin |
| `VITE_APP_ENV` | `local` / `staging` / `production` |
| `VITE_SENTRY_DSN` | optional |
| `VITE_GIT_COMMIT`, `VITE_BUILD_VERSION` | release identity — please surface these somewhere in the UI |

**Every `VITE_*` value is public.** There is no private one.
`scripts/infra/check-web-env.sh` refuses a build whose `VITE_*` names or values
look like credentials, and separately scans the built bundle. If a feature seems
to need a secret in the browser, that is a design problem — route the call
through the API.

## 4. Delivery behaviour you can rely on

| | |
|---|---|
| SPA routing | unknown paths serve `index.html`, so deep links work |
| `/assets/*` | `Cache-Control: public, immutable`, 1 year — filenames are content-hashed |
| `index.html` | **`no-store`** — a cached `index.html` keeps serving the previous release after a rollback, and presents as "the fix didn't deploy" |
| `/healthz` | plain-text `ok` for the load balancer |
| CSP | `frame-ancestors 'none'`, `script-src 'self'`, `connect-src` pinned to this environment's API and realtime origins |
| Other headers | `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS, `X-Robots-Tag: noindex` |

Two CSP consequences: no inline `<script>` and no third-party script host will
load. `style-src` currently allows `'unsafe-inline'` because most CSS-in-JS needs
it — if you are not using any, tell me and I will tighten it.

`connect-src` is pinned deliberately. A wildcard there would let injected script
exfiltrate customer messages to any host it liked.

## 5. CORS

The API accepts only origins listed in `CORS_ALLOWED_ORIGINS`, with credentials.
Verified: an allowed origin gets `Access-Control-Allow-Origin`; an untrusted one
gets no header at all. If Admin Web is served from a new domain, that variable
must be updated or every request will fail in the browser while working in curl.

`X-Request-Id` is exposed to the browser — surfacing it in an error toast makes
support tickets traceable to a single request in the logs.

## 6. Monitoring

Sentry is specified but not provisioned (BLOCKER-3). When it is, initialise it
with `VITE_SENTRY_DSN` and set the release to `VITE_GIT_COMMIT` so browser errors
map to a deployed commit.

## 7. In CI

Admin Web is typechecked, tested, **built**, and the built bundle is scanned for
credentials. The build step was added to the pipeline as part of this work — it
is what makes the bundle scan meaningful.
