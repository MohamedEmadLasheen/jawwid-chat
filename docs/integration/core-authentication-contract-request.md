# Jawwid Core — Authentication & Teacher Identity Contract Request

From: Jawwid Chat engineering · 2026-09-06 · Base commit `d236ce3`
To: whoever owns Jawwid Core (product + engineering)
Status: **AWAITING CORE RESPONSE — Chat implementation is blocked on D-1 and D-3**

Companion documents:
[`authentication-decision-gate.md`](authentication-decision-gate.md) (the evidence
audit that produced this request) ·
[`authentication-implementation-boundary.md`](authentication-implementation-boundary.md)

---

## Why you are receiving this

Jawwid Chat cannot implement sign-in until Jawwid Core tells us what it can do.

PRD v0.1 §7.1 says credentials are *"provisioned from Jawwid Core"*, and §6
assigns **identity to Core and sessions to Chat**. PRD §15.2 open question 1
lists Jawwid Core's *"authentication scheme"* as unknown, and it is still
unknown. We audited this repository for evidence of a Core authentication
capability and found none — no Core HTTP client exists, no auth endpoint is
referenced, and the Core ingestion payloads carry no credential, no subject and
no email.

We are not asking whether Core "supports auth". **We are asking for an
executable contract.** A prose answer we cannot write a client against does not
unblock us, and we will not fill a gap with an assumption — the last time work
existed on a branch instead of in a contract, an entire database's security
controls shipped nowhere (finding RT-023).

### The rule this document follows

Every claim about Core below is marked **`UNKNOWN — CORE DECISION REQUIRED`**
unless backed by an actual contract, Core documentation, or executable evidence.
Nothing here says "probably", "likely", "Core should" or "we can assume". Where
we state something about *Chat*, the file and line are cited.

---

## A · Identity capability

**Question A1. Does Jawwid Core expose a user authentication capability?**
Choose exactly one.

| | Capability | Chat's current evidence |
|---|---|---|
| 1 | Core verifies username/password | `UNKNOWN — CORE DECISION REQUIRED` |
| 2 | Core issues identity tokens | `UNKNOWN — CORE DECISION REQUIRED` |
| 3 | Core exposes an identity/user endpoint | `UNKNOWN — CORE DECISION REQUIRED` |
| 4 | Core exposes an authentication/session endpoint | `UNKNOWN — CORE DECISION REQUIRED` |
| 5 | Core integrates an external identity provider | `UNKNOWN — CORE DECISION REQUIRED` |
| 6 | Other — describe the exact contract | — |
| 7 | **None currently** | This is what the repository evidence is consistent with, and it is an acceptable answer |

> Answer 7 is a legitimate outcome. It is far more useful to us than an
> optimistic 1–5 we cannot build against. If the answer is 7, say so plainly and
> we will escalate the consequence (see §J, D-1).

**Question A2.** For whichever of 1–6 you choose, supply every row below. An
incomplete row is an unanswered question.

| # | Required | Notes for the responder |
|---|---|---|
| A2.1 | Endpoint / interface | Full URL path and method, or the interface name |
| A2.2 | Request schema | Field names, types, required/optional |
| A2.3 | Response schema | Both success and every failure shape |
| A2.4 | Authentication method **of the endpoint itself** | How does Chat authenticate to Core to call it? |
| A2.5 | Token format | JWT / opaque / other |
| A2.6 | Token claims | Exact claim names and types |
| A2.7 | Subject format | See §B — this becomes `chat.account.subject` |
| A2.8 | Expiration | Access and refresh lifetimes |
| A2.9 | Refresh semantics | Rotating or fixed? Reuse detection? |
| A2.10 | Revocation semantics | How is a token invalidated before expiry? |
| A2.11 | Disabled-user behaviour | What does Core return for a disabled account? |
| A2.12 | Error semantics | See A3 |
| A2.13 | Rate limiting / lockout | Thresholds, lockout duration, and who enforces |
| A2.14 | Multi-device behaviour | Does a second sign-in invalidate the first? |

**Question A3 — error distinguishability.** Our mobile client requires three
*distinguishable* sign-in failures: **bad credentials**, **account disabled**,
**session revoked**. The app behaves differently for each, and a single generic
401 collapses that behaviour.

> *Chat evidence:* `docs/mobile/backend-dependencies.md` §C1 — *"a documented,
> distinguishable failure for account disabled vs bad credentials vs session
> revoked — the app has to react differently to each"*.

Can Core distinguish them? `UNKNOWN — CORE DECISION REQUIRED`

---

## B · Parent identity

We need this chain to be sound and permanent:

