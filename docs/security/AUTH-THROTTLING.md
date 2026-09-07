# Jawwid Chat — Abuse Protection

Status: **CANONICAL** · Phase 1 closure (2026-09-07) · extended to authenticated
actions in Phase 8 (2026-09-08)
Implementation: `supabase/migrations/20260907120100_chat_phase1_auth_throttle.sql`,
`supabase/migrations/20260908090000_chat_phase8_action_throttle.sql`,
`apps/api/src/platform/auth/throttle.service.ts`,
`apps/api/src/platform/auth/action-throttle.guard.ts`,
`apps/api/src/communication/realtime/frame-budget.ts`
Tests: `apps/api/test/integration/auth-throttling.spec.ts`,
`apps/api/test/integration/phase8-abuse-controls.spec.ts`,
`apps/api/test/unit/abuse/`

---

## 1. What was already there, and what it did not cover

Phase 1 shipped a **per-credential lockout**: `chat.account_credential` counts
failed attempts and locks the account for `auth.lockout_seconds` after
`auth.max_failed_attempts`. That stops a patient attacker guessing one person's
password. It stops nothing else:

| Attack | Why the credential lockout misses it |
|---|---|
| **Password spraying** — one common password against a thousand subjects | No single credential ever reaches its limit |
| **Subject enumeration** via forgot-password | The endpoint is designed to answer identically, which also makes it cheap to hammer |
| **Reset-token guessing** | A reset token takes an account over without knowing anything about it, and redeeming one is not a credential attempt |
| **Lockout as denial of service** | Ten deliberate failures lock a real person out. A source-scoped limit blocks the attacker before they get there |

---

## 2. The model

Two axes, because they fail differently.

```
per SOURCE  (login_ip, reset_request_ip, reset_redeem_ip)
    bounds one address. Evaded by rotating addresses — which is
    why it is not the only axis.

per TARGET  (login_subject, reset_request_subject)
    bounds attempts against one subject FROM ANYWHERE.
    Address rotation does not help an attacker here.
```

A bucket is `<scope>:<HMAC of the value>`. The table stores no address and no
subject in clear: a throttle table is not a place to accumulate a list of real
account names or a log of who connected from where.

Counting happens **before** the credential is examined, and for an unknown
subject exactly as for a known one. A throttle that only counted real subjects
would answer, through the shape of its refusals, the question the uniform 401
exists to refuse.

## 3. The policy

Every number is a row in `chat.config`, so changing it is an operations change
rather than a deploy. These are initial hypotheses, not commitments.

| Key | Default | Meaning |
|---|---|---|
| `auth.throttle.window_seconds` | 900 | The rolling window every counter is measured over |
| `auth.throttle.block_seconds` | 900 | How long a bucket stays blocked once it trips |
| `auth.throttle.login_per_ip` | 30 | Failed logins allowed from one address. Sized to let a shared office NAT have a bad morning |
| `auth.throttle.login_per_subject` | 10 | Failed logins against one subject, from anywhere |
| `auth.throttle.reset_request_per_ip` | 10 | Forgot-password requests from one address |
| `auth.throttle.reset_request_per_subject` | 5 | Forgot-password requests naming one subject |
| `auth.throttle.reset_redeem_per_ip` | 10 | Reset-token redemptions from one address |

The limit is the number of attempts **allowed**; the one after it trips the
block. A block outlives its window, so waiting out the window while blocked does
not reset the counter. A **successful** login clears its own counters, so
somebody who mistypes twice and then signs in carries nothing forward.

Refusal is always `AUTH.TOO_MANY_ATTEMPTS`, HTTP **429**, with no indication of
which axis tripped.

## 4. Why PostgreSQL and not Redis

The same reason the credential lockout lives beside the credential: a limit that
disappears when a cache restarts is not a limit, and an attacker who can cause a
restart can clear it. Redis is already a dependency here — for presence and
typing indicators, both of which are *allowed* to evaporate. Authentication
throttling is not.

The counter is one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement,
so two concurrent attempts cannot both read a count of nine and both decide they
are the tenth.

## 5. What this does NOT cover

Stated plainly, because a file like this one otherwise implies more than it
delivers.

