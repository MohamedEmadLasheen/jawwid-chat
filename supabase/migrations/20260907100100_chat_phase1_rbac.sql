-- Jawwid Chat -- Phase 1: role-based access control, as data.
--
-- Canonical design: docs/architecture/AUTHORIZATION-MODEL.md §2-§3 (PD-5,
-- closed 2026-09-07). Supersedes docs/qa/rbac-matrix.md's role vocabulary.
--
-- Two things change:
--
--  1. THE ROLE VOCABULARY becomes the four canonical staff roles
--     super_admin | manager | admin | coverage_admin.
--     `coverage` is renamed `coverage_admin`. `finance`, `technical` and
--     `academic` were never roles -- they are DEPARTMENTS, a routing attribute
--     for task work -- so they move to chat.staff.department and the staff row
--     takes the `admin` role. A departmental staff member is NOT family-facing:
--     chat.staff_is_family_facing() is false while `department` is set, and
--     chat.family_assignment (next migration) refuses to assign them a family,
--     so they hold no family scope and can reach no family conversation.
--
--  2. PERMISSIONS BECOME DATA. chat.role_permission maps role -> permission
--     key; chat.account_permission_override records per-account ALLOW/DENY.
--     Adding a permission is a migration and a row, not a new `if` in a
--     controller. The TypeScript mirror is asserted equal to this table by a
--     test, so the two can never drift silently.

-- ---------------------------------------------------------------------------
-- 1. The role vocabulary
-- ---------------------------------------------------------------------------

alter table chat.staff add column if not exists department text;

alter table chat.staff drop constraint if exists staff_department_check;
alter table chat.staff
  add constraint staff_department_check
  check (department is null or department in ('finance', 'technical', 'academic'));

comment on column chat.staff.department is
  'Routing attribute for task work, NOT a role (AUTHORIZATION-MODEL.md §2). A '
  'staff member carrying a department completes tasks and never takes part in '
  'family communication.';

-- Move the departments off the role column, then narrow the vocabulary. Order
-- matters: the CHECK cannot be tightened while a legacy value is still stored.
update chat.staff
   set department = role
 where role in ('finance', 'technical', 'academic')
   and department is null;

update chat.staff set role = 'admin'          where role in ('finance', 'technical', 'academic');
update chat.staff set role = 'coverage_admin' where role = 'coverage';

alter table chat.staff drop constraint if exists staff_role_check;
alter table chat.staff
  add constraint staff_role_check
  check (role in ('super_admin', 'manager', 'admin', 'coverage_admin'));

comment on column chat.staff.role is
  'The canonical staff role (PD-5). admin and coverage_admin have identical '
  'permissions and differ only in how scope is granted: an admin holds primary '
  'family assignments, a coverage_admin holds temporary ones.';

-- The on_behalf_mode vocabulary keeps the value `coverage`: it describes how a
-- message was attributed, not who the author is, and renaming it would rewrite
-- history. Only the ROLE was renamed.

-- One definition of "may this staff member take part in family communication",
-- called by every policy and helper below so the rule exists exactly once.
create or replace function chat.staff_is_family_facing(p_staff_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.staff s
     where s.id = p_staff_id
       and s.is_active
       and s.department is null
       and s.role in ('super_admin', 'manager', 'admin', 'coverage_admin'))
$$;

-- "Sees the whole organization" -- managers and above. Used by scope and RLS.
create or replace function chat.staff_is_organization_wide(p_staff_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.staff s
     where s.id = p_staff_id and s.is_active and s.role in ('super_admin', 'manager'))
$$;

-- is_manager() now means "manager or above", so every manager-only policy
-- already written continues to mean what it says and super_admin is not
-- accidentally less privileged than manager.
create or replace function chat.is_manager()
returns boolean
language sql
stable
as $$ select chat.current_staff_role() in ('manager', 'super_admin') $$;

-- ---------------------------------------------------------------------------
-- 2. Functions that inlined the old vocabulary
-- ---------------------------------------------------------------------------