```
Core parent ID → stable identity subject → chat.account.subject
```

**What Chat already has.** `chat.account.subject` is `text not null unique`
(`20260905090050_chat_identity.sql:14`). Its header states it is *"the opaque
identifier the identity provider puts in the token's `sub` claim"*, and that
*"credentials and contact details live there, not here"*. `chat.contact` carries
`core_parent_id` and an `account_id` FK, and `chat.link_contact_account(contact_id, subject)`
exists (`20260905090900:314`) — **with no caller in any application code**, because
nothing produces a subject yet.

| # | Question | Chat's evidence |
|---|---|---|
| B1 | What is the canonical parent identifier? | Chat stores `core_parent_id`; whether it is *the* identity is `UNKNOWN — CORE DECISION REQUIRED` |
| B2 | Is it **immutable** for the life of the person? | `UNKNOWN — CORE DECISION REQUIRED` |
| B3 | Is it **unique** within its type? | `UNKNOWN — CORE DECISION REQUIRED` |
| B4 | Is it **globally unique** across all Core principal types (parent, staff, teacher)? | `UNKNOWN — CORE DECISION REQUIRED` — **and it matters:** `chat.account.subject` is unique across every actor kind, so a parent and a staff member must never be able to collide on it |
| B5 | Is it **safe to persist** in Chat — i.e. not a credential, phone number or email? | `UNKNOWN — CORE DECISION REQUIRED`. **Constraint from our side:** the subject must not be a contact channel. `chat.account`'s comment forbids it and a CI test enforces it (`no-contact-channel-columns.spec.ts`) |
| B6 | If the identifier ever changes, how is Chat told? | `UNKNOWN — CORE DECISION REQUIRED`. A changed subject orphans a Chat account and every session on it |

---

## C · Staff identity

PRD §3 names four staff roles: `admin`, `coverage_admin`, `manager`,
`super_admin`.

| # | Question | Chat's evidence |
|---|---|---|
| C1 | **Does Core own staff identity at all**, or does another authoritative system (an HR system, a directory, Chat itself)? | `UNKNOWN — CORE DECISION REQUIRED`. We are explicitly **not** assuming Core owns it. PRD §12.4's synced entities list says "users and roles", but the ingestion contract we have implements **parents, learners and subscriptions only** — there is no staff ingest function |
| C2 | If Core owns it, what is the canonical staff identifier, and does B2–B6 hold for it? | `UNKNOWN — CORE DECISION REQUIRED` |
| C3 | **Who is authoritative for a staff member's role?** Core, or Chat's admin panel? | `UNKNOWN — CORE DECISION REQUIRED`. PRD §7.1 says accounts are created and disabled *"from the admin panel **or** by sync"* — that "or" is unresolved, and it decides whether a role change is a Core event or a Chat write |
| C4 | Does Core represent `super_admin`? | `UNKNOWN — CORE DECISION REQUIRED`. *Chat-side gap regardless:* `chat.staff.role` permits `admin, coverage, manager, finance, technical, academic` (`20260905090200:19`) — **`super_admin` is absent, and `coverage_admin` is spelled `coverage`.** This is Chat's to fix, recorded here so the vocabularies are reconciled once rather than twice |

---

## D · Teacher identity — **CRITICAL**

This is the blocker with the largest scope consequence: it decides whether the
Teacher mobile app is in MVP.

### What Chat can prove today

- `chat.learner.teacher_id` is a bare `uuid` with **no foreign key and no table behind it** (`20260905090300_chat_family_domain.sql:107`).
- The Core integration migration contains **zero** teacher references. There is no `ingest_core_teacher`, and `ingest_core_learner`'s payload is `core_child_id, core_parent_id, name, level, schedule_ref, next_class_at, last_attended_at, consecutive_absences` — **no teacher field**. `chat.learner.teacher_id` is therefore never populated by any code path in this repository.
- Our own schema records why:

  > `'Carried from the brief SS3. Jawwid Core has no teacher entity today (its own`
  > `PRD lists live classes as a V1 non-goal), so this stays null until Core`
  > `gains one.'` — `20260905090300_chat_family_domain.sql:117`

- Consequently `IdentityService` resolves a "teacher" by scanning `chat.learner` for a matching `teacher_id` and returns a hardcoded display name. In a real environment that branch can never match.
- `docs/release/integration-matrix.md` I-3 already records: **FAIL — "teacher cannot authenticate at all"**.

### Question D1 · Does Core have a first-class Teacher entity?

**If YES**, supply all of:

