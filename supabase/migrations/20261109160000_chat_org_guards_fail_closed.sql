-- Jawwid Chat -- RT-029 follow-up (LR-46 P2-4, P2-5): the organization guards
-- fail closed.
--
-- ===========================================================================
-- P2-4. THE LEARNER'S TEACHER CHECK FAILS CLOSED
-- ===========================================================================
--
-- THE GAP. 20261109130000 (#545) guards chat.learner.teacher_id with the shared
-- chat.enforce_same_organization(), which is SECURITY INVOKER and reads the
-- parent with the caller's privileges: when the teacher row is not visible it
-- gets NULL and lets the write through. chat.teacher has row-level security
-- (teacher_organization_isolation), so a writer that cannot see organization
-- B's teacher would pass a cross-organization teacher_id; the foreign key,
-- checked as the table owner, still finds the row and accepts it. Not
-- reachable today (only BYPASSRLS server roles write teacher_id: the
-- assignment gate refuses request roles), but the guard should not depend on
-- who calls it.
--
-- THE FIX. A dedicated function for this one trigger,
-- chat.enforce_learner_teacher_organization(): SECURITY DEFINER, search_path
-- pinned to pg_catalog, pg_temp, every relation schema-qualified, EXECUTE
-- revoked from every request role (a trigger fires regardless of EXECUTE;
-- definer-function-audit.spec.ts forbids request roles calling it). It
--   * returns NEW when teacher_id is NULL (an unassigned learner);
--   * raises foreign_key_violation (23503) when the teacher does not exist --
--     the same SQLSTATE the learner_teacher_fk foreign key gave before, now
--     raised by the guard itself, never "not visible, so pass";
--   * raises check_violation (23514) when the teacher is in another
--     organization, with the shared guard's "cross-organization reference"
--     wording, so callers and tests read the same message as before.
-- The trigger keeps its name (learner_teacher_same_organization), its events
-- (INSERT, UPDATE OF organization_id, teacher_id) and therefore its place
-- after learner_assignment_is_guarded in name order. Only the function it
-- executes changes.
--
-- chat.enforce_same_organization() itself is NOT changed: every other trigger
-- that uses it (chat.learner.family_id via learner_same_organization, and the
-- family- and conversation-scoped tables of 20260906120000 and
-- 20261014140000) keeps exactly its behaviour.
--
-- ===========================================================================
-- P2-5. LEARNER, CONTACT, STAFF AND ACCOUNT NEVER CHANGE ORGANIZATION
-- ===========================================================================
--
-- 20261109150000 (#551) made organization_id immutable on chat.family,
-- chat.conversation and chat.teacher. The same reasoning holds for four more
-- tables that other rows hang off:
--   * chat.learner -- parent of lesson, learner_schedule_slot,
--     parent_feedback, learner_subscription, learner_access, learner_profile,
--     learner_supervision, conversation_learner;
--   * chat.contact -- parent of contact_profile and parent_file (whose
--     organization is copied from the contact at write time), and the
--     family's member in its conversations;
--   * chat.staff -- department membership, supervision, backups, profile,
--     reporting lines, family ownership;
--   * chat.account -- the login; chat.current_organization_id() resolves the
--     caller's tenant from it.
-- Audited at this slot (evidence listed in the PR):
--   * SQL (supabase/migrations, db/): no UPDATE of these tables sets
--     organization_id; no ON CONFLICT ... DO UPDATE on them does (Core
--     learner/account upserts set name, schedule, activity, is_active); no
--     BEFORE trigger on them assigns NEW.organization_id. The only bulk
--     "set organization_id" is 20260906120000's one-time NULL -> default
--     backfill, which ran before NOT NULL and cannot recur.
--   * API and CLIs (apps/, scripts/, tools/): Prisma updates of these tables
--     write name, avatar, level, account link, flags, status, timestamps;
--     organizationId appears only in WHERE clauses and in create(). The
--     review-cohort CLI REFUSES (SUBJECT_TAKEN) an existing account in
--     another organization rather than moving it.
--   * Tests (apps/api/test, db/tests): no fixture changes organization_id
--     on these tables.
-- So organization_id is fixed at insert, with no escape hatch. One function
-- per table (AGENTS.md): chat.<table>_organization_immutable(). Each trigger
-- is BEFORE UPDATE (any column list, so a value changed by an earlier BEFORE
-- trigger is refused too) WHEN new.organization_id IS DISTINCT FROM
-- old.organization_id; an UPDATE that restates the organization, and every
-- other update, never run the function. Raises check_violation (23514)
-- "organization_id is immutable". The functions only compare NEW and OLD:
-- SECURITY INVOKER, search_path pinned.
--
-- On chat.learner, learner_org_immutable sorts (and fires) after
-- learner_assignment_is_guarded and before learner_same_organization and
-- learner_teacher_same_organization, so a learner move reads "organization_id
-- is immutable" whatever else the UPDATE names.
--
-- EXISTING ROWS. Nothing is read for rewriting, moved or deleted. The teacher
-- check's data precondition was established by 20261109130000 (which fails
-- on any learner crossing the boundary) and is kept since by its trigger;
-- immutability constrains future UPDATEs only. CREATE TRIGGER takes SHARE ROW
-- EXCLUSIVE on each table (writes wait, reads continue) for the instant of
-- the DDL.
--
-- IDEMPOTENT: create or replace function, drop trigger if exists + create.
-- REVERSIBLE: db/rollback/20261109160000_chat_org_guards_fail_closed.down.sql.

set local lock_timeout = '5s';

do $pre$
declare
  t text;
begin
  foreach t in array array['learner', 'teacher', 'contact', 'staff', 'account'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'chat' and table_name = t and column_name = 'organization_id') then
      raise exception 'RT-029 fail-closed precondition failed: chat.%.organization_id missing', t;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'chat.learner'::regclass
                    and tgname = 'learner_teacher_same_organization'
                    and not tgisinternal) then
    raise exception 'RT-029 fail-closed precondition failed: learner_teacher_same_organization (20261109130000) missing';
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- P2-4: chat.learner.teacher_id, fail closed

