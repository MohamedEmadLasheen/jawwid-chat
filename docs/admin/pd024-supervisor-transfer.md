# PD-24 — changing a family's supervisor

Record: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-24. Scope rules: `docs/architecture/ORG-SCOPE-PD8.md`.

## Where

| Action | Who | Where |
|---|---|---|
| Hand a group to another supervisor | super admin / Operations manager | Admin Web → Chat → the group → info panel → **Change supervisor** |
| Change a new student's supervisor (any time after Assign) | super admin / Operations manager | Admin Web → Trials & new students → New students → card → **Change** |
| Move one child on its own | super admin / Operations manager | Admin Web → Organization → Children & supervisors (PD-8, unchanged) |

Each asks for the new supervisor (Operations primary supervisors only, the current one not offered) and a reason.

## What moves, in one transaction

| Record | What happens |
|---|---|
| The children | the group's (or the enrolment's) children, plus every child sharing a live family group with them: a group is never split |
| `learner_supervision` | one row per child re-pointed; audited `learner.supervisor_reassigned` with before / after / reason / actor |
| The group(s) | the same conversation; the old supervisor's member row gets `left_at` (kept), the new one is added as admin; system line `group.supervisor_changed` |
| The parent's 1:1 | the same conversation passes to the new supervisor (member swapped, `direct_key` rewritten, system line `direct.supervisor_changed`) when the old supervisor has no child of the family left; not duplicated if the parent already has a 1:1 with the new supervisor |
| Billing supervisor | re-pointed to the new supervisor; audited `family.billing_supervisor_transferred` |
| `family.owner_id` | moved with `chat.transfer_ownership` (staff workload counts follow) |
| Profiles, lessons, reports, payments, the New Students card | nothing to move: they are read through the supervision scope, so the new supervisor sees them and the old one stops at once |

Nothing is copied, recreated or deleted. Messages, attachments and members other than the supervisor are untouched.

## Routes

| Method | Path | Body → answer |
|---|---|---|
| POST | `/org/conversations/:conversationId/supervisor` | `{ supervisorId, reason }` → `{ supervisorId, changed, learners: [{ id, name }], groups, directChats }` |
| POST | `/trials/new-students/:trialId/supervisor` | same |

Refusals: `COMM.ORG_STRUCTURE_DENIED` (403, not the super admin or the manager of both supervisors), `COMMON.VALIDATION` (400, no reason, or a conversation that is not a live student/family group), `COMM.ORG_STRUCTURE_INVALID` (409, the new supervisor is not an Operations primary supervisor), `COMM.LESSON_DENIED` on the New Students route for anyone but the Operations manager / super admin.

## Tests

`apps/api/test/integration/supervisor-transfer-pd024.spec.ts` (who, nothing lost, the unit, split families), `new-student-enrolment-pd016.spec.ts` §3b, `pd012-s3.spec.ts` (billing follows), Admin Web `organization/ChangeSupervisor.test.tsx` and `trials/TrialsPages.test.tsx`.
