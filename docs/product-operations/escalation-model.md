# Escalation and Complaint Model Audit

**Owner:** AI #8 · **Date:** 2026-09-05

## 1. The principle, and it is already right

**A complaint is a category, not a priority.** The brief scores `complaint_open` at +25 with
+15 more only when a human sets `severity=high`, and `complaint[severity=high]` is the only
complaint that is automatically `owner_locked`. Nothing auto-classifies text. This is
correct and must survive implementation — the temptation to make every complaint a P1 is
exactly what makes an inbox unreadable.

## 2. Specified escalation triggers (brief §5)

Automatic: unattended family · response target fully breached with no open · complaint
`severity=high` · same case type 3rd time in 30 days · admin at HIGH workload receives a new
NOW item · Friday coverage over the workload threshold.
Manual: a button with a reason · the customer asks for a manager.

## 3. Implementation status

| Piece | Status |
|---|---|
| `escalation_level`, `escalated_to_id` on `case` | ❌ no case table |
| `on_behalf_mode=ESCALATION` | ✅ exists in Prisma, admin-web and mobile enums |
| Escalation is audited | ✅ `message.service.ts` writes an `audit_log` row with a reason for ASSIST/ESCALATION |
| Manager notified of an escalation | ❌ nothing routes it; the manager is not in the audience |
| Any automatic trigger | ❌ all six require engines that do not exist |
| Escalation UI | endpoints + strings only |

**Finding ES-1 (P1):** escalation exists today as a *label on a message* and an audit row.
It does not notify anyone, does not change any state, and does not appear on any surface a
manager reads. An escalation that nobody receives is worse than none, because the escalating
admin believes they have handed the problem over.

## 4. Complaint scenarios traced

| Scenario | Expected | Today |
|---|---|---|
| Mild complaint, replied within target | complaint case, +25, normal handling | no case |
| **Repeated complaint (3rd of a type in 30d)** | automatic escalation | no case history to count |
| Teacher-related complaint | complaint case; teacher never sees it; academic staff may get a task | no cases; teachers are not actors at all |
| Payment complaint | billing case + finance task | none |
| Scheduling complaint | schedule case; may be `is_blocking` if a class is imminent | none |
| Angry customer | human sets `severity=high` → `owner_locked` + escalation | severity has nowhere to live |
| High-impact customer | `family.tier=priority` × 1.2 multiplier | ✅ column + config exist; no engine |
| **Complaint with no response for a full target** | escalate | no target engine |

**Finding ES-2 (P1) — the gap the role brief predicted:** a *mild* complaint with **no reply
at all** is the case most likely to be buried. It scores 25 (TODAY) and stays there while
newer unanswered messages (30 + wait) outrank it in NOW. **Recommendation:** add one rule —
*any* complaint with no staff reply for a full response target escalates automatically,
independent of severity. This is the brief's *"response target fully breached with no open"*
trigger, and it must be tested specifically for the low-severity case, which is the one it
was written for.

## 5. Escalation must not move ownership

Escalation moves attention and visibility. `escalated_to_id` is not an owner and not a
handler; the manager acting does not become the owner (`operating-model.md` §7). Two current
defects work against this:

- **FS-02:** a manager who replies becomes the sticky handler for the grace window.
- **FS-12:** the manager's `on_behalf_mode` is client-chosen, so an escalated reply can be
  recorded as `OWNER`.

Both must be fixed or the audit trail will not show who actually intervened.

## 6. Acceptance criteria

1. Escalation writes a case-level state change, an `audit_log` row with a mandatory reason,
   **and** a notification to the manager.
2. All six automatic triggers implemented and individually tested.
3. An escalated case appears on the manager dashboard header with an age.
4. Escalation never changes `family.owner_id` and never sets a sticky handler.
5. Test: a `severity=low` complaint with no reply for a full response target escalates.
