# The teacher web portal (PD-28)

Teachers use their portal in a laptop browser. It is **the same Flutter app** as the
phones (`lib/`), built for the web, served by the Admin Web nginx container under
`/teacher/`. Nothing was rebuilt in React. The decision is PD-28 in
`../product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4.

- URL: `https://<admin web domain>/teacher/` (routes are `#` URLs, e.g. `/teacher/#/chats`).
- Teachers only on the web. Any other account sees "The web portal is for teachers" and a
  sign-out button (`lib/features/auth/presentation/web_portal_gate.dart`).
- Same account and password as the phone app.

## Building

```bash
scripts/mobile/build-teacher-web.sh https://api.staging.jawwid.example/api/v1
```

This runs `flutter build web --release --no-web-resources-cdn --base-href /teacher/`
with `JAWWID_API_BASE_URL` compiled in, like a phone build, and copies `build/web/` to
`apps/admin-web/teacher-web/` (ignored by git). `apps/admin-web/Dockerfile` copies that
directory to `/usr/share/nginx/html/teacher/`.

- `--no-web-resources-cdn` bundles CanvasKit (Flutter's renderer) in `/teacher/canvaskit/`.
  Nothing is loaded from gstatic, so the CSP names no third-party host.
- The bundle is per environment, like Admin Web's (ADR-006): the API URL is in it.
- The deploy workflows (`deploy-staging.yml`, `deploy-production.yml`) clone Flutter 3.47.2
  and run the script right before `docker build apps/admin-web`, using the same
  `*_API_BASE_URL` variable as Admin Web. No new variable or secret, so `.do/app.*.yaml` and
  `infra/env/manifest.tsv` are unchanged.
- An Admin Web image built without the script contains only the placeholder, and
  `/teacher/` answers 404. Admin Web itself is unaffected.

## Serving (`apps/admin-web/infra-nginx/default.conf.template`)

- `location /teacher/`: falls back to the portal's own `index.html`, then `=404`.
  `expires -1` (`Cache-Control: no-cache`), because Flutter's file names are not hashed.
  Every file is revalidated by ETag. It uses `expires`, not `add_header`, because an
  `add_header` inside a location drops the server's security headers.
- `/teacher` redirects to `/teacher/` with a relative `Location`.
- **CSP:** a `map` picks the policy per app. Admin Web's policy is unchanged. `/teacher/`
  gets the same policy plus:
  - `script-src 'wasm-unsafe-eval'`: CanvasKit is WebAssembly. This keyword allows
    WebAssembly compilation only, not `eval` or inline script.
  - `connect-src blob: data:`: a picked photo or file is read through its `blob:` URL to be
    uploaded, and Flutter fetches images and the bundled fonts itself.
  - `img-src` gets the API and storage origins (Flutter's `<img>` fallback).
- **CORS:**
  - Origins need nothing new. The API's allowlist is per origin (`CORS_ALLOWED_ORIGINS`),
    and the portal runs on the Admin Web origin, which is already allowed.
  - One header was missing. The Flutter app sends `X-Idempotency-Key` on every replayable
    write. A phone never sends a preflight, so the header was never in the API's
    `allowedHeaders`, and in a browser every message send was refused at the preflight.
  - Fixed in `apps/api/src/infra/http/bootstrap.ts`, tested by
    `apps/api/test/unit/infra/cors.spec.ts`.

## Running locally

Against a local API whose `CORS_ALLOWED_ORIGINS` includes `http://localhost:5299`:

```bash
~/development/flutter/bin/flutter run -d chrome --web-port 5299 --dart-define=JAWWID_API_BASE_URL=http://localhost:3000/api/v1
```

Or the production shape, through nginx (the image built from `apps/admin-web` after the
script):

```bash
scripts/mobile/build-teacher-web.sh http://localhost:3000/api/v1
```

```bash
docker build -t jawwid-admin-web:local --build-arg VITE_API_BASE_URL=http://localhost:3000/api/v1 --build-arg VITE_REALTIME_URL=ws://localhost:3000 apps/admin-web
```

```bash
docker run --rm -p 8088:8080 -e API_ORIGIN=http://localhost:3000 -e REALTIME_ORIGIN=ws://localhost:3000 -e STORAGE_ORIGIN=http://localhost:9000 jawwid-admin-web:local
```

Then open `http://localhost:8088/teacher/`. Without `JAWWID_API_BASE_URL` a debug build runs
on fixtures (`JAWWID_DEV_ROLE=teacher` to see the teacher screens). A release build refuses
to start without it.

## Sign-in and sessions (PD-23 rules, applied to the browser)

- `lib/core/storage/browser_token_store.dart` works like Admin Web's `tokens.ts`:
  - The access token is kept in memory only. After a reload the first request gets a 401,
    and the one refresh authority renews the session.
  - The refresh token goes to `sessionStorage` (`jawwid.teacher.refresh`), or to
    `localStorage` (`jawwid.teacher.refresh.persistent`) when the server answers a login
    with `session.remembered: true`.
  - "Keep me signed in on this device" is offered only where Web Locks exist. Every refresh
    in that mode runs under the `jawwid.teacher.refresh` lock, so two tabs never present
    the same token.
  - The keys differ from Admin Web's, so the two apps on one origin never adopt each other's
    session.
- Login sends `device: {platform: 'web', name: 'Chrome on macOS'}`
  (`browserDeviceLabel`, Admin Web's rules). Then:
  - `platform: 'web'` selects the browser lifetimes in `session-policy.ts`: 12 h / 7 d, or
    7 d / 30 d when kept signed in.
  - The device list shows the browser's name.
- The phone keeps the Keychain / Keystore (`SecureTokenStore`). `platformTokenStore()`
  chooses by conditional import, so `package:web` is never compiled into a phone build.

## What is different in a browser

Every `dart:io` / `Platform.` use in `lib/` was checked.

| Where | Phone | Browser |
|---|---|---|
| `core/network/device_descriptor.dart` (`Platform.isIOS/isAndroid`) | unchanged | `kIsWeb` first: `platform: 'web'`, "Chrome on macOS" |
| `core/storage/secure_token_store.dart` (flutter_secure_storage) | unchanged | `BrowserTokenStore` instead (`token_store_factory.dart`) |
| `core/media/media_picker.dart` (`File(path).length()`) | same read, through `XFile` | `XFile` measures the `blob:` URL |
| `core/data/http/http_message_repository.dart`, `http_billing_repository.dart`, `http_teacher_profile_repository.dart`, `features/messages/data/chat_theme_repository.dart`, `features/profile/data/profile_photo_repository.dart` (`File(path).readAsBytes()/openRead()`) | same read, through `XFile` | `XFile` reads the `blob:` URL |
| `features/messages/presentation/attachment_preview.dart`, `message_bubble.dart`, `media_viewer.dart`, `conversation_media_screen.dart` (`Image.file`) | `FileImage`, through `core/media/local_image.dart` | `NetworkImage` of the `blob:` URL |
| `features/messages/application/messages_controller.dart` (`File(path).delete()`) | unchanged | skipped (nothing on disk) |
| `core/audio/voice_recorder.dart` (path_provider, `File`) | unchanged | not offered: "Voice notes can be recorded in the phone app." |
| `core/network/error_mapper.dart` (`is SocketException`) | unchanged | unchanged (never true in a browser; Dio's own error types are mapped first) |
| `core/data/fake_backend.dart` (`File`, `Platform.pathSeparator`) | fixtures only | fixtures only; never in a release build |
| Push registration (`main.dart`) | unchanged | not started: no APNs/FCM in a browser. Realtime works while the tab is open. |
| App lock (`local_auth`, Settings) | unchanged | the Settings section is hidden |
| CallKit / ConnectionService (`call_native_providers.dart`) | unchanged | none. A call rings on the in-app call screen. |
| Time zone (`flutter_timezone`) | unchanged | the browser's zone (the plugin's web implementation), or picked by hand |
| Voice calls (LiveKit) | unchanged | work: verified in Chrome. The browser asks for the microphone, joins the room and publishes an Opus microphone track. Media needs `LIVEKIT_ORIGIN` in the CSP, which Admin Web's policy already has. |
| Parent sign-up button on the sign-in screen | unchanged | hidden (parents use the app) |

## Verified (2026-10-24, local stack, the real Admin Web nginx image)

Screenshots: [`evidence/pd28/`](evidence/pd28/).

- **Teacher:**
  - Signs in at `/teacher/` and sees their chats.
  - Sends text, a photo and a document, and receives a parent's message live (realtime).
  - Opens a student's profile.
- **Sessions:**
  - Reloading the page keeps the session (one 401, one refresh).
  - The server records `client=web`, 12 h, and the device "Chrome on macOS".
  - With "Keep me signed in", the token is in localStorage and the session is 7 d / 30 d.
    A second tab joins the same session, and the two tabs rotate the shared token without
    a theft revocation.
- **Settings:** no app lock section. Devices & sessions shows "Chrome on macOS · This device".
- **Voice notes:** the mic button says "Voice notes can be recorded in the phone app."
- **Parent:** sees the refusal screen. Only `login` and `/me` are requested.
- **Voice call:** started from the web build in Chrome with a fake microphone. The call
  connects (timer running), and LiveKit logs the browser's published `audio/opus`
  microphone track. The other side answered through the API only, so two-way audio
  between two real people was not exercised.
- **Headers:** `/teacher/` responses carry the portal CSP, HSTS, `nosniff` and
  `Cache-Control: no-cache`. `/teacher` answers 301 to `/teacher/`. Unknown paths serve
  the portal's `index.html`.

## Known limits and follow-ups

- **Voice notes are not recorded in the browser.** Browsers record WebM/Opus, which the
  iPhone app's player cannot play. To record them, the browser would need an AAC/MP4
  encoder, or the server would need to transcode.
- **No push** while the tab is closed. Web Push would need a service worker, VAPID keys and
  a server channel.
- **Emoji show as boxes in the browser.** IBM Plex Sans Arabic (bundled) covers Arabic and
  Latin. For anything else, Flutter fetches Noto fonts from `fonts.gstatic.com`, which the
  CSP blocks (seen in testing). The message itself is stored and delivered intact; only the
  browser cannot draw it. The fix is to self-host Noto Color Emoji (about 10 MB) under
  `/teacher/`, or allow `https://fonts.gstatic.com` in `connect-src`.
- **App icon**: none yet. It waits on the same artwork as the phone icon.
- **Size**: about 37 MB on disk, mostly CanvasKit builds for other browsers. Only one
  CanvasKit is downloaded per visit.
