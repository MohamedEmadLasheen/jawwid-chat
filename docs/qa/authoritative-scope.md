> **STATUS: REFERENCE** (Phase 0, 2026-09-07). Its verdict (PRD supersedes the brief) is adopted and extended by `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md`; corrections C-1..C-4 are resolved in `docs/architecture/IDENTITY-MODEL.md` and the OD-01 migration.
> Canonical index: `docs/README.md`.

# Jawwid Chat — Authoritative Scope (READ THIS FIRST)

Date: 2026-09-05 · Owner: AI #5 · Status: **GOVERNING**
Audience: AI #1, AI #2, AI #3, AI #4

> ## ⚠️ `docs/JAWWID_CHAT_BRIEF.pdf` IS SUPERSEDED. STOP BUILDING FROM IT.
>
> The authoritative source of truth is the **Jawwid Chat PRD v0.1**, approved by
> the product owner. The PDF brief in this repository describes a *CS-only
> console* and is an older, different document. Its self-description — *"this
> brief is the contract for what to build"* — is no longer true.
>
> Confirmed by the product owner on 2026-09-05, in response to the scope
> conflict escalated by AI #3, AI #4 and AI #5.

## 1. Why this file exists

All three discovery reports concluded the PDF brief was authoritative. That
conclusion was **wrong**, and code is already being written against it:

| Artifact | Built from superseded brief |
|---|---|
| `supabase/migrations/*.sql` (4 files) | yes — headers cite "brief §…" |
| `apps/admin-web/src/shared/types/domain.ts` | yes |
| `docs/admin/*`, `docs/mobile/*`, `docs/qa/*` | yes |

Not all of it is wrong — see §4. But three structural decisions are, and one of
them is about to be baked in.

## 2. Jawwid Chat is an independent product

Jawwid Chat is **not** Second School. The `~/Documents/second-school*` and
`ss-*` checkouts are an unrelated product. Their architecture, database,
authentication, UI, business rules and mobile implementation are **not
constraints** on Jawwid Chat and must not be copied or treated as precedent.

## 3. Authoritative MVP scope

Parent mobile app · Teacher mobile app · Admin Web · 1:1 Parent↔Admin ·
Teacher↔Admin · **Student Groups** · **message approval workflow** ·
server-side communication authorization · **push notifications** · automated
reminders · **in-app voice calling** · **group voice calling in Student
Groups** · family accounts · Admin Inbox · Permanent Primary Ownership · Shift
Coverage · Workload Monitoring · rule-based Attention states · Tasks &
Follow-ups · Manager Dashboard · Audit logging · Jawwid Core integration.

### The critical communication rule (BR-1)

**Teacher ↔ Parent direct 1:1 communication is FORBIDDEN** — messaging and
calling alike. Teacher↔Parent communication happens **only** through the
official Student Group, with the required admin presence/authorization.

**This must be enforced server-side.** A UI restriction is not an
implementation of this rule; it is a cosmetic. See `release-gate.md` G-01.

### Operating model

Permanent Customer Ownership + Shift Coverage + Workload Monitoring.
**Not** a shared queue.

- **Primary Owner ≠ Current Handler.**
- Coverage does **not** change Primary Ownership.
- Handoff does **not** automatically change Primary Ownership.
- Workload does **not** automatically reassign families.

### Phone privacy

Phone numbers must **never** be exposed in normal product communication or
calling flows — including call setup, call metadata, push payloads, realtime
events, search results, and error messages.

### MVP / Phase 2 boundary

| Capability | MVP | Phase 2 |
|---|---|---|
| Approvals | approve · reject · **rejection reason** — intentionally simple | escalation, expiry, coverage-aware approval |
| Calling | **voice** (1:1 and group) | video |
| Attention scoring | **rule-based** | AI scoring |
| Labels, Broadcast | — | yes |

Building Phase 2 behaviour into MVP is a scope defect and will fail review.

## 4. What survives from the superseded brief

Do **not** discard this work. These concepts are carried forward by the PRD and
the existing migrations remain a valid foundation for them:

`chat.config` (config-driven constants) · `chat.staff` · `chat.shift` ·
`chat.coverage_rule` · `chat.absence` · `chat.family` · `chat.contact`
(capability flags) · `chat.learner` · `chat.subscription` · `chat.family_note` ·
append-only `event_log` / `audit_log` · `on_duty()` coverage engine ·
computed attention & workload · permanent ownership via `transfer_ownership()` ·
Unattended list · handoff cards · tasks · manager dashboard.

The **operating model chapter of the brief is still correct.** It is the
*communication* chapter that is superseded.

## 5. Required corrections — concrete and blocking

### C-1 · Teacher is not an actor (P0, already committed)

`chat.staff.role` is constrained to
`('admin','coverage','manager','finance','technical','academic')`.
`chat.learner.teacher_id` is a bare `uuid` with no FK and no identity behind it.

The PRD requires a **Teacher mobile app**, Teacher↔Admin conversations, and
Teacher membership in Student Groups. Teachers must be first-class
authenticated actors.

*Owner: AI #1.* QA does not prescribe the design (separate `chat.teacher` table
vs. extending the role enum) — only the observable requirement: a teacher can
authenticate, is authorized independently of CS staff, and **can never be
granted a 1:1 channel to a parent.**

### C-2 · The conversation model cannot be "one thread per family" (P0, NOT YET BUILT — act now)

The superseded brief specifies `thread.family_id UNIQUE` with the invariant
*"cases never create a second thread."* **This is incompatible with the PRD.**
The PRD requires at least three concurrent conversation kinds:

1. Parent ↔ Admin (1:1)
2. Teacher ↔ Admin (1:1)
3. Student Group (parents + teacher + admin presence)

A single unique thread per family cannot represent these, and cannot carry the
per-conversation participant set that BR-1 must be enforced against.

**`thread` and `message` have not been created yet.** This correction is free
today and expensive tomorrow. *Owner: AI #1 / AI #2 — highest priority.*

Conversations require an explicit `type` and an explicit participant set;
authorization must be a function of *(actor, conversation, channel)*, evaluated
server-side, and must be the **single** code path for messaging **and** calling.

### C-3 · Missing MVP entities (P1)

No table or contract yet exists for: **Student Group** (and membership),
**approval** (state + rejection reason), **call** (session, participants,
outcome — with no phone number anywhere), **device/push token**, **reminder
schedule**. *Owners: AI #1 (identity/authz), AI #2 (communication).*

### C-4 · Documentation references (P3)

`README.md`, `docs/admin/*`, `docs/mobile/*` and migration headers cite the
superseded brief. Update citations to PRD v0.1 opportunistically — do not stop
feature work for this.

## 6. PRD v0.1 is not in the repository

The approved PRD is **not on disk**; only the superseded PDF is. Until the PRD
file is added to `docs/`, §3 of this document is the operative written record of
authoritative scope, and QA gates are written against it.

**Request to product owner:** add PRD v0.1 to `docs/` so all five agents read
one artifact instead of five second-hand summaries. This is precisely the
failure mode that produced the current divergence.

## 7. Standing instruction

No agent is blocked waiting for another. Work against declared contracts and
seams; QA continuously revalidates them as implementation lands. Where a
contract does not yet exist, state your assumption in `docs/<area>/` and
proceed — but **never** assume around BR-1, ownership, or phone privacy. Those
three are gates, not assumptions.
