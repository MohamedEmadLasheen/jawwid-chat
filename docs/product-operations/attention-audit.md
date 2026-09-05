# Attention Audit

**Owner:** AI #8 · **Date:** 2026-09-05

## 1. Status

Fully specified (brief §6), fully seeded (24 keys in `chat.config`), fully typed
(`AttentionBucket`, `InboxRow.top_reason`), and rendered by `InboxRowItem.tsx`.
**No engine computes it.** MVP is rule-based, as required — no AI anywhere, correctly.

Three design choices are right and must be preserved:

- **Attention is computed, never stored or user-entered** — no `priority` column exists.
- **The score has no UI representation** (`terminology.md` §4). Admins see a section and a
  sentence, never a number. This is what keeps the model honest under recalibration.
- **`top_reason` is a sentence** — *"class started 5 minutes ago"* — so the ranking explains
  itself.

## 2. The dead-signal problem

| Signal | Points | Source | Producer exists? |
|---|---|---|---|
| Class in progress / within 30 min | **+40** | `learner.next_class_at` | ❌ — the migration says it stays *"null while Core has no class schedule to sync"* |
| Payment failed within 48h | +20 | `chat.subscription.last_payment_status` | ❌ no sync |
| Renewal due / urgent | +10 / +25 | `chat.subscription.renewal_due_at` | ❌ no sync |
| Complaint open (+high) | +25 / +15 | `case` | ❌ no case table |
| Same case type within 30d | +15 | `case` | ❌ |
| Response target 70% / breached | +20 / +40 | `case` + targets | ❌ |
| Follow-up due now | +10 | `case.due_at` | ❌ |
| Family state `at_risk` | +15 | `family.state` | ✅ column exists, ❌ no lifecycle engine writes it |
| Blocking issue | +35 | `case.is_blocking` | ❌ |
| Manual urgent / escalated | +50 | `family.manual_flag` | ✅ column exists |
| Customer message unanswered | +30 +1/min (cap 40) | `thread` | ✅ **the only fully-available signal** |

**Finding AT-1 (P0):** on the data that exists today, `attention()` reduces to
*"unanswered, ordered by wait"*. Every family with an unanswered message scores 30–70 and
lands in NOW or TODAY; nothing else can differentiate them. That is not a priority model —
it is a FIFO queue with extra steps, and it is materially worse than the WhatsApp it
replaces, because WhatsApp at least shows the message.

**Recommendation:** do not ship the attention engine before at least the case table and the
subscription sync. If they cannot land, cut the model to the signals that can fire, rebalance
the weights, and say plainly that this is a reduced MVP (OD-13). Shipping a 14-signal model
running on 2 signals will produce 60–90 days of calibration data that is worthless.

## 3. False urgency, missed urgency

| Pattern | Cause | Effect |
|---|---|---|
| **Priority inflation** | `unanswered_base` 30 + wait cap 40 = 70 alone ⇒ ≥ NOW (60) after ~30 min | after an hour offline, *every* waiting family is NOW; the section stops ranking |
| **Missed urgency** | a blocking issue with **no unanswered message** scores 35 ⇒ TODAY, not NOW | a parent who told us yesterday they cannot join today's class ranks below a routine question asked 40 minutes ago |
| **Bucket ambiguity** | AMB-2: high score coinciding with "waiting on family" | the same family sorts differently in two implementations |
| **Renewal invisibility** | renewal at 3 days = 25 ⇒ TODAY at best, and only *"owner only"* | during coverage, the highest-value commercial event in the model is not shown to the person on duty |

**Finding AT-2 (P1):** the wait component alone can reach the NOW threshold, so during any
backlog the buckets collapse. **Recommendation:** cap the *total* contribution of the
unanswered signal below the NOW threshold (e.g. base 30 + wait cap 25 = 55), so that
reaching NOW always requires a second, substantive signal. Numbers are hypotheses; the
structural rule is the point.

**Finding AT-3 (P1):** `renewal_urgent` being *"owner only"* means a renewal at 3 days is
invisible to the covering admin who is handling the family tonight. Recommendation: show it
to the Current Handler; keep the **action** owner-locked. Visibility and authority are
different things.

## 4. Preserve

`OrderFeedbackDialog.tsx` and `inboxApi.orderFeedback` implement the brief's *"this order is
wrong"* button, recording what the admin would have done. This is the mechanism that turns
the initial hypotheses into real weights, and AI #4 built it into MVP unprompted. Keep it,
and make sure it records the **full signal vector** at the moment of the complaint, not just
the position — otherwise the calibration data cannot be replayed.

## 5. Acceptance criteria

- Attention computed server-side from `config`; no client re-implementation (G-22).
- `top_reason` returned as key + params, localised per `terminology.md` §8.6.
- Bucket precedence for "high score but waiting on family" decided (AMB-2) and tested.
- Recompute cadence defined (AMB-7): event-driven on message/case change, plus a sweep at
  most one minute stale for time-based terms.
- A test asserts a blocking issue with no unanswered message outranks a 40-minute-old
  routine question.
