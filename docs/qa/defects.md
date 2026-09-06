# Jawwid Chat — Defect Log

Owner: AI #5 · Opened 2026-09-05
Severity: **P0** breach/corruption/blocked-MVP · **P1** major workflow broken ·
**P2** important · **P3** minor.

Status values: OPEN · IN PROGRESS · FIXED · VERIFIED · WONTFIX

---

## JC-001 · Student Groups, Approvals and Calling are implemented as "DESIGN-ONLY, not in MVP"

| | |
|---|---|
| **Severity** | **P0 — MVP is unbuildable as currently architected** |
| **Area** | Backend schema + communication authorization |
| **Owner agent** | AI #1 (schema, authorization) · AI #2 (communication engine) |
| **Status** | OPEN |
| **Found** | 2026-09-05, static review of live code |

### Evidence

`apps/api/prisma/schema.prisma` §C:

> `// SECTION C - DESIGN-ONLY (declared, deliberately NOT implemented in MVP)`
> `// The authoritative product brief's MVP scope (section 10) contains no student`
> `// groups, no message approval, and no calling.`

Models `StudentGroup`, `StudentGroupMember` and the approval/calling models are
each tagged `/// DESIGN-ONLY. Not implemented.` and no service reads or writes
them.

### Root cause

Built against `docs/JAWWID_CHAT_BRIEF.pdf`, which is **superseded**. See
`docs/qa/authoritative-scope.md`. The approved **PRD v0.1** places Student
Groups, the approval workflow (approve / reject / rejection reason), and voice
calling — 1:1 **and group** — inside MVP.

### Impact

