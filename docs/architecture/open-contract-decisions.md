> **STATUS: HISTORICAL** (Phase 0, 2026-09-07). Teacher identity is now decided in `IDENTITY-MODEL.md` §2.1; Core authentication remains an external unknown, handled per `IDENTITY-MODEL.md` §4.1.
> Canonical index: `docs/README.md`.

# Open contract decisions

Plans and blockers only. **Nothing in this document is implemented**, and nothing
in it invents a Jawwid Core field, event or payload.

---

## 1. Teacher identity — BLOCKED, contract decision required

### The chain, traced end to end

| Link | State |
|---|---|
| Core teacher identity | **Does not exist.** Jawwid Core (`second-school`) has no teacher table, and its own PRD lists live classes as a V1 non-goal. PRD v0.1 §12.4 lists teachers as a synced entity, so Core must gain one. |
| Core identifier | **Unratified.** `core_teacher_id uuid` is a proposal I wrote; the PRD says only that each entity "carries an `external_id`" — no name, no type. |
| `chat.teacher` record | **Exists**, populated by `chat.ingest_core_teacher`. |
| `chat.teacher.account_id` | **Exists, never written.** Nothing anywhere assigns it — verified by search. |
| `chat.account` | **Cannot hold a teacher.** `kind` is `CHECK (kind IN ('staff','family'))`. There is no `'teacher'`. |
| Authenticated actor | **No resolver.** `current_staff_id()` and `current_contact_family_ids()` exist; there is no `current_teacher_id()`. Every RLS policy is written against staff or contact, so a teacher matches nothing. |
| Teacher App | Cannot sign in. |

### Why `chat.teacher.account_id` is never populated

Three independent reasons, each sufficient on its own:

1. `chat.account.kind` has no `'teacher'` value, so a teacher account cannot be
   inserted at all.
2. There is no `chat.link_teacher_account()`. The two that exist
   (`link_staff_account`, `link_contact_account`) hard-code `'staff'` and
   `'family'`.
3. Nothing would call it. No Core event provisions a user of any kind.

It was written as a forward-looking column and no path to it was ever built.

### What must be decided before any of it can be implemented

PRD §7.1 says sign-in is "provisioned from Jawwid Core… created, activated and
disabled from the admin panel **or by sync**", but never defines that sync. So:

1. **Does Jawwid Core model teachers at all**, and if not, where does teacher
   identity live? (PRD §15.2 Q1 is open on exactly this.)
2. **What is the teacher identifier** — field name, type, stability guarantee?
3. **Who issues the login subject?** Does Core's identity provider mint it and
   deliver it to Chat, or does Chat provision credentials and tell Core? PRD §7.1
   implies the former; nothing specifies it.
4. **Is a teacher's identity the same principal as a staff member's?** Chat models
   them as different actor kinds; a person who is both would need two accounts.

Until 1–3 are answered, implementing this means inventing Core's identity
contract. **STOP is the correct state.**

---

## 2. User / role synchronisation — BLOCKED, contract decision required

### Audit

| What | State |
|---|---|
| Core events for users | **None.** All 11 event types cover families, students, teachers, enrolments, class sessions, subscriptions and payments. |
| `chat.staff` | No `core_user_id`. Staff exist only if inserted directly into Chat. |
| `chat.account` | `kind IN ('staff','family')`. |
| `conversation_member.actor_kind` | `('contact','staff','teacher')` — three kinds. |
| `chat.staff.role` | `admin, coverage, manager, finance, technical, academic` |

### A mismatch that must be resolved first

`chat.staff.role` does **not** match PRD v0.1 §3, and cannot be mapped cleanly:

| PRD v0.1 §3 | `chat.staff.role` |
|---|---|
| `admin` | `admin` ✅ |
| `coverage_admin` | `coverage` — different name |
| `manager` | `manager` ✅ |
| `super_admin` | **missing** |
| `parent`, `student`, `teacher` | not staff roles here (modelled as contact / learner / teacher) |
| — | `finance`, `technical`, `academic` — **not PRD roles.** They come from the superseded PDF brief's departmental task model. |

Syncing roles from Core into this vocabulary would either drop `super_admin` or
silently coerce it. **The role vocabulary has to be reconciled with PRD §3 before
a sync contract can be written**, and that reconciliation is itself a product
decision: are `finance`/`technical`/`academic` still real (they carry the
department task model in §7.6), or did they leave with the PDF brief?

### What is missing, once the above is settled

- Event types: `user.upserted`, `user.deactivated`, and role assignment —
  whether roles ride on the user payload or are separate events is undecided.
- Payload: Core user id, display name, role(s), status, locale, and the login
  subject (see §1.3 above).
- Schema: `chat.staff.core_user_id`, unique per organization; `'teacher'` in
  `chat.account.kind`; `chat.link_teacher_account()`; `chat.current_teacher_id()`.