create or replace function chat.may_assist(
  p_staff_id uuid, p_family_id uuid, p_at timestamptz default now()
) returns boolean
language plpgsql
stable
as $$
declare
  v_on_duty      uuid := chat.effective_handler(p_family_id, p_at);
  v_last_message timestamptz;
  v_waiting      numeric;
begin
  if not chat.staff_is_family_facing(p_staff_id) then
    return false;
  end if;
  if v_on_duty is null or v_on_duty = p_staff_id then
    return false;
  end if;

  select c.last_customer_message_at into v_last_message
    from chat.conversation c
   where c.family_id = p_family_id
   order by c.last_customer_message_at desc nulls last
   limit 1;

  if v_last_message is null then
    return false;
  end if;

  if exists (select 1 from chat.event_log e
             where e.family_id = p_family_id and e.type = 'assist_requested'
               and e.actor_id = v_on_duty and e.at >= v_last_message) then
    return true;
  end if;

  if chat.attention_bucket(p_family_id, p_at, v_on_duty) <> 'now' then
    return false;
  end if;

  v_waiting := extract(epoch from (p_at - v_last_message)) / 60.0;
  if v_waiting <= chat.response_target_minutes(p_family_id, p_at)
                  * chat.config_num('assist.min_wait_fraction') then
    return false;
  end if;

  return not exists (
    select 1 from chat.event_log e
    where e.family_id = p_family_id and e.type = 'family_opened'
      and e.actor_id = v_on_duty and e.at >= v_last_message);
end;
$$;

create or replace function chat.staff_may_send(
  p_staff_id uuid, p_family_id uuid, p_mode text, p_at timestamptz default now()
) returns boolean
language plpgsql
stable
as $$
declare
  v_role    text := (select role from chat.staff where id = p_staff_id and is_active);
  v_owner   uuid := (select owner_id from chat.family where id = p_family_id);
  v_handler uuid := chat.effective_handler(p_family_id, p_at);
begin
  -- Departmental staff complete tasks; they never message families.
  if not chat.staff_is_family_facing(p_staff_id) then
    return false;
  end if;

  return case p_mode
    when 'owner'      then p_staff_id = v_owner and p_staff_id = v_handler
    when 'coverage'   then p_staff_id = v_handler and p_staff_id is distinct from v_owner
    when 'assist'     then chat.may_assist(p_staff_id, p_family_id, p_at)
    when 'escalation' then v_role in ('manager', 'super_admin')
    else false
  end;
end;
$$;

-- Ownership: the target of a transfer must be an active, family-facing
-- supervisor. `coverage` no longer exists as a role name.
create or replace function chat.transfer_ownership(
  p_family_id   uuid,
  p_to_staff_id uuid,
  p_reason      text,
  p_actor_id    uuid default null
) returns void
language plpgsql
as $$
declare
  v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_from  uuid;
  v_name  text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'ownership transfer requires a reason' using errcode = 'check_violation';
  end if;

  if chat.staff_role(v_actor) is distinct from 'manager'
     and chat.staff_role(v_actor) is distinct from 'super_admin' then
    raise exception 'only a manager may transfer ownership' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from chat.staff
                 where id = p_to_staff_id and is_active and department is null
                   and role in ('admin', 'coverage_admin')) then
    raise exception 'the new owner must be an active admin or coverage admin'
      using errcode = 'check_violation';
  end if;

  select owner_id, display_name into v_from, v_name
    from chat.family where id = p_family_id for update;

  if v_from is null then
    raise exception 'family % does not exist', p_family_id using errcode = 'no_data_found';
  end if;
  if v_from = p_to_staff_id then
    return;
  end if;

  perform set_config('chat.transferring_ownership', 'on', true);
  update chat.family set owner_id = p_to_staff_id where id = p_family_id;
  perform set_config('chat.transferring_ownership', 'off', true);

  perform chat.write_audit(
    v_actor, 'ownership_transferred', 'family', p_family_id, p_reason,
    jsonb_build_object('owner_id', v_from),
    jsonb_build_object('owner_id', p_to_staff_id));

  perform chat.log_event(
    'ownership_transferred', p_family_id, 'staff', v_actor,
    jsonb_build_object('from_staff_id', v_from, 'to_staff_id', p_to_staff_id,
                       'reason', p_reason, 'family_name', v_name));
