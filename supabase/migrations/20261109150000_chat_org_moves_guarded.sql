-- Jawwid Chat -- RT-029 follow-up: a root row never changes organization
-- after it is created.
--
-- THE GAP. 20261109140000 (#550) closed the parent side for chat.teacher only,
-- and only while learners still name the teacher. chat.family and
-- chat.conversation had the same hole with nothing in front of it: an UPDATE
-- of a parent's organization_id is not a write to its children, so a family's
-- contacts, learners, subscriptions, notes, support cases and tasks, and a
-- conversation's messages and calls, stayed in the old organization without
-- any trigger firing. Any child-side check also races a parent move: under
-- READ COMMITTED a child write and a parent move committed together each pass
-- their own check against the other's pre-commit state.
--
-- WHY IMMUTABILITY, NOT MORE MOVE GUARDS. No legitimate path changes
-- organization_id on these tables after insert. Audited at this slot:
--   * SQL functions (supabase/migrations): every UPDATE of chat.family,
--     chat.conversation and chat.teacher sets other columns (owner,
--     primary contact, display name/language from Core ingestion, activity
--     and stickiness, approval flags, name/avatar on erasure, account,
--     is_active/left_at). No ON CONFLICT ... DO UPDATE sets organization_id
--     on them, and no BEFORE UPDATE trigger on them assigns
--     NEW.organization_id. The only "set organization_id" in an UPDATE is on
--     chat.learner_access (a derived cache, not guarded here).
--   * API (apps/api/src) and CLIs: Prisma updates of family/conversation/
--     teacher write location, segment, plan, primary contact, title, last
--     seq/activity, archive, direct key, name and avatar; organizationId only
--     ever appears in their WHERE clauses. The one raw UPDATE of chat.family
--     (family-location-backfill) sets location columns.
--   * Tests: the single fixture that moves a conversation's organization
--     (pd034 "an entry never crosses a tenant") disables user triggers around
--     it, which disables this guard too; it is unaffected.
-- So the safest rule is the simplest: organization_id is fixed at insert.
-- That closes the parent side for all three tables and the commit-time race
-- with it (a parent's organization can no longer change under a child write).
-- No escape hatch is provided because no legitimate move exists; moving a
-- tenant's data would be a new, owner-approved operation of its own.
--
-- chat.thread. Named in the finding, but dropped by
-- 20260905094000_chat_od01_conversation_reconciliation (OD-01), before
-- organizations existed; it has no organization_id to guard. The test
-- rt029-organization-immutable asserts it is still absent.
--
-- THE GUARD. One trigger function per table (AGENTS.md):
-- chat.family_organization_immutable(), chat.conversation_organization_immutable(),
-- chat.teacher_organization_immutable(). Each trigger is BEFORE UPDATE (any
-- column list, deliberately wider than UPDATE OF organization_id: a value
-- changed by an earlier BEFORE trigger is refused too) WHEN
-- new.organization_id IS DISTINCT FROM old.organization_id, so an UPDATE that
-- restates the same organization, and every other update, never run the
-- function. Raises check_violation (23514) "organization_id is immutable".
-- The functions only compare NEW and OLD: SECURITY INVOKER, search_path pinned.
--
-- #550's teacher guard (teacher_org_move_keeps_learners) is LEFT IN PLACE, not
-- superseded. Postgres fires same-timing row triggers in name order, so
-- teacher_org_immutable runs first and every refused move reads the same on
-- all three tables. The older guard becomes unreachable while this one
-- stands, and is exactly what remains if this migration is rolled back, so
-- the rollback needs no copy of #550's code.
--
-- EXISTING ROWS. Nothing is rewritten. Immutability constrains future
-- UPDATEs only, so no stored row can violate it and there is no data check;
-- the precondition below only refuses to half-install on a schema without
-- the organization columns. CREATE TRIGGER takes SHARE ROW EXCLUSIVE on each
-- table (writes wait, reads continue) for the instant of the DDL.
--
-- IDEMPOTENT: create or replace function, drop trigger if exists + create.
-- REVERSIBLE: db/rollback/20261109150000_chat_org_moves_guarded.down.sql.

set local lock_timeout = '5s';

do $pre$
declare
  t text;
begin
  foreach t in array array['family', 'conversation', 'teacher'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'chat' and table_name = t and column_name = 'organization_id') then
      raise exception 'RT-029 immutability precondition failed: chat.%.organization_id missing', t;
    end if;
  end loop;
end
$pre$;

-- ---------------------------------------------------------------------------
-- chat.family

create or replace function chat.family_organization_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'organization_id is immutable: chat.family % belongs to organization % (attempted %)',
    old.id, old.organization_id, new.organization_id
    using errcode = 'check_violation',
          hint = 'A family never moves between organizations; its contacts, learners and records would be left behind.';
end;
$$;

comment on function chat.family_organization_immutable() is
  'RT-029: refuses any change of chat.family.organization_id after insert (trigger family_org_immutable).';

drop trigger if exists family_org_immutable on chat.family;
create trigger family_org_immutable
  before update on chat.family
  for each row
  when (new.organization_id is distinct from old.organization_id)
  execute function chat.family_organization_immutable();

comment on trigger family_org_immutable on chat.family is
  'RT-029: organization_id is fixed at insert.';

-- ---------------------------------------------------------------------------
-- chat.conversation

create or replace function chat.conversation_organization_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'organization_id is immutable: chat.conversation % belongs to organization % (attempted %)',
    old.id, old.organization_id, new.organization_id
    using errcode = 'check_violation',
          hint = 'A conversation never moves between organizations; its messages and calls would be left behind.';
end;
$$;

comment on function chat.conversation_organization_immutable() is
  'RT-029: refuses any change of chat.conversation.organization_id after insert (trigger conversation_org_immutable).';

drop trigger if exists conversation_org_immutable on chat.conversation;
create trigger conversation_org_immutable
  before update on chat.conversation
  for each row
  when (new.organization_id is distinct from old.organization_id)
  execute function chat.conversation_organization_immutable();

comment on trigger conversation_org_immutable on chat.conversation is
  'RT-029: organization_id is fixed at insert.';

-- ---------------------------------------------------------------------------
-- chat.teacher (named to sort, and so fire, before teacher_org_move_keeps_learners)

create or replace function chat.teacher_organization_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'organization_id is immutable: chat.teacher % belongs to organization % (attempted %)',
    old.id, old.organization_id, new.organization_id
    using errcode = 'check_violation',
          hint = 'A teacher never moves between organizations; the learners naming them would be left behind.';
end;
$$;

comment on function chat.teacher_organization_immutable() is
  'RT-029: refuses any change of chat.teacher.organization_id after insert (trigger teacher_org_immutable). '
  'Supersedes in effect, without removing, teacher_org_move_keeps_learners (20261109140000).';

drop trigger if exists teacher_org_immutable on chat.teacher;
create trigger teacher_org_immutable
  before update on chat.teacher
  for each row
  when (new.organization_id is distinct from old.organization_id)
  execute function chat.teacher_organization_immutable();

comment on trigger teacher_org_immutable on chat.teacher is
  'RT-029: organization_id is fixed at insert.';
