-- =============================================================================
-- super_admin becomes representable, and becomes un-grantable from inside Chat
-- =============================================================================
--
-- PD-5 (CLOSED 2026-09-07, JAWUID-CHAT-PRODUCT-BOUNDARY.md §4) fixed that
-- `super_admin` exists from day one. It never did on this schema:
-- `chat.staff.role`'s CHECK admits six legacy values and not this one, so the
-- organization owner could not be represented, let alone sign in
-- (authentication-decision-gate.md CG-2).
--
-- WHAT THIS DOES
--   1. Widens the CHECK by exactly one value. Additive: every existing row stays
--      valid, and the legacy values are NOT renamed here. The rest of PD-5's
--      normalization (`coverage` -> `coverage_admin`, departments to an
--      attribute) changes what existing staff are called and is its own
--      reviewed migration; folding it into an account bootstrap would hide it.
--   2. Guards the GRANT. A row may enter or leave the super_admin role, a
--      super_admin row may be deleted, and it may change which login it
--      belongs to, only inside a
--      transaction that opens `chat.provisioning_super_admin`. No API route
--      opens it; the only writer is the bootstrap CLI
--      (apps/api/src/cli/bootstrap-super-admin.ts).
--
-- WHY A TRIGGER AND NOT ONLY APPLICATION CODE
--   "Other users cannot assign themselves super_admin" has to hold for every
--   future staff-management endpoint too, including ones not yet written. The
--   same mechanism already guards family.owner_id (chat.guard_owner_change) and
--   learner.teacher_id (chat.guard_learner_assignment_change): an ordinary
--   UPDATE fails at the database, whichever code path issued it.
--
--   Re-pointing a super_admin row's account_id is guarded too. Without that,
--   anyone able to UPDATE chat.staff could take the role without ever writing
--   the word `super_admin` -- by moving the existing row onto their own login.
--
-- WHAT IT IS NOT
--   A defence against a database superuser, who can open the gate or drop the
--   trigger. Neither is any other guard in this schema; the boundary is that
--   the application cannot do it by accident or by request.
--
-- WHAT super_admin MAY DO is decided in AuthorizationService, not here. As of
-- this migration it is NOT a family-facing role: the SQL helpers that admit
-- ('admin', 'coverage', 'manager') still refuse it, and the API agrees with
-- them rather than letting the two layers disagree mid-write.
-- =============================================================================

alter table chat.staff drop constraint staff_role_check;
alter table chat.staff add constraint staff_role_check check (role in
  ('admin', 'coverage', 'manager', 'finance', 'technical', 'academic', 'super_admin'));

comment on column chat.staff.role is
  'admin and coverage have identical permissions; coverage is a label that '
  'routes covered families into a separate inbox section (brief SS2). '
  'finance/technical/academic see only their own tasks and never message families. '
  'super_admin (PD-5) is the organization owner; it is granted only through the '
  'bootstrap procedure, which opens chat.provisioning_super_admin '
  '(see chat.guard_super_admin_grant).';

create or replace function chat.guard_super_admin_grant()
returns trigger
language plpgsql
as $$
declare
  v_open boolean := coalesce(current_setting('chat.provisioning_super_admin', true), '') = 'on';
  v_touches boolean;
begin
  if tg_op = 'INSERT' then
    v_touches := new.role = 'super_admin';
  elsif tg_op = 'DELETE' then
    v_touches := old.role = 'super_admin';
  else
    v_touches :=
         (new.role = 'super_admin' or old.role = 'super_admin')
     and (new.role is distinct from old.role
          or new.account_id is distinct from old.account_id);
  end if;

  if v_touches and not v_open then
    raise exception
      'the super_admin role is granted, revoked and re-bound only by the bootstrap procedure'
      using errcode = 'insufficient_privilege',
            hint = 'Run apps/api dist/cli/bootstrap-super-admin.js; it opens '
                   'chat.provisioning_super_admin for its own transaction.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function chat.guard_super_admin_grant() is
  'PD-5: super_admin is never granted from a request. Insert as super_admin, '
  'promotion to or demotion from it, deleting a super_admin row, and moving one '
  'onto another account all require set_config(''chat.provisioning_super_admin'', ''on'', true) '
  'in the same transaction. Same mechanism as chat.guard_owner_change.';

drop trigger if exists staff_super_admin_is_guarded on chat.staff;
create trigger staff_super_admin_is_guarded
  before insert or update of role, account_id or delete on chat.staff
  for each row execute function chat.guard_super_admin_grant();