end;
$$;

create or replace function chat.offboard_staff(
  p_staff_id    uuid,
  p_reason      text,
  p_to_staff_id uuid default null,
  p_actor_id    uuid default null
) returns table (family_id uuid, new_owner_id uuid)
language plpgsql
as $$
declare
  v_actor     uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_targets   uuid[];
  v_family    record;
  v_index     integer := 0;
  v_new_owner uuid;
  v_orphaned  integer;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'offboarding requires a reason' using errcode = 'check_violation';
  end if;
  if chat.staff_role(v_actor) is distinct from 'manager'
     and chat.staff_role(v_actor) is distinct from 'super_admin' then
    raise exception 'only a manager may offboard staff' using errcode = 'insufficient_privilege';
  end if;

  if p_to_staff_id is not null then
    v_targets := array[p_to_staff_id];
  else
    select array_agg(s.id order by owned.n, s.name)
      into v_targets
      from chat.staff s
      left join lateral (
        select count(*) as n from chat.family f where f.owner_id = s.id
      ) owned on true
     where s.is_active and s.department is null
       and s.role in ('admin', 'coverage_admin') and s.id <> p_staff_id;
  end if;

  if v_targets is null or cardinality(v_targets) = 0 then
    raise exception 'no active admin is available to take over these families'
      using errcode = 'restrict_violation';
  end if;

  for v_family in
    select id from chat.family where owner_id = p_staff_id order by display_name
  loop
    v_new_owner := v_targets[(v_index % cardinality(v_targets)) + 1];
    perform chat.transfer_ownership(
      v_family.id, v_new_owner, format('offboarding: %s', p_reason), v_actor);
    v_index := v_index + 1;
    family_id := v_family.id;
    new_owner_id := v_new_owner;
    return next;
  end loop;

  update chat.staff
     set is_active = false, left_at = coalesce(left_at, now()), presence = 'offline'
   where id = p_staff_id;

  -- Offboarding ends the person's ability to authenticate, in the same
  -- transaction as the reassignment (IDENTITY-MODEL.md §5). A staff member
  -- whose families were reassigned but whose sessions live on is still inside.
  update chat.session s
     set revoked_at = now(), revoked_reason = 'offboarded', revoked_by = v_actor
   from chat.staff st
   where st.id = p_staff_id and s.account_id = st.account_id and s.revoked_at is null;

  update chat.account a
     set status = 'deactivated', deactivated_at = now(),
         deactivated_by = v_actor, deactivated_reason = p_reason
   from chat.staff st
   where st.id = p_staff_id and a.id = st.account_id;

  select count(*) into v_orphaned
    from chat.coverage_rule r
   where r.covering_id = p_staff_id or r.covered_id = p_staff_id;

  perform chat.write_audit(
    v_actor, 'staff_offboarded', 'staff', p_staff_id, p_reason,
    jsonb_build_object('is_active', true),
    jsonb_build_object('is_active', false,
                       'families_transferred', v_index,
                       'orphaned_coverage_rules', v_orphaned));

  perform chat.log_event(
    'ownership_transferred', null, 'staff', v_actor,
    jsonb_build_object('offboarded_staff_id', p_staff_id,
                       'families_transferred', v_index,
                       'orphaned_coverage_rules', v_orphaned));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Permissions as data
-- ---------------------------------------------------------------------------

create table if not exists chat.permission (
  key         text primary key,
  description text not null
);

comment on table chat.permission is
  'The complete permission vocabulary. A key that is not here cannot be granted, '
  'so a typo in a role mapping fails the migration instead of silently granting '
  'nothing (or, worse, being interpreted as a wildcard).';

