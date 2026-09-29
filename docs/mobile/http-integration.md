# Mobile ↔ Backend HTTP Integration

Owner: AI #3 · Date: 2026-09-29
Status: **Data plane CONNECTED. Auth plane CONNECTED.**

---

## 1. What was actually proven

The Flutter transport was run against a booted NestJS API and a real PostgreSQL database —
not a mock, not a test double. `test/integration/live_backend_test.dart`, **10 tests, all
passing**:

| Verified | How |
|---|---|
| Conversation list | `GET /api/v1/conversations` returned the parent's real conversations |
| Conversation detail | `GET /api/v1/conversations/:id` with the real per-role approval policy |
| Message history | `seq` parsed from its string form on real rows |
| Send | A real `chat.message` row was created |
| **Idempotency** | The same `clientMessageId` sent twice returned the *same* `id` and `seq`; the database shows **zero duplicate `client_message_id` values** |
| Exactly-once | The retried message appears once in history |
| Resync | `?after=` returned nothing at or below the watermark |
| **BR-1** | The server refused parent→teacher **and** teacher→parent with `COMM.BR1_TEACHER_PARENT_DIRECT`, classified terminal so it never enters the retry loop |
| Authorization | Decided by the server; the client renders the result |
| Phone privacy | No phone-shaped string in any payload received |

Database evidence after the run:

```
 seq |      body      | moderation |        cmid
-----+----------------+------------+--------------------
   1 | السلام عليكم   | published  | aaaa1111-2222-3333
   2 | اختبار التكامل | published  | live-1788686845234
   3 | رسالة واحدة    | published  | live-once-17886868
```

## 2. How to run it

The backend needs Postgres and Redis. Both were already running as
`jawwid-chat-int` (`:55433`) and `jawwid-chat-redis` (`:6380`).

```bash
cd apps/api && npm run build
```

```bash
DATABASE_URL="postgres://postgres:postgres@localhost:55433/jawwid_chat_int" REDIS_URL="redis://localhost:6380" PORT=3100 STORAGE_SIGNING_SECRET="local-dev-signing-secret-at-least-32-chars" node apps/api/dist/main.js
```

Then, with seeded ids:

```bash
JAWWID_LIVE_API=http://127.0.0.1:3100/api/v1 JAWWID_LIVE_PARENT=<contact-uuid> JAWWID_LIVE_ADMIN=<staff-uuid> JAWWID_LIVE_TEACHER=<teacher-uuid> JAWWID_LIVE_CONVERSATION=<conversation-uuid> flutter test test/integration/live_backend_test.dart
```

The suite **skips** when those variables are absent, so CI without a backend stays green.

The app itself is pointed at a backend at build time. There is no default:

```bash
flutter run --dart-define=JAWWID_API_BASE_URL=http://127.0.0.1:3100/api/v1
```

Note the `/api/v1` prefix — `main.ts` sets it globally, excluding `/health*`.

## 3. Endpoints consumed

| Method | Path | Used for |
|---|---|---|
| GET | `/api/v1/conversations` | Chat list |
| GET | `/api/v1/conversations/:id` | Conversation header, group members |
| POST | `/api/v1/conversations/:id/preferences` | Pin / mute / archive |
| GET | `/api/v1/conversations/:id/messages?before=&after=&limit=` | History and reconnect resync |
| POST | `/api/v1/conversations/:id/messages` | Send, with `clientMessageId` |
| POST | `/api/v1/conversations/:id/messages/read` | Read watermark (`upToSeq` as a string) |
| GET | `/api/v1/conversations/:id/messages/unread` | Unread count (see O1) |
| POST/DELETE | `/api/v1/messages/:id/reactions` | Reactions |

Not consumed: calling (out of scope by instruction), attachments, notifications, membership
mutation (staff-only), and `POST /conversations/direct` outside the BR-1 conformance test.

## 4. The auth plane

**Chat owns credentials and sessions**, and the backend's implementation is authoritative
(`docs/architecture/IDENTITY-MODEL.md` §4.1; `apps/api/src/platform/auth/`). Not Supabase
Auth — there is none in this repository. Not Jawwid Core — Core provisions who exists, Chat
issues sessions.

The Flutter client consumes the published contract unchanged:

| Method | Path | Guard | Client transport |
|---|---|---|---|
| POST | `/auth/login` | `@Public()` | `AuthTransport` |
| POST | `/auth/refresh` | `@Public()` | `AuthTransport` |
| GET | `/me` | bearer | `ApiClient` |
| POST | `/auth/logout` | bearer | `ApiClient` |

`HttpAuthRepository` is the only implementation. There is no second auth path, no development
bypass, and no build in which a client asserts its own identity.

### Tokens live in exactly one place

`SecureTokenStore` — iOS Keychain (`first_unlock_this_device`, never migrated to a new
device) and Android AES-GCM under the platform keystore. Never `shared_preferences`, never
the sqlite cache, never a file, never a URL, never a log. `RedactingLogger` masks token- and
JWT-shaped values on the way out as a second line of defence, not as permission to be casual.

### One TokenProvider, shared by every authenticated consumer

**This is the rule most likely to be broken by accident, so it is stated here and in the code
(`StoredTokenProvider`, `bootstrap.dart`).** There is one `SecureTokenStore`, one
`StoredTokenProvider` and one `ApiClient` per session, and realtime and push registration
must take the same instances when they arrive.