| # | Required |
|---|---|
| D1.1 | Teacher ID — format and semantics |
| D1.2 | Is the ID immutable? |
| D1.3 | Is it globally unique across all Core principal types? (see B4) |
| D1.4 | Teacher username — see §E |
| D1.5 | Can a teacher authenticate? (the answer to §A may differ per principal type) |
| D1.6 | Account lifecycle: create, activate, disable, delete |
| D1.7 | Disabled/deleted semantics — is a deleted teacher's history retained? |
| D1.8 | Teacher → learner relationship: how is assignment expressed, and how is a change communicated? |
| D1.9 | Teacher → class relationship, if classes exist |
| D1.10 | Webhook/event contract for all of the above |
| D1.11 | Provisioning contract — how does a teacher first come to exist in Chat? |

**If NO**, we will record verbatim, and it becomes a release-scope decision:

> **Teacher authentication is blocked because Core currently has no
> authoritative Teacher identity.**

We will **not** propose or build a Chat-side synthetic teacher identity. A
teacher invented in Chat has no authority behind it, cannot be disabled from
Core, and would make BR-1 — the product's constitutional rule, which turns on
telling a teacher from a parent — depend on a value Chat made up.

**Current answer on the evidence: `UNKNOWN — CORE DECISION REQUIRED`, with the
repository evidence pointing to NO.**

---

## E · Username

**Chat's position, with evidence.** `username` is the canonical login
identifier. Email is not canonical anywhere in Chat, and we are asking Core not
to introduce it:

- No `email` column exists in the `chat` schema (verified: `information_schema` returns zero rows).
- `chat.account`'s header explicitly forbids one: *"Adding an email column to this table would be the ordinary way to break phone/contact privacy… must not be added without a privacy review."*
- `20260905093000` header: *"no table here has a phone, email or address column."*
- Core's ingestion payloads carry no email.
- Our Flutter client already ships `usernameLabel` / `اسم المستخدم`.

*(Chat-side inconsistency we will fix on our side: Admin Web's API call names the
parameter `email` — `apps/admin-web/src/core/api/endpoints.ts:32` — while its own
input field is already `autoComplete="username"`.)*

**If username is canonical, document:**

| # | Question | Status |
|---|---|---|
| E1 | Normalization (trim, Unicode form, lowercasing) | `UNKNOWN — CORE DECISION REQUIRED` |
| E2 | Case sensitivity on login | `UNKNOWN — CORE DECISION REQUIRED` |
| E3 | Uniqueness scope — global, or per role/organization? | `UNKNOWN — CORE DECISION REQUIRED` |
| E4 | Allowed character set and length | `UNKNOWN — CORE DECISION REQUIRED` |
| E5 | **Can a username change?** | `UNKNOWN — CORE DECISION REQUIRED` |
| E6 | Is the username exposed to Chat at all? | `UNKNOWN — CORE DECISION REQUIRED` |
| E7 | **Is it a login identifier only, or also a stable identity key?** | `UNKNOWN — CORE DECISION REQUIRED` |

> **E5 and E7 together are the ones that bite.** If a username can change *and*
> is used as the identity key, every rename orphans a Chat account. Our strong
> preference — and the shape `chat.account.subject` was built for — is a username
> that is **a login identifier only**, with a separate immutable subject as the
> identity key. If Core cannot separate them, say so; it changes our model.

**If Core establishes email as canonical instead**, state it explicitly and we
will re-open the privacy review that currently forbids an email column.

---

## F · Token contract

Only if Core issues identity tokens (§A answer 2 or 5).

| # | Required | Status |
|---|---|---|
| F1 | Algorithm (e.g. RS256, ES256, HS256) | `UNKNOWN — CORE DECISION REQUIRED` |
| F2 | `iss` — exact issuer string | `UNKNOWN — CORE DECISION REQUIRED` |
| F3 | `aud` — what audience should Chat require? | `UNKNOWN — CORE DECISION REQUIRED` |
| F4 | `sub` — format, and is it the §B/§D identifier? | `UNKNOWN — CORE DECISION REQUIRED` |
| F5 | Required claims | `UNKNOWN — CORE DECISION REQUIRED` |
| F6 | Optional claims (role? locale?) | `UNKNOWN — CORE DECISION REQUIRED` |
| F7 | Expiry | `UNKNOWN — CORE DECISION REQUIRED` |
| F8 | **Key discovery and rotation** — JWKS URL, cache TTL, rotation notice | `UNKNOWN — CORE DECISION REQUIRED` |
| F9 | Signature verification method | `UNKNOWN — CORE DECISION REQUIRED` |
| F10 | Revocation strategy — introspection, short expiry, or a revocation list | `UNKNOWN — CORE DECISION REQUIRED` |

