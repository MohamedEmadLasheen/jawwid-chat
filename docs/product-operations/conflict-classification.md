# Conflict Classification

**Owner:** AI #8 · **Date:** 2026-09-05 · **Mode:** conformance

The 15 conflicts from `cross-agent-audit.md`, classified by **cause**, not by implementation
preference. The question answered for each is *"what kind of thing went wrong?"* — because
the class determines who can resolve it, and a conflict misfiled as an implementation bug
gets handed to an engineer when it needed a product decision.

## Classes

| Class | Definition | Resolved by |
|---|---|---|
| **PRD VIOLATION** | implementation contradicts an authoritative PRD requirement | owning agent |
| **IMPLEMENTATION BUG** | implementation contradicts its own stated intent | owning agent |
| **ARCHITECTURE CONFLICT** | two valid designs cannot coexist | AI #1 + AI #10 |
| **OPEN PRODUCT DECISION** | the product has not decided | product owner |
| **CROSS-AGENT CONTRACT CONFLICT** | two agents built to incompatible contracts | AI #10 |
| **SUPERSEDED-BRIEF ARTIFACT** | correct against the PDF brief, wrong against PRD v0.1 | owning agent |
| **UNVERIFIED** | cannot be judged today |

**Conformance note.** PRD v0.1 is not on disk. Every "PRD VIOLATION" below is therefore
asserted against `docs/qa/authoritative-scope.md` §3 — AI #5's operative written record —
and is tagged accordingly. None is asserted from my own reading of what the PRD ought to say.

---

| # | Conflict | Classification | Basis | Status |
|---|---|---|---|---|
| **X-01** | Two persistence stacks own the same six tables | **ARCHITECTURE CONFLICT** | locked decision 2026-09-05: one standalone PostgreSQL, SQL migrations authoritative | **DECISION MADE** — execution owned by AI #1 + AI #10. See `database-divergence.md` |
| **X-02** | `contact.can_message` default `false` vs `true` | **IMPLEMENTATION BUG** | a permission default diverging between two writers of the same column | **FIXED** — Prisma default removed; DB default governs |
| **X-03** | Config key namespaces diverge; Node fails quiet, SQL fails loud | **IMPLEMENTATION BUG** | brief §12 and both stacks' own comments require config-driven constants; `app-config.service.ts:52` substitutes hardcoded literals | **CONFIRMED OPEN** — AI #2 |
| **X-04** | Thread-level `RESOLVED` vs "a conversation is never resolved" | **CROSS-AGENT CONTRACT CONFLICT** | AI #6 `terminology.md` §2 is authoritative for UI vocabulary; AI #2 shipped a competing lifecycle | **PARTIALLY RESOLVED** — `chat.conversation.state` is now explicit and its comment defers case status to the ops domain. Node DTO still infers. **UNVERIFIED** whether any writer sets it correctly |
| **X-05** | `WAITING_ON_CUSTOMER` inferred from who spoke last | **IMPLEMENTATION BUG** | contradicts the state's own operational meaning; no PRD requirement needed to establish this | **FIXED in SQL** (stored column) · **CONFIRMED OPEN in Node** |
| **X-06** | One Student Group thread per family vs one per learner | **PRD VIOLATION** *(vs `authoritative-scope.md` §3 "Student Groups")* | a two-child family cannot hold two official groups | **FIXED in SQL** (`conversation_one_group_per_learner`) · Prisma still carries the old constraint |
| **X-07** | `jawwidSupport` **and** `adminDirect` both reachable by a parent | **OPEN PRODUCT DECISION** (OD-05) | the PRD's channel list is not on disk; both readings are defensible | **UNVERIFIED — PRD SOURCE NOT PRESENT** |
| **X-08** | Teacher barred from all family communication vs teacher as an app user | **SUPERSEDED-BRIEF ARTIFACT** | the brief's back-office `academic` staff and the PRD's classroom teacher were conflated; correct against the brief, wrong against `authoritative-scope.md` §3 | **PARTIALLY FIXED** — `ActorKind.TEACHER` exists; identity is a declared temporary seam (CF-08) |
| **X-09** | `FamilyDetail.capabilities` consumed by AI #4, produced by nobody | **CROSS-AGENT CONTRACT CONFLICT** | AI #4 built to a contract AI #1/#2 never accepted | **CONFIRMED OPEN** |
| **X-10** | Super Admin / CRITICAL workload in role briefs, rejected in code | **OPEN PRODUCT DECISION** (OD-06) | vocabulary divergence between role assignments and the built system | **UNVERIFIED — PRD SOURCE NOT PRESENT** |
| **X-11** | 3-state vs 4-bucket attention vocabulary | **OPEN PRODUCT DECISION** (OD-06) | same cause as X-10 | **UNVERIFIED — PRD SOURCE NOT PRESENT** |
| **X-12** | `message` append-only (SQL) vs mutable soft-delete (Prisma) | **ARCHITECTURE CONFLICT** | resolved in principle by the locked decision; the SQL stack's own `20260905093000` adds `deleted_at`/`redacted_reason` **columns**, so the two intents must be reconciled deliberately, not by default | **CONFIRMED OPEN** — AI #1 |
| **X-13** | `userId` means `Contact.id` in one place and `Contact.appUserId` in another | **IMPLEMENTATION BUG** | internal inconsistency within one stack | **SUPERSEDED BY REFACTOR** — `actor_id` is now uniform in the SQL stack; re-verify when the Node layer is rebuilt |
| **X-14** | Delivery audience resolves to the owner, not the handler | **IMPLEMENTATION BUG** | contradicts the operating model that both the brief and `authoritative-scope.md` §3 carry forward | **SUPERSEDED BY REFACTOR** — requirement restated as CF-01 |
| **X-15** | Supabase/RLS assumptions vs a Nest service with its own Postgres | **ARCHITECTURE CONFLICT** | resolved in principle by the locked decision; the *authorization strategy* (RLS as primary control vs defence in depth) is still undeclared | **CONFIRMED OPEN** — AI #1 + AI #7 |

---

## Distribution

| Class | Count | IDs |
|---|---|---|
| ARCHITECTURE CONFLICT | 3 | X-01, X-12, X-15 |
| IMPLEMENTATION BUG | 5 | X-02, X-03, X-05, X-13, X-14 |
| CROSS-AGENT CONTRACT CONFLICT | 2 | X-04, X-09 |
| OPEN PRODUCT DECISION | 3 | X-07, X-10, X-11 |
| PRD VIOLATION | 1 | X-06 |
| SUPERSEDED-BRIEF ARTIFACT | 1 | X-08 |
| UNVERIFIED | 0 (3 carry the PRD-absent tag) | — |

**Reading.** Only one conflict is a genuine PRD violation, and only one is a
superseded-brief artifact. The bulk — 8 of 15 — are implementation bugs and cross-agent
contract conflicts, i.e. **coordination failures, not comprehension failures.** That is
consistent with the diagnosis: the agents understood their briefs; they did not share one.

Three conflicts (X-07, X-10, X-11) cannot be closed without PRD v0.1 and must not be
guessed. They are vocabulary and channel-shape questions where both readings are defensible.
