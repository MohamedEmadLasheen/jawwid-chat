# Tasks and Follow-ups Audit

**Owner:** AI #8 · **Date:** 2026-09-05

## 1. Status

**Nothing is implemented.** There is no `case` table, no `task` table, no follow-up
mechanism, in either persistence stack. What exists:

- `Task`, `TaskStatus`, `TaskType` types and `tasksApi` endpoints in Admin Web;
- `taskScopeFor(role)` in `capabilities.ts` (`mine` / `team` / `department`);
- `ShiftEndBanner.tsx` reading a `follow_up_count` from an endpoint that does not exist;
- `attention.points.follow_up_due` and `workload.weights.follow_up_due_today` in `config`;
- `message.caseId` in Prisma — a nullable string with **no foreign key and no table behind it**.

## 2. Why this is the largest MVP gap

Cases and tasks are not one feature among many. They are the substrate for:

| Depends on `case` / `task` | Consequence of absence |
|---|---|
| Follow-ups | nothing can be due; nothing can be overdue |
| `owner_locked` | coverage's central constraint is unenforceable (FS-13) |
| Renewal operations | renewal is a case type — no case, no renewal workflow |
| Complaints and severity | no complaint record, no `severity=high` escalation |
| Escalation | `escalation_level`, `escalated_to_id` live on `case` |
| Response targets | targets attach to a case, not a thread |
| 8 of 14 attention signals | see `attention-audit.md` §2 |
| 6 of 9 workload units | see `workload-audit.md` |
| Department staff (finance/technical/academic) | their entire product surface is the task list |
| Handoff cards ("open cases") | card payload is undefined without cases |
| Calibration logging | *"log per case from day one"* (brief §7) |

**Finding TF-1 (P0):** the case/task layer is a prerequisite for most of the MVP, and it
currently has less implementation than any other part of the system. It should be the next
thing built after the conversation model is settled (OD-01).

## 3. Rules that must be decided before building

| Question | Recommendation [AI #8] | Decision |
|---|---|---|
| Who owns a follow-up? | the **family and its case**; *shown* to the Current Handler when due; *accountable to* the Primary Owner | OD-09 |
| A follow-up comes due while the owner is off shift | it appears in the coverage inbox with the handoff card, tagged "for the owner" if the case is `owner_locked` | OD-09 |
| It becomes overdue during coverage | it stays overdue, and appears in *"What happened while you were away"* with elapsed time. **Never silently re-dated** | OD-10 |
| Does a task follow the handler? | **No.** Department tasks (`finance`/`technical`/`academic`) belong to a named person in that department; CS follow-ups belong to the case | — |
| Completing the last open task on a case | case `waiting_internal` → `open`; family moves to TODAY with the reason *"inform family of finance result"* (brief §8) | — |
| Can coverage complete an owner's follow-up? | yes for the transactional part; no for closing an `owner_locked` case | brief §5 |

## 4. The disappearing-follow-up test

The single scenario that must pass before pilot:

1. Dina creates a follow-up on a renewal case, due tomorrow 14:00.
2. Dina's shift ends; Radwa covers.
3. Tomorrow 14:00 falls inside Radwa's shift, not Dina's.
4. **Expected:** it appears in Radwa's inbox with the handoff card and a "for the owner"
   tag; the attention signal fires (+10); the workload unit counts against Radwa
   (brief §7: covered families count on the coverage admin).
5. Radwa acts on the transactional part; the case stays open.
6. Dina returns; the follow-up and everything Radwa did are in her away summary.
7. If nobody acted, it is **overdue**, with its original date, in Dina's inbox and on the
   manager's dashboard.

No part of this sequence is currently implementable.

## 5. Acceptance criteria

1. `case` and `task` tables exist in the stack chosen by OD-02, with the brief's §3 columns.
2. `owner_locked` is applied automatically from `cases.owner_locked_types` in `config` plus
   `complaint[severity=high]`, and is enforced server-side on close.
3. A follow-up is `case.due_at` + `follow_up_reason`; it is never silently re-dated.
4. Overdue follow-ups appear in three places: the handler's inbox, the owner's away summary,
   and the manager dashboard.
5. Department staff see only their own tasks and cannot reach a family record (G-26,
   `capabilities.ts` already enforces the UI half).
6. Per-case calibration logging from day one: staff message count, time to first reply,
   handling time excluding `waiting_customer`, reopen count.