insert into chat.permission (key, description) values
('conversations.read',    'List and read conversations within scope'),
('conversations.manage',  'Create groups, add or remove members, archive'),
('messages.read',         'Read messages in a readable conversation'),
('messages.send',         'Post in a conversation'),
('messages.delete',       'Delete for everyone beyond the author window'),
('messages.moderate',     'Approve or reject held group messages'),
('messages.internal',     'Read and write internal, staff-only notes'),
('families.read',         'Read family, learners and contacts within scope'),
('families.assign',       'Assign or reassign the supervisor of a family'),
('contacts.view_private', 'Reserved for future private contact fields'),
('calls.start',           'Start a call in a readable conversation'),
('calls.accept',          'Join or answer a call one is invited to'),
('broadcasts.send',       'Send official broadcast messages'),
('audit.read',            'Read the audit log'),
('settings.manage',       'Edit chat.config'),
('users.manage',          'Provision, suspend, deactivate accounts; reset credentials; revoke sessions'),
('sessions.manage',       'List and revoke one''s own sessions')
on conflict (key) do update set description = excluded.description;

create table if not exists chat.role_permission (
  role       text not null check (role in
               ('parent', 'teacher', 'admin', 'coverage_admin', 'manager', 'super_admin')),
  permission text not null references chat.permission (key) on delete cascade,
  primary key (role, permission)
);

comment on table chat.role_permission is
  'The default role -> permission mapping (AUTHORIZATION-MODEL.md §3). This '
  'table is the source of truth; apps/api/src/platform/rbac/permissions.ts '
  'mirrors it and a test asserts the two are identical.';

-- Rebuilt wholesale so the table always equals this migration's intent, even if
-- an earlier version of it granted something this one does not.
delete from chat.role_permission;

insert into chat.role_permission (role, permission)
select r.role, r.permission
from (values
  -- parent: their own family, their own conversations. Scope does the narrowing.
  ('parent', 'conversations.read'), ('parent', 'messages.read'), ('parent', 'messages.send'),
  ('parent', 'families.read'), ('parent', 'calls.start'), ('parent', 'calls.accept'),
  ('parent', 'sessions.manage'),

  -- teacher: identical keys; scope limits them to the groups they teach, and
  -- BR-1 forbids the direct channel regardless of any permission.
  ('teacher', 'conversations.read'), ('teacher', 'messages.read'), ('teacher', 'messages.send'),
  ('teacher', 'families.read'), ('teacher', 'calls.start'), ('teacher', 'calls.accept'),
  ('teacher', 'sessions.manage'),

  -- admin (supervisor)
  ('admin', 'conversations.read'), ('admin', 'conversations.manage'),
  ('admin', 'messages.read'), ('admin', 'messages.send'), ('admin', 'messages.moderate'),
  ('admin', 'messages.internal'), ('admin', 'families.read'),
  ('admin', 'calls.start'), ('admin', 'calls.accept'), ('admin', 'sessions.manage'),

  -- coverage_admin: the same permissions as an admin, on a narrower scope.
  ('coverage_admin', 'conversations.read'), ('coverage_admin', 'conversations.manage'),
  ('coverage_admin', 'messages.read'), ('coverage_admin', 'messages.send'),
  ('coverage_admin', 'messages.moderate'), ('coverage_admin', 'messages.internal'),
  ('coverage_admin', 'families.read'), ('coverage_admin', 'calls.start'),
  ('coverage_admin', 'calls.accept'), ('coverage_admin', 'sessions.manage'),

  -- manager: runs the operation.
  ('manager', 'conversations.read'), ('manager', 'conversations.manage'),
  ('manager', 'messages.read'), ('manager', 'messages.send'), ('manager', 'messages.delete'),
  ('manager', 'messages.moderate'), ('manager', 'messages.internal'),
  ('manager', 'families.read'), ('manager', 'families.assign'),
  ('manager', 'contacts.view_private'), ('manager', 'calls.start'), ('manager', 'calls.accept'),
  ('manager', 'broadcasts.send'), ('manager', 'audit.read'), ('manager', 'settings.manage'),
  ('manager', 'sessions.manage'),

  -- super_admin: everything a manager may, plus user and credential management.
  ('super_admin', 'conversations.read'), ('super_admin', 'conversations.manage'),
  ('super_admin', 'messages.read'), ('super_admin', 'messages.send'),
  ('super_admin', 'messages.delete'), ('super_admin', 'messages.moderate'),
  ('super_admin', 'messages.internal'), ('super_admin', 'families.read'),
  ('super_admin', 'families.assign'), ('super_admin', 'contacts.view_private'),
  ('super_admin', 'calls.start'), ('super_admin', 'calls.accept'),
  ('super_admin', 'broadcasts.send'), ('super_admin', 'audit.read'),
  ('super_admin', 'settings.manage'), ('super_admin', 'users.manage'),
  ('super_admin', 'sessions.manage')
) as r(role, permission)
join chat.permission p on p.key = r.permission;

