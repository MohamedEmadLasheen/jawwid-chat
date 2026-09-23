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

**This document is policy, not delivery.** At the time of approval the
prohibition is still implemented as v0.1 described it, and the permitted case is
**not** built. PD-6 stages the work and requires that no BR-1 structural
backstop and no BR-1 security test be weakened before its stage. Until then,
code and documentation disagree **in the direction of the stricter rule**, which
is the safe direction.
