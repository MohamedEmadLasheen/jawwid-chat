# Jawwid Chat — Red Team Findings

Owner: AI #9 (Adversarial Red Team / Chaos) · Opened 2026-09-05 · Updated 2026-09-06
Status: **EVIDENCE FROZEN — handed off to release (Agent #10)**
Handoff: [`handoff-to-release.md`](handoff-to-release.md)

Scope of this pass: static attack of the whole tree, **runtime-executed**
attacks against `AuthorizationService`, `SignedLocalObjectStorage`,
`AttachmentService` and `MessageService`, and **runtime-executed SQL attacks
against the `chat.*` migration series** on a local Supabase Postgres.

> **Re-verified at `c6aa4a6`.** This tree moved under this audit: AI #1 landed
> the JC-005/JC-006 authorization fixes (`fa53ba7`), a 620-line
> `chat.conversation` communication schema with BR-1 database triggers, and AI #7
> landed CI (`bf279a7`). **Every finding below was re-checked against the tree as
> of `c6aa4a6`, not against the tree this audit started on.** Findings closed by
> those commits are marked ✅ and kept, not deleted — a closed finding is the
> record that the control now exists.
>
> Three of the highest-severity findings in this report (**RT-023, RT-024,
> RT-026**) are consequences of that new work and did not exist when this audit
> began.

## Evidence grades — read these before reading a severity

| Grade | Meaning |
|---|---|
| **CONFIRMED (runtime)** | An executing test in `apps/api/test/unit/red-team/` demonstrates the behaviour. |
| **CONFIRMED (static)** | Proven by reading the only code path that exists; no alternative path can intervene. |
| **UNVERIFIED** | The implementation strongly suggests it, but the code is not reachable at runtime yet. |
| **THEORETICAL** | Reasoned from the design; not proven. Stated as a risk, never as a defect. |

> **Environmental constraint governing every "UNVERIFIED" below.**
> There is no `main.ts`, no `AppModule`, no HTTP controller other than
> `/health`, no auth middleware, and no outbox drain worker. `RealtimeGateway`
> is defined but registered in no module. **The application cannot currently be
> started.** Runtime attacks against HTTP, WebSocket, queues and storage
> endpoints are therefore impossible today, and no finding below claims
> otherwise. Reproduce them at the service layer, or re-run this campaign once
> the app boots.

## Reproducing the runtime evidence

```bash
cd apps/api && npx jest --selectProjects unit --testPathPattern red-team
```

The SQL attacks (RT-023, RT-024, RT-025) are reproduced with:

```bash
bash scripts/db/test-db.sh reset
```

which currently **fails** — that failure *is* RT-023. RT-024 and RT-025 were
executed against a harness that first creates the platform tables the series
omits; the harness is scratch-only and deliberately not committed, so it cannot
be mistaken for a schema proposal.

These specs assert **observed** behaviour, so they pass today. When a finding is
fixed, invert its assertion in the same commit as the fix — a green red-team
suite after a fix means the fix did not land.

## ⚠️ Live-tree notice — an unlandeded refactor is in the working copy

At the close of this campaign the working tree (uncommitted, `git status`)
contains a large in-flight refactor by another agent: Prisma has been remapped
onto the `chat` schema (`Conversation`, `ConversationMember`, `MessageApproval`,
`Call`), enums have become `String` + `vocab.ts`, `Actor.userId` is now
`Actor.actorId`, kinds are lower-case, and `thread.service.ts` is deleted. **Six
of seven unit suites — including AI #5's — currently fail to compile**; this is
that refactor mid-flight, not a defect any single suite introduced. The red-team
specs are pinned to the pre-refactor API and must be re-pointed once it lands;
they are deliberately not being rewritten against a half-applied change.

Three findings were re-checked against the *uncommitted* code, because the
refactor is where the risk now is:

| Finding | Status against the in-flight refactor |
|---|---|
| **RT-002** | **Largely addressed.** `canRead(actor, conv, membership)` now receives the conversation and the membership; a contact or teacher must be a live member. `canOpenDirect()` is a closed allow-list and `canCall()` takes a participant set. This is the fix RT-002 asked for. Blanket staff access to every family remains (RT-011). |
| **RT-003** | **Survives verbatim.** `if (actor.staffRole === 'manager') return allow(intent.requestedMode ?? ESCALATION, …)` is unchanged through two rewrites of this file. |
| **RT-004** | **REGRESSED — worse than reported.** `deriveMode` is now `private deriveMode(actor, _conv, fallback) { return fallback; }` — the owner comparison is gone. Every internal note by any family-facing admin is now stamped **`OWNER`**, on every family, whoever owns it. The previous behaviour was a wrong-but-distinguishable `COVERAGE`; this is an affirmative false claim of ownership written into the audit trail, and `actor` and `_conv` are both now unused parameters. **New severity: P1, and it should be fixed before the refactor is committed.** |


## Severity tally

Counted from the detailed findings below. Every id RT-001…RT-027 is present
exactly once; there are no gaps and no duplicates.

| Severity | Count | IDs |
|---|---|---|
| **P0** | **5** | RT-001, RT-002, RT-023, RT-024, RT-026 |
| **P1** | **9** | RT-003, RT-004, RT-005, RT-006, RT-007, RT-008, RT-009, RT-010, RT-025 |
| **P2** | **5** | RT-011, RT-012, RT-013, RT-014, RT-027 |
| **P3** | **7** | RT-016, RT-017, RT-018, RT-019, RT-020, RT-021, RT-022 |
| Closed | 1 | RT-015 |
| | **27** | |

**Of the five P0s, three are proven by execution** (RT-002, RT-023, RT-024); two
are CONFIRMED (static) — RT-001 and RT-026. An earlier verbal summary of this
audit said "four proven by execution". That was wrong; the figure is three.

## Test-preservation contract

`apps/api/test/unit/red-team/` holds **security regression tests**. They assert
the *observed insecure* behaviour so each finding can be graded CONFIRMED rather
than THEORETICAL, and so a fix is visible rather than silent.

> **A fix must make the invariant hold and the assertion be inverted in the same
> commit. A test must never be deleted, skipped, or weakened because the
> implementation fails it.** A red-team spec that has been relaxed to go green is
> a regression in the audit, not a fix in the product.

Both specs are intact and unmodified in substance. They currently do not compile
— see RT-027 — which is the in-flight refactor, not an edit to the tests.

---

## Evidence register

Every finding, with the fields required for release triage. `Regression?` means
*introduced or worsened by the uncommitted refactor now in the working tree*.
Full attack steps, expected behaviour, root cause and acceptance criteria are in
the detailed finding bodies below.

### A · Database and migration failures

| ID | Sev | Exact attack | Exact evidence | Affected component | Status | Regression? |
|---|---|---|---|---|---|---|
| **RT-023** | **P0** | Apply the committed migration series to an empty database. | `bash scripts/db/test-db.sh reset` → `ERROR: relation "chat.family" does not exist` at `20260905093000`. `comm` of `references chat.*` against `create table chat.*` yields **`chat.family`, `chat.staff`, `chat.learner`, `chat.thread`, `chat.message`** — created by no migration; `git log --diff-filter=D` shows none were deleted. | `supabase/migrations/*`, CI gate G-19 | **CONFIRMED (runtime)** | No — pre-existing |
| **RT-010** | P1 | None — architectural fork. | `20260905090000_chat_foundation.sql:3-7` places `chat` *inside the Jawwid Core database*; `schema.prisma` + `.env.example:37` target a standalone Postgres; `infra/docker/postgres-init/10-app-role.sh:5-8` states it serves "both database strategies currently in the tree". | schema, infra | **CONFIRMED (static)** | No — pre-existing |

### B · Authorization failures

| ID | Sev | Exact attack | Exact evidence | Affected component | Status | Regression? |
|---|---|---|---|---|---|---|
| **RT-001** | **P0** | Open a WebSocket with `auth.userId` set to any staff or contact primary key. | `realtime.gateway.ts:57` `String(client.handshake.auth?.userId ?? '')` passed to `identity.resolveActor`; no verifier exists in `apps/api`. `Contact.appUserId` is read by no code. | `RealtimeGateway`, `IdentityService` | **CONFIRMED (static)** | No — pre-existing |
| **RT-002** | **P0** | Read/write a thread of any `kind` for a family; probe `familyId: '*'`. | `authz-attacks.spec.ts` §RT-002, 4 assertions: all four `ThreadKind` values admitted for a contact; all family ids admitted for all three operator roles. | `AuthorizationService` | **CONFIRMED (runtime)** — *largely addressed by the uncommitted refactor: `canRead(actor, conv, membership)` now requires live membership for contacts and teachers* | No |
| **RT-026** | **P0** | None — the control guards tables no code uses. | `grep -rln "chat\.\|conversation_member\|conversationId" apps/api/src apps/admin-web/src` → no matches at `c6aa4a6`. BR-1 triggers live on `chat.conversation_member`; all services target Prisma `Thread`/`Message`. | schema ↔ services seam | **CONFIRMED (static)** | No — the uncommitted refactor is the fix in progress |
| **RT-003** | P1 | Manager sends with `requestedMode: 'OWNER'` on a family they do not own. | `authz-attacks.spec.ts` §RT-003, 2 assertions. Survives `fa53ba7` and the refactor: `authorization.service.ts:217-218` `if (actor.staffRole === 'manager') return allow(intent.requestedMode ?? ESCALATION, …)`. | `AuthorizationService` | **CONFIRMED (runtime)** | No — but **survived two rewrites** |
| **RT-006** | P1 | Pass another family's message ids to the signing helper. | `attachment.service.ts` `signUrlsForMessages(messageIds: string[])` — no actor parameter. `grep` confirms no caller exists yet. | `AttachmentService` | **CONFIRMED (static)**; UNVERIFIED at runtime (unreachable) | No |
| **RT-009** | P1 | Disable an account while its socket is open; keep using it. | `resolveActor` appears once in `realtime.gateway.ts` (line 58, `handleConnection`); the `Actor` is cached on the socket and reused by `subscribe`/`typingStart`/`canTouchThread`. No TTL, no eviction. | `RealtimeGateway` | **CONFIRMED (static)** | No |
| **RT-011** | P2 | List threads as any operator. | `thread.service.ts:142` `canReadThread(actor, { familyId: '*' })` then `findMany({ take: 200 })`, unfiltered. `authz-attacks.spec.ts` §RT-002 shows `'*'` is allowed for all operator roles. | `ThreadService` | **CONFIRMED (runtime)** | No — file is deleted by the refactor; re-verify the replacement |
| **RT-014** | P2 | Revoke authority between the decision and the commit. | `message.service.ts:81-137` — actor, family and `canSendMessage` all resolved before `$transaction`; the `FOR UPDATE` lock is taken afterwards. | `MessageService` | **CONFIRMED (static)** | No |

### C · Privacy and security failures

| ID | Sev | Exact attack | Exact evidence | Affected component | Status | Regression? |
|---|---|---|---|---|---|---|
| **RT-005** | P1 | Sign a read URL for any object key using the literal in the repo. | `storage-and-integrity-attacks.spec.ts` §RT-005: with `STORAGE_SIGNING_SECRET` deleted, an attacker-constructed signer's signature makes the victim instance's `verify()` return `true`. `object-storage.ts:35` `?? 'dev-only-not-a-secret'`; variable absent from `.env.example`. | `SignedLocalObjectStorage` | **CONFIRMED (runtime)** | No |
| **RT-007** | P1 | Authorize an `image/png` upload, PUT other bytes, then send the attachment declaring any MIME/size. | `storage-and-integrity-attacks.spec.ts` §RT-007: `AttachmentService.validate` correctly rejects `text/html`, `image/svg+xml`, oversize — and a static assertion over `message.service.ts` shows no `AttachmentService` reference and no `.validate(` call, while `objectKey: a.objectKey` is persisted verbatim. | `MessageService`, `AttachmentService` | **CONFIRMED (runtime + static)** | No |
| **RT-008** | P1 | Contact sends `{ type: 'SYSTEM', origin: 'AUTOMATION' }` into their own thread. | `storage-and-integrity-attacks.spec.ts` §RT-008: `validateContent(SYSTEM, { body: null, attachments: [] })` does not throw, while the same emptiness throws for `TEXT` and `IMAGE`. `message.service.ts:102-103` takes both fields from the request. | `MessageService` | **CONFIRMED (runtime)** | No |
| **RT-012** | P2 | Read any message as a contact. | `dto.ts:185-190` — `toMessageDto` maps every `MessageReceipt` row (`userId`, `deliveredAt`, `readAt`), including staff. | `MessageDto` | **CONFIRMED (static)** | No |
| **RT-013** | P2 | Observe realtime while staff write internal notes. | `message.created` is published with `toThread(threadId, …)` to a room holding contacts and staff; payload carries `visibility: 'INTERNAL'`, `authorId`, `createdAt`. REST filters internal messages; realtime has no audience filter. | realtime fan-out contract | **CONFIRMED (in contract)**; **UNVERIFIED at runtime** — no outbox drain worker exists | No |
| RT-016 | P3 | Timing oracle on HMAC comparison. | `object-storage.ts:64` `===` on hex digests. | `SignedLocalObjectStorage` | CONFIRMED (static) | No |
| RT-021 | P3 | Log an email, `authToken`, `idToken`, `jwt`, `otp`. | `redacting_logger.dart:20-40` — exact-key match list; those keys are absent. | Flutter `RedactingLogger` | CONFIRMED (static) | No |
| RT-022 | P3 | None — storage halves cannot connect. | `object-storage.ts:33-60` expects this API to serve bytes (no such route); `docker-compose.yml:70-110` + `.env.example:49-53` provision MinIO credentials no code reads. | storage layer | CONFIRMED (static) | No |

### D · Product invariant failures (BR-1, ownership)

| ID | Sev | Exact attack | Exact evidence | Affected component | Status | Regression? |
|---|---|---|---|---|---|---|
| **RT-024** | **P0** | Create a legal `student_group` with a teacher and a parent, then `UPDATE chat.conversation SET type='direct', direct_key=…`. | Executed on Supabase Postgres 17.6. Control refused: `ERROR: BR-1 violation: a direct conversation may never contain both a teacher and a family contact`. Attack succeeded: result rows `direct \| contact \| parent` and `direct \| teacher \| teacher`. **Calling identical**: a `group` call promoted to `direct` yields `direct \| contact` + `direct \| teacher`. | `chat.enforce_direct_conversation_rules()`, `chat.enforce_call_participant_rules()` | **CONFIRMED (runtime)** | No — the trigger is new, the gap shipped with it |
| **RT-025** | P1 | Create a `student_group` (or `class_group`) containing exactly one teacher and one parent, no admin. | Executed: `student_group \| admin_members 0 \| live_members 2`; `class_group \| 0 \| 2`; group call `group \| staff_present 0 \| participants 2`. The trigger checks `type = 'direct'` only, so `class_group` is entirely out of scope. | same triggers | **CONFIRMED (runtime)** | No |
| **RT-004** | P1 | Any family-facing admin writes an internal note on a family they neither own nor cover. | See section E — this finding is a **refactor regression** and is recorded there. | `AuthorizationService.deriveMode` | **CONFIRMED (runtime)** | **YES** |

### E · Refactor regressions

Both entries below concern the **uncommitted** refactor in the working tree
(Prisma remapped onto `chat`, `Conversation`/`ConversationMember`/`Call`,
`thread.service.ts` deleted). Neither is committed history; both are the current
state of the working copy and must not be lost when it lands.

| ID | Sev | Exact attack | Exact evidence | Affected component | Status | Regression? |
|---|---|---|---|---|---|---|
| **RT-004** | P1 | Any family-facing admin writes an internal note on any family. | **Before the refactor:** `deriveMode` compared `actor.userId === familyOwnerId` and returned `COVERAGE` for a non-owner — wrong, but distinguishable; `authz-attacks.spec.ts` §RT-004 proves `onDuty()` was never called (`onDutyCalls === 0`). **After the refactor:** `authorization.service.ts:269-271` is `private deriveMode(actor: Actor, _conv: Conv, fallback: string): string { return fallback; }` — the ownership comparison is gone and **both parameters are unused**, so the OWNER fallback is returned verbatim and every internal note by any family-facing admin is stamped **`OWNER`** on every family. | `AuthorizationService.deriveMode` | **CONFIRMED (runtime, pre-refactor); CONFIRMED (static, post-refactor)** | **YES — worsened.** `COVERAGE` (unjustified) → `OWNER` (an affirmative false ownership claim in the audit trail) |
| **RT-027** | P2 | None — the regression tests stop running. | `npx jest --selectProjects unit` → **6 failed, 1 passed**, all six `Test suite failed to run` with `TS2305: Module '"@prisma/client"' has no exported member 'MessageVisibility'` and `TS2820: Type '"STAFF"' is not assignable to type 'ActorKind'`. AI #5's JC-005/JC-006 conformance specs and both red-team specs are among the six. | whole `apps/api` unit suite | **CONFIRMED (runtime)** | **YES** |

**Why RT-027 is a security finding and not a build annoyance:** the JC-005,
JC-006 and red-team specs are the only automated evidence that these invariants
hold. While the suite does not compile, CI's `npm run test:unit` step cannot
distinguish "the invariant holds" from "nothing ran". The tests must be
re-pointed at the new `AuthorizationService` API — **not** deleted — before the
refactor is committed.

---

## Recommended fix order

Unchanged from the original assessment, and deliberately narrow — this audit
does not prescribe the remediation:

1. **RT-023** — cheap, unblocks CI's G-19, and until it lands no database fix
   reaches any environment.
2. **RT-010** — the database decision. RT-002, RT-024 and RT-026 all resolve
   differently depending on the answer. **This audit does not make that choice.**
3. **RT-001** — the cheapest single break in the attack chain
   (see `cross-agent-red-team.md`).
4. **RT-004 and RT-027** — before the refactor is committed, not after.

# BLOCKING RELEASE — P0

## RT-001

### Title
The only runtime entry point accepts self-asserted identity: a client declares who it is.

### Category
Security / Authentication

### Severity
**P0**

### Attack Scenario
An attacker opens a WebSocket to the API and sets `auth.userId` to any staff or
contact primary key. The server resolves that id into a full `Actor` and treats
the connection as that person for its entire lifetime.

### Preconditions
The app is bootstrapped (it currently is not) and `RealtimeGateway` is
registered in a module. Knowledge of one `staff.id` or `contact.id` UUID.

### Attack Steps
1. `io(API_URL, { auth: { userId: '<victim staff uuid>' } })`
2. `socket.emit('thread.subscribe', { threadId })` for any thread.
3. Receive every realtime event for that thread; mark receipts as the victim.

### Expected Secure Behaviour
Identity is derived from a verified credential (a signed token, a session
cookie). A client-supplied identifier is never an identity.

### Actual Behaviour
`realtime.gateway.ts:57` — `const userId = String(client.handshake.auth?.userId ?? '')`,
passed straight to `identity.resolveActor`. No signature, no session, no
expiry, no audience check. `PrismaIdentityService.resolveActor` looks the id up
directly as a table primary key; `Contact.appUserId` (the field that exists to
link a contact to an authenticated account) is never read by any code.

### Impact
Complete authentication bypass at the only entry point that exists.
Every other control in this report — all of which are correctly written — is
downstream of an identity that the attacker chooses.

### Evidence
`apps/api/src/communication/realtime/realtime.gateway.ts:54-75`;
`apps/api/src/platform/identity.service.ts:20-50`. CONFIRMED (static).

### Root Cause
A deliberate placeholder ("AI #1 SEAM: replace this with verification of the
auth token"). The defect is not the placeholder — it is that **nothing prevents
it from shipping**: no startup assertion, no `APP_ENV` guard, no failing test,
no CI (see RT-015), and no release-gate item bound to this line.

### Recommended Fix
Two changes, both small:
1. Make the placeholder fail closed outside local: refuse to construct the
   gateway when `APP_ENV !== 'local'` and no token verifier is provided.
2. Add a red-team regression test asserting that a handshake without a verified
   credential is rejected.

Independently, AI #1 lands real token verification; `resolveActor` should then
take a verified principal, not a raw id.

### Acceptance Criteria
- A handshake carrying only `auth.userId` is disconnected.
- Starting the API with `APP_ENV=staging` and no token verifier fails at boot.
- `Contact.appUserId` is the join key from authenticated principal to contact,
  or the column is deleted.

### Owner
**AI #1** (auth), with AI #7 for the boot-time guard.

---

## RT-002

### Title
Authorization is a total function of `familyId` alone — thread kind and participant set are outside its type signature, so BR-1 cannot be expressed.

### Category
Authorization / Architecture

### Severity
**P0**

### Attack Scenario
Any `Thread` row whose `kind` is `STUDENT_GROUP`, `CLASS_GROUP` or `OFFICIAL`
is readable and writable by **every contact of that family and every
family-facing staff member**, with no code change and no new migration — because
the authorization functions are never shown the thread's kind or its
participants.

### Preconditions
A thread row exists with `kind <> FAMILY`. `ThreadKind` already contains all
four values, `Thread` is `@@unique([familyId, kind])` (four threads per family
are representable today), and any seed script, admin tool, integration import or
future service can insert one.

### Attack Steps
1. Insert `Thread { familyId: F, kind: STUDENT_GROUP }`.
2. As any contact of family F, call `canReadThread` — allowed.
3. As any ADMIN / COVERAGE / MANAGER, call `canReadThread` for **any** family — allowed.

### Expected Secure Behaviour
Authorization is a function of *(actor, conversation, channel, context)*
including the conversation's type and explicit participant set, per
`docs/qa/defects.md` JC-002.

### Actual Behaviour
```ts
canReadThread(actor: Actor, thread: Pick<Thread, 'familyId'>): AuthzDecision
canSendMessage(actor, thread: Pick<Thread,'familyId'|'stickyHandlerId'|'stickyUntil'>, ...)
```
Neither signature can see `kind`, and neither receives a participant set.

### Impact
This is the finding that outlives JC-002. AI #5 correctly identified that the
"structural guarantee" makes Student Groups unrepresentable. The **stronger and
more dangerous** reading is the converse: multi-kind threads are *already*
representable, and the moment one exists the authorization layer treats it as a
family-wide broadcast channel. BR-1 — "no 1:1 conversation may contain both a
teacher and a parent" — is a predicate over a participant set that the single
authorization code path is never given. It is not unimplemented; **it is
unexpressible without changing the contract.**

Adding Student Groups (required MVP scope) therefore does not merely need new
tables. Done against the current contract, it silently creates the exact channel
BR-1 forbids.

### Evidence
`apps/api/test/unit/red-team/authz-attacks.spec.ts` → *RT-002 · authorization is
a function of familyId alone* (4 assertions). CONFIRMED (runtime): all four
`ThreadKind` values are admitted for a contact, and all family ids — including
the literal `'*'` — are admitted for every family-facing staff role.

### Root Cause
The `Pick<>` narrowing was chosen to keep the authorization service decoupled
from the Thread model. It decoupled it from the two fields the rule needs.

### Recommended Fix
Widen the contract *before* Student Groups are built:
`canReadThread(actor, thread: Pick<Thread,'familyId'|'kind'>, participants: Participant[])`,
and deny by default for any kind the function does not explicitly handle. A new
`ThreadKind` must then fail to compile rather than fall through to allow.

### Acceptance Criteria
- A `STUDENT_GROUP` thread is denied to a contact who is not a member of it.
- Adding a `ThreadKind` value without adding a branch fails the build.
- `BR1-01…BR1-14` (`docs/qa/test-plan.md` §3) run against this single path for
  both messaging and calling.

### Owner
**AI #1** (contract) · **AI #2** (call sites). Blocks JC-001 and JC-002.

---

---

## RT-023

### Title
The migration series cannot be applied to an empty database: five `chat.*` tables are referenced by foreign keys and never created.

### Category
Operational Safety / Security (control non-installation)

### Severity
**P0**

### Attack Scenario
Not an attacker action. A clean environment — a new staging database, a
disaster-recovery rebuild, or CI — cannot be built from this repository, and
every database-level security control lands in **no** environment.

### Attack Steps
```
$ bash scripts/db/test-db.sh reset
  apply   20260905090000_chat_foundation
  apply   20260905090100_chat_config_defaults
  apply   20260905093000_chat_communication
ERROR:  relation "chat.family" does not exist
```

### Actual Behaviour
`supabase/migrations/` creates 17 tables and references 8. Five of the
referenced tables — **`chat.family`, `chat.staff`, `chat.learner`,
`chat.thread`, `chat.message`** — are created by no migration in the tree, and
`git log --diff-filter=D -- supabase/migrations` shows nothing was deleted:
**they were never committed.** `20260905093000` even performs
`alter table chat.message add column …` against a table that does not exist,
which is only writable by someone whose working copy had it.

### Impact
1. **The database cannot be built from the repository.** Reproducible
   environments and disaster recovery are both blocked.
2. **Every control AI #1 just wrote is absent from every environment**: the BR-1
   triggers, the append-only `event_log`/`audit_log` triggers, the
   `message_no_rewrite` immutability trigger, the approval CHECK constraints.
   Code review will read them as present. No deployed database has them.
3. CI's own **G-19 gate — "migrations apply and are idempotent" — fails today.**
   It was added in `bf279a7`, the commit *after* the migrations it cannot apply.
4. `docs/qa/authoritative-scope.md` §5 C-1 cites a `chat.staff.role` CHECK
   constraint as "already committed" evidence. That file is not in the tree, so
   the finding's evidence cannot be inspected.

### Evidence
CONFIRMED (runtime), transcript above. Cross-check:
`grep -ohE "references chat\.[a-z_]+" supabase/migrations/*.sql | sort -u`
against `grep -ohE "create table chat\.[a-z_]+" …`.

### Root Cause
Work exists in a working copy and not in the repository. The migration ledger
(`chat.schema_migrations`) records what was applied on a developer's machine,
which makes local runs succeed and hides the gap.

### Recommended Fix
Commit the platform migration that creates `chat.staff`, `chat.family`,
`chat.contact`, `chat.learner`, `chat.thread`, `chat.message`, `chat.event_log`
and `chat.audit_log`, with a sequence number before `20260905093000`. Then make
G-19 blocking on a clean database.

### Acceptance Criteria
`scripts/db/test-db.sh reset` succeeds on an empty volume, and re-running it is
a no-op. G-19 is green.

### Owner
**AI #1**, blocking. **AI #7** for the gate.

---

## RT-024

### Title
The BR-1 database backstop is bypassed by mutation: a Student Group is promoted to a teacher↔parent 1:1 channel with one `UPDATE`.

### Category
Security / Authorization — BR-1

### Severity
**P0**

### Attack Scenario
Create the legitimate thing, then change what it is. The trigger validates
membership; nothing validates the conversation's `type`.

### Preconditions
The ability to run one `UPDATE` against `chat.conversation` — a compromised API,
a SQL-injection sink, an admin tool, an operator, or a future service method
that legitimately edits a conversation.

### Attack Steps
```sql
-- 1. A perfectly legal student group.
insert into chat.conversation (type, family_id, learner_id, title)
     values ('student_group', :fam, :learner, 'Learner A group');
insert into chat.conversation_member (conversation_id, actor_kind, member_role)
     values (:conv, 'teacher', 'teacher'), (:conv, 'contact', 'parent');   -- allowed

-- 2. Promote it.
update chat.conversation
   set type = 'direct', direct_key = 'promoted-by-attacker', learner_id = null
 where id = :conv;                                                          -- ALLOWED
```

### Expected Secure Behaviour
The function's own comment:
> `'BR-1 backstop. Even a compromised API or a manual SQL session cannot create a teacher<->parent 1:1 channel.'`

### Actual Behaviour
```
### CONTROL — create a teacher<->parent DIRECT conversation
ERROR:  BR-1 violation: a direct conversation may never contain both a teacher and a family contact

### ATTACK A — promote a legal student_group {teacher,parent} to type=direct
 conversation_type | actor_kind | member_role
-------------------+------------+-------------
 direct            | contact    | parent
 direct            | teacher    | teacher
```

**Calling has the identical bypass** — `chat.enforce_call_participant_rules()` is
also attached only to `call_participant`:
```
### ATTACK D — build a group call {teacher,parent}, then promote it to direct
 call_type | actor_kind
-----------+------------
 direct    | contact
 direct    | teacher
```

### Impact
The single strongest control in the system — the one explicitly designed to hold
when the API is compromised — does not hold. The forbidden state is not
unrepresentable; it is one `UPDATE` away, and the `v_live > 2` participant cap is
bypassed the same way. This is the product's constitutional rule.

The control is genuinely good for what it checks: the control case is correctly
refused, in both messaging and calling. The defect is placement, not intent.

### Evidence
CONFIRMED (runtime), transcripts above, against `20260905093000` applied to
Supabase Postgres 17.6.

### Root Cause
`create trigger conversation_member_br1 after insert or update on chat.conversation_member`
— the invariant spans two tables and is enforced on one. `chat.conversation` has
only an `updated_at` trigger.

### Recommended Fix
Add the mirror trigger on `chat.conversation` (`after update of type`) calling a
shared validation function, so the invariant is checked from whichever side
changes. A constraint trigger deferred to commit would cover both in one place.

### Acceptance Criteria
Both the insert path *and* the type-change path raise `BR-1 violation`, for
`chat.conversation` and `chat.call` alike. `BR1-01…BR1-14` include the promotion
case (`docs/qa/test-plan.md` §3 already calls for "group→1:1 promotion").

### Owner
**AI #1**.

---

## RT-026

### Title
The running application targets the weaker of the two schemas: no TypeScript references `chat.conversation`, so the BR-1 backstop guards tables no code uses.

### Category
Architecture / Authorization

### Severity
**P0**

### Attack Scenario
Not an attacker action — a control that protects the wrong asset.

### Actual Behaviour
`20260905093000` introduces exactly the model `docs/qa/defects.md` JC-002 asks
for: `chat.conversation` with an explicit `type`, `chat.conversation_member` as
an explicit participant set, a `teacher` actor kind, `chat.message_approval`
with `rejection_reason`, and BR-1 triggers over both messaging and calling.

Every line of application code targets the **other** schema — Prisma's
`Thread` / `Message` in `public`, where a family has one `FAMILY` thread, there
is no teacher actor, and Student Groups are `/// DESIGN-ONLY. Not implemented.`

```
$ grep -rln "chat\.\|conversation_member\|conversationId" apps/api/src apps/admin-web/src
(no matches)
```

### Impact
- The BR-1 backstop protects tables that no service reads or writes. Even fixing
  RT-024 changes nothing for the running system.
- **RT-002 is unchanged.** `AuthorizationService` still decides on `familyId`
  alone, against Prisma's `Thread`. The conversation model exists in SQL and is
  invisible to the authorization path.
- JC-001, JC-002 and JC-003 are answered in one schema and still open in the
  other. A reviewer reading the migrations concludes they are fixed; a reviewer
  reading `src/` concludes they are open. **Both are reading correctly.**
- This is RT-010 (two databases) escalated: the two are no longer merely
  divergent, they now *disagree about the security model*, and the application
  runs on the permissive one.

### Evidence
CONFIRMED (static): the grep above; `schema.prisma` §C unchanged at `c6aa4a6`;
`message.service.ts` and `authorization.service.ts` still import from
`@prisma/client`.

### Recommended Fix
Resolve RT-010 first — one schema — then port the communication engine onto
`chat.conversation` and widen `AuthorizationService` per RT-002. Until then, no
statement of the form "BR-1 is enforced" is true of the running system, and the
release gate should say so.

### Acceptance Criteria
One schema in the tree. `AuthorizationService` receives a conversation type and
a participant set. `BR1-01…BR1-14` execute against the code path the application
actually uses.

### Owner
**AI #1** and **AI #2** jointly; needs a product-owner decision on RT-010 first.


# MUST FIX BEFORE PILOT — P1

## RT-003

### Title
`on_behalf_mode` is client-controlled for a MANAGER: ownership attribution can be forged.

### Category
Integrity / Audit

### Severity
**P1**

### Attack Scenario
A manager sends a customer-facing message with `requestedMode: 'OWNER'` on a
family they do not own. The message is persisted, and the audit trail records,
`on_behalf_mode = OWNER`.

### Preconditions
Actor is `StaffRole.MANAGER`. No other precondition.

### Attack Steps
`canSendMessage(manager, thread, someOtherOwnerId, { visibility: CUSTOMER, requestedMode: OWNER })`

### Expected Secure Behaviour
The contract states it plainly:
> `/** Only honoured for ASSIST/ESCALATION; OWNER vs COVERAGE is derived, never trusted. */`

### Actual Behaviour
`authorization.service.ts:126-128` — `return allow(intent.requestedMode ?? ESCALATION)`.
All four modes are honoured verbatim for a manager.

### Status at `c6aa4a6` — re-verified after the JC-005 fix
`fa53ba7` closed JC-005 correctly: a non-manager who supplies
`requestedMode: ASSIST | ESCALATION` is now denied with a fail-closed branch and
an explicit "do not restore an unconditional allow" comment. **The MANAGER
branch on line 126 is untouched**, and this finding's runtime probe still passes
against the fixed file. This is the fix-validation case in §55 of the red-team
charter: the reported request was closed, the boundary was not.

### Impact
`on_behalf_mode` is the field the operating model relies on to distinguish
Primary Owner from Current Handler, and it is written into `audit_log` and
`event_log` as fact. A forged `OWNER` stamp corrupts ownership analytics,
workload attribution and the audit record of who acted for whom — the exact
record the product's "the system owns the family history" rule depends on.

This survives AI #5's JC-005 fix as specified: their test only exercises a
non-manager intruder. **Fixing JC-005 without touching the MANAGER branch leaves
this open.** (Red-team fix-validation rule §55: test the boundary, not the
request.)

### Evidence
`apps/api/test/unit/red-team/authz-attacks.spec.ts` → RT-003, 2 assertions.
CONFIRMED (runtime).

### Root Cause
The manager short-circuit was written for *access* ("Manager can act on
anything") and reused for *attribution*, which is a different question.

### Recommended Fix
Split the two. A manager's access stays unconditional; the mode is still derived:
`allow(this.deriveMode(actor, familyOwnerId, intent.requestedMode ?? ESCALATION))`,
with `OWNER` reachable only when `actor.userId === familyOwnerId`.

### Acceptance Criteria
A manager requesting `OWNER` on a family they do not own is allowed to send and
the message is stamped `ESCALATION` (or `COVERAGE`), never `OWNER`.

### Owner
**AI #1** (owns `AuthorizationService` internals) · coordinate with AI #5's JC-005.

---

## RT-004 — ⚠️ REFACTOR REGRESSION, DO NOT LET THIS BE ABSORBED SILENTLY

### Title
`on_behalf_mode` is asserted without any basis. Pre-refactor: `COVERAGE` for actors holding no coverage. Post-refactor: **`OWNER` for actors who do not own the family.**

### Category
Product invariant (ownership attribution) / Integrity / Audit — **and a refactor regression**

### Severity
**P1** · **Regression: YES, worsened**

### Regression record — the fact this finding exists to protect

| | Pre-refactor (committed) | Post-refactor (uncommitted working tree) |
|---|---|---|
| `deriveMode` | compares `actor.userId === familyOwnerId`, returns `COVERAGE` for a non-owner | `private deriveMode(actor: Actor, _conv: Conv, fallback: string): string { return fallback; }` — **both parameters unused** |
| Internal note by a non-owner admin | stamped `COVERAGE` — unjustified, but distinguishable from ownership | stamped **`OWNER`** — an affirmative false claim of permanent ownership |
| `on_duty()` consulted | never (`onDutyCalls === 0`, proven) | never |

The product's core rule is *One Family → One Primary Owner; the system, not the
employee, owns the family's history.* `on_behalf_mode` is the field that records
which of the two an action was taken under, and it is written to `audit_log` and
`event_log` as fact. After the refactor, that field asserts ownership for every
family-facing admin on every family.

**This must not be closed by the refactor landing.** The refactor is what caused
it. If the working tree is committed as-is, the regression ships and the
pre-refactor evidence for it (`authz-attacks.spec.ts` §RT-004) stops compiling at
the same moment (RT-027) — the finding and its proof would disappear together.
Fix `deriveMode`, or re-point the spec so the assertion still runs, in the same
commit that lands the refactor.

### Attack Scenario
Any ADMIN writes an internal note on a family they neither own nor cover. The
note is persisted with `on_behalf_mode = COVERAGE`, asserting a coverage
relationship that does not exist.

### Expected Secure Behaviour
The documented derivation:
> "The mode is DERIVED from on_duty() + ownership, never taken from the client."

### Actual Behaviour
`deriveMode()` consults **ownership only**. On the INTERNAL branch
(`authorization.service.ts:121-123`) `coverage.onDuty()` is never called at all;
any non-owner is labelled `COVERAGE` by default.

### Impact
Every internal note by a non-owner admin is an audit record that states
something untrue. Coverage is the operating model's core distinction between
"assigned to help" and "wandered in"; a mode that means "not the owner" is not
the same field as one that means "was on duty". Downstream workload and coverage
reporting inherits the error.

### Evidence
`apps/api/test/unit/red-team/authz-attacks.spec.ts` → RT-004, asserting
`onDutyCalls === 0` while the decision returns `COVERAGE`. CONFIRMED (runtime).

### Recommended Fix
Either introduce a distinct mode for "family-facing admin acting outside
ownership and coverage", or make `deriveMode` async and consult `onDuty()` on
every path that can emit `COVERAGE`.

### Acceptance Criteria
A non-owner, non-on-duty admin's internal note is never stamped `COVERAGE`.

### Owner
**AI #1**. Related to RT-003; fix together.

---

## RT-005

### Title
Object-storage URL signing falls back to a secret committed to git, and the variable is absent from the documented environment.

### Category
Security / Privacy

### Severity
**P1**

### Attack Scenario
An attacker who can name any object key mints a valid signed read URL for it,
without ever authenticating.

### Preconditions
`STORAGE_SIGNING_SECRET` is unset — which is the state an operator reaches by
following the documented setup, because **`.env.example` does not contain the
variable** and `docs/infrastructure/environment.md` (cited as the authoritative
inventory) does not exist on disk.

### Attack Steps
1. Read `'dev-only-not-a-secret'` from `object-storage.ts:35` (public repo).
2. `createHmac('sha256', secret).update('GET:' + key + ':' + expires)`.
3. `GET {STORAGE_ENDPOINT}/{key}?expires=…&sig=…` — accepted by `verify()`.

### Expected Secure Behaviour
Absence of a signing secret is a fatal startup error outside local development.

### Actual Behaviour
`private readonly secret = process.env.STORAGE_SIGNING_SECRET ?? 'dev-only-not-a-secret'`

### Impact
Forgeable read (and, via the `PUT` variant, write) capabilities over the entire
attachment store. Attachments are family communication content: photos of
children, documents, voice notes.

### Evidence
`apps/api/test/unit/red-team/storage-and-integrity-attacks.spec.ts` → RT-005,
which deletes the env var, signs a key with an attacker-constructed instance and
shows the victim instance's `verify()` returns `true`. CONFIRMED (runtime).

### Recommended Fix
Throw at construction when the secret is missing and `APP_ENV !== 'local'`; add
`STORAGE_SIGNING_SECRET` to `.env.example` and to the environment inventory.

### Acceptance Criteria
Constructing `SignedLocalObjectStorage` with `APP_ENV=staging` and no secret
throws. `grep STORAGE_SIGNING_SECRET .env.example` matches.

### Owner
**AI #2** (the class) · **AI #7** (environment inventory).

---

## RT-006

### Title
`signUrlsForMessages()` mints signed URLs for arbitrary message ids with no authorization check.

### Category
Authorization / IDOR

### Severity
**P1** (seam not yet reachable — see grade)

### Attack Scenario
A caller passes message ids belonging to another family and receives working,
short-lived read URLs for their attachments.

### Expected Secure Behaviour
Every object-level read is authorized against the requesting actor. This is the
canonical IDOR shape: an id in, an object out, no subject in the signature.

### Actual Behaviour
```ts
async signUrlsForMessages(messageIds: string[]): Promise<Map<…>>
```
No `actor`, no `userId`, no thread check. `SignedLocalObjectStorage.signedReadUrl`
likewise signs any key handed to it. The only correct gate in this file —
`authorizeUpload`, which does check `canReadThread` — sits beside it, which makes
the omission look intentional to a reader.

### Impact
Whichever controller AI #2 or AI #4 wires to this becomes a cross-family
attachment read. The function's shape invites the mistake.

### Evidence
`attachment.service.ts:90-108`; grep confirms **no caller exists yet**, so the
IDOR is not presently reachable. CONFIRMED (static) for the contract;
UNVERIFIED at runtime by construction.

### Recommended Fix
Change the signature to take the actor and filter to messages whose thread the
actor may read: `signUrlsForMessages(actor: Actor, messageIds: string[])`.
Fix it before a caller exists — it is free today.

### Acceptance Criteria
Requesting a signed URL for another family's attachment returns nothing, and a
red-team test proves it.

### Owner
**AI #2**.

---

## RT-007

### Title
Attachment MIME type, size and object key are persisted verbatim from the request body; the validator is never called on the send path.

### Category
Security / Input validation

### Severity
**P1**

### Attack Scenario
1. Call `authorizeUpload(kind: IMAGE, mimeType: 'image/png')` — passes validation,
   returns a signed `PUT` URL for key `K`.
2. `PUT` arbitrary bytes to `K`. The signature covers only `method:key:expires` —
   **not** the content type, and not the byte size.
3. Send a message with `attachments: [{ objectKey: K, mimeType: 'text/html', byteSize: 1, kind: 'FILE' }]`.

Every field is stored as supplied.

### Expected Secure Behaviour
The MIME allowlist and size ceiling are enforced where the metadata is
persisted, and the object key is verified to have come from an upload
authorization for *this* thread.

### Actual Behaviour
`MessageService` never imports `AttachmentService`. Its only attachment check is
`validateContent`, which asks solely whether the array is non-empty.

### Impact
- The MIME allowlist (which correctly rejects `text/html` and `image/svg+xml`)
  is bypassed entirely, and the declared MIME is what every client renders.
- The reference signer's built-in default is
  `STORAGE_ENDPOINT=http://localhost:3000/storage` — the API's own origin — so
  with the variable unset a stored HTML/SVG payload is same-origin stored XSS
  against anything served from the API host. (`.env.example` points the variable
  at MinIO on `:9000` instead, which is a different origin — but see RT-022:
  the reference signer cannot serve from MinIO at all, so it is not clear which
  value production will carry.)
- The size ceiling is advisory only.
- Nothing binds an object key to the thread it was authorized for.

### Evidence
`apps/api/test/unit/red-team/storage-and-integrity-attacks.spec.ts` → RT-007:
`AttachmentService.validate` correctly rejects `text/html`, `image/svg+xml` and
oversize; static assertion over `message.service.ts` shows no reference to
`AttachmentService` and no `.validate(` call, while `objectKey: a.objectKey` is
persisted verbatim. CONFIRMED (runtime + static).

### Recommended Fix
Call `attachments.validate(kind, mimeType, byteSize)` per attachment inside
`send()`, and require the object key to match `threads/{threadId}/…` for the
thread being written to. Serve storage from a separate origin.

### Acceptance Criteria
A send carrying `mimeType: 'text/html'` is rejected with
`ATTACHMENT_TYPE_NOT_ALLOWED`; a send carrying another thread's object key is
rejected.

### Owner
**AI #2**.

---

## RT-008

### Title
A parent can forge a system message: `type` and `origin` are client-controlled and `type: SYSTEM` bypasses all content validation.

### Category
Integrity / Impersonation

### Severity
**P1**

### Attack Scenario
A contact sends `{ type: 'SYSTEM', origin: 'AUTOMATION', body: '<official-looking text>' }`
into their own family thread. Authorization passes — they are a contact of the
family, `canMessage` is true, visibility is `CUSTOMER`. The row is written with
`type=SYSTEM, origin=AUTOMATION` and renders in the admin console and the mobile
apps as an official Jawwid notice.

### Expected Secure Behaviour
`type` and `origin` are server-determined facts about provenance. A non-SYSTEM
actor can never author a `SYSTEM`-typed or `AUTOMATION`/`BROADCAST`-origin
message.

### Actual Behaviour
`message.service.ts:102-103` — `const type = input.type ?? TEXT` and
`origin: input.origin ?? MessageOrigin.USER`, both straight from the request.
Neither is constrained by `actor.kind` anywhere. `validateContent` explicitly
exempts `SYSTEM` from both the body and the attachment requirement
(`type !== TEXT && type !== SYSTEM`), so a `SYSTEM` message needs no content at
all and passes every check.

### Impact
Impersonation of the product itself, by the least-privileged actor in the system.
The obvious abuse is a forged "your subscription has lapsed, pay here" notice
inside a legitimate Jawwid thread. `authorType` is set correctly to `CONTACT`,
so the forgery is detectable in the database — but only if a client renders
`authorType` rather than `type`, and `MessageDto` exposes both with equal
prominence.

### Evidence
`apps/api/test/unit/red-team/storage-and-integrity-attacks.spec.ts` → RT-008:
`validateContent(SYSTEM, { body: null, attachments: [] })` does not throw, while
the same emptiness throws for `TEXT` and `IMAGE`. CONFIRMED (runtime).

### Recommended Fix
Derive both fields: `SYSTEM` type and non-`USER` origin are permitted only when
`actor.kind === 'SYSTEM'`. Drop them from `SendMessageInput` for other callers.

### Acceptance Criteria
A contact sending `type: SYSTEM` or `origin: AUTOMATION` is rejected.

### Owner
**AI #2**.

---

## RT-009

### Title
A realtime session never re-evaluates identity: a disabled account keeps live access for the life of its socket.

### Category
Security / Session

### Severity
**P1**

### Attack Scenario
An admin is offboarded, or a contact's `canMessage` is revoked, or a staff
member's role is downgraded, while they hold an open WebSocket. Nothing changes
for them.

### Expected Secure Behaviour
Revocation is effective immediately, or within a short bounded window, on every
channel — including sockets already established.

### Actual Behaviour
`resolveActor` is called exactly once, in `handleConnection`. The resulting
`Actor` — including `isActive`, `staffRole` and `canMessage` — is cached on the
socket and reused by `subscribe`, `typingStart` and `canTouchThread` forever.
There is no TTL, no re-resolution, no invalidation channel, and no mechanism
that removes an already-joined socket from a thread room.

### Impact
Offboarding does not offboard. A dismissed employee keeps reading live family
conversations until they choose to disconnect. This compounds RT-001: an
attacker who has forged an identity once needs never re-present it.

### Evidence
`apps/api/src/communication/realtime/realtime.gateway.ts:54-75, 82-98, 171-175`.
CONFIRMED (static) — `resolveActor` appears once in the file.

### Recommended Fix
Re-resolve the actor on a TTL (or on every privileged frame), and publish a
revocation event that forces `disconnect(true)` and room eviction.

### Acceptance Criteria
Setting `isActive = false` terminates the user's live sockets within the agreed
window; a subsequent `thread.subscribe` is refused.

### Owner
**AI #1** (revocation signal) · **AI #2** (gateway). Distinct from AI #5's JC-006,
which is about `canReadInternal` ignoring `isActive` at all; this is about the
check never re-running even once it is correct. **Fixing JC-006 alone does not
close RT-009.**

---

## RT-025

### Title
BR-1's "required admin presence" is unenforced: a Student Group containing only a teacher and a parent is permitted.

### Category
Security / Authorization — BR-1

### Severity
**P1**

### Attack Scenario
BR-1 is not "teachers and parents may share a group". It is, per
`docs/qa/authoritative-scope.md` §3: *"Teacher↔Parent communication happens
**only** through the official Student Group, **with the required admin
presence/authorization**."* The database enforces the first clause and not the
second, so a two-party group is a private teacher↔parent channel wearing a group's
name.

### Attack Steps
Create a `student_group` and add exactly one teacher and one parent. No admin.

### Actual Behaviour
```
### ATTACK C — student_group {teacher,parent} with no admin
 conversation_type | admin_members | live_members
-------------------+---------------+--------------
 student_group     |             0 |            2

### ATTACK E — a GROUP call with exactly {teacher,parent} and no admin
 call_type | staff_present | participants
-----------+---------------+--------------
 group     |             0 |            2
```

Additionally, **`class_group` is outside the trigger's scope entirely** — it
checks `type = 'direct'` only — so a `class_group` with {teacher, parent} is
also permitted (ATTACK B, confirmed).

### Impact
The permitted channel becomes the bypass. An attacker never needs RT-024's
`UPDATE`: they can simply create the allowed thing and leave the admin out.

### Evidence
CONFIRMED (runtime), transcripts above.

### Recommended Fix
Require at least one live `admin` member on any conversation (or call) whose live
membership contains both a teacher and a contact — whatever its type — and
enforce it on member removal as well as on insert, so the admin cannot be
dropped afterwards. Decide explicitly what `class_group` is for; if it can carry
parents, it is in BR-1's scope.

### Acceptance Criteria
Removing the last admin from a teacher+parent conversation raises. Creating one
without an admin raises. `class_group` is covered or removed.

### Owner
**AI #1** (trigger) · **Product** (the `class_group` question).


---

## RT-010

### Title
Two incompatible database architectures are committed simultaneously, one of which places Jawwid Chat inside the Jawwid Core database.

### Category
Operational Safety / Tenancy isolation

### Severity
**P1**

### Attack Scenario
Not an attacker action — an architectural fork that determines the blast radius
of every other finding in this report.

### Actual Behaviour
| Source | Model |
|---|---|
| `supabase/migrations/20260905090000_chat_foundation.sql:3-7` | "It lives in the `chat` schema **inside the Jawwid Core Supabase database**." |
| `apps/api/prisma/schema.prisma:20-23` + `.env.example:37` | A standalone Postgres, `public` schema, tables `staff` / `family` / `thread`. |
| `infra/docker/postgres-init/10-app-role.sh:5-8` | Explicitly serves **both** — "both database strategies currently in the tree". |

The two define overlapping entities (`chat.config` vs `Config`, `chat.staff` vs
`Staff`) with different names, types and constraints, and neither references the
other.

### Impact
1. **Isolation.** The `chat`-inside-Core model contradicts the governing scope
   document (`docs/qa/authoritative-scope.md` §2, "Jawwid Chat is an independent
   product") and the standing instruction that Chat shares no database with any
   other product. Under it, a compromise of the Chat application role is a
   compromise of Core's customer data; the init script grants
   `grant all on database` and `alter schema public owner to` the app role.
2. **Divergence.** Two schemas for one product guarantees that a constraint added
   to one is missing from the other. `chat.forbid_mutation()` is defined for
   append-only enforcement — and attached to **no table**; the Prisma side has no
   equivalent at all, so `audit_log` and `event_log` are append-only by comment
   only, in both.
3. It is not knowable today which one a security review is reviewing.

### Evidence
CONFIRMED (static), cited above. `grep 'ROW LEVEL\|POLICY\|GRANT\|REVOKE\|TRIGGER'`
over `supabase/migrations/` returns only the `updated_at` trigger — no RLS, no
grants, no append-only trigger.

### Recommended Fix
A product-owner decision, then delete the loser. If the standalone model wins
(as the governing scope document requires), remove the `chat`-inside-Core
framing from the migration headers and the dual-mode init script.

### Acceptance Criteria
One schema definition in the tree. Append-only tables enforced by a trigger or
by revoked `UPDATE`/`DELETE` grants, not by a comment.

### Owner
**Product owner** (decision) · **AI #1** (schema) · **AI #7** (infrastructure).

---

# SHOULD FIX — P2

## RT-011 · The `familyId: '*'` probe defeats per-object authorization by construction

`thread.service.ts:142` authorizes a *list* by calling the object-level check
against a fabricated family id, then returns every thread in the system
(`take: 200`, no filter, no coverage scope).

The result is correct only because `canReadThread` currently ignores `familyId`
for staff. The moment coverage scoping is added — which the PRD requires — this
probe either denies every operator, or is "repaired" by keeping the fake id and
permanently exempting the list endpoint from the rule. A list must be built from
an authorization-derived filter, never from a probe with a sentinel value.
CONFIRMED (runtime): `authz-attacks.spec.ts` §RT-002 shows `familyId: '*'` is
allowed for all three operator roles. *Owner: AI #2.*

## RT-012 · `MessageDto` returns the full receipt roster to every reader

`toMessageDto` maps **all** `MessageReceipt` rows — `userId`, `deliveredAt`,
`readAt` — for every recipient. A parent therefore learns the internal user ids
of the staff on their family and precisely when each read a message. Staff ids
are the object ids used everywhere else in the system, which makes this an
enumeration primitive as well as a privacy leak. Receipts should be scoped to
the requesting user plus an aggregate. CONFIRMED (static), `dto.ts:185-190`.
*Owner: AI #2.*

## RT-013 · Internal notes are announced to customer contacts over realtime

`message.created` is fanned out with `toThread(threadId, …)` to a room
containing contacts and staff alike, and its payload carries
`visibility: 'INTERNAL'` plus `authorId` and `createdAt`. The body is correctly
withheld — but the existence, author and timing of every internal staff note is
delivered to the family. The REST path filters internal messages properly
(`visibilityFilter`); the realtime path has no audience filter at all. Not yet
reachable (no outbox drain worker exists), so **UNVERIFIED at runtime**;
CONFIRMED in the contract. Fan-out must be per-audience, not per-thread.
*Owner: AI #2.*

## RT-014 · The authorization decision is computed outside the transaction that acts on it

`MessageService.send` resolves the actor, loads the family, and evaluates
`canSendMessage` **before** opening the transaction; the row lock
(`SELECT … FOR UPDATE`) is taken afterwards, and the recipient audience is also
computed outside. A concurrent deactivation, ownership transfer, coverage change
or contact removal between the two is applied to a decision already made.
Window is small and the exploit is a race, so P2 — but the fix is mechanical:
re-read and re-decide inside the transaction, after the lock.
CONFIRMED (static), `message.service.ts:81-137`. *Owner: AI #2.*

## RT-015 · ✅ CLOSED — CI now exists, with one hazard it introduces

**Closed by `bf279a7`.** When this audit opened, `.github/workflows/` was an
empty directory and `npx jest --selectProjects unit` was *4 failed, 6 passed* —
AI #5's JC-005/JC-006 conformance specs, failing, with nothing observing them.
`.github/workflows/ci.yml` now runs typecheck, `npm run test:unit`, admin-web
tests and the G-18/G-19/G-20/G-31..35 release-gate guards. The suite is green
(39 passed, 23 todo) because AI #1 fixed both defects in `fa53ba7`.

**Hazard introduced, and deliberately accepted.** `test:unit` now also runs
`test/unit/red-team/`, whose specs assert *observed insecure behaviour* so the
findings can be graded CONFIRMED. CI therefore currently enforces that RT-002,
RT-003, RT-004, RT-005, RT-007 and RT-008 **remain unfixed** — fixing one turns
CI red. That is the intended design (a fix must be visible, not silent), but it
must be understood: **the correct response to that red build is to invert the
assertion in the same commit as the fix, never to delete the spec.** Each spec
header says so. Flagged here so nobody meets it as a surprise.

Note also G-19 ("migrations apply and are idempotent") **cannot pass** — see
RT-023. *Owner: AI #7, with AI #5.*

---

## RT-027 · The in-flight refactor leaves the unit suite uncompilable, so every security regression test is silently not running

| | |
|---|---|
| **Severity** | **P2** |
| **Category** | Operational Safety / Test integrity |
| **Status** | **CONFIRMED (runtime)** |
| **Regression** | **YES** — caused by the uncommitted refactor |
| **Owner** | the agent landing the refactor · **AI #7** for the gate |

### Attack Scenario
None. This is the failure mode where a control stops being verified without
anyone deciding that it should.

### Actual Behaviour
```
$ npx jest --selectProjects unit
Test Suites: 6 failed, 1 passed, 7 total
  ● Test suite failed to run
    TS2305: Module '"@prisma/client"' has no exported member 'MessageVisibility'
    TS2820: Type '"STAFF"' is not assignable to type 'ActorKind'. Did you mean '"staff"'?
```

The six include AI #5's `assist-escalation-bypass.spec.ts` and
`internal-note-privacy.spec.ts` (the JC-005/JC-006 conformance suites) and both
red-team specs. The refactor removed the Prisma enums in favour of
`contracts/vocab.ts`, renamed `Actor.userId` → `Actor.actorId`, and lower-cased
the actor kinds.

### Impact
CI's `npm run test:unit` step cannot distinguish *"the invariant holds"* from
*"nothing ran"*. Every finding whose grade depends on an executing test —
RT-002, RT-003, RT-004, RT-005, RT-007, RT-008 — loses its automated evidence
for as long as this persists, and the JC-005/JC-006 fixes lose their regression
guard at the same time.

### Recommended Fix
Re-point the specs at the new `AuthorizationService` API as part of the commit
that lands the refactor. **The assertions do not change** — only the imports,
the `Actor` shape and the vocabulary constants. Deleting or skipping a spec to
make the suite compile is out of bounds; see the test-preservation contract at
the top of this document.

### Acceptance Criteria
`npx jest --selectProjects unit` reports 0 failed suites, all specs execute, and
`test/unit/red-team/` still contains both files with their assertions intact.

---

# HARDENING — P3

| ID | Finding | Evidence | Owner |
|---|---|---|---|
| **RT-016** | `SignedLocalObjectStorage.verify` compares HMACs with `===`, not `timingSafeEqual`. Minor next to RT-005, but it is the same function. | `object-storage.ts:64` | AI #2 |
| **RT-017** | `BigInt(input.before / after / seq)` on unvalidated client strings throws `SyntaxError`, not a typed `CommError` — an uncaught 500 and a stack trace instead of a 400. | `message.service.ts:380-381, 438` | AI #2 |
| **RT-018** | Passing both `before` and `after` silently overwrites `where.seq`; `after` wins and the caller's page bound is discarded without error. | `message.service.ts:380-381` | AI #2 |
| **RT-019** | `message.delivered` accepts an unbounded `messageIds[]` straight into a SQL `IN`. No cap, no rate limit; the socket is otherwise unmetered. | `realtime.gateway.ts:155-169` | AI #2 |
| **RT-020** | Re-checked at `c6aa4a6`: **seven** cited documents still do not exist — `docs/brief/JAWWID_CHAT_BRIEF.md` (README), `docs/communication/{scope-decisions,realtime-events}.md`, `docs/infrastructure/{environment,architecture,decisions,handoff-ai2}.md`. `docs/architecture/` was created and is **empty**; `docs/infrastructure/` now holds only `discovery.md`. A control justified by a missing document is unreviewable, and RT-005 is a direct consequence of one of them (`environment.md` is named as the authoritative variable inventory; the variable that matters is in neither it nor `.env.example`). | filesystem | all |
| **RT-022** | The storage layer has two incompatible halves. `AttachmentService` is wired to `SignedLocalObjectStorage`, which signs URLs with its own HMAC and expects **this API** to serve them — but no such route exists, and `docker-compose.yml` provisions MinIO with `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`/`STORAGE_BUCKET` that no code reads. No S3 adapter exists. Attachments cannot currently be stored or served by any path. | `object-storage.ts:33-60`, `docker-compose.yml:70-110`, `.env.example:49-53` | AI #2 / AI #7 |
| **RT-021** | `RedactingLogger._sensitiveKeys` matches keys exactly and omits `email`, `authtoken`, `idtoken`, `sessiontoken`, `jwt`, `credential`, `otp`. Phone numbers are covered; email addresses are not redacted anywhere. | `lib/core/logging/redacting_logger.dart:20-40` | AI #3 |

---

# Deferred — needs a bootable system

These are **not** clearances. They are attacks I could not run because the
application cannot start (no `main.ts`, no `AppModule`, no controllers, no
worker). Re-open this campaign when it boots.

| Area | Blocked because |
|---|---|
| Race conditions (real concurrency) | No runnable service; see `race-conditions.md` for the static analysis and the exact probes to run. |
| Chaos / recovery (§37, §52) | Nothing to kill. `docker-compose.yml` provisions Postgres, Redis and MinIO but **no API container**, and `apps/api` still has no `main.ts` or `AppModule` at `c6aa4a6` — `applyInfrastructure()` (`infra/http/bootstrap.ts`, added since) is written, correct, and called by nothing. Database-layer chaos *is* now possible and was used for RT-023/024/025. |
| Queue / worker attacks | BullMQ is a dependency; no queue, worker or job is implemented. |
| Notification attacks | `src/communication/notifications/` is an **empty directory**. |
| Calling attacks | No implementation; `Call` models are DESIGN-ONLY (JC-001). |
| Search attacks | No search implementation. |
| Jawwid Core integration attacks | No integration code; `CORE_*` env vars only. |
| HTTP-layer attacks (IDOR via REST, CORS, CSRF, rate limiting) | `/health` is the only controller in the tree. |
