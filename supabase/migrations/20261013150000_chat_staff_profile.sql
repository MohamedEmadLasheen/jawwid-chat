-- =============================================================================
-- Staff profiles: a photo, a professional introduction, official
-- responsibility labels and reporting lines -- and nothing that authorizes.
-- =============================================================================
--
-- WHAT THIS ADDS
--   1. chat.staff.avatar_object_key   -- one nullable column (see below).
--   2. chat.staff_profile             -- self-service descriptive fields.
--   3. chat.staff_responsibility      -- official responsibility LABELS.
--   4. chat.staff_reporting_line      -- who a staff member reports to.
--
-- THE RULE EVERY TABLE HERE KEEPS: NONE OF THIS IS AN AUTHORIZATION INPUT.
--   AuthorizationService decides what a staff member may do from chat.staff.role
--   and (for families) family ownership. No policy, helper or service in this
--   schema reads a job title, an introduction or a responsibility label to
--   decide access, and none may start to: a label an admin can see is not a
--   permission they hold. The reporting line is read for ONE decision only --
--   which staff PROFILES a manager may see and edit -- and it never widens what
--   a manager may do with families, conversations or messages.
--
-- WHY THE AVATAR IS A COLUMN ON chat.staff
--   `feat/account-avatar` (unmerged, 20261005160000) adds exactly this column
--   with exactly this DDL. `add column if not exists` makes the two migrations
--   commute: whichever lands first creates it, the other is a no-op. The column
--   holds an OBJECT KEY into the private bucket, never a URL and never a
--   capability: a read is a short-lived signed URL minted per request after the
--   API has decided the viewer may see this profile.
--
-- WHY THE OTHER FIELDS ARE NOT COLUMNS ON chat.staff
--   chat.staff is the authorization row: role, activity, login binding. Its RLS
--   update policy (20260905091200 `staff_managed_by_manager`) admits the row's
--   own staff member for EVERY column (closed for the request role by
--   20261013160000). Putting descriptive fields beside `role` would make "edit
--   my introduction" and "edit my role" the same grant at the database layer. Separate tables keep the self-service surface and the
--   authorization surface physically apart.
--
-- WHAT IS DELIBERATELY ABSENT
--   No phone, no email, no address (BR-2: the chat schema carries no contact
--   channel). No salary, evaluation, disciplinary or HR note. No permission
--   column. No "department" column: PD-5 plans `chat.staff.department` as part
--   of its own reviewed normalization, and pre-empting it here would fork that
--   decision.
--
-- COMPATIBILITY
--   Additive only. No existing row is rewritten, nothing is backfilled, no
--   existing constraint or policy is changed. A staff member with no profile
--   row, no responsibility and no reporting line reads exactly as today.
--
-- ROLLBACK
--   drop table chat.staff_reporting_line;
--   drop table chat.staff_responsibility;
--   drop table chat.staff_profile;
--   drop function chat.current_staff_manages(uuid);
--   drop function chat.staff_profile_child_guard();
--   drop function chat.guard_staff_reporting_line();
--   drop function chat.guard_staff_responsibility_update();
--   -- and, only if feat/account-avatar has not landed:
--   alter table chat.staff drop column avatar_object_key;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The photo
-- ---------------------------------------------------------------------------

alter table chat.staff add column if not exists avatar_object_key text;

comment on column chat.staff.avatar_object_key is
  'Private object-storage key for this staff member''s profile photo, set by that staff member. Read through a signed URL only; never served as a public URL.';

-- ---------------------------------------------------------------------------
-- 2. Self-service descriptive fields
-- ---------------------------------------------------------------------------

create table chat.staff_profile (
  staff_id        uuid primary key references chat.staff (id) on delete cascade,
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  -- Professional title as the person describes their job. NOT a role.
  job_title       text,
  -- Plain text. Rendered as text by every client; never as HTML or Markdown.
  about           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Who last saved it: the profile owner, their manager, or the super admin.
  updated_by      uuid references chat.staff (id) on delete set null,

  constraint staff_profile_job_title_shape check (
    job_title is null
    or (char_length(job_title) between 1 and 80 and job_title !~ '[[:cntrl:]]')
  ),
  constraint staff_profile_about_length check (
    about is null or char_length(about) between 1 and 1500
  )
);

comment on table chat.staff_profile is
  'Descriptive, self-service profile fields for a staff member. Not an authorization input: no policy or service reads these columns to decide access.';

create trigger staff_profile_set_updated_at
  before update on chat.staff_profile
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Official responsibility labels
-- ---------------------------------------------------------------------------

