# Jawwid Chat — PRD v0.2

Status: **CANONICAL** · Approved by the product owner **2026-09-23**
Amends: [`jawwid-chat-prd-v0.1.md`](jawwid-chat-prd-v0.1.md) (retained, historical for the sections below)
Decision of record: [`JAWUID-CHAT-PRODUCT-BOUNDARY.md`](JAWUID-CHAT-PRODUCT-BOUNDARY.md) §4 **PD-6**

---

## What this version is

PRD v0.1 §4 states that a core business rule may not be contradicted *"unless the
rule itself is explicitly changed and re-versioned here."* PD-6 changes **BR-1**.
This document is that re-versioning.

**v0.2 is an amendment, not a replacement.** It changes exactly two passages of
v0.1 — **§4 BR-1** and the **§9 calling matrix row for Teacher ↔ Parent**. Every
other section of v0.1 remains in force, unedited, and is still read as the PRD.
v0.1 is preserved in full rather than rewritten, so the prior rule and the date
it changed stay legible.

| Section | v0.1 | v0.2 |
|---|---|---|
| §4 BR-1 | No direct Teacher ↔ Parent communication | **Amended** — see below |
| §9 calling matrix, 1:1 Teacher ↔ Parent | Rejected server-side (BR-1) | **Amended** — see below |
| §4 BR-2 … BR-5, §§1–3, 5–8, 10–14 | in force | **unchanged** |

---

## §4 — BR-1, as amended

> **BR-1 · Teacher ↔ Parent communication follows the teaching relationship**
>
> Teachers and parents communicate through the official Student Group, where the
> assigned admin/supervisor is a member. The Student Group is the official
> shared channel and remains so.
>
> **In addition**, a teacher may hold a direct 1:1 conversation and a direct 1:1
> call with a parent contact **while, and only while, the Teacher–Parent
> relationship is authorized** as defined in PD-6: the teacher is assigned to at
> least one learner in that contact's family, the teacher is active and has not
> left, the contact is active and holds `can_message`, and the teacher, learner
> and contact belong to the same organization. One qualifying learner is enough.
>
> Direct communication between a teacher and a parent who are **not** in an
> authorized relationship is **forbidden**. A teacher cannot start, send or
> receive a private conversation or call with a parent they do not teach.
> Creating such a conversation or call is rejected server-side regardless of
> client.
>
> Authorization is evaluated **at the time of each protected action**. When the
> qualifying relationship ends — the learner is reassigned, the teacher leaves or
> is deactivated, the contact is deactivated, or `can_message` is withdrawn —
> authorization for **new** direct messages and calls ends immediately. Existing
> conversation history is retained and is never deleted because an authorization
> lapsed.
>
> This rule authorizes **communication only**. It grants no access to any
> learner's data; learner-data access is governed by its own rules.

**What changed, precisely.** v0.1 prohibited the direct channel outright. v0.2
prohibits it **for unauthorized pairs** and permits it **for authorized pairs**.
The prohibition is narrowed, not removed, and it is still *"enforced in backend
authorization and in database constraints, not by hiding buttons"* — v0.1 §4's
opening paragraph continues to govern.

---

## §9 — calling matrix, as amended

The 1:1 row for Teacher ↔ Parent is replaced. Every other row is unchanged.

| Call type | Who can start | Participants | Rule |
| --- | --- | --- | --- |
| 1:1 call | Teacher or Parent | Teacher ↔ Parent | **Allowed while the relationship is authorized (PD-6); otherwise rejected server-side** |
| Group call | Teacher, admin (parent by policy) | Members of the Student Group | The official shared Teacher ↔ Parent call channel |

Calling continues to follow the communication matrix exactly, and continues to
use the same authorization relationship as messaging — there is one definition,
not two. BR-2 is untouched: phone numbers are never exposed, and direct calls are
placed between Jawwid identities through the media layer like every other call.
PD-2 is untouched: a parent still may not initiate a Student Group call.

---

## What v0.2 does **not** change

- **The Student Group.** Still the official shared channel; membership, C-4 admin presence, PD-1 and PD-2 are untouched.
- **Admin participation.** No admin is required in a direct Teacher–Parent conversation or call. v0.2 introduces no admin-presence rule; moderation, audit and administrative capability keep their own rules.
- **BR-2 … BR-5.** Unchanged.
- **Learner-data access.** Unchanged, and explicitly not widened.
- **Enforcement standard.** Unchanged: server-side and in the database.

## Implementation status

**This document is policy. Delivery is recorded here so the two cannot drift
apart unnoticed.**

*At approval (2026-09-23)* the prohibition was still implemented as v0.1
described it and the permitted case was **not** built. PD-6 staged the work and
required that no BR-1 structural backstop and no BR-1 security test be weakened
before its stage. Code and documentation disagreed **in the direction of the
stricter rule**, which is the safe direction.

*As of 2026-09-24* the permitted case **is** built and the two now agree.
Authorization resolves the relationship server-side and the database enforces it
independently; release gate **G-01** records the proof. What is built is the
**policy**, not the end-to-end product: voice calling as a capability is
governed by **G-06**, and the remaining calling work is milestone **M4** in
v0.1 §13.1. Nothing in this section asserts that a call carries audio — see
`docs/qa/release-gate.md` for what is and is not verified.