> **Chat will not verify tokens using undocumented assumptions.** If any of
> F1–F9 is unanswered, we cannot write a verifier, and a verifier written against
> a guess is worse than no verifier: it looks like a control and is not one.

---

## G · Session ownership

**Chat's position, from PRD §6 ("Jawwid Core for identity; Chat for devices and
sessions") and §7.1:**

| Owner | Responsibility |
|---|---|
| **Core** | Authoritative identity; credential verification (subject to §A); authoritative user lifecycle |
| **Chat** | Device-bound sessions; refresh-token rotation; session revocation; device binding; logout; session expiry |

**Question G1.** Does Core's model differ from this split? If Core also issues
and manages sessions, we need to know before we build ours, because two session
authorities means two revocation paths and a user who is signed out of one and
not the other. `UNKNOWN — CORE DECISION REQUIRED`

---

## H · Disabled user propagation

PRD §7.1 requires: *"a disabled user loses all sessions **within seconds**."*

Required end-to-end behaviour:

```
Core disables the account
  → Chat observes the change            ← mechanism? latency?
  → Chat marks chat.account.is_active = false
  → existing Chat sessions become invalid
  → the API rejects the next request (401)
  → the live WebSocket is disconnected
```

| # | Question | Status |
|---|---|---|
| H1 | **Mechanism** — webhook, event stream, polling, or a token that simply expires? | `UNKNOWN — CORE DECISION REQUIRED` |
| H2 | **Latency** — what does Core guarantee between the disable action and Chat being able to observe it? | `UNKNOWN — CORE DECISION REQUIRED` |
| H3 | Is a disable event **replayable and idempotent**? Chat's `chat.core_event` dedupes on `(source, external_event_id)`; an event without a stable id cannot be deduped | `UNKNOWN — CORE DECISION REQUIRED` |
| H4 | Is there a **poll/reconcile** endpoint for the case where an event is lost? A push-only design with no reconciliation means one dropped event leaves a disabled user signed in indefinitely | `UNKNOWN — CORE DECISION REQUIRED` |

---

## I · Provisioning and synchronization

**What exists today.** Chat has an event-ingestion boundary — `chat.core_event`
with `unique (source, external_event_id)` — plus `record_core_event`,
`ingest_core_parent`, `ingest_core_learner`, `ingest_core_subscription`,
`assign_family_owner` and `record_sync_result` (`20260905090900`). It is a
webhook/event shape, and it currently covers **parents, learners and
subscriptions only**.

For each entity and each lifecycle event, name the mechanism (Core API / Core
webhook / event stream / polling / other) and the payload. **Where an event does
not exist, write "none" — do not let us infer one.**

| Entity | create | update | disable | delete | role change | identity change |
|---|---|---|---|---|---|---|
| **parent** | `ingest_core_parent` exists in Chat; Core's emitter is `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | n/a | `UNKNOWN` |
| **teacher** | **no Chat ingest function exists** | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| **staff** | **no Chat ingest function exists** | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` (see C3) | `UNKNOWN` |

All cells marked `UNKNOWN` are `UNKNOWN — CORE DECISION REQUIRED`.

**Question I1.** Does Core emit events at all, or must Chat poll? PRD §12.4
leaves both open: *"**Preferred:** Jawwid Core exposes an API and change
webhooks. **If not**, the integration service polls or consumes a read replica."*
Chat's boundary is built for events; polling would need a different contract, and
we would rather know now.

**Question I2.** Is there a bulk/initial-load contract for first provisioning, or
does Chat learn about a user only when they change?

---

## J · Required decisions

| Decision | Required from Core | Blocks |
|---|---|---|
| **D-1** Authentication capability | Yes | User login |
| **D-2** Token issuer | Yes | JWT verification |
| **D-3** Teacher entity | Yes | Teacher App |
| **D-4** Teacher stable ID | Yes | Teacher identity |
| **D-5** Username contract | Yes | Login |
| **D-6** Disabled-user propagation | Yes | Session revocation |
| **D-7** Staff identity source | Yes | Staff authentication |
| **D-8** Provisioning mechanism | Yes | Account synchronization |

**D-1 and D-3 are the two that decide the release.** D-1 blocks every sign-in on
every platform. D-3 alone decides whether the Teacher mobile app ships in MVP.

---

## How to respond

Answering §A2 and §D1 with concrete schemas unblocks Chat immediately. A response
of "none currently" to §A1 is a complete and useful answer — it moves the
decision to Jawwid product, where it belongs, instead of leaving it to whoever
writes the code first.

Until this document is answered, Chat will not implement sign-in, will not create
a credential store, and will not invent a teacher identity.
