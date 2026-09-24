> **STATUS: REFERENCE** (Phase 0, 2026-09-07). Sound webhook contract from the archived branch `archive/phase0/feat/core-integration-boundary`; not implemented on the integration line. Re-implemented against the canonical schema in a later phase per `JAWUID-CHAT-ARCHITECTURE.md` §2.9.
> Canonical index: `docs/README.md`.

# Jawwid Core ⇄ Jawwid Chat — integration contract

**Status: authoritative.** This supersedes the proposed payload shapes in
`backend-contract.md` §9 and any earlier description of the boundary.

Owner: AI #1. Source of truth for the product: **Jawwid Chat PRD v0.1**
(`docs/product/jawwid-chat-prd-v0.1.md`), §12.4 in particular.

```
Jawwid Core  ──API / webhook──▶  Jawwid Chat integration boundary  ──▶  Chat-owned DB
```

Jawwid Chat never reads Jawwid Core's database. There is no shared schema, no
foreign key across the boundary, and no SQL path between the two products. A
test in `db/tests/invariants.sql` fails if one appears.

---

## 1. Authentication

Every delivery is a `POST` to `/integration/core/events` over TLS, signed with
HMAC-SHA256.

| Header | Value |
|---|---|
| `X-Jawwid-Key-Id` | which shared secret was used, e.g. `core-2026-09` |
| `X-Jawwid-Timestamp` | Unix seconds at send time |
| `X-Jawwid-Signature` | `sha256=` + hex HMAC-SHA256 of `{timestamp}.{raw body}` |

- The signed value covers **the raw bytes as sent**. Re-serialising the JSON
  changes key order and invalidates the signature. Chat reads `rawBody`.
- The timestamp is *inside* the signature, so a captured request cannot be
  replayed with a fresh one. Deliveries outside ±`CORE_WEBHOOK_TOLERANCE_SECONDS`
  (default 300) are refused.
- Comparison is constant-time.
- `CORE_WEBHOOK_SECRETS` holds `keyid:secret[,keyid2:secret2]`. Two entries is
  how a rotation lands: Core switches key id, then the old secret is dropped.
- A deployment with no secrets configured returns `503` and accepts nothing.
  An unconfigured boundary must never be an open one.