create or replace function chat.enforce_learner_teacher_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_teacher_org uuid;
begin
  if new.teacher_id is null then
    return new;
  end if;

  select t.organization_id
    into v_teacher_org
    from chat.teacher t
   where t.id = new.teacher_id;

  if not found then
    raise exception
      'chat.learner % names chat.teacher %, which does not exist',
      new.id, new.teacher_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_teacher_org is distinct from new.organization_id then
    raise exception
      'cross-organization reference: chat.learner row belongs to organization %, parent chat.teacher belongs to %',
      new.organization_id, v_teacher_org
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- A trigger fires regardless of EXECUTE; no request role may call it directly
-- (definer-function-audit.spec.ts: only reviewed helpers are executable).
revoke all on function chat.enforce_learner_teacher_organization() from public, anon, authenticated, chat_app;

comment on function chat.enforce_learner_teacher_organization() is
  'RT-029 (LR-46 P2-4): chat.learner.teacher_id names an existing teacher in the learner''s own '
  'organization. SECURITY DEFINER so a writer that cannot see the teacher is refused, not passed. '
  'Trigger learner_teacher_same_organization; the shared chat.enforce_same_organization() is unchanged.';

drop trigger if exists learner_teacher_same_organization on chat.learner;
create trigger learner_teacher_same_organization
  before insert or update of organization_id, teacher_id on chat.learner
  for each row execute function chat.enforce_learner_teacher_organization();

comment on trigger learner_teacher_same_organization on chat.learner is
  'RT-029: chat.learner.teacher_id names an existing teacher in the learner''s own organization (fails closed). '
  'Fires after learner_assignment_is_guarded (name order), so authority is checked before tenancy.';

-- ---------------------------------------------------------------------------
-- P2-5: chat.learner

create or replace function chat.learner_organization_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'organization_id is immutable: chat.learner % belongs to organization % (attempted %)',
    old.id, old.organization_id, new.organization_id
    using errcode = 'check_violation',
          hint = 'A learner never moves between organizations; their lessons, schedule, feedback and subscriptions would be left behind.';
end;
$$;

comment on function chat.learner_organization_immutable() is
  'RT-029: refuses any change of chat.learner.organization_id after insert (trigger learner_org_immutable).';

drop trigger if exists learner_org_immutable on chat.learner;
create trigger learner_org_immutable
  before update on chat.learner
  for each row
  when (new.organization_id is distinct from old.organization_id)
  execute function chat.learner_organization_immutable();

comment on trigger learner_org_immutable on chat.learner is
  'RT-029: organization_id is fixed at insert.';

-- ---------------------------------------------------------------------------
-- P2-5: chat.contact

create or replace function chat.contact_organization_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'organization_id is immutable: chat.contact % belongs to organization % (attempted %)',
    old.id, old.organization_id, new.organization_id
    using errcode = 'check_violation',
          hint = 'A contact never moves between organizations; their profile and files would be left behind.';
end;
$$;

comment on function chat.contact_organization_immutable() is
  'RT-029: refuses any change of chat.contact.organization_id after insert (trigger contact_org_immutable).';

drop trigger if exists contact_org_immutable on chat.contact;
create trigger contact_org_immutable
  before update on chat.contact
  for each row
  when (new.organization_id is distinct from old.organization_id)
  execute function chat.contact_organization_immutable();

comment on trigger contact_org_immutable on chat.contact is
  'RT-029: organization_id is fixed at insert.';

-- ---------------------------------------------------------------------------
-- P2-5: chat.staff

create or replace function chat.staff_organization_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'organization_id is immutable: chat.staff % belongs to organization % (attempted %)',
    old.id, old.organization_id, new.organization_id
    using errcode = 'check_violation',
          hint = 'A staff member never moves between organizations; their departments, supervision and families would be left behind.';
end;
$$;

comment on function chat.staff_organization_immutable() is
  'RT-029: refuses any change of chat.staff.organization_id after insert (trigger staff_org_immutable).';

drop trigger if exists staff_org_immutable on chat.staff;
create trigger staff_org_immutable
  before update on chat.staff
  for each row
  when (new.organization_id is distinct from old.organization_id)
  execute function chat.staff_organization_immutable();

comment on trigger staff_org_immutable on chat.staff is
  'RT-029: organization_id is fixed at insert.';

-- ---------------------------------------------------------------------------
-- P2-5: chat.account

create or replace function chat.account_organization_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'organization_id is immutable: chat.account % belongs to organization % (attempted %)',
    old.id, old.organization_id, new.organization_id
    using errcode = 'check_violation',
          hint = 'A login never moves between organizations; the caller''s tenant is resolved from it.';
end;
$$;

comment on function chat.account_organization_immutable() is
  'RT-029: refuses any change of chat.account.organization_id after insert (trigger account_org_immutable).';

drop trigger if exists account_org_immutable on chat.account;
create trigger account_org_immutable
  before update on chat.account
  for each row
  when (new.organization_id is distinct from old.organization_id)
  execute function chat.account_organization_immutable();

comment on trigger account_org_immutable on chat.account is
  'RT-029: organization_id is fixed at insert.';