create table chat.staff_responsibility (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  staff_id        uuid not null references chat.staff (id) on delete cascade,
  category        text not null check (category in (
                    'family_follow_up', 'student_follow_up', 'teacher_supervision',
                    'teaching_quality', 'academic_progress', 'attendance_monitoring',
                    'operations_scheduling', 'message_moderation', 'content_materials',
                    'customer_support', 'complaints_escalations', 'sales_admissions',
                    'team_management', 'other')),
  -- What part of the area this covers, in the assigner's words.
  scope_note      text check (scope_note is null or char_length(scope_note) between 1 and 280),
  assigned_by     uuid references chat.staff (id) on delete set null,
  assigned_at     timestamptz not null default now(),
  ended_at        timestamptz,
  ended_by        uuid references chat.staff (id) on delete set null,
  end_reason      text check (end_reason is null or char_length(end_reason) between 1 and 280),

  constraint staff_responsibility_end_ordered check (ended_at is null or ended_at >= assigned_at),
  constraint staff_responsibility_other_explained check (category <> 'other' or scope_note is not null)
);

comment on table chat.staff_responsibility is
  'Official responsibility LABELS assigned to a staff member. A label grants nothing: no policy or service reads it to decide access. Rows are ended, never edited or deleted, so the history is the table.';

-- One ACTIVE assignment per (staff, category). Ended rows are history and may
-- repeat; this is what stops a double-click or a replayed request from
-- inflating a count.
create unique index staff_responsibility_one_active
  on chat.staff_responsibility (staff_id, category) where ended_at is null;
create index staff_responsibility_org_active_idx
  on chat.staff_responsibility (organization_id, category) where ended_at is null;

-- A responsibility row is a record of an assignment. The only lawful change is
-- ending it, once.
create or replace function chat.guard_staff_responsibility_update()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.staff_id is distinct from old.staff_id
     or new.category is distinct from old.category
     or new.scope_note is distinct from old.scope_note
     or new.assigned_by is distinct from old.assigned_by
     or new.assigned_at is distinct from old.assigned_at then
    raise exception 'a responsibility assignment is immutable; end it and assign a new one'
      using errcode = 'integrity_constraint_violation';
  end if;
  if old.ended_at is not null then
    raise exception 'an ended responsibility assignment cannot change'
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$$;

create trigger staff_responsibility_is_append_only
  before update on chat.staff_responsibility
  for each row execute function chat.guard_staff_responsibility_update();

-- ---------------------------------------------------------------------------
-- 4. Reporting lines
-- ---------------------------------------------------------------------------

create table chat.staff_reporting_line (
  staff_id        uuid primary key references chat.staff (id) on delete cascade,
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  manager_id      uuid not null references chat.staff (id) on delete restrict,
  assigned_by     uuid references chat.staff (id) on delete set null,
  assigned_at     timestamptz not null default now(),

  constraint staff_reporting_line_not_self check (staff_id <> manager_id)
);

comment on table chat.staff_reporting_line is
  'Who a staff member reports to: at most one current manager. Read ONLY to decide which staff profiles a manager may view and edit; it never widens family, conversation or message access. History is in chat.audit_log.';

create index staff_reporting_line_manager_idx on chat.staff_reporting_line (manager_id);

-- The hierarchy is enforced here, whichever code path writes:
--   admin / coverage / finance / technical / academic  -> a manager or the super admin
--   manager                                            -> the super admin
--   super_admin                                        -> nobody
-- With those three rules a cycle is unrepresentable, so no recursive check is
-- needed. The manager must be active: a reporting line to someone who has left
-- is a team nobody runs.
create or replace function chat.guard_staff_reporting_line()
returns trigger
language plpgsql
as $$
declare
  v_staff   chat.staff%rowtype;
  v_manager chat.staff%rowtype;
begin
  select * into v_staff   from chat.staff where id = new.staff_id;
  select * into v_manager from chat.staff where id = new.manager_id;

  if v_staff.id is null or v_manager.id is null then
    raise exception 'reporting line references a staff member that does not exist'
      using errcode = 'foreign_key_violation';
  end if;
  if v_staff.organization_id is distinct from v_manager.organization_id then
    raise exception 'a reporting line cannot cross organizations'
      using errcode = 'insufficient_privilege';
  end if;
  if v_staff.role = 'super_admin' then
    raise exception 'the super admin reports to nobody'
      using errcode = 'check_violation';
  end if;
  if v_manager.role not in ('manager', 'super_admin') then
    raise exception 'only a manager or the super admin can have direct reports'
      using errcode = 'check_violation';
  end if;
  if v_staff.role = 'manager' and v_manager.role <> 'super_admin' then
    raise exception 'a manager reports only to the super admin'
      using errcode = 'check_violation';
  end if;
  if not v_manager.is_active or v_manager.left_at is not null then
    raise exception 'a staff member cannot report to an inactive manager'
      using errcode = 'check_violation';
  end if;

  new.organization_id := v_staff.organization_id;
  return new;
end;
$$;

create trigger staff_reporting_line_is_hierarchical
  before insert or update on chat.staff_reporting_line
  for each row execute function chat.guard_staff_reporting_line();

-- ---------------------------------------------------------------------------
-- 5. Tenancy: a child row always carries its staff member's organization
-- ---------------------------------------------------------------------------
--
-- The column is set FROM the staff row rather than trusted from the writer, so a
-- profile or responsibility cannot be filed under another tenant.