- Deactivation must route through the existing `chat.offboard_staff()`, which
  already refuses to strand families — a naive `user.deactivated` that flips
  `is_active` would be rejected by that guard, correctly.

**Do not implement until Core's user and role model is documented.**

---

## 3. Backfill and reconciliation — recommendation, not implemented

### What happens today to a misbehaving delivery

| Failure | Current behaviour | Verdict |
|---|---|---|
| **Delayed** | Applied on arrival; `core_synced_at` drops it if a newer event already landed. | Safe |
| **Duplicated** | Refused twice over: unique `event_id`, and upsert on the Core id. | Safe |
| **Out of order** (update before create) | The update returns `not_applicable`, the contract tells Core to stop retrying, and the create arrives later carrying only its own state. **The update is lost silently.** | **Gap** |
| **Lost** | Nothing notices. No sequence, no watermark, no sweep. | **Gap** |
| **Partially applied** | Impossible: one delivery is one transaction. A crash leaves it recorded-and-unprocessed, and the retry re-applies it. | Safe |

The two gaps share a shape: Chat has no way to know that what it holds differs
from Core.

### Minimum production-safe mechanism

**Do not add polling as a transport.** PRD §12.4 prefers webhooks and allows
polling only as a fallback where Core has no API. What follows is a periodic
*sweep*, which is a different thing.

1. **Deferred replay — the cheapest fix, and the one to do first.**
   Persist `not_applicable` payloads instead of discarding them, keyed by the
   dependency they are waiting for. Re-attempt when that dependency arrives.
   This closes the out-of-order hole entirely and needs no Core cooperation.

2. **Periodic reconciliation sweep.** Core exposes a digest per entity type —
   `(external_id, updated_at)`, paged. Chat compares against its mirror:
   - *missing in Chat* → fetch and ingest;
   - *stale in Chat* (`core_synced_at` older than Core's `updated_at`) → refetch;
   - *present in Chat, absent from Core* → **flag, never delete** (BR-5).
   Hourly incremental by watermark, daily full. **Requires a Core endpoint that
   does not exist** — this is the one part that needs a contract decision.

3. **Repair is replay.** Every ingestion function is already idempotent and
   ordered, so repair is ingesting the current state through the same path. No
   separate repair code, and no way for repair to behave differently from normal
   delivery.

4. **Audit.** Each run writes `chat.sync_state` (status, watermark) and an
   `event_log` entry with the counts. Any non-zero discrepancy also writes
   `chat.audit_log`, because a silent divergence between two systems of record is
   exactly what §11.4 asks to be alerted on. Surface the counts in
   `chat.sync_health`, which the admin panel already reads.

Ordering note: (1) is implementable now and closes a real data-loss path. (2)
should not be built until Core's digest contract exists.

---

## 4. Coverage admins in Student Groups — OPEN, not resolved

PRD §15.2 open question 4: are coverage admins **permanent silent members** of
every Student Group, or do they **join only during their coverage window**?

Both are representable — `chat.conversation_member.is_silent` exists and
membership rows carry `joined_at`/`left_at`. **Neither is implemented.**
`chat.sync_student_group_membership()` reconciles the parent, the active teachers
and the family's primary owner, and deliberately does not add coverage admins at
all.

This is recorded as OPEN and is not resolved here. Student Group membership is
functionally incomplete until it is answered.

---

## 5. Core-side HMAC signing — OPEN, not resolved

| Side | Status |
|---|---|
| **Chat-side verification** | **IMPLEMENTED and VERIFIED.** HMAC-SHA256 over `{timestamp}.{raw body}`, constant-time comparison, ±300s window, keyed secrets for rotation, tenant bound to the key. Six runtime checks cover unsigned, mis-signed, unknown-key, stale and tampered deliveries. |
| **Core-side signing capability** | **OPEN — product / deployment decision.** PRD §15.2 Q1 (Core's stack and authentication scheme) is unanswered. Whether Core can compute an HMAC over a raw body is unknown. |

mTLS is recorded in the contract as the documented fallback **if and only if** it
is explicitly decided. It has **not** been decided, and HMAC has **not** been
replaced.

---

## 6. What this work does *not* fix

The HMAC in the Core boundary authenticates **Jawwid Core → Jawwid Chat events**.
It is service-to-service authentication for one webhook endpoint.

It does **not** address, and must not be read as addressing:

- parent login, teacher login or admin login;
- WebSocket / realtime user authentication;
- **RT-001** — `realtime.gateway.ts` reads `client.handshake.auth?.actorId` and
  trusts it as an authenticated principal. That is a self-asserted identity and
  remains **OPEN**;
- actor spoofing generally.

Those are user authentication, a separate concern, unaddressed by this cycle.
