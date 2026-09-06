# Handoff → AI #3 (Flutter — Parent and Teacher apps)

From AI #7 (infrastructure) · 2026-09-06

> **Read this first.** Everything below is a **specification, not a verified
> procedure.** There is no `pubspec.yaml` in the repository and no Flutter or
> Dart SDK on any host I have access to, so none of these commands has been
> executed. Treat them as a starting point to correct, not instructions that are
> known to work.

## 1. Endpoints

| Environment | API base | Realtime | LiveKit |
|---|---|---|---|
| Local | `http://localhost:3000/api/v1` | `ws://localhost:3000` | `ws://localhost:7880` |
| Staging | `https://api.staging.<domain>/api/v1` **TBD** | `wss://api.staging.<domain>` **TBD** | LiveKit project URL **TBD** |
| Production | `https://api.<domain>/api/v1` **TBD** | `wss://api.<domain>` **TBD** | LiveKit project URL **TBD** |

The domains are TBD because no hosting exists (BLOCKER-1). Android emulators
reach the host at `10.0.2.2`, not `localhost`; iOS simulators use `localhost`.

## 2. Configuration strategy

Use `--dart-define` per flavor. Do **not** commit an environment file, and do not
read configuration at runtime from a bundled asset that differs per build.

```bash
flutter build apk --release \
  --dart-define=API_BASE_URL=https://api.staging.example/api/v1 \
  --dart-define=REALTIME_URL=wss://api.staging.example \
  --dart-define=LIVEKIT_URL=wss://livekit.example \
  --dart-define=APP_ENV=staging
```

## 3. What the app may and may not carry

**May:** the API base URL, the realtime URL, the **LiveKit URL**, the bundle
identifier, the Firebase client configuration (`google-services.json`,
`GoogleService-Info.plist` — these are client configuration, not secrets).

**May never:** any JWT signing secret, storage access or secret keys, the
**LiveKit API secret**, Jawwid Core credentials, or a database URL. A compiled
app is public: anything inside it can be extracted from the binary in minutes.

`scripts/infra/scan-secrets.sh` fails CI if `LIVEKIT_API_SECRET`,
`JWT_*_SECRET`, `STORAGE_SECRET_KEY`, `CORE_API_KEY`, `CORE_WEBHOOK_SECRET` or
`service_role` appears anywhere under `lib/`.

Calling works by the app asking the API for a short-lived LiveKit room token
(300s TTL). The app never signs a token itself.

## 4. Infrastructure-dependent UX states

These are the states infrastructure can actually produce. What they look like is
AI #6's; that they exist is not optional.

| State | Cause | Expected behaviour |
|---|---|---|
| Offline | no connectivity | Queue outgoing messages locally with an idempotency key; show unsent state. |
| Reconnecting | socket dropped, server restart, deploy | Reconnect with backoff; **reconcile by re-reading server state** — a dropped realtime event must not mean a lost message. |
| Server unavailable | 503 from readiness draining | Retry with backoff. This is transient by design; do not log the user out. |
| Session revoked | 401 with a distinguishable code | Clear local sensitive state, return to login. Distinct from "server unavailable". |
| Upload failed | storage error, size limit, expired signed URL | Offer retry. A signed URL expires after 300s — request a fresh one rather than reusing. |
| Call failed | LiveKit unavailable, token expired | Calling degrades alone; messaging keeps working. |
| Push not delivered | provider failure | Never assume push equals delivery. In-app state is authoritative. |

Deploys are rolling and graceful (15s drain), so a normal release should present
as a brief reconnect, not an error.

## 5. Builds, signing, release

Versioning: `<semver>+<build number>`; the build number must increase on every
store upload. In CI it would come from the run number.

Signing material — Android upload keystore, iOS certificate and provisioning
profile — is **not rotatable** in any ordinary sense. Losing the Android upload
keystore means the app can never be updated again. When these exist they must
live in the secret store with an offline backup, and must never be committed.

**Nothing is published automatically.** No workflow uploads to a store, and none
should be added without explicit approval.

## 6. What I need from you

1. `pubspec.yaml`, so dependency resolution and a build can be attempted at all.
2. Confirmation of the flavor names you want (`dev`/`staging`/`prod`?) so CI
   jobs and `--dart-define` sets match your project.
3. Whether you need a Flutter CI job now — it will be a `BLOCKED` placeholder
   until an SDK is available on a runner, which AI #5's pipeline already reports
   honestly rather than skipping silently.
