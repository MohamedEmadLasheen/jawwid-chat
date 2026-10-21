# Abuse limits on authenticated actions (Phase 8)

Status: on branch `claude/hardening-abuse-limits` (2026-10-21). This rebuilds the
September Phase 8 limits (`integration/phase7-gate2-ci`, `AUTH-THROTTLING.md` §5.1
there) on main's design. Nothing from the old Postgres throttle table was ported.

## 1. What was missing

Login is rate limited (`LoginRateLimiter`, `platform/auth/login-rate-limit.ts`).
Everything behind login was bounded only by **authorization**. Authorization answers
"may this actor do this at all". It does not answer "may this actor do it four
thousand times a minute".

Every abuse case this product has is an *authorized* action:

- a compromised or scripted session flooding a family's thread;
- a client minting presigned uploads until the storage bill is a problem;
- a story published again and again at every family;
- a client looping call starts, where each start rings every member.

## 2. The mechanism

| Piece | Where |
|---|---|
| `@RateLimited(ActionScope.X)` opt-in decorator, `ActionThrottleGuard` | `apps/api/src/platform/auth/action-throttle.guard.ts` |
| Registration: a global `APP_GUARD` after `AuthenticatedGuard` | `apps/api/src/platform/auth/auth.module.ts` |
| Counter store: the login limiter's `RateLimitStore` (Redis, one atomic Lua reserve) | `RATE_LIMIT_STORE`, `redis-rate-limit.store.ts` |
| Per-socket frame budget | `apps/api/src/communication/realtime/frame-budget.ts`, installed in `RealtimeGateway.connect` |
| Limits | `chat.config` rows (migration `20261021020000_chat_abuse_limits.sql`), mirrored as compiled defaults in `AppConfigService` |

- **Per actor.** The key is `ratelimit:action:<scope>:<sha256(actorId)[0:32]>`. The
  actor comes from the verified token (`request.actor`), never from a header or body.
  The id is hashed so a Redis dump does not list who was active.
- **The attempt counts, before the handler runs.** A request that later fails
  validation still spent budget. Nothing is released on success.
- **Fixed window**, like login. The store has no separate block period: a refused
  actor waits for the rest of the window. `Retry-After` gives that wait.
- **Opt-in.** Each check costs a Redis round trip, so only the routes below pay it.
  Reads, paging and health checks never do.
- **Refusal:** `429 COMMON.RATE_LIMITED` with `Retry-After`, served by
  `AuthErrorFilter`. This is the same code and header as login.

## 3. The limits (initial hypotheses, editable in `chat.config`)

| Key | Default | Routes |
|---|---|---|
| `abuse.throttle.window_seconds` | 60 | the window for all four budgets |
| `abuse.throttle.message_send_actor` | 60 | `POST /conversations/:id/messages`, `POST …/messages/forward` |
| `abuse.throttle.attachment_upload_actor` | 30 | `POST …/messages/attachments/authorize`, `POST /stories/media` |
| `abuse.throttle.story_publish_actor` | 20 | `POST /stories/:id/publish` |
| `abuse.throttle.call_start_actor` | 20 | `POST /calls`, `POST /scheduled-calls/:id/join` |
| `abuse.realtime.frames_per_socket_per_minute` | 600 | every inbound WebSocket frame |

- These are set well above human use on purpose. A limit a busy admin can hit on a
  hard morning gets raised in a panic and then forgotten.
- Shared budgets are deliberate. A forward is a send. A story upload grant is an
  upload grant. A scheduled-call join starts the call when the room is empty. A
  separate budget for any of these would be a second, unmetered way around the first.
- A row that is missing, unreadable or not an integer falls back to the compiled
  default. JSON `null` counts as malformed; it is never read as 0. A limit of `0`
  is honoured and refuses everything: tightening a limit must never turn it off.
  The window must be at least 1.
- Not ported:
  - `block_seconds`: main's store uses a fixed window only.
  - `broadcast_send_actor`: main has no broadcast route. Story publish is the
    fan-out action.
  - `ai_generate_actor`: main has no AI.

## 4. Failure mode: FAIL OPEN (the opposite of login)

If Redis is unreachable, the action is **allowed** and an error is logged (the error
name only). The same applies when Redis has not answered within 500 ms, and when
`REDIS_URL` is unset (logged once).

Why login fails closed:

- Its endpoint guards a secret.
- An unmetered Argon2id endpoint is both a brute-force oracle and a CPU amplifier.
- A refused login costs the user one retry.

Neither reason applies to these routes:

- The caller has already authenticated.
- Every action is still fully authorized on every request.
- The abuse being limited is *volume* from an identity that can be revoked.

Failing closed would turn a Redis blip into "nobody can send a message, upload a
photo or start a call". That is an outage of the product's core function, and it
is far worse than a minute of unmetered sends by an accountable session. Once
readiness sees Redis gone, the instance is drained anyway (`architecture.md` §7).

## 5. WebSocket frames

- Frames are bounded **per socket, in memory**, not in Redis. `typing.start` fires on
  every keystroke, and a round trip per keystroke would be a self-inflicted denial of
  service.
- A socket lives on one node for its whole life. So a per-process counter is exactly
  right for what it protects, which is that node's event loop.
- Thousands of sockets across a fleet are a connection-count problem, and that
  belongs at the edge.
- The budget is installed as socket middleware (`client.use`) **after**
  authentication. It counts every frame, including events that no handler
  subscribes to.
- Over budget:
  - the frame is dropped and never reaches a handler;
  - the socket is disconnected by the server (`disconnect(true)`), which socket.io
    clients do not auto-reconnect from;
  - `realtimeMetrics.framesOverBudget` is incremented.
- Fixed window: a client can burst up to 2× the limit across a window boundary.

## 6. Tests

- `apps/api/test/unit/abuse/action-throttle-guard.spec.ts`: policy, fail-open on
  error, hang and missing store, config fallbacks, guard order.
- `apps/api/test/unit/abuse/rate-limited-routes.spec.ts`: every route above carries
  its scope, with the method and path.
- `apps/api/test/unit/abuse/frame-budget.spec.ts`: the budget, plus how the gateway
  wires it in.
- `apps/api/test/integration/action-rate-limit.spec.ts`: against a real Redis, over
  HTTP. Covers the 429 body and `Retry-After`, the hashed key and TTL, atomicity
  under a burst, and fail-open against a dead Redis.
