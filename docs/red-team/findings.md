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

Severity is the severity of the *finding*; it does not change when the finding
is fixed — only **Status** does. Every id RT-001…RT-027 appears exactly once as
a record. No gaps, no duplicates.

| Severity | Count | IDs | Still open |
|---|---|---|---|
| **P0** | **5** | RT-001, RT-002, RT-023, RT-024, RT-026 | **0** — RT-001 closed 2026-09-23 (Phase 8) |
| **P1** | **9** | RT-003, RT-004, RT-005, RT-006, RT-007, RT-008, RT-009, RT-010, RT-025 | 3 — RT-006, RT-009, RT-010 (partial) |
| **P2** | **6** | RT-011, RT-012, RT-013, RT-014, RT-027, RT-028 | 5 — RT-011, RT-012, RT-013, RT-014, RT-028 |
| **P3** | **7** | RT-016, RT-017, RT-018, RT-019, RT-020, RT-021, RT-022 | 7 (RT-020 partial) |
| Closed | 1 | RT-015 | — |
| | **28** | | **15 open · 12 resolved · 1 closed** |

**Of the five P0s, three were proven by execution** (RT-002, RT-023, RT-024);
RT-001 and RT-026 are CONFIRMED (static). An earlier verbal summary of this audit
said "four proven by execution" — that was wrong; the figure is three.

> **RT-029 added 2026-09-23** (P2, section A) during the PD-6 authorization
> switch. It is a containment gap, not a leak: the cross-organization row is
> storable but authorizes nothing, and two independent controls prove it.
> Deliberately **not** fixed in that phase — attaching a trigger to
> `chat.learner` is tenancy work, not authorization work, and widening a
> security-critical migration to carry an unrelated fix makes the review of both
> worse. The control to add is named in the row.

### Verification anchor

> **All statuses below were re-verified at commit `b634fe8` on 2026-09-06**, with
> a further 35 files uncommitted in the working tree. This tree moved five times
> during the audit. **Eight findings were fixed while this report was being
> written** — RT-002, RT-003, RT-004, RT-005, RT-007, RT-008, RT-026, and
> RT-015 — and they are recorded as RESOLVED with the evidence that closed them,
> not deleted. Anything read from an older copy of this file is stale.

## Test-preservation contract

`apps/api/test/unit/red-team/` holds **security regression tests**. They assert
the *observed insecure* behaviour so each finding can be graded CONFIRMED rather
than THEORETICAL, and so a fix is visible rather than silent.

> **A fix must make the invariant hold, and the assertion must be inverted in the
> same commit. A test must never be deleted, skipped, renamed away, or weakened
> because the implementation fails it.** A red-team spec relaxed to go green is a
> regression in the audit, not a fix in the product.

**The contract has now been exercised end to end.** Six sections were re-pointed
at the refactored API and **inverted** — they assert the secure behaviour and
fail loudly if the vulnerability returns — and a seventh (`RT-008`) that had gone
missing during the inversion was restored. Nothing was deleted, skipped or
weakened. Current state: **22 assertions across 7 sections, all passing**; the
full unit suite is 6 suites / 81 tests green.

---

## Evidence register

Every finding with the fields required for release triage. `Regression?` means
*introduced or worsened by the refactor that landed during this audit*.
Full attack steps, root cause and acceptance criteria are in the finding bodies
below; where a finding is now RESOLVED, the body records the original attack and
this register records what closed it.

### A · Database and migration failures

