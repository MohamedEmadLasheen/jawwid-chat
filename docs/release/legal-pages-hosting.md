# Where to serve the public legal pages (LR-04)

**Draft, 2026-11-09. Builder W4.** A recommendation only: no hosting code, nginx change or workflow change is
made by this document. The requirements are in `docs/legal/public-hosting-requirements.md` (R-1 to R-13);
the owner's open choices there are H-1 (host) and H-2 (paths). Everything here waits for the first
production deploy (LR-01), as the account-deletion page already does.

## 1. What already exists

| Piece | Where | What it can serve today |
|---|---|---|
| API | `api.chat.jawwid.com` (`docs/infrastructure/production-readiness.md` §3) | The account-deletion **form**, server-rendered, Arabic by default and English with `?lang=en` (`apps/api/src/account-deletion/`). Its real path is **`/api/v1/account-deletion`**: the global prefix `api/v1` excludes only the health routes (`apps/api/src/main.ts:82-84`; `docs/security/pd040-route-permissions.md:17`; `docs/infrastructure/environment.md:102-103`). Several drafts say `/account-deletion` without the prefix; that path does not exist. |
| Admin Web container | `admin.chat.jawwid.com` (ADR-011, ADR-012) | nginx with full control of response headers, one policy per path chosen by a `map` (`apps/admin-web/infra-nginx/default.conf.template`). It already serves a second public app, the teacher portal under `/teacher/` (PD-28), copied into the image from `apps/admin-web/teacher-web/`. HSTS, `nosniff` and `X-Robots-Tag: noindex` are set server-wide; `scripts/infra/check-web-headers.sh` asserts the headers in CI and after every deploy. |
| Public website | `https://jawwid.com/` (the store consoles' website field; DNS at Hostinger) | Outside this repository. Nothing here can publish to it or check it. |

## 2. Options

| | Option | For | Against |
|---|---|---|---|
| **A** | **Admin Web container, path `/legal/`** | No new resource, no cost, no DNS change. Full header control (R-9 no third parties, R-10 HSTS, a strict CSP). Same deploy, same rollback, same header checks. Pages are generated from the Markdown in the repository, so a test can prove R-7 (same text as the source) on every PR. | "admin" appears in the public URL. The legal pages ship with Admin Web releases. A change to the nginx template is a security-posture change (ADR-011) and needs a careful review. |
| B | The jawwid.com website (Hostinger) | The nicest URL; where visitors expect it | Manual upload by the owner for every change: drift from the approved source (R-7) cannot be checked by CI; the host is outside this repository and may be shared with other Jawwid systems; the owner's job grows instead of shrinking |
| C | The API host, like the deletion form | One more controller | `public-hosting-requirements.md` §2 rules it out: legal pages must not depend on the API being up; adds application code to the API |
| D | A new App Platform static-site component (e.g. `legal.chat.jawwid.com`) | Separate from the console | No response-header control (no HSTS, no CSP: ADR-011's table); a new DNS record; may be a new paid resource |
| E | GitHub Pages from this public repository | Free | Needs a new `.github/` workflow and repository settings (owner-only), another host and DNS record, and Pages' own headers |

## 3. Recommendation: Option A

Serve the rendered pages from the Admin Web container under `https://admin.chat.jawwid.com/legal/`.

### 3.1 The URLs (the values `scripts/mobile/build-store.sh` requires)

`build-store.sh` refuses to build without these (lines 6-10, 85-92); each URL must be `https://`, and `{lang}`
becomes `ar` or `en` in the app (`lib/core/legal/legal_links.dart`).

| Build setting | Value |
|---|---|
| `API_BASE_URL` | `https://api.chat.jawwid.com/api/v1` |
| `PRIVACY_POLICY_URL` | `https://admin.chat.jawwid.com/legal/{lang}/privacy` |
| `TERMS_URL` | `https://admin.chat.jawwid.com/legal/{lang}/terms` |
| `SUPPORT_URL` | `https://admin.chat.jawwid.com/legal/{lang}/support` |
| `SUPPORT_EMAIL` | the confirmed `{{SUPPORT_EMAIL}}` (`docs/legal/owner-confirmation-sheet.md` B-1) |

The other pages, on the same pattern (`public-hosting-requirements.md` §2, H-2):

| Page | Source | Path under `https://admin.chat.jawwid.com/legal/` |
|---|---|---|
| Privacy Policy | `privacy-policy-{ar,en}.md` | `{lang}/privacy` |
| Terms of Use | `terms-of-use-*.md` | `{lang}/terms` |
| Code of Conduct | `user-conduct-policy-*.md` | `{lang}/code-of-conduct` |
| Teacher Terms | `terms-teachers-*.md` | `{lang}/terms/teachers` |
| Staff Terms | `terms-staff-*.md` | `{lang}/terms/staff` (not linked from the support page: H-4) |
| Reporting and Complaints | `reporting-and-complaints-policy-*.md` | `{lang}/reporting` |
| Blocking, Suspension and Enforcement | `blocking-and-enforcement-policy-*.md` | `{lang}/enforcement` |
| Child Safety | `child-safety-policy-*.md` | `{lang}/child-safety` |
| Help and Support | `support-*.md` (new) | `{lang}/support` |
| Account deletion (information) | `account-deletion-*.md` (new) | `{lang}/account-deletion` |
| Versioned copies for the terms gate | as above | `{lang}/terms/<version>`, `{lang}/code-of-conduct/<version>`, … (R-12: never removed) |

The account-deletion **form** stays on the API: `https://api.chat.jawwid.com/api/v1/account-deletion`
(Arabic) and `…?lang=en` (English). It is the value of `{{ACCOUNT_DELETION_URL}}` in the policies.

**Console fields:**

| Console field | Value |
|---|---|
| App Store Connect → Privacy Policy URL | `https://admin.chat.jawwid.com/legal/en/privacy` (and `/ar/` on the Arabic localization) |
| App Store Connect → Support URL | `https://admin.chat.jawwid.com/legal/en/support` (and `/ar/`) |
| App Store Connect → User Privacy Choices URL (optional) | `https://admin.chat.jawwid.com/legal/en/account-deletion` |
| Play → Privacy policy | `https://admin.chat.jawwid.com/legal/en/privacy` |
| Play → Data safety → Delete account URL | `https://admin.chat.jawwid.com/legal/en/account-deletion` (it names the app and developer, gives the steps, and lists what is deleted and kept, then links to the form) |
| Play → Store listing → Website | `https://jawwid.com/` (already set) |

### 3.2 What engineering builds (tickets for the lead; nothing here is implemented)

1. **Renderer.** A script turns each approved `docs/legal/*-{ar,en}.md` into
   `apps/admin-web/legal-web/{ar,en}/<path>/index.html` with one fixed template: `lang`/`dir` (R-4), the
   title, version and effective date at the top (R-5), the version history (R-6), a link to the other
   language, a local stylesheet and system fonts only (R-4, R-9), no script. It drops the front matter and
   every `> **Drafting note …**` block, and **refuses** to render a file that still contains `{{`,
   `TO CONFIRM`, `legal review` or an internal ID (R-11). Links to `*.md` siblings become the paths in §3.1.
2. **Committed output plus a drift test.** The rendered HTML is committed (like
   `apps/admin-web/teacher-web/`, but checked in), and a unit test re-renders the sources and fails on any
   difference (R-7) and on any change to the PD-48 paragraph (R-13). This needs no `.github/` change.
3. **Image.** `apps/admin-web/Dockerfile` gains `COPY legal-web/ /usr/share/nginx/html/legal/`.
4. **nginx.** In `default.conf.template`, following its own rule (no `add_header` in a location):
   a `map $uri $jawwid_csp` entry `~^/legal(/|$)` →
   `default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
   a `$jawwid_cache_control` entry `~^/legal(/|$)` → `no-cache`;
   `location = /legal { absolute_redirect off; return 301 /legal/; }`, the same exact-match redirect
   `/teacher` already has, because without it a bare `/legal` falls through to `location /` and serves the
   Admin Web app; and
   `location /legal/ { try_files $uri $uri/index.html =404; }`, so a missing page is a 404, never the
   Admin Web app. The renderer also writes `legal-web/index.html`, a plain page linking to `ar/` and `en/`,
   so that `/legal/` itself is not a 404.
   **`X-Robots-Tag`: keep it.** The server block sends `X-Robots-Tag: noindex, nofollow` on every response
   (it is a server-level `add_header`), so it also covers `/legal/`. Decision: leave it unchanged for launch.
   The stores, the app and the support page reach the legal pages by direct link, and neither Apple nor
   Google requires them to be indexed by search engines; keeping the header means the console's security
   headers are not touched beyond the two `map` entries and two locations. If the owner later wants the
   pages to appear in search results, the change is to replace the server-level header with
   `add_header X-Robots-Tag $jawwid_robots always;` and a `map $uri $jawwid_robots` that gives
   `~^/legal(/|$)` an empty value (nginx sends no header for an empty value) and `noindex, nofollow` to
   everything else. That would be a separate, reviewed change.
5. **Checks.** `scripts/infra/check-web-headers.sh` asserts the `/legal/` policy (including the
   `X-Robots-Tag` above and the `/legal` → `/legal/` redirect); `smoke.sh` fetches
   `/legal/ar/privacy` and `/legal/en/privacy` after each deploy; ticket L-ENG-11 adds the
   `public-hosting-requirements.md` §5 checks to the release audit.

Risk: High for item 4 (the console's security headers live in the same file), Low for the rest. Review
item 4 with `check-web-headers.sh` in CI.

### 3.3 If the owner prefers the jawwid.com website (Option B)

Use the same paths under the website (for example `https://jawwid.com/legal/{lang}/privacy`), upload the
renderer's output unchanged, and run `public-hosting-requirements.md` §5 by hand after every upload. Decide
before the first store submission: R-12 forbids moving a published URL later, so whichever host is chosen
first must keep answering.

## 4. Order of work

1. Owner confirms `docs/legal/owner-confirmation-sheet.md` (OA-08); counsel reviews (L-items).
2. The lead applies the values in one commit (`docs/legal/apply-confirmed-values.md`).
3. Engineering builds §3.2; independent review of the nginx change.
4. First production deploy (LR-01, owner-approved OA-21); the pages and the deletion form go live together.
5. Run `public-hosting-requirements.md` §5 for every page and language; then enter the console fields
   (LR-09b) and build with the URLs in §3.1.