* **A distributed attack from many addresses defeats any per-address counter.**
  No application-level limiter changes that. The per-subject counter still
  bounds the damage per target, but volume defence belongs at the edge — a WAF,
  the load balancer, or the CDN — and that is **not configured by this
  repository**.
* **No CAPTCHA, no proof of work, no device reputation.** Out of scope for the
  MVP and a product decision, not a security omission to be fixed quietly.
* **`/auth/refresh` is not throttled.** A refresh token is opaque, 256 bits, and
  rotated on use; guessing one is not the cheap attack. Its session check is a
  single indexed lookup.

> **Superseded (Phase 8).** This section used to end with "authenticated
> endpoints are not throttled. They are bounded by authorization, and a session
> that misbehaves can be revoked." That was true and it was not enough:
> authorization answers whether an actor may do a thing, not whether they may do
> it four thousand times a minute, and revocation is a human noticing. See §5.1.

## 5.1 Authenticated actions

The counters in §3 bound what can be reached **without** a session. These bound
what a session can **repeat**, per actor — the axis an authenticated caller
cannot rotate, because authorization already resolved it and it can be revoked.

Same table, same function, same window semantics. A second mechanism with its
own storage and its own off-by-one is how two limiters disagree during an
incident.

| Key | Default | Bounds |
|---|---|---|
| `abuse.throttle.window_seconds` | 60 | The rolling window. Much shorter than the auth window: this asks whether a session is behaving like a script *right now* |
| `abuse.throttle.block_seconds` | 300 | How long a tripped actor stays blocked |
| `abuse.throttle.message_send_actor` | 60 | One per second sustained — far above human typing, far below a script |
| `abuse.throttle.attachment_upload_actor` | 30 | Each grant authorises a write to object storage, so this bounds spend too |
| `abuse.throttle.broadcast_send_actor` | 5 | Fans out to every family in the audience: the most expensive action in the product |
| `abuse.throttle.story_publish_actor` | 20 | |
| `abuse.throttle.call_start_actor` | 20 | Each one mints a media token and reserves a room |

Every number is an INITIAL HYPOTHESIS sized from the shape of the product rather
than from measurement, and every one is a `chat.config` row. They sit well above
human use on purpose: a limit a busy admin can reach on a difficult morning is a
limit that gets raised in a panic and then forgotten.

Refusal is `AUTH.TOO_MANY_ATTEMPTS`, HTTP **429** — the same code as §3, because
it is the same answer. Unlike the login counters, an action counter is **not**
cleared on success: a login counter measures failures, so signing in correctly
should erase it, but this one measures the action itself. Sixty successful sends
in a minute is exactly what it is looking for.

The gate is **opt-in per route** (`@RateLimited(ActionScope.X)`), the opposite
arrangement from authentication. A route nobody remembered to authenticate is a
hole; a route nobody remembered to rate-limit is merely unlimited, and paying a
database round trip on message-history paging would be a performance regression
dressed as a security control.

## 5.2 WebSocket frames

Bounded in the gateway, per socket, **in memory** — `abuse.realtime.frames_per_socket_per_minute`,
default 600. This is the one place the durable counter is the wrong tool:
`typing.start` fires per keystroke, and a database write per keystroke would be a
worse denial of service than the abuse it defends against.

The trade is honest about what it buys. The resource being protected is one
node's event loop, and a socket lives on exactly one node for its whole life, so
a per-process counter is not an approximation of the right answer — it is the
right answer for that resource. It is installed as socket middleware, so it
bounds **frames** rather than handler invocations, including frames for events
nothing subscribes to. A socket that exceeds it is refused *and* disconnected:
refusing alone leaves a runaway client looping against a socket that keeps
answering it.

What it does not bound is an attacker opening a thousand sockets across a fleet.
That is connection-count defence and belongs at the edge, with the volume
defence below.

## 6. Operating it

* `chat.auth_throttle` is safe to truncate: every row is a counter, and losing
  them costs an attacker's progress as much as a victim's.
* `chat.prune_auth_throttle(interval)` removes rows that are past their window
  and not blocked. Nothing depends on it running — an expired row is already
  inert, because every decision compares against the window and the block.
* To release somebody locked out in error, delete their bucket. There is no
  administrative unlock endpoint by design: an endpoint that clears a throttle
  is an endpoint worth attacking.
