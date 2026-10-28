---
pd: PD-30
kind: amendment
subject: Supervisors may record a carried-over package from Core (no payment), tightly limited, for PD-42 intake (owner 2026-10-28)
branch: claude/pd42-direct-enrol-7a765a
pr: #173, #194
state: IN PROGRESS
---
Owner, 2026-10-28, verbatim: "Allow, tightly limited (Recommended)".

PD-30 (2026-10-26) lets only the super admin, the Operations Manager and the
Sales Manager add lessons with no payment behind them. This amendment adds one
narrow exception: a `learner_subscription` row with `source = 'carried_over'`,
written by a supervisor. The database refuses it unless ALL of these hold:

1. source is `carried_over`, and the child's enrolment has origin `intake`,
   which means the child was entered through PD-42's form;
2. the writer is the staff member who entered that child
   (`created_by = student_enrolment.entered_by`);
3. the write is within 14 days of that intake;
4. the child has no other standing ledger row;
5. the writer may handle the family (`chat.staff_may_handle_family`) and holds
   `subscriptions.carry_over` (`chat.staff_has_permission`).

Everything else stays with PD-30's three roles (`can_grant_subscription_exception`).
Design: docs/product/pd042-direct-enrolment-plan.md §5.1, §16 F4.