| ID | Sev | Exact attack | Exact evidence | Affected component | Status | Regression? |
|---|---|---|---|---|---|---|
| **RT-023** | **P0** | Apply the committed migration series to an empty database. | **Original:** `ERROR: relation "chat.family" does not exist` at `20260905093000`; five tables referenced by FK and created by nothing. **Closed:** the 13 platform migrations were brought onto the integration branch from `feat/backend-foundation`, and `20260905091150_chat_application_roles` creates the three role names the RLS policies are written against (`ERROR: role "authenticated" does not exist` was the last remaining break). Verified on a bare `postgres:17`: **20 migrations apply from empty, re-apply is 20 skip**, `db/tests/schema_acceptance.sql` passes 58 structural assertions including zero non-`chat` tables and no `auth` schema. Branch composition, the Core shim and the identity stub are removed from CI and from `integration-db.sh`. | `supabase/migrations/*`, CI gate G-19 | **RESOLVED · verified on an empty database** | No |
| **RT-010** | P1 | None — architectural fork. | **Half closed.** `schema.prisma:18` is now `schemas = ["chat"]`, so the duplicate `public`-schema model is gone and the two definitions no longer disagree. **Unchanged:** `20260905090000_chat_foundation.sql:3-7` still states Jawwid Chat "lives in the `chat` schema inside the Jawwid Core Supabase database", which contradicts `docs/qa/authoritative-scope.md` §2. | schema, infra | **OPEN (partial)** · CONFIRMED (static) — *schema divergence resolved; the tenancy question is not* | No |
| **RT-029** | P2 | Insert a `chat.learner` row in organization A whose `teacher_id` points at a teacher in organization B. | **CONFIRMED (runtime), 2026-09-23, found during the PD-6 authorization switch.** `chat.enforce_same_organization()` exists and is attached to the family-scoped tables, but **not to `chat.learner`**, so the cross-organization row is accepted rather than refused at write time. **Not currently exploitable:** `chat.teacher_parent_authorized()` requires `learner.organization_id = contact.organization_id = teacher.organization_id`, so a bridged row authorizes nothing, and `PrismaRelationshipService` carries the same term independently. Both are asserted — `db/tests/relationship_predicate.sql` D4, and "cross-tenant data cannot satisfy the predicate even through a learner row" in `apps/api/test/integration/relationship-predicate.spec.ts`. The defect is that the invalid row is storable at all, which leaves the tenant boundary resting on every reader restating it rather than on the data being well-formed. **Appropriate control:** a `chat.enforce_same_organization('teacher', 'teacher_id')` trigger on `chat.learner`, plus the same audit for every other FK that crosses a root entity. | `chat.learner`, `chat.enforce_same_organization()` | **OPEN** · CONFIRMED (runtime) — *contained by the PD-6 predicate; not a live leak* | No |

### B · Authorization failures

| ID | Sev | Exact attack | Exact evidence | Affected component | Status | Regression? |
|---|---|---|---|---|---|---|
| **RT-001** | **P0** | Send any HTTP request with `x-actor-id` set to a staff primary key, or open a WebSocket with `auth.actorId` set to one. No credential of any kind. | **Upgraded to CONFIRMED (runtime), and the blast radius has grown.** Against the running API: `curl -H 'x-actor-id: <admin uuid>' /api/v1/conversations` returns that admin's full conversation list, HTTP 200. `api/actor.decorator.ts` reads `request.headers['x-actor-id']` with no guard; `realtime.gateway.ts:57` does the same with `handshake.auth.actorId`. The API now exposes **six controllers**, so this is no longer one socket — it is the whole REST surface. No token verifier and no `APP_ENV` guard exist. Secondary: a request with no header at all returns **HTTP 500**, not 401. **CLOSED 2026-09-23, both halves.** PR-B closed HTTP: no source file reads the header, `@ActorId()` reads only `request.actor`, and the global `AuthenticatedGuard` is its sole writer. Phase 8 closed the WebSocket: `realtime.gateway.ts#handleConnection` takes a token from the handshake and verifies it with `AuthService.authenticate()` -- the same method the HTTP guard calls, not a second verifier -- and reads no client-supplied actor id; a missing, malformed, forged or revoked token disconnects the socket. The containment guard (`assertHandshakeIdentitySeamAllowed`) was deleted WITH the seam, and the API now boots with `APP_ENV=production` (verified: `Jawwid Chat API listening on :3199 [env=production]`, `/health/live` 200). Proof and tripwires: `test/integration/realtime-authentication.spec.ts` (21 assertions incl. forged-actorId impersonation, revoked session, cross-tenant subscribe) and the protected `test/unit/auth/identity-seam.spec.ts`, which now watches BOTH seam names. Retained, not deleted: a closed finding is the record that the control exists. | `actor.decorator.ts`, `RealtimeGateway`, all controllers | **RESOLVED** · verified by execution | No |
| **RT-002** | **P0** | Read/write a conversation of any kind for a family; probe `familyId: '*'`. | Original: `authz-attacks.spec.ts` §RT-002, 4 assertions. **Closed by the refactor:** `canRead(actor, conv, membership)` now receives the conversation and the membership, and a contact or teacher must be a live member (`NOT_CONVERSATION_MEMBER`). `canOpenDirect()` is a closed allow-list; `canCall()` takes a participant set. | `AuthorizationService` | **RESOLVED** · re-verify by inverting the spec (RT-027) | No |
| **RT-026** | **P0** | None — the control guarded tables no code used. | Original: `grep` for `chat.conversation` across `apps/api/src` returned nothing. **Closed:** `conversation.service.ts` and `call.service.ts` now exist and `schema.prisma` is `schemas = ["chat"]`. The application and the BR-1 triggers now target the same tables. | schema ↔ services seam | **RESOLVED** | No |
| **RT-003** | P1 | Manager sends with `requestedMode: 'OWNER'` on a family they do not own. | Original: `authz-attacks.spec.ts` §RT-003, 2 assertions; survived `fa53ba7`. **Closed:** `authorization.service.ts:311-326` — `deriveMode` honours only `ESCALATION` from `requested`, returns `OWNER` solely when `actor.actorId === familyOwnerId`, and the manager branch is commented "may not choose their own attribution". | `AuthorizationService` | **RESOLVED** | No |
| **RT-006** | P1 | Pass another family's message ids to the signing helper. | `attachment.service.ts:89-91` — still `signUrlsForMessages(messageIds: string[])`, no actor parameter, no thread or membership check. | `AttachmentService` | **OPEN · CONFIRMED (static)**; UNVERIFIED at runtime (no caller yet) | No |
| **RT-009** | P1 | Disable an account while its socket is open; keep using it. | `realtime.gateway.ts` — `resolveActor` still appears exactly once (line 58, `handleConnection`); the `Actor` is cached on the socket for its lifetime. No TTL, no re-resolution, no revocation channel, no room eviction. | `RealtimeGateway` | **OPEN · CONFIRMED (static)** | No |
| **RT-011** | P2 | List conversations as any operator. | `conversation.service.ts:420-445` — `listForActor` still returns `take: 200` with no coverage scoping for staff. The `familyId: '*'` probe is gone with `thread.service.ts`; **the unbounded staff scope is not.** | `ConversationService` | **OPEN (re-scoped)** · CONFIRMED (static) | No |
| **RT-014** | P2 | Revoke authority between the decision and the commit. | `message.service.ts:124` — `canSend` is still evaluated before the transaction; the `SELECT last_seq … FOR UPDATE` lock is taken at line 158. | `MessageService` | **OPEN · CONFIRMED (static)** | No |

