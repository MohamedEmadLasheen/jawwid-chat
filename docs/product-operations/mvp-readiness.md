# MVP Readiness Report

**Owner:** AI #8 · **Date:** 2026-09-05 · **Assessment scope:** product and operations
(AI #5 owns the security/QA gate in `docs/qa/release-gate.md`, which reads **NOT READY**).

---

# 🔴 NOT READY — RECONCILIATION BLOCKED

**Status reaffirmed 2026-09-06.** READY and READY WITH KNOWN RISKS are both unavailable until
reconciliation completes. The immediate objective is not features: **one PRD · one database ·
one domain model · one authorization model · one realtime contract · one isolated integration
process.** Feature implementation resumes only after that.

Blocking, as of pass 3: **CF-09** (Core DB coupling) · **CF-08** (teacher identity) ·
**RC-01** (no API process) · **NF-02 / RT-023** (no branch builds a database) ·
**RT-005 / RT-007 / RT-008 / RT-024 / RT-025** (open security findings) · shared-worktree
isolation (`docs/release/worktree-isolation.md`).

Not as a judgement of the work — the documentation and the code that exists are of high
quality — but as a statement of fact: **the operating model that distinguishes Jawwid Chat
from WhatsApp has no runtime.** Ownership transfer, coverage resolution, attention, workload,
cases, tasks, follow-ups, handoffs and the Unattended list exist as config rows, TypeScript
types and endpoint constants. The only executable HTTP surface in the repository is a health
check and a realtime gateway.

This is an *early-stage* NOT READY, not a *broken* one. The right question today is not
"what do we fix" but "which four decisions unblock everything else" — R-01, R-02, R-07 and
OD-01.

---

## Assessment by dimension

| Dimension | State | Evidence |
|---|---|---|
| Product completeness | 🔴 | 11 of the 19 capabilities in `discovery.md` §4 have no runtime; 4 more are `/// DESIGN-ONLY` |
| Operating model | 🔴 | `on_duty()` is a stub returning the owner; the model is untested |
| Ownership | 🟠 | schema is correct; `transfer_ownership()` does not exist; no offboarding |
| Coverage | 🔴 | tables exist, engine does not; the covering admin is not in the audience |
| Workload | 🔴 | config seeded, no engine, no breakdown, staleness undecided |
| Attention | 🔴 | 8 of 14 signals have no producer; the largest weight can never fire |
| Conversation state | 🟠 | computed not stored (right); mislabels Jawwid's own obligations |
| Customer lifecycle | 🔴 | `family.state` has no writer; 5 of 6 states unreachable |
| Tasks and follow-ups | 🔴 | no `case`, no `task`, anywhere |
| Renewals | 🔴 | `chat.subscription` has no producer; no lifecycle trigger |
| Escalation | 🔴 | a label and an audit row; notifies nobody |
| Student Groups | 🔴 | `/// DESIGN-ONLY`; cardinality breaks multi-child families |
| Approvals | 🔴 | `/// DESIGN-ONLY`; approver-when-off-duty undecided |
| Notifications / reminders | 🟠 | strong schema (dedupe key, quiet hours, VoIP tokens); no worker |
| Calling | 🔴 | `/// DESIGN-ONLY`; missed-call follow-up undefined |
| Multi-child families | 🔴 | one group thread per family; no per-learner case tagging |
| Admin workflows | 🟠 | contract fully specified by AI #4; no server behind it |
| Manager workflows | 🔴 | no dashboard input exists: no workload, no coverage engine, no Unattended |
| Cross-agent consistency | 🔴 | 15 conflicts, 4 of them P0; nothing merged to `main` |
| Unresolved decisions | 🔴 | 7 blocking |

Legend: 🟢 ready · 🟠 partial, known risk · 🔴 not ready.

---

## What is genuinely strong — protect it

1. **Phone privacy by construction.** `Actor` has no phone field and `Contact` has no phone
   column, so the communication engine has no code path that can obtain one. This is the
   strongest available form of the control (AI #5 PF-1). Preserve it through the
   conversation-model refactor and extend it to call signalling.
2. **One centralized `AuthorizationService`**, with an explicit "no controller, gateway or
   worker decides for itself" contract (PF-2).
3. **`on_behalf_mode` derived, never trusted** for OWNER vs COVERAGE (PF-4) — with the
   manager exception that R-06 closes.
4. **Message integrity**: per-thread monotonic `seq` under a row lock, `clientMessageId`
   idempotency with P2002 recovery, and a transactional outbox. Correct by design.
5. **No priority column, no queue table, no round-robin, no "least loaded"** anywhere. The
   brief's hardest architectural constraints have been respected under pressure.
6. **A vocabulary that refuses to lie**: no score in the UI, no "assigned to", *transfer*
   reserved for ownership, `top_reason` as a sentence (AI #6).
7. **The "this order is wrong" calibration button**, built into MVP by AI #4 unprompted —
   the mechanism that turns the brief's initial hypotheses into real weights.
8. **AI #5's escalation of the scope conflict.** The divergence was caught by a QA agent
   reading code, not by a post-mortem. That is the process working.

---

## The critical path to READY

**Stage 0 — decisions (days, not weeks).** R-01 (PRD on disk), OD-01 (conversation model),
OD-02 (one database), OD-03 (admin presence in groups). Nothing else should start.

**Stage 1 — integrate.** R-03: merge to `main` behind CI. Every defect in this report is
currently invisible.

**Stage 2 — make responsibility correct.** R-04 (audience follows the handler), R-05
(stickiness), R-06 (assist gate), R-15 (`transfer_ownership` + trigger), the real `on_duty()`,
R-14 (Unattended). After this stage the sentence *"exactly one person is responsible for this
family right now, and they know it"* becomes true.

**Stage 3 — make work visible.** R-09 (`case` + `task`), R-13 (handoffs + away summary),
R-10 (conversation state), R-16 (Core sync). After this stage nothing can be silently
forgotten.

**Stage 4 — make it rankable.** R-08 (attention on live signals only), R-11 (workload with
decay and breakdown), R-17 (scoped inbox), manager dashboard.

**Stage 5 — the PRD's added surface.** Student Groups (R-07 cardinality first), teacher
identity, approvals (R-19 decided first), calling (R-18).

**Stage 6 — re-audit.** Re-run the five simulations in `simulations.md` against running code.
Everything in this report is static analysis until then, and static analysis is optimistic.

---

## Conditions for "READY WITH KNOWN RISKS"

Reachable at the end of Stage 4 **if** the following hold:

- zero open P0 in this report and in `docs/qa/defects.md`;
- the five simulations pass against running code;
- `current_handler()` returns exactly one staff member or an explicit Unattended for 10 000
  random `(family, instant)` pairs;
- no attention or workload signal is in `config` without a producer;
- a renewal case survives a full coverage cycle without being resolved, re-dated or losing
  its owner;
- a three-child family holds three group conversations, one family conversation, one owner;
- every blocking decision in `open-decisions.md` is closed in `decision-log.md`.

Student Groups, approvals and calling may ship behind a flag in a pilot **only** if BR-1 is
enforced server-side at creation and at every membership mutation, verified with the
client-side policy disabled (release-gate G-01, BR1-19).
