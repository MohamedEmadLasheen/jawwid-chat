# Secret Management

Owner: AI #7 · Date: 2026-09-05

## 1. Where secrets live

| Environment | Store |
|---|---|
| Local | `.env`, gitignored, throwaway values only |
| Staging | GitHub Environment `staging` (secrets scoped to it) + the hosting platform's store |
| Production | GitHub Environment `production`, protected by required reviewers |

Secrets are injected as environment variables at deploy time. They are scoped to
an Environment, so a workflow that does not name that environment cannot read
them — which is why deployment lives in its own workflow files and never in the
one triggered by `pull_request`.

## 2. The inventory

Database credentials · Redis credentials · JWT signing secrets · object storage
access and secret keys · FCM service account JSON · APNs signing key ·
LiveKit API secret · Jawwid Core API key and webhook secret · Sentry DSN ·
registry credentials · mobile signing keys (Android keystore, iOS
certificate/profile).

Marked `SECRET` in `infra/env/manifest.tsv`; that file is the list.

## 3. Rules

Secrets are **never**: committed; written to a `.env.example` or template;
printed by a build log; returned in an API response, including health endpoints
and error payloads; logged, including inside a driver's error text; embedded in
a Flutter binary or an Admin Web bundle; sent to a third party that did not
issue them.

Two of these are enforced mechanically rather than by discipline:

- `scripts/infra/scan-secrets.sh` — runs in CI over the worktree **and git
  history**. Reports file and rule; never prints the matching text, because
  echoing a leaked key into a CI log copies the leak into a second system.
- `scripts/infra/check-web-env.sh` — refuses a web build whose `VITE_*`
  variables, or whose built bundle, look like they carry a credential.

The health endpoints and probe errors are sanitised for the same reason: a
driver error routinely quotes the DSN that failed, and a DSN contains a
password, so `health.service.ts` returns the error *class*, never its message.

## 4. Rotation

Rotate on a schedule, on staff departure, and immediately on any suspicion.

| Secret | Procedure | User impact |
|---|---|---|
| `DATABASE_URL` | Create a second role with the same grants → update the secret → deploy → verify → drop the old role. | None. |
| `REDIS_URL` | Provider rotates the password → update → deploy. | Brief queue pause; jobs are durable and resume. |
| `JWT_ACCESS_SECRET` | Deploy accepting **both** old and new for one refresh-token lifetime, then remove the old. | None if dual-accept is implemented; otherwise every session drops. AI #1 owns the verification path. |
| `JWT_REFRESH_SECRET` | Same, over `JWT_REFRESH_TTL` (30 days) — or accept a forced re-login. | Full re-login if rotated abruptly. |
| `STORAGE_*` | Issue a new key pair → update → deploy → verify uploads and signed reads → revoke the old pair. | Signed URLs already issued keep working until they expire. |
| `FCM_SERVICE_ACCOUNT_JSON` | New service-account key in Firebase → update → deploy → verify → delete the old key. | None. |
| `APNS_PRIVATE_KEY` | New APNs auth key → update `APNS_KEY_ID` **and** the key together → deploy → verify on a real device → revoke the old. | iOS push fails if the ID and key are updated separately. |
| `LIVEKIT_API_SECRET` | New key pair → update → deploy → verify a call connects → revoke the old. | Tokens minted with the old secret fail; TTL is 300s, so a short window. |
| `CORE_API_KEY` / `CORE_WEBHOOK_SECRET` | Coordinate with the Core team; the webhook secret must be rotated on both sides, ideally with dual-accept. | Webhook signature failures if rotated one-sided. |
| Mobile signing | **Not rotatable.** An Android upload key or an iOS certificate cannot be changed without a store process. Back them up; losing the Android keystore means the app cannot be updated. | — |

## 5. Revoking a compromised credential

1. **Revoke at the provider first.** Not "remove it from the code first" —
   deleting a key from git does not un-leak it. It is already in every clone, in
   CI caches, and possibly in an attacker's hands.
2. Issue a replacement and update the secret store.
3. Deploy.
4. Verify the feature the credential serves actually works.
5. Remove the leaked value from the tree; rewriting history is optional and does
   **not** substitute for step 1.
6. Check what the credential could reach while it was valid — database audit
   logs, storage access logs, Core API logs.
7. Write it up (`incident-response.md`). A credential leak is a security
   incident even when nothing was exfiltrated.

## 6. Client applications

A secret that a client needs is a design error, not a configuration one. Route
the call through the API instead.

Clients may hold: the public API base URL, the public realtime URL, the public
LiveKit **URL** (not its secret), and the app bundle identifier.

Clients may never hold: any JWT signing secret, storage credentials, the LiveKit
API secret, Core credentials, or a Supabase `service_role` key. Everything
shipped to a device or a browser is public, whatever it is named.

## 7. Known gaps

- No secret store exists yet, because no hosting or GitHub repository exists yet
  (`production-readiness.md`, BLOCKER-1 and BLOCKER-2).
- No automated rotation schedule. Rotation is documented and manual.
- `scan-secrets.sh` is a tripwire covering this project's realistic failure
  modes, not a comprehensive scanner. Adding a managed scanner is worthwhile once
  the repository is hosted.
