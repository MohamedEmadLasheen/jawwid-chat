# Red Team → Release · Handoff to Agent #10

From: AI #9 (Adversarial Red Team) · 2026-09-06
Evidence: [`findings.md`](findings.md) · Status: **EVIDENCE FROZEN**

This is the release-decision list. Every item is either **resolved** (the
invariant holds and a test proves it) or **explicitly accepted** (a named owner
records that the risk ships). Nothing may reach release in an undecided state.

**Red team position: RED TEAM FAILED.** Five confirmed P0s, three of them proven
by execution. This document does not prescribe remediation, does not choose the
database architecture, does not redesign the authorization model, and does not
touch the PRD. Those are Agent #10's calls and AI #1's work.

---

## 1. Release blockers — must be RESOLVED, acceptance is not available

| ID | Finding | Why it cannot be accepted |
|---|---|---|
| **RT-023** | The migration series cannot apply to an empty database — `chat.family`, `chat.staff`, `chat.learner`, `chat.thread`, `chat.message` are referenced by foreign keys and created by no migration. | No environment can be built from the repository. Every database-level control — the BR-1 triggers, the append-only log triggers, the message-immutability trigger, the approval constraints — is installed **nowhere**. Accepting this would be accepting that no reviewed control exists in production. CI's own G-19 gate cannot pass. |
| **RT-024** | The BR-1 database backstop is bypassed by mutation: a legal Student Group is promoted to a teacher↔parent 1:1 channel with one `UPDATE chat.conversation SET type='direct'`. Calling has the identical bypass. | BR-1 is the product's constitutional rule. The control was built specifically to hold when the API is compromised, and its own comment claims it does. Proven by execution against Supabase Postgres 17.6. |

**Blocker exit criteria.** `bash scripts/db/test-db.sh reset` succeeds on an
empty volume and is a no-op on re-run; G-19 is green; and the BR-1 invariant
raises on the **type-change path** as well as the insert path, for
`chat.conversation` and `chat.call` alike.

---

## 2. Must be resolved or explicitly accepted before release

Each row needs a decision recorded against it. "Explicitly accepted" means a
named owner, a stated reason, and a date — not silence.

### P0 — accept only with an owner's signature

| ID | Finding | Status | If accepted, what ships |
|---|---|---|---|
| **RT-001** | The only runtime entry point takes self-asserted identity: `auth.userId` from the WebSocket handshake is treated as an authenticated principal. | CONFIRMED (static) | A complete authentication bypass. Every other control is downstream of an identity the caller chooses. Acceptable **only** if the gateway cannot start outside local — that guard does not exist today. |
| **RT-002** | Authorization is a function of `familyId` alone; thread kind and participant set are outside the contract's type signature, so BR-1 is unexpressible. | CONFIRMED (runtime) · **largely addressed by the uncommitted refactor** — `canRead(actor, conv, membership)` now requires live membership. | Re-verify against the refactor once committed, then close or re-open. Do not close it on the strength of uncommitted code. |
| **RT-026** | The running application targets the schema *without* the BR-1 backstop: no TypeScript references `chat.conversation`. | CONFIRMED (static) · the uncommitted refactor is the fix in progress | Until it lands, **no statement of the form "BR-1 is enforced" is true of the running system**, and the release gate should say so in those words. |

### P1 — nine findings

| ID | Finding | Status | Regression |
|---|---|---|---|
| **RT-004** | `on_behalf_mode` asserted with no basis — **post-refactor it stamps `OWNER` on families the actor does not own**. | CONFIRMED | **YES — see §3** |
| **RT-003** | A manager stamps any `on_behalf_mode` they request, `OWNER` included. Survived the JC-005 fix and the refactor. | CONFIRMED (runtime) | No |
| **RT-005** | Storage URL signing falls back to a literal committed to git; the variable is in neither `.env.example` nor any environment document. | CONFIRMED (runtime) | No |
| **RT-006** | `signUrlsForMessages(messageIds)` takes no actor — object-level authorization absent by shape. | CONFIRMED (static) | No |
| **RT-007** | Attachment MIME, size and object key are persisted verbatim; the validator is never called on the send path. | CONFIRMED (runtime + static) | No |
| **RT-008** | A parent can forge a `SYSTEM` / `AUTOMATION` message; `type: SYSTEM` bypasses all content validation. | CONFIRMED (runtime) | No |
| **RT-009** | A realtime session never re-evaluates identity: offboarding does not offboard. | CONFIRMED (static) | No |
| **RT-025** | BR-1's "required admin presence" is unenforced; `class_group` is outside the trigger's scope entirely. | CONFIRMED (runtime) | No |
| **RT-010** | Two divergent database architectures are committed simultaneously, one placing Jawwid Chat inside the Jawwid Core database. | CONFIRMED (static) | No |