### C · Privacy and security failures

| ID | Sev | Exact attack | Exact evidence | Affected component | Status | Regression? |
|---|---|---|---|---|---|---|
| **RT-005** | P1 | Sign a read URL for any object key using the literal committed to git. | Original: `storage-and-integrity-attacks.spec.ts` §RT-005 — with the env var deleted, an attacker-built signer's signature made the victim's `verify()` return `true`. **Closed:** `object-storage.ts:43-46` now reads `process.env.STORAGE_SIGNING_SECRET` with no fallback and throws unless it is ≥32 characters. | `SignedLocalObjectStorage` | **RESOLVED** | No |
| **RT-007** | P1 | Authorize an `image/png` upload, PUT other bytes, then send the attachment declaring any MIME/size. | Original: static proof that `message.service.ts` referenced no validator. **Closed:** `message.service.ts:11, 72, 114` — `AttachmentService` is injected and `this.attachments.validate(a.kind, a.mimeType, a.byteSize)` runs per attachment inside `send()`. | `MessageService` | **RESOLVED** | No |
| **RT-008** | P1 | Contact sends `{ type: 'SYSTEM', origin: 'AUTOMATION' }` into their own conversation. | Original: `storage-and-integrity-attacks.spec.ts` §RT-008 — `validateContent(SYSTEM, empty)` did not throw. **Closed:** `message.service.ts:98-109` — "A client may never author a SYSTEM message or claim a non-user origin"; origin is forced to `USER` unless `actor.kind === SYSTEM`. | `MessageService` | **RESOLVED** | No |
| **RT-012** | P2 | Read any message as a contact. | `dto.ts:55, 185` — `toMessageDto` still maps every `MessageReceipt` row (`actorId`, `state`, `deliveredAt`, `readAt`), staff included. Field renamed `userId` → `actorId`; the disclosure is unchanged. | `MessageDto` | **OPEN · CONFIRMED (static)** | No |
| **RT-013** | P2 | Observe realtime while staff write internal notes. | `realtime.gateway.ts:180` — `toThread(threadId, …)` still fans out to a room holding contacts and staff, with no audience filter; the payload carries `visibility`. | realtime fan-out contract | **OPEN · CONFIRMED (in contract)**; UNVERIFIED at runtime — no outbox drain worker | No |
| RT-016 | P3 | Timing oracle on HMAC comparison. | `object-storage.ts:80` — still `this.sign(…) === sig`, not `timingSafeEqual`. | `SignedLocalObjectStorage` | **OPEN** · CONFIRMED (static) | No |
| RT-021 | P3 | Log an email, `authToken`, `idToken`, `jwt`, `otp`. | `redacting_logger.dart:20-40` — exact-key match list; those keys are absent. | Flutter `RedactingLogger` | **OPEN** · CONFIRMED (static) | No |
| RT-022 | P3 | None — storage halves cannot connect. | `object-storage.ts:31-34` — `SignedLocalObjectStorage` is still the only implementation and still expects this API to serve the bytes; no route exists and no S3/MinIO adapter has been written. | storage layer | **OPEN** · CONFIRMED (static) | No |

