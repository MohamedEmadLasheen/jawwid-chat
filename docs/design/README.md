# Jawwid Chat — Design

Owner: **AI #6 — Product UX/UI Architect**
Status: **DESIGN PACK COMPLETE — AWAITING SYSTEM INTEGRATION** (frozen 2026-09-06)

This directory is a **design / UX conformance artifact**. It is **subordinate to the approved
Jawwid Chat PRD v0.1** and defines no product scope, data model, authorization or architecture.
If an implementation question is about *what the user experiences*, the answer is here. If it is
about *how the backend behaves*, it is not.

| Read first | |
|---|---|
| [`scope-authority.md`](scope-authority.md) | **Source-of-truth hierarchy.** What this pack decides and what it does not. |
| [`FREEZE.md`](FREEZE.md) | Final decisions · open questions · backend contracts required · Admin Web reconciliation · blockers owned by others. |

## Start here

| File | What it settles |
|---|---|
| [`discovery.md`](discovery.md) | What exists, the vocabulary reconciliation (**§5**), the open product decisions (**§6**), and the live cross-agent contradiction (**§4**) |
| [`terminology.md`](terminology.md) | Every concept's English and Arabic name, and the rules for using them |
| [`design-system.md`](design-system.md) | Tokens, typography, components, states, responsive, accessibility |
| [`cross-platform.md`](cross-platform.md) | Everything Flutter and Admin Web must agree on, exactly |
| [`user-journeys.md`](user-journeys.md) | 24 end-to-end journeys, including the critical routing, coverage and approval ones |
| [`decisions.md`](decisions.md) | 18 design decisions with their rationale, cost, and what would reverse them |
| [`design-qa.md`](design-qa.md) | The pass/fail checklist |
| [`token-reconciliation.md`](token-reconciliation.md) | Mobile tokens are the reference; what Admin Web must align |

## Handoffs

- [`handoff-mobile.md`](handoff-mobile.md) → AI #3
- [`handoff-admin.md`](handoff-admin.md) → AI #4
- [`handoff-qa.md`](handoff-qa.md) → AI #5

## Screens

**Staff (Admin Web)** — [inbox](screens/admin-inbox.md) · [conversation](screens/admin-conversation.md) ·
[family 360](screens/family-360.md) · [tasks & follow-ups](screens/tasks.md) ·
[coverage](screens/coverage.md) · [change owner](screens/ownership.md) ·
[manager dashboard](screens/manager-dashboard.md) · [workload](screens/workload.md)

**Family & teacher (Flutter)** — [parent home](screens/parent-home.md) ·
[parent chat](screens/parent-chat.md) · [student group](screens/student-group.md) ·
[teacher home](screens/teacher-home.md) · [teacher chat](screens/teacher-chat.md)

**Shared** — [sign in](screens/auth.md) · [notifications](screens/notifications.md) ·
[settings](screens/settings.md) · [approvals](screens/approvals.md) · [calls](screens/call.md)

## Status

**Ready to build:** every staff screen, parent home, parent chat, sign in, notifications,
settings, and the design system in full.

**PRD MVP scope, blocked on decisions owned by others** — build these against the contracts in
each spec's final section, not on the strength of this pack alone:

| Screen | Blocked on | Owner |
|---|---|---|
| `screens/approvals.md` | **OQ-1** — who the authorized approver is | product owner → AI #1 / AI #2 |
| `screens/teacher-home.md`, `screens/teacher-chat.md` | **C-1 / OD-04** — no teacher principal exists | AI #1 |
| `screens/student-group.md` | **C-2 / OD-01** — the conversation model must carry one group **per student** | product owner → AI #1 / AI #2 |
| `screens/call.md` | **JC-001** — implementation status only; **calling is MVP scope** | integration / release authority |

**Standing risk:** PRD v0.1 is not in the repository. This pack was conformed against
`docs/qa/authoritative-scope.md`, AI #5's written record of PRD scope. A conformance re-check
against the PRD itself is required — `FREEZE.md` §5, **B-1**.

**Awaiting brand sign-off:** the colour values and type stack in `design-system.md` §2–§3. Token
*names* are final, so a brand swap changes two files (`lib/design/tokens.dart`,
`apps/admin-web/src/core/theme/tokens.css`) and no screens.

## The four rules everything else derives from

1. **Make the next correct action obvious.**
2. **The Primary Owner is permanent and always visible; the Current Handler is additive, never a replacement.**
3. **Attention is a sentence, never a number.**
4. **Internal content is unmistakable, and never reaches a family.**