> **RT-010 is a product-owner decision, not a red-team one.** This audit
> deliberately does not choose. But RT-002, RT-024 and RT-026 all resolve
> differently depending on the answer, so the decision gates them.

### P2 — five findings

RT-011 (probe-based list authorization), RT-012 (receipt roster discloses staff
ids and read times to contacts), RT-013 (internal-note existence announced over
realtime — CONFIRMED in contract, UNVERIFIED at runtime, no drain worker yet),
RT-014 (authorization decided outside the transaction that acts on it),
**RT-027** (see §3).

### P3 — seven findings

RT-016, RT-017, RT-018, RT-019, RT-020, RT-021, RT-022. Hardening. Acceptable to
ship with a recorded decision. **RT-020** is worth reading before accepting: seven
documents cited as authoritative by code do not exist, and RT-005 is a direct
consequence of one of them.

### Closed

**RT-015** — closed by `bf279a7`; CI now exists. Kept in the record as evidence
that the control was added, not deleted as though it never applied.

---

## 3. Refactor regressions — do not let these be absorbed

A large refactor is **uncommitted in the working tree**: Prisma remapped onto the
`chat` schema, `Conversation` / `ConversationMember` / `Call` models,
`thread.service.ts` deleted. It is genuinely good work and it closes RT-002 and
RT-026. It also introduces two regressions that must be handled **in the commit
that lands it**, not after.

### RT-004 — worsened by the refactor

`deriveMode` is now `private deriveMode(actor, _conv, fallback) { return fallback; }`
— the ownership comparison is gone and both parameters are unused. Every internal
note by any family-facing admin is stamped **`OWNER`**, on every family, whoever
owns it. Before the refactor it was `COVERAGE`: unjustified, but at least
distinguishable from ownership. This writes an affirmative false ownership claim
into `audit_log`.

The trap: the pre-refactor proof for RT-004 lives in `authz-attacks.spec.ts`
§RT-004, and that spec stops compiling the moment the refactor lands (RT-027).
**The finding and its evidence would disappear in the same commit.** That is why
it is called out here separately.

### RT-027 — the security regression tests are not running

`npx jest --selectProjects unit` → **6 failed, 1 passed**, all six
`Test suite failed to run` on `TS2305` / `TS2820`. The six include AI #5's
JC-005 and JC-006 conformance suites and both red-team specs.

While this persists, CI's `npm run test:unit` cannot distinguish *"the invariant
holds"* from *"nothing ran"*, and RT-002, RT-003, RT-004, RT-005, RT-007 and
RT-008 have no automated evidence.

**Required before the refactor is committed:** re-point the specs at the new
`AuthorizationService` API. Imports, the `Actor` shape and the vocabulary
constants change. **The assertions do not.**

---

## 4. The rule that governs every fix

`apps/api/test/unit/red-team/` holds **security regression tests**. They assert
observed insecure behaviour so each finding is graded CONFIRMED rather than
THEORETICAL. Because CI now runs them, **fixing a finding turns CI red — by
design.**

> A fix must make the invariant hold, and invert the assertion in the same
> commit. A test must never be deleted, skipped, renamed away, or weakened
> because the implementation fails it.

A red-team spec relaxed to go green is a regression in the audit, not a fix in
the product. Both specs are currently intact and unmodified in substance.

---

## 5. What this audit could not test, and why

Not clearances — untested surfaces:

| Area | Blocked by |
|---|---|
| HTTP-layer attacks (REST IDOR, CORS, CSRF, rate limiting) | No `main.ts`, no `AppModule`; `/health` is the only controller. `applyInfrastructure()` is written, correct, and called by nothing. |
| Chaos / recovery, queue and worker attacks | Nothing to kill: `docker-compose.yml` provisions Postgres, Redis and MinIO but no API container. No queue, worker or job exists. Database-layer chaos *was* possible and produced RT-023/024/025. |
| Notification, calling and search attacks | `notifications/` and `handoff/` are empty directories; calling is DESIGN-ONLY (JC-001); no search exists. |
| Jawwid Core integration attacks | No integration code; `CORE_*` environment variables only. Webhook replay, ordering and authenticity are all unaddressed. |

**Re-run the campaign once the application boots.** The reproduction commands are
in [`README.md`](README.md).

---

## 6. Recommended order — advisory only

1. **RT-023** — cheap, unblocks G-19, and until it lands no database fix reaches any environment.
2. **RT-010** — the database decision. Gates RT-002, RT-024 and RT-026. **Not this audit's call.**
3. **RT-001** — the cheapest single break in the attack chain (`cross-agent-red-team.md`).
4. **RT-004 and RT-027** — before the refactor is committed, not after.
5. **RT-024, RT-025** — with the answer to (2) in hand.
