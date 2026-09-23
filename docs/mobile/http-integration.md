# Mobile ↔ Backend HTTP Integration

Owner: AI #3 · Date: 2026-09-06
Status: **Data plane CONNECTED and verified against a running backend. Auth plane BLOCKED.**

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

> ### ⚠️ The live suite cannot currently be run at all (verified 2026-09-23)
>
> Not "nobody has set the variables" — the supported path to produce them is
> broken by two changes that have since landed. Both were reproduced, not
> inferred:
>
> 1. **`scripts/mobile/seed-live.sh` no longer applies.** It inserts a
>    `chat.learner` with a `teacher_id` and never inserts the `chat.teacher`
>    row. PR-A made that column a real foreign key, so the insert fails:
>    `insert or update on table "learner" violates foreign key constraint
>    "learner_teacher_fk"`. Executed against a database built by the current
>    migration chain.
>
> 2. **The suite authenticates with `x-actor-id`, which no longer exists.**
>    PR-B closed the HTTP half of the identity seam: no file under
>    `apps/api/src` reads that header (asserted by the protected test
>    `test/unit/auth/identity-seam.spec.ts`), and `@ActorId()` now reads only
>    `request.actor`, which only `AuthenticatedGuard` writes from a verified
>    bearer token. Every request the suite makes would be refused
>    `AUTH.UNAUTHENTICATED` before reaching a handler.
>
> Reviving it needs a seed script that creates the teacher row and a live run
> that obtains a real session through `POST /auth/login`, plus credentials for
> a seeded account. That is authentication work, not mobile work, and is not
> done here. **Until it is, no claim of live end-to-end verification is
> supportable** — the suite reports `All tests skipped`, which is honest, and
> must not be read as a pass.

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

## 4. The auth plane is blocked

**There is no authentication anywhere in `apps/api`.** No login route, no token issuance, no
refresh, no `/me`, no guard, no device or session registry. The engine identifies its caller
from a plaintext `x-actor-id` header, and says so itself:

> *"AI #1 SEAM: the authenticated actor id. Today it is read from a header so the engine is
> runnable and testable before auth lands."* — `actor.decorator.ts`

A client that asserts its own identity in a header is not authenticated; it is asking to be
trusted. So the mobile client does **not** ship that as authentication:

- `UnavailableAuthRepository` fails every auth call with a specific terminal error rather
  than inventing `/auth/login`.
- `DebugActorHeaderIdentity` exists only for local bring-up, is off unless explicitly enabled,
  and is compiled out of release builds by a `kDebugMode` guard.

**Consequence: a build pointed at the real backend reaches the sign-in screen and stops.**
That is the honest state of the integration.

### What AI #1 must publish

1. **Login** — username + password → access token, refresh token, expiries. Failures must be
   *distinguishable*: bad credentials vs disabled account vs locked. The app reacts
   differently to each; one generic 401 collapses that.
2. **Refresh** — refresh token → new access token.
3. **`/me`** — actor id, display name, avatar, and **server-asserted role** (`parent` |
   `teacher`).
4. **Logout** — invalidate server-side.
5. **Devices/sessions** — register (with push token), list, revoke, and make revocation
   observable to the client.

The client plumbing for all five already exists and is tested: secure token storage,
single-flight refresh on 401 with one replay, and terminal handling for revoked/disabled.
Only the transport calls are missing.

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
| Authentication | `UnavailableAuthRepository` — blocked on AI #1 |
| Calling | `FakeCallRepository` — out of scope by instruction |
| Attachments, voice notes | Not implemented |
| Push notifications | Not implemented |
| Realtime | Not connected; reconnect resync uses the REST `?after=` cursor |
| Typing indicators | No-op; a gateway concern |

Widget tests and local development without a backend still use `FakeBackend`. Selection is by
build-time configuration, so a shipped build cannot fall back to fixtures.
