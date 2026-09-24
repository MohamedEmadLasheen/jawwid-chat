# Jawwid Chat — Release Gate

Date: 2026-09-05 · Owner: AI #5 · **G-01 re-versioned 2026-09-23 (PD-6)**
Authoritative scope: `docs/qa/authoritative-scope.md` (PRD v0.1) → superseded on BR-1 by **PRD v0.2 / PD-6**
(`docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4)

A release is **BLOCKED** if any gate is failing **or unverified**. The two are
treated identically: an untested control is not a control.

## 1. Current verdict

# 🔴 NOT READY
**Reason: implementation is in progress.**
Scope is settled — PRD v0.1 governs. Additionally, **the repository has two unmerged
migration lineages and the working tree cannot build a database on its own**
(`docs/release/branch-reconciliation.md`). **Five P0 defects remain open**
(JC-001/002/003 scope, JC-009 database architecture, JC-010 silent schema
divergence) and two P1 (JC-007, JC-008). JC-005 and JC-006 were found, fixed and
regression-tested. The integration environment is now executable: 8 tests
passing, 1 failing, and that failure is JC-008 rather than a test defect.

---

## 2. P0 — hard blockers

| # | Gate | Status |
|---|---|---|
| **G-01** | **BR-1 (PD-6): a Teacher↔Parent 1:1 conversation or call exists ONLY for an authorized relationship — enforced server-side AND independently in the database, verified with client-side policy disabled** | **PASS — verified 2026-09-23.** All five proofs below execute. The gate was re-versioned, not weakened: it gained the positive half it never had. Old condition recorded beneath this table. |

**G-01 pass condition, and where each half is proven.** No client is involved in
any of it; every assertion drives the server decision or the database directly,
which is what "with client-side policy disabled" means.

| # | Must prove | Proven by |
|---|---|---|
| 1 | Authorized Parent ↔ Teacher direct communication is **allowed** | `relationship-predicate.spec.ts` §"authorization switch" 1, 2, 3, 3b · `br1_invariants.sql` A2, D5 · `schema-invariants.spec.ts` "PERMITS…" |
| 2 | Unauthorized Parent ↔ Teacher direct communication is **denied** | `br1-conformance.spec.ts` BR1-01/02/03/04 · `relationship-predicate.spec.ts` 1b · `communication-engine.spec.ts` "refuses…" · `br1_invariants.sql` A1, A3, A4, D1, D7 |
| 3 | **Application** authorization enforces the relationship | `br1-conformance.spec.ts` (the policy, in isolation) + the end-to-end block driving `ConversationService`, `MessageService` and `CallService`, which proves each call site actually resolves and passes the fact |
| 4 | **Database** backstop enforces the relationship | `br1_invariants.sql` A1–A4, D1, D5–D7 · `relationship_predicate.sql` H1, H2 · `communication-engine.spec.ts` and `schema-invariants.spec.ts`, both of which write through raw SQL with the API bypassed |
| 5 | Client-side policy **cannot** bypass server or database | Every assertion under 1–4 is server-side or SQL-side. Specifically: `authz-attacks.spec.ts` "a client cannot widen its own authority" (no request field reaches the resolved fact), `relationship-predicate.spec.ts` "client-supplied ids are never evidence" and "anti-bypass", and the raw-SQL inserts in 4, which have no client at all |

Additionally proven, because a gate that only tested the happy direction would
not be testing a boundary: the relationship is re-checked at **media-token
issue**, so revoking it mid-call denies the next token (`relationship-predicate.spec.ts` 6)
while still allowing the call to be **ended** (6b, and `br1_invariants.sql` D6) —
no call is stranded by a revocation.
| **G-02** | Student Groups implemented, with membership derived from Jawwid Core and BR-1 enforced at creation **and** every membership mutation | **FAIL — JC-001** |
| **G-03** | Teacher is a first-class authenticated actor with Teacher↔Admin and group access | **FAIL — JC-003** |
| G-04 | One centralized authorization policy governs messaging **and** calling; no second matrix; **no client-supplied field widens authority** | **PASS — re-assessed 2026-09-24.** Messaging: JC-005 fixed, regression-tested. Calling: `CallService` reaches exactly one decision surface — `AuthorizationService.canCall` — and there is exactly one `AuthorizationService` and one `canCall` in `apps/api/src`. `start`, `issueToken`, `accept` and `decline` all pass through it; `accept`/`decline` re-enter the full chain through `authorizeJoin`. No client field widens authority: the token endpoint takes no room parameter (`call-media-token.spec.ts` K), the participant identity is the resolved actor and not anything supplied (L), and the PD-6 fact is resolved server-side from Core data, never from the request (`relationship-predicate.spec.ts`, "client-supplied ids are never evidence"). |
| G-05 | Approvals: approve / reject / mandatory reason; pending never delivered, pushed, searchable or emitted; no self-approval; concurrent decisions resolve to one state | UNVERIFIED |
| G-06 | Voice calling authorized through the same policy; tokens server-generated, short-lived, room-scoped; unauthorized room join denied | **PARTIAL — re-assessed 2026-09-24.** Four of the five conditions are proven; the fifth is proven on the issuing side only. Breakdown beneath this table. |
| G-07 | **No phone number** in any API response, realtime event, push payload, call setup/metadata/history, search result, log, cache or export | **PARTIAL — re-assessed 2026-09-24.** Structural control guarded in CI (`no-contact-channel-columns.spec.ts`: schema, migrations, Actor seam, DTO/event contracts). **One runtime surface is now covered:** the push payload, asserted on the delivered message rather than on a type — `call-notifications.spec.ts` Q checks `data`, `title` and `body` against `/@|\+\d{6,}/`, and against a JWT, a room name and every media-handle key. The remaining named surfaces — API response, realtime event, call metadata/history, search result, log, cache, export — are **still unverified at runtime**. |
| G-08 | Internal notes unreachable by any parent or teacher through any surface | PARTIAL — contacts and deactivated actors denied (verified, JC-006 fixed); other surfaces unverified |
| G-09 | No cross-family or cross-group access; IDOR sweep clean across every entity id | UNVERIFIED |

**G-06 breakdown, re-assessed 2026-09-24.** The gate states five conditions. They
are not equally proven, and collapsing them into one verdict is how a gate stops
meaning anything.

| # | Condition | Status | Proven by |
|---|---|---|---|
| 1 | Calling authorized through **the same** policy | **PROVEN** | One `AuthorizationService`, one `canCall`. `call-media-token.spec.ts` A–H covers who may obtain a token: unrelated actor, revoked PD-6 relationship, participant who left, participant removed from the conversation, deactivated actor, ended call, ring-timeout-expired call, unknown actor — each denied. `call-accept-decline.spec.ts` proves accept and decline re-enter the same chain |
| 2 | Tokens **server-generated** | **PROVEN** | `call-media-token.spec.ts` J (room name derived from conversation + call), J2 (no two calls share a room), K (the endpoint takes no room parameter), L (identity is the resolved actor), Q (signed server-side; the secret is never in the token) |
| 3 | Tokens **short-lived** | **PROVEN** | `call-media-token.spec.ts` I — the TTL comes from `chat.config['call.token_ttl_seconds']`, the token's `exp` matches it, changing the config changes the token, and no environment variable claims to control it |
| 4 | Tokens **room-scoped** | **PROVEN** | `call-media-token.spec.ts` M (`roomJoin` for exactly one named room), N/O (no `roomCreate`, no `roomList`), P/P2 (publish and subscribe only; no administrative capability), and no `canPublishData` |
| 5 | **Unauthorized room join denied** | **PARTIAL** | The *issuing* half is proven — an unauthorized actor receives no token at all (condition 1). The *joining* half is LiveKit refusing a token that does not name the room, and nothing here has ever asked LiveKit to refuse one. That is a media-plane assertion and needs a real participant connection |

**Why this is PARTIAL and not PASS.** Everything the API controls is proven.
What is unproven is the other party's behaviour: that LiveKit enforces the scope
the token declares. The control-plane probe (`scripts/infra/livekit-probe.sh`)
established that LiveKit accepts a token this codebase mints and that the
credentials are real — it did not, and cannot, establish that a room-scoped
token is refused for a different room, because it never joins one.
`call-media-token.spec.ts` R states this boundary in the suite itself: a signed
token is not evidence that LiveKit works.

**G-06 closes under M4**, with the media plane. Until then the honest reading is:
the authorization and token layers are done and tested; voice calling is not
verified.

> **G-01 — superseded pass condition (in force 2026-09-05 → 2026-09-23).**
> Preserved so the gate's history is auditable, per PD-6.
>
> > **BR-1: no Teacher↔Parent 1:1 messaging or calling exists, enforced
> > server-side, verified with client-side policy disabled (BR1-19)** —
> > *FAIL — JC-008. Materially improved: BR-1 is now a DB constraint trigger and
> > blocks the member path (verified). It does not guard `conversation.type`, so
> > a group converts to a forbidden 1:1 by `UPDATE` (reproduced).*
>
> The JC-008 finding was closed by the RT-024 type-immutability triggers, which
> PD-6 retains unchanged. What PD-6 changed is *which end state is forbidden*,
> not whether the database is allowed to be bypassed.
| G-10 | Realtime delivers only in-scope events; re-authorized on reconnect and on permission change | UNVERIFIED |
| G-11 | Manager-only actions unreachable by admin, coverage, teacher, parent or internal staff | UNVERIFIED |
| **G-44** | `on_duty()` is the sole authority for acting on a family; assist and escalation are gated by server-evaluated preconditions | **FAIL — JC-007**: now fail-closed (not bypassable) but the real predicate is not implemented |
| G-12 | Exactly one Primary Owner per family; ownership changes only via `transfer_ownership()` with audit in the same transaction | UNVERIFIED |
| G-13 | Coverage, handoff and workload never change Primary Ownership | UNVERIFIED |
| G-14 | Exactly one current handler at all times — never two, never zero (Unattended counts) | UNVERIFIED |
| G-15 | No message duplication under retry, reconnect or double-submit; idempotency enforced | UNVERIFIED |
| G-16 | No message loss across restart, reconnect, worker crash or client crash | UNVERIFIED |
| G-17 | `message` / `event_log` / `audit_log` immutable or append-only; audit manager-read-only | UNVERIFIED |
| G-18 | No secrets in source or git history | **PASS** (re-checked each release) |
| G-19 | Migrations apply cleanly forward; rollback defined and tested | PARTIAL — forward apply + idempotency gated in CI **and verified locally against postgres:17**. Requires cross-branch composition: the working tree alone fails with `relation "chat.family" does not exist`. **Rollback still undefined.** |
| G-20 | No real employee or customer data in seed data, fixtures or tests | UNVERIFIED |
| **G-21** | Chat owns its own database; Core integration via the approved boundary; single migration authority | **FAIL — JC-009.** `090900_chat_core_integration` reads `public.profiles` over SQL; `091200_chat_rls` depends on it. Prisma remains a second schema authority. |

## 3. P1 — major workflow gates

| # | Gate | Status |
|---|---|---|
| G-22 | Attention and workload computed server-side from `config`; never client-set; no frontend re-implementation | UNVERIFIED |
| G-23 | No queue, round-robin, or automatic distribution anywhere | UNVERIFIED |
| G-24 | Notifications and reminders: dedupe, status lifecycle, quiet hours, retry, no storms | UNVERIFIED |
| G-25 | Push deep links re-authorized server-side on open; never open unauthorized content | UNVERIFIED |
| G-26 | Tasks and follow-ups; internal staff see only their own tasks and never message families | UNVERIFIED |
| G-27 | Manager Dashboard figures reconcile with backend engines | UNVERIFIED |
| G-28 | Offline queue, reconnect and multi-device convergence | UNVERIFIED |
| G-29 | Contact capability flags enforced server-side for every self-service action | UNVERIFIED |
| G-30 | Core integration failure degrades safely; no fabricated Core data | UNVERIFIED |

## 4. Scope-boundary gates (fail if present in MVP)

| # | Gate | Status |
|---|---|---|
| G-31 | **No** AI attention scoring, drafting, summarization or classification | UNVERIFIED |
| G-32 | **No** video calling | **PARTIAL — re-assessed 2026-09-24.** No video calling is offered or reachable: `CallType` is `{direct, group}` with no video member, the type is immutable in the database (`call_type_immutable`, RT-024), and no client has a video surface. **But the media grant does not forbid it.** `media-token.ts` sets `canPublish` without `canPublishSources`, and LiveKit reads an unrestricted `canPublish` as permission to publish any source, camera included. The product does not do video; the token does not prevent it. Restricting the grant to the microphone source is the control this gate wants and it does not exist yet. **Deliberately deferred to M4, as its first item**, before any LiveKit client reaches the app: the change is `canPublishSources: ['microphone']` in the participant grant, plus extending `call-media-token.spec.ts` P — whose key-set assertion is exhaustive by design, so a new capability cannot be added without being declared there. Deferred rather than done because nothing can exploit it today (no media client exists at all) and it is a functional change to the token, not the preservation of an existing invariant. (The `video: {…}` object in `media-token.ts` is LiveKit's name for the whole grant namespace, not a video capability. Do not read it as one.) |
| G-33 | **No** labels, **no** broadcast | UNVERIFIED |
| G-34 | **No** approval escalation, expiry or coverage-aware approval | UNVERIFIED |
| G-35 | **No** shared queue or automatic routing | UNVERIFIED |

## 5. Process gates

| # | Gate | Status |
|---|---|---|
| G-36 | CI runs typecheck, unit, security and migration validation on every push | **PASS (partial)** — `.github/workflows/ci.yml`: fast release-gate guards (G-18/G-20/G-31..35), API typecheck+unit, Admin Web typecheck+tests, migration apply + idempotency. Integration job self-skips until specs exist; no linter configured in any package yet. |
| G-37 | Every component's toolchain installed and its tests executable in CI (Flutter/Dart still absent) | **FAIL** |
| G-38 | Full E2E suite green (`test-plan.md` §20) | UNVERIFIED |
| **G-45** | Branch reconciliation complete; one migration lineage; no silently-divergent schema objects | **FAIL — JC-010.** Two `chat.event_log` definitions; `create table if not exists` hides the conflict and it surfaces only at runtime. `docs/release/branch-reconciliation.md`. |
| G-39 | Zero open P0; zero open critical P1 | **FAIL — 5 open P0 (JC-001/002/003/009/010), 2 open P1 (JC-007/008)** |
| G-40 | Observability: structured logs, health/readiness, error monitoring with token/PII redaction | UNVERIFIED |
| G-41 | Backup and restore documented **and rehearsed**; RPO/RTO stated | **FAIL — absent** |
| G-42 | Environments separated; no production credentials or debug mode outside production | UNVERIFIED |
| G-43 | Open specification ambiguities resolved (`test-plan.md` §21) — **AMB-9 blocks BR-1 testing** | **FAIL — 9 open** |

---

## 6. Release will FAIL if any of these is true

- Teacher↔Parent direct 1:1 communication or calling is possible by any route
- A phone number is reachable through any product surface
- Unauthorized family, group or conversation access is possible
- Manager permissions are bypassable
- A pending message reaches anyone before approval
- Approval can be bypassed, or rejection accepted without a reason
- Messages duplicate or are lost
- Coverage, handoff or workload changes Primary Ownership
- Production secrets are committed
- Migrations fail, or core E2E flows fail
- Phase 2 functionality (AI scoring, video, labels, broadcast, approval
  escalation) ships in MVP

## 7. Severity policy

**P0** security breach · unauthorized data access · Teacher↔Parent direct
communication · phone leakage · data corruption or loss · broken authentication.
**P1** major workflow broken: approvals, coverage, calling, notifications, Core
integration. **P2** important functional/UX. **P3** minor/cosmetic.

**READY is never declared while any P0 or critical P1 is open.**
