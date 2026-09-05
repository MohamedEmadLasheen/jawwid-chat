# Operational Simulations

**Owner:** AI #8 · **Date:** 2026-09-05

Five realistic operating days, walked step by step. Each states what the system **should**
do and what it **would** do today. Staff names are the brief's: owners Dina, Zeinab, Rehab,
Asmaa; coverage Radwa and Mariam; manager Roqaya.

---

## SIM-1 · Monday 16:52 — the shift boundary

Dina owns 15 families; 3 are waiting for a reply and she has 2 follow-ups due today. Her
shift ends at 17:00; Radwa covers 17:00–23:00.

| Time | Should happen | Would happen today |
|---|---|---|
| 16:30 | Dina sees the wrap-up banner: *"3 families waiting, 2 follow-ups → snooze to my next shift?"* | `ShiftEndBanner.tsx` exists; `inboxApi.shiftBanner()` has no server |
| 16:58 | Dina replies to one family | ✅ message sends; she becomes sticky handler until 17:13 |
| 17:00 | The 2 unanswered families move to Radwa's inbox with handoff cards; the quiet 12 do not move | nothing moves; no handoff is written |
| 17:05 | A customer replies to the family Dina just answered | stickiness correctly keeps it with Dina **but** nothing checks she is online, and she has gone home (FS-03) |
| 17:06 | Another family messages | should notify Radwa; **notifies Dina** (FS-01) |
| 17:13 | Stickiness expires → handoff to Radwa | `currentHandler()` would return Radwa; but no one is told, and no handoff row exists |

**Failure mode:** between 17:00 and 17:13 the two families with the most recent contact are
held by someone who has left the building, and every message that arrives goes to her phone
instead of Radwa's. Neither admin can see this happening.

---

## SIM-2 · Tuesday 10:00 — the workload inversion

Dina 15 families, Zeinab 12, Rehab 18, Asmaa 10. Rehab's 18 are mostly quiet and waiting on
customers. Asmaa's 10 include 6 needing an immediate reply, a breached target and an open
complaint.

| | Rehab | Asmaa |
|---|---|---|
| Brief's weights as specified | ~18 → HIGH | ~15.5 → HIGH |
| What is actually true | quiet | on fire |

Roqaya sees two HIGH admins and no way to tell them apart: `TeamNowRow` carries a score and
a level, **no breakdown** (WL-3). She would most likely help Rehab, who does not need it.

**Fix:** OD-07's staleness rule (Rehab drops to ~6 → LOW) plus a mandatory breakdown beside
every score.

---

## SIM-3 · Wednesday 14:00 — the renewal that disappears

The Hassan family (2 children) has a renewal due in 3 days for the elder child. Owner: Zeinab.

| Should happen | Would happen today |
|---|---|
| T-14: renewal case opens, `owner_locked`, Zeinab notified | nothing — no case table, no lifecycle job |
| T-3: attention +25, family in TODAY, `top_reason` *"renewal in 3 days"* | nothing — `chat.subscription` has no producer (RN-1) |
| Zeinab off sick; Radwa covers | `renewal_urgent` is *"owner only"*, so even with an engine Radwa would not see it (RN-3, AT-3) |
| Renewal lapses | family moves to `at_risk` 14 days later, after the subscription has ended (RN-5) |
| Roqaya's weekly view shows *no reply* | no weekly view |

**Failure mode:** a paying family lapses and the first person to notice is the parent.

---

## SIM-4 · Thursday 19:40 — the two-handler problem

Roqaya is reviewing the evening. She opens a family owned by Asmaa, currently covered by
Radwa, and sends one reassuring reply.

| Should happen | Would happen today |
|---|---|
| The message is labelled *Escalated*; Radwa remains the handler | `canSendMessage` lets the client pick the mode, so it may be recorded as `OWNER` (FS-12) |
| Roqaya's intervention is logged and visible to Radwa | an `audit_log` row is written ✅, but nothing notifies Radwa |
| The family stays in Radwa's inbox | `stickyHandler = Roqaya` for 15 minutes (FS-02) — the family leaves Radwa's handler view |
| The customer replies at 19:45 | goes to Roqaya (sticky) and notifies **Asmaa** (owner, audience) — Radwa, who is on duty, sees nothing |

**Failure mode:** three staff members are involved and none of them is the one who thinks
they are responsible. This is the *"two admins each assume the other is handling it"* failure,
reachable in four steps with today's code.

---

## SIM-5 · Friday 11:00 — coverage, a group message and a multi-child family

Mariam covers **all** owners on Friday. The Ibrahim family has three children, three teachers
and three Student Groups. A teacher posts a message to one group; it requires approval.
Simultaneously the parent asks about a different child's schedule.

| Should happen | Would happen today |
|---|---|
| Three groups exist, one per child | **impossible** — `Thread @@unique([familyId, kind])` permits one (FS-05/X-06) |
| The teacher's message sits pending, visible only to the sender | no approval runtime (FS-19) |
| An on-duty admin approves | undefined who may approve on a Friday (OD-11) |
| The schedule question opens a case on the family conversation, tagged to the right child | no cases; `learner_id` tagging unbuilt |
| One family, one owner, one relationship, three student contexts | the family stays one record ✅ — the **only** part of this simulation that works |
| Mariam's Friday load crosses the threshold → escalation to Roqaya | no workload engine |

**Failure mode:** the multi-child family is the common case, not the edge case, and it is the
case the current conversation model cannot represent.

---

## What the simulations show

1. Every failure traces to one of four causes: **no operating-model runtime**, **the wrong
   person in the audience**, **stickiness applied too broadly**, or **the conversation model
   cannot represent a multi-child family**.
2. None of the four is a coding error. Each is a decision that was made implicitly and needs
   to be made explicitly.
3. All five simulations should be re-run against running code before pilot. Until then they
   are static analysis, and static analysis is optimistic.