### D · Product invariant failures (BR-1, ownership)

| ID | Sev | Exact attack | Exact evidence | Affected component | Status | Regression? |
|---|---|---|---|---|---|---|
| **RT-024** | **P0** | Create a legal `student_group` with a teacher and a parent, then `UPDATE chat.conversation SET type='direct'`. Same for `chat.call`. | **Closed by `20260905093300_chat_br1_structural_backstop`:** `type` is now immutable on `chat.conversation` and `chat.call`, and the invariant is re-checked from **both** tables it spans by `DEFERRABLE INITIALLY DEFERRED` constraint triggers, so it holds however the state is reached. Proven at a real `COMMIT` with no `SET CONSTRAINTS` assistance, and against the running system with the application bypassed entirely: injecting a parent into a live Teacher↔Admin conversation by direct SQL returns `ERROR: BR-1 violation: a direct conversation may never contain both a teacher and a family contact`. `db/tests/br1_invariants.sql` — 11 attacks blocked, 7 legitimate channels preserved. | `chat.assert_conversation_br1()`, `chat.assert_call_br1()` | **RESOLVED · verified by executable SQL tests** | No |
| **RT-025** | P1 | Create a `student_group` (or `class_group`) containing exactly one teacher and one parent, no admin. | **Closed by the same migration.** Required admin presence is now enforced on **every** conversation type, not just `student_group` — `class_group` was outside the old trigger's scope. The admin must be `actor_kind='staff'` AND `member_role='admin'`, so a teacher cannot satisfy the rule by claiming the role on their own row (no constraint tied the two columns). Enforced on removal and deletion too, so the last admin cannot be dropped afterwards. Calling has the parity rule. Tests C1–C5, D3 in `db/tests/br1_invariants.sql`. | `chat.assert_conversation_br1()`, `chat.assert_call_br1()` | **RESOLVED · verified by executable SQL tests** | No |

| **RT-004** ↗ | P1 | *Cross-reference — full record in section E.* Ownership attribution asserted with no basis. | see §E | `AuthorizationService.deriveMode` | **RESOLVED** | Regression was transient |

### E · Refactor regressions

| ID | Sev | Exact attack | Exact evidence | Affected component | Status | Regression? |
|---|---|---|---|---|---|---|
| **RT-004** | P1 | Any family-facing admin writes an internal note on a family they neither own nor cover. | **Original:** `deriveMode` compared ownership only and returned `COVERAGE` for a non-owner; `authz-attacks.spec.ts` §RT-004 proved `onDuty()` was never called (`onDutyCalls === 0`). **Regressed mid-audit:** `deriveMode` became `{ return fallback; }` with both parameters unused, stamping **`OWNER`** on every family. **Now closed:** `authorization.service.ts:311-326` — `deriveMode` is async, returns `OWNER` only for the actual family owner, calls `coverage.onDuty()` and returns `COVERAGE` only when it matches, and falls through to `ASSIST` otherwise. | `AuthorizationService.deriveMode` | **RESOLVED** — the regression was caught in the working tree and fixed before it was committed | **Was YES; now closed** |
| **RT-027** | P2 | None — the regression tests stop running. | **Original:** at `b634fe8`, `npx jest --selectProjects unit` → 3 failed, 2 passed; both red-team specs failed to compile (`TS2305` on the removed Prisma enums, `TS2820` on `'STAFF'` vs `'staff'`). **Closed:** the specs were re-pointed at the new API and their assertions **inverted** — `RT-002 (fixed)`, `RT-003 (fixed)`, `RT-004 (fixed)`, `RT-005 (fixed)`, `RT-007 (fixed)` now assert the secure behaviour, plus a new `conversation-type confusion` section. Suite: **6 passed, 81 tests**. One gap found and closed by this audit: the `RT-008` section had been dropped while the file header still claimed it, leaving a fixed finding with no guard — restored as `RT-008 (fixed)`. | `apps/api/test/unit/red-team/*` | **RESOLVED** | Was YES; now closed |

