# Workload Audit

**Owner:** AI #8 · **Date:** 2026-09-05

## 1. Status

Specified in the brief §7, seeded into `chat.config` (nine weights, two thresholds,
`workload.reply_burst`), typed in `apps/admin-web/src/shared/types/domain.ts`
(`TeamNowRow`, `WorkloadLevel`), rendered by `Badge.tsx`. **No engine computes it.**

The model's foundation is right and worth defending: workload is a **weighted sum of real
work units**, counted against `on_duty()`, and *"number of families is never part of
workload"*. That single sentence prevents the most common failure in this class of system.

## 2. The inversion this audit was asked to find

> Admin A: 20 conversations, most waiting for the customer.
> Admin B: 8 conversations, 6 needing an immediate reply.

Under the brief's weights as specified:

- **A** = 20 × `active_case` 1.0 = **20.0** → HIGH
- **B** = 6 × `needs_reply` 1.0 + 6 × `active_case` 1.0 + say 2 × `sla_risk` 1.5 = **15.0** → HIGH

Both HIGH, but A's 20 points are dormant and B's 15 are on fire. The manager would offer
help to A. **The model as specified is vulnerable to exactly the inversion the role brief
describes**, because `active_case` is counted with no regard to case status or age, and
`waiting_internal` is the only status given a reduced weight (0.3).

The brief is not wrong so much as incomplete: it lists `waiting_internal 0.3` but says
nothing about `waiting_customer`.

## 3. Recommendation — staleness and status decay

**[AI #8 RECOMMENDATION — needs a product decision, OD-07]**

| Rule | Proposed | Rationale |
|---|---|---|
| A case in `waiting_customer` weighs `active_case × waiting_customer_factor` | **0.3** *(initial hypothesis)* | it is real work, but not work *today* |
| A case in `waiting_customer` whose last customer contact is older than `workload.stale_days` weighs | **0** *(default 7 days, initial hypothesis)* | after a week of silence it is a follow-up, not a load |
| A case in `scheduled` with `due_at` in the future weighs | **0** until 24h before due | scheduled work is not current work |
| `needs_reply` | keep 1.0, and add `+1.0` when the response target is breached | doubles the weight of the only unit a customer can feel |

Every number above is an **initial hypothesis**, seeded in `config`, to be replaced from
`event_log` after 60–90 days exactly as the brief prescribes.

## 4. Other findings

| # | Finding | Sev |
|---|---|---|
| **WL-1** | Workload has no engine, so the manager dashboard, the assist gate and the "HIGH admin receives a NOW item" escalation all have no input | **P1** |
| **WL-2** | `waiting_customer` cases carry full `active_case` weight → the inversion in §2 | **P1** |
| **WL-3** | **Workload is not explainable.** `TeamNowRow` carries `workload_score` and `workload_level` and no breakdown. A manager cannot answer *"why is Rehab HIGH?"* — and a number a manager cannot explain is a number they will stop trusting | **P1** |
| **WL-4** | Covered families "count fully on the coverage admin during her shift" (brief §7) — correct, but with `familyThreadAudience` excluding coverage (FS-01), the covering admin will carry the load without receiving the messages | **P0** *(compounding)* |
| **WL-5** | `capacity_override` exists on `chat.staff` with no defined semantics: does it override the score, the MEDIUM threshold, or the HIGH threshold? Undocumented and unread | **P2** |
| **WL-6** | No gaming analysis. Every unit is derived from case/thread state that the admin controls: closing a case early, or marking it `waiting_customer`, reduces measured load. This is acceptable **only** because workload never routes work — it advises a human. That property must be protected: **workload must never become an input to automatic assignment** | **P2** |

## 5. Making workload actionable

A workload number earns its place only if it changes what the manager does. Required:

1. Every score renders **with its breakdown** — "Rehab 16.4 = 6 waiting replies · 2 breached ·
   1 complaint · 3 renewals" — beside the number, in the same view.
2. A HIGH level must offer the four bounded actions from `operating-model.md` §4: assist,
   activate backup, extend a coverage window, transfer ownership.
3. Levels must be **rare**. If everyone is HIGH every afternoon, the level carries no
   information; that is a signal to recalibrate the thresholds, not to add a CRITICAL level
   above them (OD-06).

## 6. Acceptance criteria

- `workload(admin, now)` computed server-side from `config`, never client-side (G-22).
- The API returns `{score, level, breakdown[]}`; the UI never re-implements the sum.
- `waiting_customer` and stale-case handling implemented per OD-07's decision.
- Changing a weight in `config` changes the dashboard within one cache TTL, with no deploy.
- A test asserts a high-count/low-urgency admin scores **below** a low-count/high-urgency one.