-- ---------------------------------------------------------------------------
-- 4. Per-account overrides
-- ---------------------------------------------------------------------------

create table if not exists chat.account_permission_override (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references chat.account (id) on delete cascade,
  permission text not null references chat.permission (key) on delete cascade,
  effect     text not null check (effect in ('allow', 'deny')),
  reason     text not null,
  granted_by uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),

  constraint account_permission_override_reason_not_blank
    check (length(btrim(reason)) > 0)
);

create unique index if not exists account_permission_override_unique
  on chat.account_permission_override (account_id, permission);

comment on table chat.account_permission_override is
  'Per-account exceptions to the role default. PRECEDENCE, in order: an '
  'unexpired DENY wins over everything; then an unexpired ALLOW; then the role '
  'default; otherwise denied. A DENY therefore removes a permission the role '
  'grants, which is the whole point -- it is the only way to restrict one '
  'person without inventing a role for them.';

-- The role an account acts as, derived from its principal. One account has
-- exactly one principal, so this is total.
create or replace function chat.account_role(p_account_id uuid)
returns text
language sql
stable
as $$
  select coalesce(
    (select s.role from chat.staff s
      where s.account_id = p_account_id and s.is_active and s.department is null),
    (select 'teacher' from chat.teacher t
      where t.account_id = p_account_id and t.is_active),
    (select 'parent' from chat.contact c
      where c.account_id = p_account_id and c.is_active)
  )
$$;

-- THE resolver. Everything -- SQL, RLS and the API's mirror -- answers
-- "does this account hold this permission" here and nowhere else.
create or replace function chat.account_has_permission(
  p_account_id uuid, p_permission text, p_at timestamptz default now()
) returns boolean
language plpgsql
stable
as $$
declare
  v_role   text;
  v_effect text;
begin
  if p_account_id is null or p_permission is null then
    return false;
  end if;

  -- A non-active account holds nothing, whatever its role or overrides say.
  if not exists (select 1 from chat.account a
                 where a.id = p_account_id and a.status = 'active') then
    return false;
  end if;

  select o.effect into v_effect
    from chat.account_permission_override o
   where o.account_id = p_account_id
     and o.permission = p_permission
     and (o.expires_at is null or o.expires_at > p_at);

  if v_effect = 'deny'  then return false; end if;
  if v_effect = 'allow' then return true;  end if;

  v_role := chat.account_role(p_account_id);
  if v_role is null then
    return false;
  end if;

  return exists (select 1 from chat.role_permission rp
                 where rp.role = v_role and rp.permission = p_permission);
end;
$$;

create or replace function chat.current_has_permission(p_permission text)
returns boolean
language sql
stable
as $$ select chat.account_has_permission(chat.current_account_id(), p_permission) $$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

alter table chat.permission                 enable row level security;
alter table chat.role_permission            enable row level security;
alter table chat.account_permission_override enable row level security;

grant select on chat.permission, chat.role_permission to authenticated;
grant select, insert, update, delete
  on chat.permission, chat.role_permission, chat.account_permission_override to service_role;

-- The vocabulary and the default mapping are not secret: a client needs them to
-- render its own affordances, and hiding them would not remove a permission.
create policy permission_readable on chat.permission for select to authenticated using (true);
create policy role_permission_readable on chat.role_permission for select to authenticated using (true);

-- An override is about one person. Only they, and user management, see it.
create policy account_permission_override_own on chat.account_permission_override
  for select to authenticated
  using (account_id = chat.current_account_id() or chat.current_has_permission('users.manage'));