**Why RT-027 mattered.** While the specs did not compile, CI's
`npm run test:unit` could not distinguish *"the invariant holds"* from *"nothing
ran"*, and six of the findings closed during this audit were closed without their
guard executing. **The preservation contract then worked as designed:** the specs
were re-pointed and inverted rather than deleted, and they now guard the fixed
behaviour. The one section that went missing in the process (`RT-008`) was
detected precisely because the file header still claimed it, and was restored.
That is the intended failure mode — visible, not silent.

| **RT-028** | P2 | None — a false-positive in a privacy guard. | `groups-approval-calls.spec.ts:467` asserts a LiveKit token's identity claims contain no `/\+?\d{7,}/`. The claims are UUIDs and a display name, and a random UUID hex segment can be seven or more consecutive digits — observed failing on `...-c0801160-...`. Passes 3/3 in isolation; fails intermittently in the full run. | `apps/api/test/integration/groups-approval-calls.spec.ts` | **OPEN · CONFIRMED (runtime, intermittent)** | No |

**RT-028 was deliberately not "fixed".** The assertion is a phone-privacy control
and loosening the pattern to stop the false positive is exactly the kind of
change this audit refuses to make on its own authority. The correct fix is to
assert over the fields that could carry a phone number (the display name) rather
than over UUIDs — an owner decision for AI #2/#5, not a red-team edit. Until then
CI will red intermittently for a reason that is not a product defect.

### F · Remaining hardening and closed findings

| ID | Sev | Exact attack | Exact evidence | Affected component | Status | Regression? |
|---|---|---|---|---|---|---|
| RT-017 | P3 | Send `before`, `after` or `seq` as a non-numeric string. | `message.service.ts:416-417, 469` — `BigInt(input.before)` on an unvalidated client string throws `SyntaxError`, not a typed `CommError`. | `MessageService` | **OPEN** · CONFIRMED (static) | No |
| RT-018 | P3 | Send `before` and `after` together. | `message.service.ts:416-417` — the second assignment overwrites `where.seq`; `after` wins and the other bound is silently discarded. | `MessageService` | **OPEN** · CONFIRMED (static) | No |
| RT-019 | P3 | Emit `message.delivered` with a very large `messageIds[]`. | `realtime.gateway.ts:150-157` — array passed straight into a SQL `IN`; no cap, no rate limit. | `RealtimeGateway` | **OPEN** · CONFIRMED (static) | No |
| RT-020 | P3 | None — documentation gap. | **Partly closed:** `docs/infrastructure/environment.md` and `architecture.md` now exist. **Still missing:** `docs/brief/JAWWID_CHAT_BRIEF.md` (cited by README), `docs/communication/scope-decisions.md` (cited by the schema to justify its scope), `docs/communication/realtime-events.md`, `docs/infrastructure/{decisions,handoff-ai2}.md`. | repository | **OPEN (partial)** · CONFIRMED (static) | No |
| RT-015 | — | *Closed.* CI did not exist; the QA suite gated nothing. | Closed by `bf279a7`: `.github/workflows/ci.yml` runs typecheck, `test:unit`, the integration suite and the G-18/G-19/G-20/G-31..35 guards. Retained as the record that the control was added. | CI | **CLOSED** | No |

**Counting note.** RT-004 appears twice above — once in section D as a
cross-reference (it is a product-invariant failure) and once in section E as its
full record (it is a refactor regression). It is **one finding**. The tally counts
records, not rows.

---

## Recommended fix order

Advisory. This audit does not prescribe remediation, does not choose the database
architecture, and does not redesign the authorization model.

1. **RT-023** — cheap, unblocks CI's G-19, and until it lands no database fix
   reaches any environment. **Blocker.**
2. **RT-024** and **RT-025** — the BR-1 trigger gaps. RT-023 must land first for
   the fix to exist in any environment. **RT-024 is a blocker.**
3. **RT-027** — re-point the red-team specs. This is also the fix validation for
   the six findings closed during this audit without their guard executing.
4. **RT-001** — the cheapest single break in the attack chain
   (see `cross-agent-red-team.md`).
5. **RT-010** — the tenancy decision. **Not this audit's call.**
6. **RT-006, RT-009**, then the P2s.

---

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