create or replace function chat.staff_profile_child_guard()
returns trigger
language plpgsql
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from chat.staff where id = new.staff_id;
  if v_org is null then
    raise exception 'staff member % does not exist', new.staff_id
      using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  return new;
end;
$$;

create trigger staff_profile_inherits_organization
  before insert or update of staff_id, organization_id on chat.staff_profile
  for each row execute function chat.staff_profile_child_guard();

create trigger staff_responsibility_inherits_organization
  before insert on chat.staff_responsibility
  for each row execute function chat.staff_profile_child_guard();

-- ---------------------------------------------------------------------------
-- 6. Row level security -- deny by default, mirror the service rule
-- ---------------------------------------------------------------------------
--
-- RLS is not yet the live control (RLS-STRATEGY §7: the API still connects as
-- the owner), so AuthorizationService is the boundary today. These policies are
-- written to say the same thing, so that the day the API connects as chat_app
-- nothing here becomes wider than the service. No `using (true)` policy exists
-- on these tables (see the blanket-policy trap noted in RLS-STRATEGY).

-- Does the CURRENT staff member manage this one? Same predicate as
-- StaffProfileService.relationTo(): a direct report, of a caller who is a
-- manager, whose own role is not manager or super_admin.
create or replace function chat.current_staff_manages(p_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select exists (
    select 1
      from chat.staff_reporting_line l
      join chat.staff me     on me.id = l.manager_id
      join chat.staff member on member.id = l.staff_id
     where l.staff_id = p_staff_id
       and l.manager_id = chat.current_staff_id()
       and me.role = 'manager'
       and member.role not in ('manager', 'super_admin')
  )
$$;

comment on function chat.current_staff_manages(uuid) is
  'True when the current staff member is a manager and p_staff_id is one of their direct reports (not a manager, not the super admin).';

alter table chat.staff_profile        enable row level security;
alter table chat.staff_responsibility enable row level security;
alter table chat.staff_reporting_line enable row level security;

create policy staff_profile_organization_isolation on chat.staff_profile
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());
create policy staff_responsibility_organization_isolation on chat.staff_responsibility
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());
create policy staff_reporting_line_organization_isolation on chat.staff_reporting_line
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- Profiles: the owner, their manager, the super admin.
create policy staff_profile_visible on chat.staff_profile for select to authenticated
  using (staff_id = chat.current_staff_id()
         or chat.current_staff_role() = 'super_admin'
         or chat.current_staff_manages(staff_id));
create policy staff_profile_written on chat.staff_profile for insert to authenticated
  with check (staff_id = chat.current_staff_id()
              or chat.current_staff_role() = 'super_admin'
              or chat.current_staff_manages(staff_id));
create policy staff_profile_updated on chat.staff_profile for update to authenticated
  using (staff_id = chat.current_staff_id()
         or chat.current_staff_role() = 'super_admin'
         or chat.current_staff_manages(staff_id))
  with check (staff_id = chat.current_staff_id()
              or chat.current_staff_role() = 'super_admin'
              or chat.current_staff_manages(staff_id));

-- Responsibilities: everyone may READ their own; only the manager of the
-- person or the super admin may assign or end one. A non-super-admin can never
-- write a row about themselves.
create policy staff_responsibility_visible on chat.staff_responsibility for select to authenticated
  using (staff_id = chat.current_staff_id()
         or chat.current_staff_role() = 'super_admin'
         or chat.current_staff_manages(staff_id));
create policy staff_responsibility_assigned on chat.staff_responsibility for insert to authenticated
  with check (chat.current_staff_role() = 'super_admin'
              or chat.current_staff_manages(staff_id));
create policy staff_responsibility_ended on chat.staff_responsibility for update to authenticated
  using (chat.current_staff_role() = 'super_admin' or chat.current_staff_manages(staff_id))
  with check (chat.current_staff_role() = 'super_admin' or chat.current_staff_manages(staff_id));

-- Reporting lines: both ends may read; only the super admin writes.
create policy staff_reporting_line_visible on chat.staff_reporting_line for select to authenticated
  using (staff_id = chat.current_staff_id()
         or manager_id = chat.current_staff_id()
         or chat.current_staff_role() = 'super_admin');
create policy staff_reporting_line_written on chat.staff_reporting_line for insert to authenticated
  with check (chat.current_staff_role() = 'super_admin');
create policy staff_reporting_line_updated on chat.staff_reporting_line for update to authenticated
  using (chat.current_staff_role() = 'super_admin')
  with check (chat.current_staff_role() = 'super_admin');
create policy staff_reporting_line_removed on chat.staff_reporting_line for delete to authenticated
  using (chat.current_staff_role() = 'super_admin');

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------

grant select, insert, update on chat.staff_profile, chat.staff_responsibility, chat.staff_reporting_line
  to authenticated;
grant delete on chat.staff_reporting_line to authenticated;
grant select, insert, update, delete on
  chat.staff_profile, chat.staff_responsibility, chat.staff_reporting_line to service_role;
grant execute on function chat.current_staff_manages(uuid) to authenticated, service_role;