`POST /auth/refresh` **rotates**: the presented refresh token is retired as it is used, and
`AuthService.handleRefreshReuse` treats a replayed one as theft and revokes **every live
session on the account**. Two independent refreshers on one device therefore do not cost a
retry — they sign the user out of every device they own. `ApiClient` single-flights the
refresh, and that guarantee holds *per provider instance*, which is exactly why there must
only ever be one.

### Why login and refresh use a different transport

`ApiClient` answers a 401 by refreshing and replaying. On `/auth/refresh` itself that is a
loop that awaits its own future and never completes. The two `@Public()` routes therefore go
over `AuthTransport`, which has no refresh interceptor — the recursion is impossible by
construction rather than avoided by care. `/me` and `/auth/logout` deliberately go the other
way, over `ApiClient`, *because* it refreshes: `/me` is what `restore()` calls on a cold
start, by which point the access token is usually expired.

### Which principals may sign in

`ActorDto.kind` is `contact | staff | teacher | system`; the app models `parent | teacher`.
`contact → parent`, `teacher → teacher`, and **`staff`, `system` and any unrecognised kind
are refused** with their own message. Staff use the Jawwid console. The mapping fails closed:
defaulting an unclassified principal to parent would hand them a screen and an approval
policy nobody decided they should have.

### The `x-actor-id` seam is gone

PR-B removed the last HTTP reader of that header (`@ActorId()` reads `request.actor`, which
only the verified-bearer guard writes). `DebugActorHeaderIdentity`, `ActorIdentity` and
`UnavailableAuthRepository` have been deleted, and `buildApiClient` no longer takes an
identity: the bearer token is the only credential the client sends.

### Not this workstream

- **Realtime.** `realtime.gateway.ts` still trusts `handshake.auth.actorId`, and
  `identity-seam.ts` refuses to boot the API outside `local | test | ci` because of it. The
  realtime workstream verifies the handshake token and deletes that guard. When it does, its
  client takes the same `TokenProvider` — it must not build its own.
- **Push registration.** `POST /notifications/devices` is authenticated and exists, but no
  push client ships on this branch. It will be another consumer of the same session, and it
  must retire its tokens *before* the session is cleared, because unregistering is itself an
  authenticated call.
- **Proactive revocation.** `AuthRepository.sessionRevoked` is an empty stream. Revocation is
  still enforced immediately — `AuthService.authenticate` re-reads the session row on every
  request — so a revoked session fails the next call the app makes. What is missing is only
  the eviction of an app sitting idle, which realtime provides.
- **Session registry.** `GET /me/sessions` and `DELETE /me/sessions/:id` are named in
  IDENTITY-MODEL §4 but not published. `devices()` and `revokeDevice()` fail explicitly
  rather than fabricating a list a user would act on.

## 5. Defects found in the backend while integrating

Reported, not fixed — `apps/api` is not mine to change.

| # | Severity | Finding |
|---|---|---|
| B1 | **High** | An empty or malformed `x-actor-id` produces a Prisma `P2023` and a **500**, not a 401. Any unauthenticated request to the API currently 500s. |
| B2 | **High** | An unknown actor id returns `{"conversations":[]}` — indistinguishable from "authenticated but has nothing". Without auth the server cannot tell the two apart. |
| B3 | Medium | `POST /conversations/direct` snapshots `threadId` at creation. If the family has no `chat.thread` row yet, the conversation is created with `thread_id = null` and **every send to it fails forever** with a 500 from the `chat.assert_message_author_exists()` trigger. Creating a family without a thread yields a permanently broken conversation. |
| B4 | Low | A `CommError` maps to a clean `{error:{code,message}}`, but an unexpected Prisma error surfaces as a bare `{"statusCode":500,"message":"Internal server error"}` with no `code`, so clients cannot branch on it. |
| B5 | Low | `apps/api` integration suite: 1 of 76 fails — a privacy regex matches a UUID's digit run in a LiveKit claim. A false positive in the test, not a leak. |

## 6. Still outstanding from the contract

Unchanged from `backend-dependencies.md` §5, and now confirmed against the live API:

- **O1 unread count** and **O2 last-message preview** are absent from `ConversationDto`. The
  unread endpoint is per conversation, so a chat list of N rows would need N+1 round trips.
  The client therefore renders no unread badge from the real backend yet.
- **O3 display names.** `MessageDto` carries `authorId` but no name; `ConversationMemberDto`
  carries `actorId` but no name. The member sheet and message author lines have nothing to
  render, and must never fall back to an id.
- **O4 `handledBy`**, **O6 localised server strings**, **O7 learner display name** — unchanged.
- **No search route**, so `search()` fails honestly rather than filtering a partial local cache.

## 7. What is still fake

| Area | State |
|---|---|
| Calling | `FakeCallRepository` — out of scope by instruction |
| Attachments, voice notes | Not implemented |
| Push notifications | Not implemented |
| Realtime | Not connected; reconnect resync uses the REST `?after=` cursor. Socket auth is still the `handshake.auth.actorId` seam server-side |
| Typing indicators | No-op; a gateway concern |

Widget tests and local development without a backend still use `FakeBackend`. Selection is by
build-time configuration, so a shipped build cannot fall back to fixtures.
