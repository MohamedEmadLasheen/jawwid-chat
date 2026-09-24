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

## 6.1 Provisioning LiveKit Cloud staging

**DONE on 2026-09-24.** The `jawwid-staging` project exists (LiveKit Cloud, data
region European Union / Frankfurt), the GitHub Environment `staging` holds all
three values, and `scripts/infra/livekit-probe.sh` exits 0 against the real
project:

```
VERIFIED — LiveKit Cloud accepted a token minted by this codebase.
  endpoint reachable, key recognised, secret correct
  active rooms visible to this project: 0
```

**What that proves:** the endpoint is reachable over TLS, the API key names a
real project, and the API secret is the right one for it — LiveKit verifies the
HMAC, so a wrong secret is refused as unauthenticated.

**What it does not prove, and must not be reported as proving:** that audio
flows. Joining a room, publishing a microphone and subscribing to remote audio
need a media client and two devices. The control plane is verified; the media
plane is not.

Re-run it after any key rotation. The steps below are the record of how the
project was provisioned, and what to repeat if it is ever rebuilt.

1. **Create the LiveKit Cloud project** at `cloud.livekit.io` — a *staging*
   project, separate from any production one. An account owner does this;
   creating accounts is not something automation should attempt.

2. **Copy three values** from the project's Settings → Keys:
   the project URL, an API key, and its secret.

3. **`LIVEKIT_URL` must be the `wss://` form.** A LiveKit project answers on the
   same host with two faces: `wss://` for media signalling and `https://` for the
   RoomService control plane. The value here is handed to the CLIENT, which
   connects over WebSocket, so it must be `wss://<project>.livekit.cloud`. The
   probe derives the `https://` form itself. Getting this wrong used to be
   silent — the probe would pass while every client failed — and
   `media-token.ts` now refuses a non-WebSocket URL for exactly that reason.

4. **Create the GitHub Environment `staging`** (it does not exist yet), then add:

   | Name | Kind | Why |
   |---|---|---|
   | `LIVEKIT_URL` | **variable** | not a secret; `manifest.tsv` marks it `no` |
   | `LIVEKIT_API_KEY` | **secret** | |
   | `LIVEKIT_API_SECRET` | **secret** | |

   The names must be exactly these — `deploy-staging.yml` reads
   `vars.LIVEKIT_URL`, `secrets.LIVEKIT_API_KEY`, `secrets.LIVEKIT_API_SECRET`.
   Do not add a fourth variable: token lifetime is
   `chat.config['call.token_ttl_seconds']` (120 s) and is deliberately not an
   environment variable.

5. **Verify, before trusting it.** Either from a shell holding the three values,
   or — better, because then nobody has to hold the secret at all — through the
   `LiveKit probe` workflow (`.github/workflows/livekit-probe.yml`), which runs
   the same script inside the environment. It is `workflow_dispatch` only, and
   GitHub requires such a workflow to be on the default branch before it can be
   dispatched.

   Locally:

   ```bash
   scripts/infra/livekit-probe.sh
   ```

   Exit 0 means the endpoint is reachable, the key is recognised and the secret
   is correct. Exit 78 means a value is missing. Exit 1 means LiveKit refused or
   could not be reached. The probe prints no key, secret, token or URL, so its
   output is safe to paste into an issue.

   A token that parses proves nothing: the API signs its own tokens, so they
   verify whether or not the project exists. Only the probe asks LiveKit.

## 7. Known gaps

- **Partially resolved 2026-09-24.** The GitHub Environment `staging` now exists
  and holds the three LiveKit values, verified end to end by the probe. Every
  other staging secret — database, Redis, JWT, storage, FCM, APNs, Core — is
  still unset, and no `production` Environment exists at all, so a deployment
  would still fail on the first missing value (`production-readiness.md`,
  BLOCKER-1 and BLOCKER-2).
- No automated rotation schedule. Rotation is documented and manual.
- `scan-secrets.sh` is a tripwire covering this project's realistic failure
  modes, not a comprehensive scanner. Adding a managed scanner is worthwhile once
  the repository is hosted.
