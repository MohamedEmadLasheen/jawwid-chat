-- =============================================================================
-- PD-59 · chat.sales_prospect_ids is owner-aware
--
-- 20261031190000 (PD-52 PR-5) defined chat.sales_prospect_ids(staff, at) as EVERY
-- prospect with a lesson in the PD-26 window, for any Sales member: "Sales reads
-- every trial". PD-59 (owner decision 2026-11-21) gives a prospect an owner
-- (chat.trial_prospect.owner_staff_id): a Sales REPRESENTATIVE works their own
-- leads, the Sales manager and the super admin work all of them. The application
-- narrowed its reads in PR #627 (TeacherScopeService.salesRowsOf), but the database
-- guards still used the wide function, so a representative could RECORD (a
-- complaint, a testimonial, a grant, lateness) about another representative's
-- trial family.
--
-- This replaces the function, same signature, language, volatility and
-- search_path, with one more condition:
--
--   basis 'member'  (a representative)  only prospects with owner_staff_id = p_staff
--                                       (an unowned prospect is no representative's)
--   basis 'manager'                     unchanged: every prospect with a lesson in the window
--   no Sales basis                      unchanged: none
--
-- Derived with no further change, because each calls this function:
--   chat.sales_teacher_ids        the teachers of the prospects it returns (+ owned families')
--   chat.may_record_teacher_row   the prospect branch of the insert guards
--                                 (guard_teacher_supervision_entry, ..._about,
--                                 guard_teacher_violation)
--
-- Additive and idempotent: create or replace of one function; no table, column,
-- grant or policy changes (the revoke from public of 20261031190000 stands and is
-- restated). Lock and duration: create or replace function takes a brief catalog
-- lock on that one pg_proc row; no table is read, locked or rewritten, so it is
-- instant and blocks no reader or writer.
-- Rollback: db/rollback/20261121120000_chat_pd059_sales_prospect_ids_owner.down.sql
-- =============================================================================

create or replace function chat.sales_prospect_ids(p_staff uuid, p_at timestamptz default now())
returns setof uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select distinct le.prospect_id
    from chat.lesson le
    join chat.staff s on s.id = p_staff and s.organization_id = le.organization_id
   where chat.sales_basis(p_staff) is not null
     and le.prospect_id is not null
     and le.starts_at >= p_at - chat.operations_lesson_window()
     and (chat.sales_basis(p_staff) = 'manager'
          or exists (select 1
                       from chat.trial_prospect p
                      where p.id = le.prospect_id
                        and p.organization_id = le.organization_id
                        and p.owner_staff_id = p_staff));
$$;

comment on function chat.sales_prospect_ids(uuid, timestamptz) is
  'PD-52/PD-59: the trial families a Sales member reads in the PD-26 window -- every one for the Sales manager, only the prospects assigned to them (owner_staff_id) for a representative.';

revoke all on function chat.sales_prospect_ids(uuid, timestamptz) from public;