Three of the PRD's headline MVP capabilities have no runtime implementation, and
the Teacher mobile app (AI #3) and Admin approval UI (AI #4) have no backend to
integrate against. This is not a missing feature; it is an architectural
position that must be reversed.

### Expected

Student Groups, approvals and voice calling are MVP. Approval is intentionally
simple in MVP — approve, reject, rejection reason — with escalation, expiry and
coverage-aware approval deferred to Phase 2. Video calling is Phase 2.

### Mitigating factor

The groundwork exists: `ThreadKind` already includes `STUDENT_GROUP`, and
`ModerationStatus` already declares `PENDING` / `REJECTED` "so the approval
workflow can be switched on without a migration". The correction is cheaper than
the §C comment implies.

### Fix direction

Promote §C models to implemented, and route them through the same centralized
authorization service (see JC-002). Do **not** create a second authorization
path for groups or calls.

---

## JC-002 · BR-1 is enforced by making Student Groups unrepresentable

| | |
|---|---|
| **Severity** | **P0 — correct rule, structurally incompatible implementation** |
| **Area** | `apps/api/src/platform/authorization.service.ts` |
| **Owner agent** | AI #1 |
| **Status** | OPEN |
| **Depends on** | JC-001 |

### Evidence

> `STRUCTURAL GUARANTEE - no teacher <-> parent channel can exist:`
> `1. There is no user-to-user conversation entity in this system at all. The only`
> `   customer-facing thread is Thread(kind=FAMILY), keyed by familyId and unique`
> `   per family. A "Teacher <-> Parent 1:1 thread" is not merely denied, it is`
> `   unrepresentable in the schema.`

### Analysis

The instinct is right and worth preserving: making a forbidden state
unrepresentable is stronger than denying it at runtime. **But the guarantee is
purchased with the wrong asset.** It holds only because *no* multi-party
conversation can exist — which also forbids the Student Group, the one channel
through which Teacher↔Parent communication is *required* to flow.

The rule is not "teachers and parents never share a conversation." It is
**"teachers and parents share only the official Student Group, with required
admin presence/authorization."** The current design cannot express the
permitted case.

### Expected

Conversations carry an explicit `type` and an explicit participant set.
Authorization is a total function of *(actor, conversation, channel, context)*,
server-side, and is the **single** code path for messaging **and** calling.
BR-1 becomes: no conversation of a 1:1 type may contain both a teacher and a
parent — checked at creation **and** at every join/add-member, so the invariant
cannot be reached by mutation after the fact.

### Regression tests required

`BR1-01` … `BR1-14` in `docs/qa/test-plan.md` §3 — including group→1:1
promotion, add-member escalation, and calling parity.

---

## JC-003 · Teacher is not a first-class actor; ACADEMIC staff are barred from all family communication

| | |
|---|---|
| **Severity** | **P0 — blocks Teacher mobile app and Student Groups** |
| **Area** | `apps/api/src/platform/types.ts`, `prisma/schema.prisma` (`StaffRole`), `supabase/migrations/*` (`chat.staff.role` CHECK) |
| **Owner agent** | AI #1 |
| **Status** | OPEN |

### Evidence

```ts
export const FAMILY_FACING_ROLES: ReadonlySet<StaffRole> =
  new Set([StaffRole.ADMIN, StaffRole.COVERAGE, StaffRole.MANAGER]);
```
> `ACADEMIC (teaching) staff are excluded here, so a teacher cannot message a`
> `family through any channel.`

`ActorKind` is `'STAFF' | 'CONTACT' | 'SYSTEM'` — there is no teacher kind.
`chat.staff.role` CHECK omits `teacher`. `chat.learner.teacher_id` is a bare
`uuid` with no FK and no identity behind it.

### Analysis — two distinct rules have been conflated

| Rule | Source | Meaning |
|---|---|---|
| "finance / technical / academic staff never message families" | superseded brief, about **internal back-office staff** | correct, keep |
| **BR-1** | PRD v0.1, about **teachers** | teachers *do* communicate with parents — only inside the Student Group |

Mapping "teacher" onto `StaffRole.ACADEMIC` and then barring that role from all
family communication implements the first rule and **deletes the second**.
Teachers additionally require Teacher↔Admin 1:1, which is also currently denied.

### Expected

A teacher is an authenticated first-class actor, distinct from CS back-office
staff, who can: hold Teacher↔Admin 1:1 conversations and calls; participate in
Student Groups for their assigned learners; and **never** obtain a 1:1 channel
to a parent. QA specifies the behaviour, not the table design.

---

## JC-004 · `chat.config_num()` / `config_text()` return NULL silently for a JSON-null value

| | |
|---|---|
| **Severity** | P3 |
| **Area** | `supabase/migrations/20260905090000_chat_foundation.sql` |
| **Owner agent** | AI #1 |
| **Status** | OPEN |

The functions document *"raise if a key is missing rather than silently
defaulting."* They detect a missing **row** (`v IS NULL` after `SELECT INTO`) but
not a row whose stored value is JSON `null`: then `v = 'null'::jsonb`,
`v #>> '{}'` yields SQL NULL, and the accessor returns NULL — the exact
behaviour the comment says it prevents. A config key silently becoming NULL
changes operational thresholds without failing loudly.

**Fix:** add a `jsonb_typeof(v) = 'null'` guard, or `CHECK (jsonb_typeof(value) <> 'null')`.

---

## JC-005 · `requestedMode: ASSIST` / `ESCALATION` bypasses the on-duty check

| | |
|---|---|
| **Severity** | **P0 — horizontal privilege escalation, client-reachable** |
| **Area** | `apps/api/src/platform/authorization.service.ts` `canSendMessage()` |
| **Owner agent** | AI #1 |
| **Status** | **FIXED — verified** (fail-closed; real predicate still owed by AI #1) |
| **Evidence** | `apps/api/test/unit/authorization/assist-escalation-bypass.spec.ts` — was 3 failing, now passing |

### Steps

1. Authenticate as any family-facing staff member (ADMIN or COVERAGE) who is
   **not** on duty for family F and is not F's owner.
2. `POST` a customer-visible message to F's thread with
   `requestedMode: "ASSIST"` (or `"ESCALATION"`) in the body.

### Expected

DENY. Assist requires **all** of: family in the NOW bucket · waited >50% of the
response target · the on-duty admin has not opened it — or the on-duty admin
explicitly requested help. None hold.

### Actual

`allow(OnBehalfMode.ASSIST)` is returned unconditionally:

```ts
if (intent.requestedMode === OnBehalfMode.ASSIST)     return allow(OnBehalfMode.ASSIST);
if (intent.requestedMode === OnBehalfMode.ESCALATION) return allow(OnBehalfMode.ESCALATION);
```

### Impact

Any admin or coverage admin can write a **customer-visible** message to **any
family** at any time by setting one field in the request body — defeating
`on_duty()`, which the architecture designates as the sole authority for who may
act on a family. The `on_behalf_mode` recorded on the message is also
client-chosen at this point, so the audit trail records the attacker's own
label.

### Root cause

The gate is delegated to "the caller" by comment, contradicting the class's own
contract: *"No controller, gateway, or worker is permitted to make its own
access decision."* `CommErrorCode.ASSIST_NOT_PERMITTED` is **declared but never
used**, confirming the check was intended and not implemented.

### Fix direction

Evaluate the assist preconditions inside `AuthorizationService`, returning
`ASSIST_NOT_PERMITTED` when unmet. `ESCALATION` needs its own explicit
predicate. Neither may be satisfiable by a client-supplied field alone.

---

## JC-006 · `canReadInternal()` does not check `isActive` — offboarded staff retain internal-note access

| | |
|---|---|
| **Severity** | **P1** |
| **Area** | `apps/api/src/platform/authorization.service.ts` `canReadInternal()` |
| **Owner agent** | AI #1 |
| **Status** | **FIXED — verified** |
| **Evidence** | `apps/api/test/unit/authorization/internal-note-privacy.spec.ts` — was 1 failing, now passing |

`canReadThread()` gates on `actor.isActive`; `canReadInternal()` does not:

```ts
canReadInternal(actor: Actor): boolean {
  return actor.kind === 'STAFF' && isFamilyFacing(actor.staffRole);
}
```

A deactivated or offboarded admin therefore still passes this check. Manager
one-click offboarding is supposed to revoke access; whether it does currently
depends on the order in which a caller happens to invoke the two methods —
exactly the per-caller reasoning the centralized-policy contract forbids.

**Fix:** gate on `actor.isActive` here too. Every public method of the
authorization service should be independently safe to call.

**Passing alongside it (verified):** no CONTACT can read internal notes,
regardless of capability flags, and FINANCE / TECHNICAL / ACADEMIC staff are
correctly excluded. The core of INV-11 is sound.

---

## Test infrastructure note

`apps/api/package.json` declared `test:unit` / `test:int` with
`--selectProjects unit|integration`, but **no jest config existed and no test
had been written**. AI #5 added `apps/api/jest.config.js` defining both
projects. Suites now execute: `npm --prefix apps/api run test:unit`.

---

## Positive findings (verified, preserve these)

| # | Finding |
|---|---|
| **PF-1** | `Actor` deliberately carries **no phone, email or address**, and `Contact` has no phone column. Phone privacy is enforced by *construction* — the communication engine has no code path that can obtain a number. This is the strongest possible form of the control. Preserve it through the JC-002 refactor and extend it to call signalling. *(AI #1)* |
| **PF-2** | A single centralized `AuthorizationService` with an explicit "no controller, gateway or worker may make its own access decision" contract. Exactly the right shape. *(AI #1)* |
| **PF-3** | `CommunicationPolicy` in the Flutter client is correctly labelled *"defence in depth only; the backend remains the authority"*, and denies the group-member→1:1 affordance so a group never becomes a directory. *(AI #3)* |
| **PF-4** | `on_behalf_mode`: OWNER vs COVERAGE is **derived, never trusted** from the client. *(AI #1)* |
| **PF-5** | Migration ledger is separate from Jawwid Core's (`chat.schema_migrations`), and each migration commits with its ledger row in one transaction — a failed migration is never recorded as applied. *(AI #1)* |
| **PF-6** | Config accessors raise on a missing key rather than defaulting, so a deleted threshold fails loudly. *(AI #1, modulo JC-004)* |


---

## Fix record — 2026-09-05

### JC-005 — fixed by failing closed

`canSendMessage()` now **denies** a client-supplied `ASSIST` / `ESCALATION`
rather than granting it:

```ts
if (intent.requestedMode === OnBehalfMode.ASSIST) {
  return deny(CommErrorCode.ASSIST_NOT_PERMITTED, '...a client-supplied mode never grants access');
}
if (intent.requestedMode === OnBehalfMode.ESCALATION) {
  return deny(CommErrorCode.ESCALATION_NOT_PERMITTED, '...');
}
```

**QA deliberately did not implement the real assist predicate.** It depends on
the attention bucket and response target, which live in engines AI #1 owns and
which have not landed. Inventing it here would fabricate a product rule. The
branches are marked for AI #1 with an explicit instruction not to restore an
unconditional `allow()` and not to move the gate into a caller.

**Residual risk (tracked):** assist and escalation are currently *unavailable*,
not merely *gated*. This is the safe direction — no unauthorized access — but it
is a functional gap until AI #1 lands the predicate. Tracked as **JC-007**.

### JC-006 — fixed

`canReadInternal()` now returns `false` for `!actor.isActive`.

### Contract impact for peer agents

| Agent | Impact |
|---|---|
| **AI #1** | Owns the follow-up: implement the real assist/escalation predicate inside `AuthorizationService`. Two marked branches await it. |
| **AI #2** | `canSendMessage()` with `requestedMode: ASSIST\|ESCALATION` now returns a denial instead of allowing. No caller relied on it — `message.service.ts` passed the client value straight through with no gate of its own. |
| **AI #3 / AI #4** | New stable error code `COMM.ESCALATION_NOT_PERMITTED` (additive; `errors.ts` declares adding a code safe). Any "reply as assist" or "escalate" affordance will now receive `COMM.ASSIST_NOT_PERMITTED` / `COMM.ESCALATION_NOT_PERMITTED`. Render the denial; do not retry, and do not build a client-side workaround. |

**Verification:** `npm --prefix apps/api run test:unit` → 28 passing.
`npm --prefix apps/api run typecheck` → clean.
`legitimate-access.spec.ts` pins the paths that must keep working: on-duty owner
(tagged OWNER), on-duty coverage (tagged COVERAGE, ownership untouched), live
stickiness, expired stickiness correctly denied, manager on any family, internal
notes by any family-facing admin, the family's own contact, cross-family contact
denied, and the system actor.

---

## JC-007 · Assist and escalation are unavailable until the server-side predicate lands

| | |
|---|---|
| **Severity** | P1 (functional gap, introduced deliberately by the JC-005 fix) |
| **Owner agent** | AI #1 |
| **Status** | OPEN |

Both paths now fail closed. "Reply as assist" and manual escalation cannot
succeed until `AuthorizationService` evaluates the real preconditions
server-side. Deliberate: unavailable beats bypassable. Release gate G-44 stays
FAIL until the predicate exists **and** is covered by tests asserting both the
permitted and the denied case.

---

## JC-008 · BR-1 database backstop does not guard conversation type changes

| | |
|---|---|
| **Severity** | **P1** (P0 if any code path can set `conversation.type`) |
| **Area** | `supabase/migrations/20260905093000_chat_communication.sql` |
| **Owner** | **AI #2** |
| **Status** | OPEN — reproduced against the live integration database |
| **Test** | `apps/api/test/integration/schema-invariants.spec.ts` → *"JC-008: converting a teacher+parent GROUP into a DIRECT conversation must be rejected"* — **currently failing** |

**Expected.** A teacher and a family contact can never be alone together in a
`direct` conversation, by any route. The trigger's own comment states the
guarantee: *"Even a compromised API or a manual SQL session cannot create a
teacher↔parent 1:1 channel."*

**Actual.** They can, with one `UPDATE`:

```sql
insert into chat.conversation (id, type, state) values ('1111…','class_group','open');
insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
  values ('1111…','teacher',gen_random_uuid(),'teacher'),
         ('1111…','contact',gen_random_uuid(),'parent');   -- legal: it is a group

update chat.conversation set type='direct', direct_key='jc008' where id='1111…';
-- UPDATE SUCCEEDED
```

**Evidence.**
```
 type   |     members
--------+-----------------
 direct | contact+teacher
```

**Impact.** The BR-1 structural backstop does not hold. It is not reachable
through the current API — no endpoint mutates `conversation.type` today — but
the backstop exists precisely for when the API is bypassed or a future endpoint
is added, so its guarantee is currently false. Gate **G-01**.

**Root cause.** The invariant is a property of *(conversation.type, member
set)*. `conversation_member_br1` fires only on `chat.conversation_member`, so
only one of the two inputs is guarded. `chat.conversation` carries just
`conversation_set_updated_at` (a timestamp trigger). `call_participant_br1` has
the identical shape and therefore the same gap on `chat.call.type`.

**Acceptance criteria.**
1. A trigger on `chat.conversation` re-validates the member set when `type`
   changes; likewise on `chat.call`.
2. The reproduction above raises `check_violation`.
3. The failing integration test passes, and the two BR-1 positive tests still
   pass (group membership stays legal).
4. Test-plan **BR1-10** converted from pending to asserting.

---

## JC-009 · Database architecture contradicts the fixed standalone decision

| | |
|---|---|
| **Severity** | **P0** (architectural) |
| **Area** | migrations, `db/test/00_core_shim.sql`, `apps/api/prisma/` |
| **Owner** | **AI #1** |
| **Status** | OPEN — partially improving |
| **Detail** | `docs/release/database-decision.md` (DB-1…DB-5) |

**Expected.** Jawwid Chat owns its own PostgreSQL database, does not depend on
Jawwid Core's database, integrates with Core through the approved API/webhook
boundary, and has exactly one migration authority (SQL).

**Actual.** Seven verified contradictions, itemised in `database-decision.md` §2:
Chat declared as living inside Core's database; `chat.core_*` **SQL views** over
`public.profiles` / `children` / `subscriptions` / `payments`; a subscription
vocabulary mirroring Core verbatim; a Core shim whose column shapes are
*"copied from second-school's live migrations"*; and Prisma as a second schema
authority alongside SQL.

**Evidence.** `20260905090900_chat_core_integration.sql` selects directly
`from public.profiles`. Reproduced during environment build:
`ERROR: relation "public.profiles" does not exist` on a standalone database.

**Impact.** Chat cannot be deployed to its own database as specified. Gate
**G-21** FAIL.

**Root cause.** Built against the superseded brief, which co-located Chat with
Core.

**Improving:** the `auth.users` coupling has narrowed sharply. AI #2's rewrite
of `093000` removed it entirely, and the whole remaining surface is **one**
`auth.uid()` call in `090700`; `staff.auth_user_id` is a plain uuid with no FK.
DB-1 is therefore much smaller than it first appeared.

**Acceptance criteria.** DB-1, DB-2 and DB-5 complete; the integration database
runs on plain `postgres:17` with **no** `db/integration/*` stub files; G-21 PASS.

**Blocked:** DB-2 needs the approved integration boundary's transport, auth,
payloads and delivery semantics, which are in no document available to QA.

---

## JC-010 · Two incompatible `chat.event_log` definitions; one silently wins

| | |
|---|---|
| **Severity** | **P0** (silent schema divergence, runtime-only failure) |
| **Area** | `090500_chat_logs_and_state_cache.sql` vs `093200_chat_shared_logs.sql` |
| **Owner** | **AI #1 + AI #2** (joint) |
| **Status** | OPEN — reproduced |
| **Test** | `schema-invariants.spec.ts` → *"JC-010"* — 2 tests, **passing** (they pin the broken state) |

**Expected.** One definition of `chat.event_log` and `chat.audit_log`.

**Actual.** Two, differing fundamentally:

| | AI #1 `090500` | AI #2 `093200` |
|---|---|---|
| `id` | `bigint generated always as identity` | `uuid default gen_random_uuid()` |
| actor column | **`actor_type`** (CHECK) | **`actor_kind`** (no CHECK) |
| `family_id` / `case_id` | FKs with cascade | plain uuid, no FK |
| `type` | CHECK, ~35 values | no CHECK |

AI #2 used `create table if not exists`, so in filename order AI #1's applies
first and **AI #2's is silently skipped**:

```
NOTICE:  relation "event_log" already exists, skipping
```

**Evidence.**
```
insert into chat.event_log (type, actor_kind, payload) values ('message_sent','staff','{}');
ERROR:  column "actor_kind" of relation "event_log" does not exist
```
Both lineages also install their own append-only trigger, so `chat.event_log`
carries duplicates (`event_log_is_append_only`, `event_log_append_only`).

**Impact.** Any AI #2 code writing `actor_kind` fails at runtime, and any event
type outside AI #1's CHECK list is rejected. `create table if not exists` turned
a schema conflict into a **silent** one — a merge is clean, migrations apply
green, and the failure surfaces only when the code runs. This is the exact class
of defect that branch reconciliation exists to catch.

**Root cause.** Two lineages defining the same object under non-colliding
filenames, with `if not exists` suppressing the collision.

**Acceptance criteria.** One definition survives; the other migration is removed
or rewritten to `alter table`; all writers agree on the column name; duplicate
triggers removed; the two JC-010 tests are rewritten to assert the *reconciled*
schema rather than the broken one.

---

## JC-011 · Confirmed security fixes silently regressed, and their regression tests were deleted

| | |
|---|---|
| **Severity** | **P0 — process defect; reintroduced one P0 and one P1** |
| **Area** | `apps/api/src/platform/authorization.service.ts`, `apps/api/test/unit/authorization/` |
| **Owner** | **AI #5** (guard) + whichever agent performed the conversation-model rewrite |
| **Status** | **FIXED — fixes re-applied, regression suite restored and hardened** |

**Expected.** Once JC-005 and JC-006 were fixed and covered by passing
regression tests, no later change reintroduces them without a test failing.

**Actual.** The conversation-model rewrite (`Thread` → `Conversation`,
`canSendMessage` → `canSend`) restored the vulnerable code **verbatim**:

```ts
// "Reply as assist" and escalation: explicit, tagged, and audited by the caller.
if (intent.requestedMode === OnBehalfMode.ASSIST)     return allow(OnBehalfMode.ASSIST, ...);
if (intent.requestedMode === OnBehalfMode.ESCALATION) return allow(OnBehalfMode.ESCALATION, ...);
```

and `canReadInternal()` dropped the `isActive` check again. The error codes
`ASSIST_NOT_PERMITTED` / `ESCALATION_NOT_PERMITTED` were removed with them.

**Nothing failed**, because the three regression suites protecting the fixes —
`assist-escalation-bypass.spec.ts`, `internal-note-privacy.spec.ts`,
`legitimate-access.spec.ts` — were **deleted in the same sweep** and replaced by
a consolidated file that did not carry the assist-denial or deactivated-actor
assertions.

**Evidence.** Unit count fell from 39 passing to 26 without any failure being
reported. `grep ASSIST_NOT_PERMITTED src/platform/` returned nothing.

**Impact.** JC-005 (P0, horizontal privilege escalation — any family-facing
admin posting a customer-visible message to any family) and JC-006 (P1) were
both live again. The rewrite itself was legitimate and necessary work; the
defect is that a security fix was reverted **silently**.

**Root cause.** Two causes, both process:
1. A large refactor rewrote a file containing security-critical branches without
   the fixes being re-applied.
2. Test files were deleted rather than migrated, removing the only signal.
   Deleting a test never fails a build.

**Resolution.**
- Both fixes re-applied to `canSend()` and `canReadInternal()`, with comments
  naming JC-005/JC-006/JC-011 so the intent survives the next refactor.
- Error codes restored.
- Single consolidated suite `jc005-jc006-regression.spec.ts`, carrying a
  DO-NOT-DELETE header that states the code is at fault if it fails, plus
  positive assertions that legitimate access still works.
- Verified: **81 unit tests passing, 6 suites, typecheck clean.**

**Acceptance criteria for prevention (open, owner AI #5).** CI cannot currently
detect a deleted test. A guard that fails when a file matching
`*regression*.spec.ts` disappears, or a coverage floor on
`authorization.service.ts`, would close this. Tracked for the next pass — the
re-application above is complete, the prevention is not.
