-- Jawwid Chat -- RT-029: a learner's teacher is in the learner's organization.
--
-- THE DEFECT. chat.enforce_same_organization() (20260906120000_chat_organization)
-- guards chat.learner.family_id but not chat.learner.teacher_id, so a learner
-- in organization A could be stored pointing at a teacher in organization B.
-- The row authorized nothing (chat.teacher_parent_authorized and the API both
-- restate the organization term), but the tenant boundary rested on every
-- reader restating it rather than on the data being well-formed.
--
-- THE FIX. The same shared guard, attached to chat.learner for teacher_id.
-- chat.learner's foreign keys are family_id (already guarded, trigger
-- learner_same_organization), teacher_id (this file) and organization_id (the
-- row's own tenant). No other column of chat.learner references a root entity.
--
-- ORDER WITH THE ASSIGNMENT GATE. BEFORE row triggers fire in name order:
--   learner_assignment_is_guarded       authority (PD-6/OD-04)  restrict_violation 23001
--   learner_same_organization           family tenancy          check_violation    23514
--   learner_set_updated_at
--   learner_teacher_same_organization   teacher tenancy (here)  check_violation    23514
-- So a Chat-side write that is not assignment ingestion is still refused for
-- authority first, exactly as before; ingestion (or a PD-11 / PD-31 transfer)
-- that names another organization's teacher is refused for tenancy. Both
-- transfer functions already refuse a foreign teacher with their own message
-- before they write; this is the backstop with the functions bypassed. An
-- unknown teacher id still falls through to the learner_teacher_fk foreign key
-- (23503), as before.
--
-- WHEN IT FIRES. INSERT, and an UPDATE that names teacher_id or
-- organization_id. Every other learner update (name, level, attention
-- counters, avatar) does not pay for the lookup.
--
-- EXISTING ROWS. Forward-only and additive: no row is read for rewriting,
-- moved or deleted. If any stored learner already names another
-- organization's teacher, this migration FAILS with the count and the first
-- learner ids, rather than install a guard over data that breaks it; resolving
-- such a row is an assignment decision for the academy, not for a migration.
-- The table is locked (SHARE ROW EXCLUSIVE, the lock CREATE TRIGGER takes
-- anyway) before the check, so no violating row can arrive between the check
-- and the trigger.
--
-- REVERSIBLE: db/rollback/20261109130000_chat_learner_same_org.down.sql drops
-- the one trigger (which reopens RT-029). No function is created or changed.

set local lock_timeout = '5s';

-- PRECONDITION: the organization columns, the shared guard and the assignment
-- gate this file is ordered against. Refuse rather than half-guard.
do $pre$
begin
  if to_regprocedure('chat.enforce_same_organization()') is null
     or to_regprocedure('chat.guard_learner_assignment_change()') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'chat' and table_name = 'learner' and column_name = 'organization_id')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'chat' and table_name = 'teacher' and column_name = 'organization_id') then
    raise exception 'RT-029 precondition failed: chat organization columns / chat.enforce_same_organization() / chat.guard_learner_assignment_change() missing';
  end if;
end
$pre$;

lock table chat.learner in share row exclusive mode;

-- EXISTING DATA: fail loudly on any learner already across the boundary.
do $check$
declare
  v_count bigint;
  v_first text;
begin
  select count(*) into v_count
    from chat.learner l
    join chat.teacher t on t.id = l.teacher_id
   where t.organization_id <> l.organization_id;

  if v_count > 0 then
    select string_agg(x.id::text, ', ') into v_first
      from (select l.id
              from chat.learner l
              join chat.teacher t on t.id = l.teacher_id
             where t.organization_id <> l.organization_id
             order by l.id
             limit 5) x;
    raise exception
      'RT-029: % chat.learner row(s) name a teacher in another organization (first: %); '
      'this migration does not rewrite assignments -- resolve them through assignment ingestion, then re-run',
      v_count, v_first
      using errcode = 'check_violation';
  end if;
end
$check$;

drop trigger if exists learner_teacher_same_organization on chat.learner;
create trigger learner_teacher_same_organization
  before insert or update of organization_id, teacher_id on chat.learner
  for each row execute function chat.enforce_same_organization('teacher', 'teacher_id');

comment on trigger learner_teacher_same_organization on chat.learner is
  'RT-029: chat.learner.teacher_id names a teacher in the learner''s own organization. '
  'Fires after learner_assignment_is_guarded (name order), so authority is checked before tenancy.';
