-- TEACHER-005 (owner decision, 2026-11-01) -- leave beyond the allowance.
--
-- Owner: leave beyond the balance is allowed, with a warning ("N days will be
-- unpaid") to the teacher and the approver; on approval the excess is stored
-- as unpaid, per request; the balance never goes below 0; the Teacher File and
-- payroll show "Unpaid leave: N days"; NO pay formula.
--
-- unpaid   a leave day the allowance did not cover. LeaveService.approve marks
--          the request's days that exceed what the balance has left (the last
--          ones, in date order). The balance counts paid days only, so it ends
--          at 0. A request's unpaid days are its rows with unpaid = true, so a
--          cancellation that returns days returns its unpaid days with them.
--          Only a leave day can be unpaid; a suspension's days are not leave.
--
-- Pay (PD-18) is not changed by it: payroll shows the month's unpaid leave
-- days; a deduction, if the Teachers department wants one, is an adjustment a
-- person records, as today.

alter table chat.teacher_day_off
  add column if not exists unpaid boolean not null default false;

alter table chat.teacher_day_off drop constraint if exists teacher_day_off_unpaid_is_leave;
alter table chat.teacher_day_off add constraint teacher_day_off_unpaid_is_leave
  check (not unpaid or leave_request_id is not null);

comment on column chat.teacher_day_off.unpaid is
  'TEACHER-005: a leave day beyond the allowance (unpaid leave). Not counted against the balance; shown in the Teacher File and payroll.';