> **PRODUCT DECISION REQUIRED — can Jawwid Core sign?**
> PRD §15.2 open question 1 (Core's stack and authentication scheme) is still
> open. The scheme above is *Chat's requirement*, which is Chat's to set. Whether
> Core can produce an HMAC over a raw body is unknown. If it cannot, the
> documented fallback is mutual TLS with a pinned client certificate, which
> changes deployment but not a line of the payload contract below.

---

## 2. Envelope

```jsonc
{
  "event_id":    "9f2c…",                  // idempotency key, stable across retries
  "event_type":  "teacher.upserted",
  "occurred_at": "2026-09-06T10:00:00Z",   // SOURCE time — this is what orders events
  "data":        { }                        // entity payload, §4
}
```

`event_id` must be **stable across retries of the same change** and **distinct
between different changes**. It is the entire idempotency guarantee at the
delivery layer.

---

## 3. Event types

| Event | Applies to |
|---|---|
| `parent.upserted` | family identity and language |
| `student.upserted` / `student.deactivated` | learner; deactivation archives the Student Group |
| `teacher.upserted` / `teacher.deactivated` | teacher; deactivation removes them from every group |
| `enrollment.upserted` / `enrollment.ended` | student ⇄ teacher; drives Student Group membership |
| `class_session.upserted` / `class_session.cancelled` | schedule; drives class reminders and the attention rule |
| `attendance.upserted` | the outcome of one class session for its learner |
| `subscription.upserted` | plan, status, renewal date |
| `payment.upserted` | due dates and payment outcomes |

Anything else is refused with `400`. Adding a type is one `ALTER` on a CHECK
plus one `case` arm — see ADR-003.

---

## 4. Payload schemas

Flat by design. **This boundary must not grow knowledge of Core's internal
schema**; a change inside Core is a change in Core's transformer, not here.

```jsonc
// parent.upserted
{ "core_parent_id": uuid, "display_name": string, "language": "ar" | "en" }

// student.upserted            // student.deactivated: { "core_child_id": uuid }
{ "core_child_id": uuid, "core_parent_id": uuid, "name": string,
  "level": string?, "schedule_ref": string?, "next_class_at": timestamptz?,
  "last_attended_at": timestamptz?, "consecutive_absences": int? }

// teacher.upserted            // teacher.deactivated: { "core_teacher_id": uuid }
{ "core_teacher_id": uuid, "display_name": string }

// enrollment.upserted         // enrollment.ended: { "core_enrollment_id": uuid }
{ "core_enrollment_id": uuid, "core_child_id": uuid, "core_teacher_id": uuid,
  "subject": string?, "status": "active" | "ended" | "cancelled",
  "started_at": timestamptz?, "ended_at": timestamptz? }

// class_session.upserted      // class_session.cancelled: { "core_class_session_id": uuid }
{ "core_class_session_id": uuid, "core_child_id": uuid, "core_teacher_id": uuid?,
  "starts_at": timestamptz, "ends_at": timestamptz?, "join_url": string?,
  "status": "scheduled" | "done" | "cancelled" | "rescheduled" }

// attendance.upserted
{ "core_class_session_id": uuid,
  "outcome": "class_attended" | "class_missed",   // Chat's existing vocabulary
  "recorded_at": timestamptz? }

// subscription.upserted
{ "core_subscription_id": uuid, "core_parent_id": uuid, "plan": string?,
  "status": string,                    // Core's own vocabulary; translated on the way in
  "ends_at": timestamptz?, "renewal_due_at": timestamptz?,
  "last_payment_status": "succeeded" | "failed" | "refunded" | null,
  "last_payment_at": timestamptz? }

// payment.upserted
{ "core_payment_id": uuid, "core_parent_id": uuid, "core_subscription_id": uuid?,
  "amount": decimal?, "currency": string?,
  "status": "due" | "paid" | "failed" | "refunded" | "unknown",
  "due_at": timestamptz?, "paid_at": timestamptz? }
```

**No payload may carry a phone number, an email address, a card or an account
number.** BR-2 is structural here: there is no column in the mirror that could
store one, and a test asserts it.

Core's `subscription.status` is **translated, never adopted**, through
`chat.config['integration.subscription_status_map']`. An unmapped value becomes
`unknown` and is reported by `chat.unmapped_core_subscription_status` — a Core
release that adds a status is a config edit, not an outage (ADR-014).

> **PRODUCT DECISION REQUIRED — class join links.**
> PRD §15.2 open question 8 (link format, and whether links must be masked) is
> open. `join_url` is stored opaquely and is not rendered anywhere yet.

---

## 5. Ordering

Webhook delivery is **not ordered**, and Chat does not assume it is.

Every mirrored row records `core_synced_at` — the `occurred_at` of the event
that last wrote it. An event whose `occurred_at` is **older** than the stored
value is acknowledged and dropped. Equal timestamps apply, so a corrected
redelivery of the same event still lands.

This is last-writer-wins by **source time**, in the database, so two boundary
processes racing each other reach the same result.

> **PRODUCT DECISION REQUIRED — per-aggregate sequence.**
> If Core can emit a monotonic sequence per entity, it is strictly better than a
> timestamp (it survives clock skew and same-millisecond writes). The envelope
> has room for it; whether Core can produce one is unknown.

---

## 6. Retry, duplicates and failure

Status codes **are** the retry contract:

| Status | Meaning | Core should |
|---|---|---|
| `200` `{"status":"applied"}` | written | stop |
| `200` `{"status":"duplicate"}` | this `event_id` was already applied | stop |
| `200` `{"status":"not_applicable"}` | accepted, nothing to write yet (see below) | stop |
| `400` | malformed envelope or unknown event type | stop — retrying cannot help |
| `401` | signature failed; body carries the reason | stop — fix credentials or clock |
| `503` | boundary not configured | retry with backoff |
| `500` | Chat failed to apply it | **retry with backoff** |

**Duplicate handling is two-layered**, and both layers were verified at runtime:

1. *Delivery* — `chat.record_core_event` inserts on a unique
   `(source, external_event_id)` and returns true only the first time.
2. *Entity* — every ingestion function upserts on the Core id, so a **different**
   event carrying the same entity updates in place rather than duplicating.

A delivery that was recorded but never applied (a crash mid-apply) is **not**
treated as a duplicate: it is re-applied on the next attempt. Only an event with
`processed_at` set and no error is a duplicate.

`not_applicable` is a normal outcome, not a failure: a learner whose family has
no owner yet, an enrolment naming a teacher Chat has not seen, a deactivation for
an entity never mirrored. Core should stop retrying; the record arrives with its
parent, or on the next backfill.

On apply failure the event stays recorded and unprocessed, `chat.sync_health`
counts it, and `chat.event_log` carries a `core_event_failed` row.

---

## 7. Audit and event logging

| What | Where |
|---|---|
| Rejected delivery (bad signature, unknown key, stale, malformed) | `chat.audit_log`, action `core_webhook_rejected`, with the reason and the *claimed* key id. Actor is null — an unauthenticated caller has no identity. |
| Accepted / duplicate / failed | `chat.event_log`, types `core_event_applied`, `core_event_duplicate`, `core_event_failed` |
| Raw delivery | `chat.core_event`, append-only, with `processed_at` and `error` |
| Health | `chat.sync_health` — last status, unprocessed events, parents awaiting an owner, unmapped statuses |

PRD §11.1 requires an audit trail for denied actions; this is that trail for the
boundary. An audit write failure is logged loudly but never converts a `401` into
a `500`.

---

## 8. Authority — every entity

**No entity appears twice.** Where a row has both Core-owned and Chat-owned
columns, the split is stated.

| Entity | Authority |
|---|---|
| Parent / family identity, name, language | **AUTHORITATIVE IN CORE**, mirrored in `chat.family` |
| Family **owner**, tier, state, manual flag | **AUTHORITATIVE IN CHAT** — BR-4; changed only by `chat.transfer_ownership()`, manager + reason + audit. A sync **never** writes these. |
| Student / learner | **AUTHORITATIVE IN CORE**, mirrored in `chat.learner` |
| Teacher | **AUTHORITATIVE IN CORE**, mirrored in `chat.teacher` |
| Enrollment (student ⇄ teacher) | **AUTHORITATIVE IN CORE**, mirrored in `chat.enrollment` |
| Class session / schedule | **AUTHORITATIVE IN CORE**, mirrored in `chat.class_session` |
| Attendance outcome | **AUTHORITATIVE IN CORE**, mirrored in `chat.class_attendance`. Nothing in Chat records attendance, and no client may write the table |
| Subscription | **AUTHORITATIVE IN CORE**, mirrored in `chat.subscription` (status vocabulary is Chat's, translated) |
| Payment / due date | **AUTHORITATIVE IN CORE**, mirrored in `chat.payment` |
| Conversation, membership, message, approval | **AUTHORITATIVE IN CHAT** |
| Student Group **membership** | **DERIVED IN CHAT** from Core enrollments; Chat owns the rows, Core owns the relationship they express |
| Ownership / coverage rules, shifts, absences | **AUTHORITATIVE IN CHAT** |
| Task, follow-up, call, notification, reminder | **AUTHORITATIVE IN CHAT** |
| Account / session / device | **AUTHORITATIVE IN CHAT** (`chat.account`) |
| Audit log, event log, config | **AUTHORITATIVE IN CHAT** |

---

## 9. Ownership synchronization

Ownership is **Chat's**, and the boundary cannot set it.

`parent.upserted` for a parent Chat has not seen does **not** create a family. It
lands in `chat.core_parent_inbox` and the boundary answers `not_applicable`. A
manager then calls:

```sql
chat.assign_family_owner(core_parent_id, owner_id, reason, actor_id)
```

which creates the family, its thread and the Primary Guardian contact, and writes
an audit row. PRD §5.1 keeps ownership a manager decision, and §1 rules out
automatic distribution — a boundary that guessed an owner would be exactly that.

Once a family exists, `parent.upserted` updates only the **Core-owned** fields
(display name, language). `owner_id` is untouched, and a later delivery naming a
different owner cannot move it. *Verified.*

> **PRODUCT DECISION REQUIRED — does Core know the owner?**
> PRD §5.1 allows ownership to be "synced from Jawwid Core **or** set by the
> manager". Whether Core models supervisor→family ownership at all is open
> (§15.2 Q1). Until it is answered, only the manager path exists. If Core does
> carry it, the seeding path is: add `owner_external_id` to the parent payload,
> map it through a `core_user_id` on `chat.staff` — **which does not exist yet.**

---

## 10. Learner / teacher membership synchronization

`enrollment.upserted` and `enrollment.ended` drive Student Group membership, per
PRD §7.3 ("membership follows the data").

`chat.sync_student_group_membership(learner_id)` reconciles the group to:
**the parent** (the family's primary contact) + **every active teacher** +
**the family's primary owner**. It creates the group if absent, marks departed
members with `left_at` rather than deleting them (BR-5), and posts a system
message on every teacher add or removal. *Verified: a teacher change swaps
membership and posts both messages.*

> **PRODUCT DECISION REQUIRED — coverage admins in groups.**
> PRD §15.2 open question 4: are coverage admins permanent silent members of
> every Student Group, or do they join only during their coverage window? Both
> are representable (`chat.conversation_member.is_silent` exists). **Neither is
> implemented**, and the reconciler does not add coverage admins at all. This is
> a functional gap in Student Groups until it is answered.

---

## 10a. Class sessions and attendance

`class_session.upserted` mirrors one occurrence into `chat.class_session`,
keyed on `core_class_session_id` — the stable identity everything else points
at. `chat.learner.next_class_at` is **not** that identity and is not written by
this path: it is a mutable scalar that cannot name a class which already
happened, and it stays exactly as it is for the consumers that still read it.
`class_session.cancelled` sets `status = 'cancelled'` and retains the row (§12).

`attendance.upserted` attaches an outcome to an occurrence. Two rules, both
enforced in the ingest function rather than by convention:

- **The vocabulary is `class_attended` / `class_missed`**, which is what
  `chat.event_log`'s type constraint has carried since 20260905090500. A value
  outside those two is **refused**, not coerced: guessing which of the two Core
  meant would write a fact nobody asserted. The delivery stays unprocessed with
  its reason, which `chat.sync_health` counts.
- **No orphans.** Attendance for a session Chat has not mirrored returns
  `not_applicable` and writes nothing. The session arrives first, or on the
  next backfill.

Applying either event enqueues a Chat-side domain event in the **same
transaction** as the projection write, so a class Chat knows about always has
the event that would tell a parent about it. `class_missed` produces one
parent notification through the existing notification engine; `class_attended`
produces none, deliberately — announcing the normal case is how a parent learns
to dismiss everything.

> **PRODUCT DECISION REQUIRED — per-learner attendance.**
> `attendance.upserted` carries no `core_child_id`: the outcome is attached to
> the session's learner. That is correct for one-to-one classes, which is what
> `chat.class_session` models today. A group class would need the child named
> explicitly, and the table's unique key already allows it.

---

## 11. Subscription and payment synchronization

`subscription.upserted` mirrors plan, status, `ends_at`, `renewal_due_at` and
last payment outcome; `payment.upserted` mirrors amounts and due dates so the
reminder engine (PRD §8.1: D−7, D−3, D0, D+3, D+7) has something to schedule
from. Status translation is §4. *Verified: two deliveries of one payment produce
one row and the newer status wins.*

---

## 12. Inactive and deleted entity semantics

**Nothing is ever deleted.** BR-5, and PRD §11.1 ("no automatic message deletion
in this phase").

| Core says | Chat does |
|---|---|
| `teacher.deactivated` | `is_active = false`, removed from every Student Group with a system message; record retained |
| `enrollment.ended` | `status = 'ended'`, membership reconciled |
| `student.deactivated` | Student Group **archived**, never deleted (§7.3) |
| `class_session.cancelled` | `status = 'cancelled'`, row retained |
| A hard delete in Core | **Not supported.** Core must send a deactivation. Chat has no delete path and will not add one. |

A deactivation that matches nothing returns `not_applicable`. Core may be
describing an entity Chat never mirrored, which is not an error.

---

## 13. Known gaps

These are real and are **not** implemented. None is guessed at.

1. **`organization_id` is absent from every table.** PRD §2.3 requires it "on
   every root entity from day one so a future SaaS conversion is a migration, not
   a rewrite". The schema does not carry it. Adding it later is a wide migration
   across every table — exactly what §2.3 was written to avoid. **Needs a
   decision now, while the table count is still small.**
2. **User and role sync is not built.** PRD §12.4 lists "users and roles" as
   synced entities. `chat.staff` has no `core_user_id`, so staff are provisioned
   only inside Chat. No event type exists for them.
3. **Backfill / reconciliation is not built.** The boundary is event-driven only.
   PRD §12.4's polling fallback, and a periodic full reconciliation to catch
   missed events, do not exist.
4. **Coverage admins in Student Groups** — §10 above.
5. **`chat.teacher.account_id` is never populated**, so a teacher cannot sign in.
   The Teacher app needs a provisioning path that does not exist.
