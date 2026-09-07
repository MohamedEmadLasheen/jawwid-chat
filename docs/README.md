# Jawwid Chat — Documentation Index

**One canonical document per decision.** Everything else is Historical,
Deprecated, Superseded or Reference. Documents carry a `STATUS:` banner at the
top when they are not canonical. When a canonical document and any other
document disagree, the canonical one wins; when code and a document disagree,
**code + executed evidence > documentation > previous reports**.

Phase 0 (reconciliation, 2026-09-07) established this hierarchy. Later phases
add canonical documents only under the five directories below and must update
this index in the same change.

**Product decisions PD-1 to PD-5 were closed on 2026-09-07**, at the Phase 0
exit gate. `product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 is their single record;
no other document may restate or reinterpret them.

## Canonical

| Directory | Document | Decides |
|---|---|---|
| `product/` | [JAWUID-CHAT-PRODUCT-BOUNDARY.md](product/JAWUID-CHAT-PRODUCT-BOUNDARY.md) | what Jawwid Chat is and is not; domain layering; deprecated machinery; **the closed product decisions PD-1..PD-5** (§4); phase map |
| `product/` | [jawwid-chat-prd-v0.1.md](product/jawwid-chat-prd-v0.1.md) | product requirements (PRD v0.1, owner-approved). Read through the boundary document above. |
| `architecture/` | [JAWUID-CHAT-ARCHITECTURE.md](architecture/JAWUID-CHAT-ARCHITECTURE.md) | layers, boundaries, what each may/may not do; storage, realtime, notifications, outbox semantics, Core integration boundary |
| `architecture/` | [IDENTITY-MODEL.md](architecture/IDENTITY-MODEL.md) | accounts, credentials, sessions, devices, teacher identity, lifecycle, offboarding. **Implemented in Phase 1** |
| `architecture/` | [AUTHORIZATION-MODEL.md](architecture/AUTHORIZATION-MODEL.md) | roles, permission keys, `AuthorizationService` decision surface, scope, known defects. **Implemented in Phase 1** |
| `architecture/` | [SUPERVISOR-OWNERSHIP.md](architecture/SUPERVISOR-OWNERSHIP.md) | family → supervisor assignment, reassignment semantics, coverage (PD-3). **Implemented in Phase 1** |
| `architecture/` | [TENANCY-MODEL.md](architecture/TENANCY-MODEL.md) | `organization_id` from day one; per-layer rules; gaps |
| `contracts/` | [API-CONTRACT.md](contracts/API-CONTRACT.md) | the one API contract: inventory, classification, canonical endpoint specs, realtime contract, client migration |
| `contracts/` | [DOMAIN-VOCABULARY.md](contracts/DOMAIN-VOCABULARY.md) | canonical terms, enumerations, aliases, forbidden terms |
| `security/` | [RLS-STRATEGY.md](security/RLS-STRATEGY.md) | how RLS engages (defence in depth behind `AuthorizationService`), connection roles, parity tests. **Engaged in Phase 1; runtime enforcement pending the connection-role change** |
| `recovery/` | [PHASE-0-BRANCH-LEDGER.md](recovery/PHASE-0-BRANCH-LEDGER.md) | freeze snapshot; every branch's disposition; archive tags |
| `recovery/` | [PHASE-0-DATABASE-RECONCILIATION.md](recovery/PHASE-0-DATABASE-RECONCILIATION.md) | every database object classified; invariants; debts; verification record |
| `recovery/` | [PHASE-0-ADMIN-WEB-RECONCILIATION.md](recovery/PHASE-0-ADMIN-WEB-RECONCILIATION.md) | Admin Web classified; vocabulary/contract migration; console direction |
| `recovery/` | [PHASE-0-REPORT.md](recovery/PHASE-0-REPORT.md) | the Phase 0 final report and Phase 1 readiness |
| `recovery/` | [PHASE-1-REPORT.md](recovery/PHASE-1-REPORT.md) | **what Phase 1 actually built and what it deliberately did not** — authentication, sessions, identity, RBAC, scope, tenancy, RLS; the five defects found on the way; the verification record |
| `recovery/` | [PHASE-2-REPORT.md](recovery/PHASE-2-REPORT.md) | **what Phase 2 actually built and what it deliberately did not** — conversations, messaging, realtime delivery, status, reply/quote, edit, delete, reactions, forwarding, search, typing, and the mobile client; the seven defects found on the way; the verification record |
| `recovery/` | [PHASE-3-REPORT.md](recovery/PHASE-3-REPORT.md) | **what Phase 3 actually built and what it deliberately did not** — families, students, teacher-assignment history, groups, supervisors, labels; the one authoritative family lifecycle; the seven defects found on the way; the verification record |
| `qa/` | [protected-tests.tsv](qa/protected-tests.tsv) | the protected security tests (JC-011 guard) — canonical list |
| `red-team/` | [findings.md](red-team/findings.md) | the security findings register (RT-xxx) — canonical status of each finding |

## Reference (valid, read with the canonical documents)

`architecture/decisions.md` (ADRs; ADR-001/005 superseded) · `architecture/core-integration-contract.md` ·
`architecture/organization-model.md` · `communication/README.md`, `realtime-events.md`, `error-codes.md`,
`scope-decisions.md` (D-2 superseded), `mobile-contract.md`, `admin-contract.md`, `test-contract.md`,
`integration-audit.md` · `release/database-decision.md` · `release/od-01-conversation-model.md` ·
`qa/authoritative-scope.md`, `release-gate.md`, `test-plan.md`, `defects.md`, `seams-required.md`, `system-inventory.md` ·
`red-team/*` · `infrastructure/*` (runbooks, environment, secrets, backup/recovery, monitoring) ·
`mobile/*` (architecture, http-integration, testing) · `admin/architecture.md`, `testing.md`, `workflows.md` ·
`design/*` (design system, screens, terminology for display labels) · `product-operations/domain-language.md`.

## Historical (evidence of how decisions were reached; do not build from these)

`JAWWID_CHAT_BRIEF.pdf` / `.txt` (the superseded Customer Success brief) ·
`architecture/backend-contract.md`, `open-contract-decisions.md` · `admin/backend-contract-required.md`,
`future-work.md`, `discovery-report.md` · `integration/*` (nine parallel-agent reconciliation records) ·
`release/handoff.md`, `branch-reconciliation.md`, `worktree-isolation.md`, `od-01-migration-impact.md`,
`blockers.md`, `integration-matrix.md`, `reconnaissance.md`, `release-scorecard.md`, `runtime-integration-dependency-map.md`,
`cross-agent-product-conformance.md`, `domain-reconciliation.md`, `database-authority.md`, `admin-work-classification.md`,
`prd-conformance-v0.1.md`, `realtime-contract-audit.md`, `integration-risk-register.md` ·
`product-operations/*` (audits of the CS operating model; `open-decisions.md` OD-06 overruled) ·
`infrastructure/api-contract-reconciliation.md` · `mobile/discovery-report.md`, `backend-dependencies.md`, `decisions.md`.

## Superseded (wrong in at least one load-bearing statement)

| Document | Wrong about | Superseded by |
|---|---|---|
| `architecture/decisions.md` ADR-001 | "build the brief; no teacher, no groups, no calls" | `product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` |
| `architecture/backend-contract.md` | brief as source of truth; RLS as a live control | `architecture/JAWUID-CHAT-ARCHITECTURE.md`, `security/RLS-STRATEGY.md` |
| `qa/rbac-matrix.md` | role vocabulary (no `super_admin`, `coverage`, departments as roles) | `architecture/AUTHORIZATION-MODEL.md` |
| `communication/scope-decisions.md` D-2 | "chat.thread is kept" | OD-01 migration `20260905094000`, `contracts/DOMAIN-VOCABULARY.md` |
| `admin/architecture.md` | "there is no super_admin" | `architecture/AUTHORIZATION-MODEL.md` |
| `product-operations/open-decisions.md` OD-06 | keep `super_admin` out | PRD §3, PD-5 |

## Deprecated machinery (frozen; removal needs a product decision)

Cases (removed), tasks, shifts/absences/coverage rules, workload and attention
scoring, renewals — `product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §3 and
`recovery/PHASE-0-DATABASE-RECONCILIATION.md`.

## Evidence

`recovery/evidence/uncommitted/` — source rescued from agent worktrees, never
applied. Archived branch heads: `git tag -l 'archive/phase0/*'`.