---

## The migration record

Kept with the amendment rather than in a changelog, because a rule that was
narrowed is only safe to read alongside the reason it existed in the first
place. Nothing here is retracted by the amendment.

### The rule that was replaced — BR-1 (v0.1)

**In force 2026-09-05 → 2026-09-23.** Its wording is preserved verbatim in
[v0.1 §4](jawwid-chat-prd-v0.1.md), which is retained unedited for exactly this
purpose, together with the v0.1 communication-matrix rows and the v0.1 §9
calling row it produced.

### Why the rule existed

Jawwid Chat was built to replace WhatsApp, where the teacher–parent
relationship, its history and the phone number belonged to the employee rather
than to the academy. A private teacher↔parent channel reproduced exactly that
failure: conversations the academy could not see, could not hand over when an
employee left, and could not supervise. The rule also protected minors'
families by guaranteeing an accountable Jawwid adult was present in every
teacher–parent exchange, and it protected teachers by making every exchange
reviewable.

The rule was hardened twice after adversarial review:

* **RT-024** — the invariant spanned two tables but was enforced on one, so a
  lawful Student Group could be promoted to a forbidden 1:1 with a plain
  `UPDATE`. Closed by making `type` immutable and by deferred constraint
  triggers on both tables.
* **RT-025** — "required admin presence" was not enforced at all, so a group of
  exactly one teacher and one parent with no admin was a private channel wearing
  a group's name. Closed by the admin-presence assertion, extended to every
  group type.

Both findings remain valid findings about the old rule and are **not** retracted.
The controls they added are still in force under PD-6.

### What changed, precisely

| | v0.1 (BR-1) | v0.2 (PD-6) |
|---|---|---|
| Parent ↔ assigned teacher, 1:1 chat | DENY | **ALLOW** |
| Parent ↔ assigned teacher, 1:1 call | DENY | **ALLOW** |
| Parent ↔ unrelated teacher | DENY | DENY *(unchanged)* |
| Teacher ↔ unrelated parent | DENY | DENY *(unchanged)* |
| Student Group, required admin presence (C-4) | REQUIRED | REQUIRED *(unchanged)* |
| Parent initiating a group call (PD-2) | DENY | DENY *(unchanged)* |
| `conversation.type` / `call.type` immutable (RT-024) | YES | YES *(unchanged)* |
| Per-message admin approval on the direct channel | n/a | **NOT required** — publishes immediately, per BR-6 |

### Systems affected

* **Authorization** — `AuthorizationService.canOpenDirect`, `canSend`, `canCall`.
  A `RelationshipService` resolves the relationship; `AuthorizationService`
  receives the resolved fact and stays free of database access.
* **Database** — `chat.assert_conversation_br1`, `chat.assert_call_br1`,
  `chat.enforce_direct_conversation_rules`, `chat.enforce_call_participant_rules`
  are redirected onto a `chat.teacher_parent_authorized()` predicate. The
  deferred constraint triggers and the type-immutability triggers are retained
  unchanged.
* **Error contract** — `COMM.TEACHER_PARENT_NOT_AUTHORIZED` (403) is added.
  `COMM.BR1_TEACHER_PARENT_DIRECT` is deprecated and no longer emitted.
* **Release gate G-01** — re-versioned from "no such channel exists" to "the
  channel exists only for an authorized relationship, proven with the client
  policy disabled".
* **Clients** — the call and message affordances become conditional on the
  backend authorizing the pairing, instead of being absent unconditionally.

### Security controls that remain in force

Nothing below was relaxed by PD-6:

* Authentication and server-side authorization on every read and write.
* Required admin presence in Student Groups (C-4).
* PD-2 — a parent may not initiate a Student Group call.
* Organization/tenant isolation, including the cross-organization term inside
  the relationship predicate.
* `conversation.type` and `call.type` immutability (RT-024).
* The two-participant ceiling on direct conversations and direct calls.
* BR-2 — no phone number on any surface, the direct channel included.
* BR-5 — history belongs to Jawwid: the direct channel is retained, auditable
  and visible to authorized staff under existing permissions.
* Server-minted rooms and short-lived, room-scoped media tokens; no provider
  secret ever reaches a client.
* Audit logging of every denial and every call lifecycle event.

### Tests re-versioned rather than deleted

`br1-conformance.spec.ts` · `db/tests/br1_invariants.sql` (A1, B1, D1, D2) ·
`authz-attacks.spec.ts` · `communication-engine.spec.ts` ·
`schema-invariants.spec.ts` · `forbidden_affordances_test.dart` ·
`live_backend_test.dart` · the Flutter transport/error-mapper suites.

Each former DENY case became a matched pair — authorized → ALLOW, unauthorized →
DENY — so assertion counts rose. No protected-test assertion floor was lowered
and no line was removed from `docs/qa/protected-tests.tsv`.

`br1-admin-presence.spec.ts` (C-4) and `pd002-group-call-initiation.spec.ts`
(PD-2) were **not** changed, and must keep passing untouched.
