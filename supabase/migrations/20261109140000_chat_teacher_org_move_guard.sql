-- Jawwid Chat -- RT-029 follow-up: a teacher does not leave their learners
-- behind in another organization.
--
-- THE GAP. 20261109130000_chat_learner_same_org guards the CHILD side:
-- chat.learner.teacher_id must name a teacher in the learner's organization,
-- checked when the learner row is written. The PARENT side stayed open: an
-- UPDATE of chat.teacher.organization_id is not a write to chat.learner, so
-- every learner that names the teacher was left pointing across the tenant
-- boundary without any trigger firing.
--
-- THE FIX. A BEFORE UPDATE OF organization_id trigger on chat.teacher that
-- refuses the move while any chat.learner row naming the teacher is in a
-- different organization than the new value. Raised as check_violation
-- (23514) with the "cross-organization reference" prefix, the wording of
-- chat.enforce_same_organization(). Its own function, used by this one table
-- (AGENTS.md: one trigger function per table).
--
-- WHEN IT FIRES. Only an UPDATE that names organization_id AND changes it
-- (WHEN clause). Renames, activation changes and an UPDATE that restates the
-- same organization never run the lookup. The lookup is served by
-- learner_teacher_idx (chat.learner (teacher_id) where teacher_id is not null).
--
-- SECURITY DEFINER, pinned search_path. The check must see every learner that
-- names the teacher, whichever role makes the update; under a caller's
-- row-level security a learner of another organization would be invisible and
-- the move would wrongly pass. The function only reads, returns NEW unchanged
-- or raises, and names every relation schema-qualified.
--
-- CONCURRENCY (known residual, recorded). Under READ COMMITTED a learner
-- insert/reassignment and a teacher move committed at the same instant can
-- each pass their own check against the other's pre-commit state. Closing
-- that needs the child-side guard to lock the parent row (FOR SHARE), which
-- is a change to the shared chat.enforce_same_organization() and out of this
-- file's scope. Both writes are rare administrative operations.
--
-- EXISTING ROWS. Forward-only and additive: no row is rewritten, moved or
-- deleted. If any stored learner already names another organization's
-- teacher (the state this guard keeps out), this migration FAILS with the
-- count and the first learner ids, as 20261109130000 does. chat.teacher is
-- locked (SHARE ROW EXCLUSIVE, the lock CREATE TRIGGER takes anyway) and
-- chat.learner too, before the check, so no violating row can arrive between
-- the check and the trigger.
--
-- REVERSIBLE: db/rollback/20261109140000_chat_teacher_org_move_guard.down.sql
-- drops the trigger and the function (which reopens the parent-side gap).

set local lock_timeout = '5s';

-- PRECONDITION: the organization columns and the child-side guard this file
-- completes. Refuse rather than half-guard.
do $pre$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'chat' and table_name = 'learner' and column_name = 'organization_id')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'chat' and table_name = 'teacher' and column_name = 'organization_id')
     or not exists (select 1 from pg_trigger
                     where tgrelid = 'chat.learner'::regclass
                       and tgname = 'learner_teacher_same_organization'
                       and not tgisinternal) then
    raise exception 'RT-029 teacher-move precondition failed: chat organization columns / learner_teacher_same_organization (20261109130000) missing';
  end if;
end
$pre$;

lock table chat.teacher in share row exclusive mode;
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

create or replace function chat.guard_teacher_organization_move()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count bigint;
  v_first uuid;
begin
  select count(*), min(l.id::text)::uuid
    into v_count, v_first
    from chat.learner l
   where l.teacher_id = new.id
     and l.organization_id is distinct from new.organization_id;

  if v_count > 0 then
    raise exception
      'cross-organization reference: chat.teacher % would move to organization %, '
      'but % chat.learner row(s) in another organization name it (first: %)',
      new.id, new.organization_id, v_count, v_first
      using errcode = 'check_violation',
            hint = 'Reassign the learners through assignment ingestion first, then move the teacher.';
  end if;

  return new;
end;
$$;

-- A trigger fires regardless of EXECUTE; no request role may call it directly
-- (definer-function-audit.spec.ts: only reviewed helpers are executable).
revoke all on function chat.guard_teacher_organization_move() from public;

comment on function chat.guard_teacher_organization_move() is
  'RT-029 (parent side): refuses moving a chat.teacher to another organization while '
  'any chat.learner naming the teacher is outside the new organization. Child side: '
  'trigger learner_teacher_same_organization on chat.learner.';

drop trigger if exists teacher_org_move_keeps_learners on chat.teacher;
create trigger teacher_org_move_keeps_learners
  before update of organization_id on chat.teacher
  for each row
  when (new.organization_id is distinct from old.organization_id)
  execute function chat.guard_teacher_organization_move();

comment on trigger teacher_org_move_keeps_learners on chat.teacher is
  'RT-029: a teacher cannot move to another organization while learners in their '
  'old organization still name them.';
