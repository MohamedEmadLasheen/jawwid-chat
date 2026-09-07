-- Jawwid Chat -- Phase 1: supervisor scope.
--
-- Canonical design: docs/architecture/SUPERVISOR-OWNERSHIP.md (PD-3, closed
-- 2026-09-07).
--
-- THE INVARIANT
--   A supervisor can only access families within their current authorized
--   scope -- and when a family moves, the previous supervisor loses access on
--   the very next request.
--
-- Before this migration, `family.owner_id` recorded who a family belonged to
-- and NOTHING consulted it for visibility: chat.staff_can_see_family() returned
-- true for every admin, coverage admin and manager. Ownership was attribution,
-- not access.
--
-- chat.family_assignment makes the assignment a first-class, historical fact,
-- and chat.staff_in_scope() is the one predicate every read is filtered by.
-- `family.owner_id` survives as a denormalised mirror of the active primary
-- assignment, maintained by trigger, so every pre-Phase-1 reader still works.

-- ---------------------------------------------------------------------------
-- 1. The assignment
-- ---------------------------------------------------------------------------

create table if not exists chat.family_assignment (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  family_id       uuid not null references chat.family (id) on delete cascade,
  staff_id        uuid not null references chat.staff (id) on delete restrict,
  kind            text not null check (kind in ('primary', 'temporary')),
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,
  assigned_by     uuid references chat.staff (id) on delete set null,
  reason          text not null,
  ended_at        timestamptz,
  ended_by        uuid references chat.staff (id) on delete set null,
  ended_reason    text,
  created_at      timestamptz not null default now(),

  constraint family_assignment_reason_not_blank check (length(btrim(reason)) > 0),
  -- A temporary assignment without an end is a permanent one wearing a
  -- different name, and would silently outlive the cover it was created for.
  constraint family_assignment_temporary_is_bounded
    check (kind = 'primary' or ends_at is not null),
  constraint family_assignment_window_ordered
    check (ends_at is null or ends_at > starts_at)
);

comment on table chat.family_assignment is
  'Who supervises which family, with history. `primary` is the owner (exactly '
  'one live per family); `temporary` is explicit, bounded cover created by a '
  'manager (PD-3). chat.on_duty() is NOT an authorization input.';

-- BR-4: one family, one primary owner.
create unique index if not exists family_assignment_one_live_primary
  on chat.family_assignment (family_id) where kind = 'primary' and ended_at is null;

create index if not exists family_assignment_staff_live_idx
  on chat.family_assignment (staff_id) where ended_at is null;
create index if not exists family_assignment_family_idx on chat.family_assignment (family_id);
create index if not exists family_assignment_organization_idx
  on chat.family_assignment (organization_id);

-- Only an active, family-facing supervisor may hold a family. This is the rule
-- Admin Web enforced in a dialog; a client-side filter is not a control.
create or replace function chat.guard_family_assignment()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from chat.staff s
                 where s.id = new.staff_id and s.is_active and s.department is null
                   and s.role in ('admin', 'coverage_admin')) then
    raise exception
      'a family may only be assigned to an active admin or coverage admin (not %)',
      coalesce((select role from chat.staff where id = new.staff_id), 'unknown')
      using errcode = 'check_violation';
  end if;

  if new.organization_id is distinct from
     (select f.organization_id from chat.family f where f.id = new.family_id) then
    raise exception 'cross-organization assignment refused' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists family_assignment_is_guarded on chat.family_assignment;
create trigger family_assignment_is_guarded
  before insert or update on chat.family_assignment
  for each row execute function chat.guard_family_assignment();

-- family.owner_id mirrors the live primary assignment. The mirror is written
-- here and only here, through the same guarded path ownership already used.
create or replace function chat.mirror_primary_assignment()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'primary' and new.ended_at is null then
    perform set_config('chat.transferring_ownership', 'on', true);
    update chat.family set owner_id = new.staff_id
     where id = new.family_id and owner_id is distinct from new.staff_id;
    perform set_config('chat.transferring_ownership', 'off', true);
  end if;
  return new;
end;
$$;

drop trigger if exists family_assignment_mirrors_owner on chat.family_assignment;
create trigger family_assignment_mirrors_owner
  after insert or update on chat.family_assignment
  for each row execute function chat.mirror_primary_assignment();

-- Backfill: every existing family already has an owner. That owner becomes its
-- live primary assignment, so no family loses its supervisor at cutover.
insert into chat.family_assignment
  (organization_id, family_id, staff_id, kind, starts_at, assigned_by, reason)
select f.organization_id, f.id, f.owner_id, 'primary', f.created_at, null,
       'Phase 1 migration: existing family.owner_id'
  from chat.family f
 where not exists (select 1 from chat.family_assignment a
                    where a.family_id = f.id and a.kind = 'primary' and a.ended_at is null);

-- ---------------------------------------------------------------------------
-- 2. Reassignment, cover and expiry
-- ---------------------------------------------------------------------------

create or replace function chat.assign_family_supervisor(
  p_family_id uuid,
  p_staff_id  uuid,
  p_reason    text,
  p_actor_id  uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_prev  record;
  v_id    uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'assignment requires a reason' using errcode = 'check_violation';
  end if;
  if chat.staff_role(v_actor) not in ('manager', 'super_admin') then
    raise exception 'only a manager may assign a supervisor' using errcode = 'insufficient_privilege';
  end if;

  select * into v_prev from chat.family_assignment
   where family_id = p_family_id and kind = 'primary' and ended_at is null
     for update;

  if v_prev.staff_id = p_staff_id then
    return v_prev.id;
  end if;

  if v_prev.id is not null then
    update chat.family_assignment
       set ended_at = now(), ended_by = v_actor, ended_reason = p_reason
     where id = v_prev.id;
  end if;

  insert into chat.family_assignment
    (family_id, staff_id, kind, assigned_by, reason,
     organization_id)
  values
    (p_family_id, p_staff_id, 'primary', v_actor, p_reason,
     (select organization_id from chat.family where id = p_family_id))
  returning id into v_id;

  perform chat.write_audit(
    v_actor, 'ownership_transferred', 'family', p_family_id, p_reason,
    jsonb_build_object('staff_id', v_prev.staff_id),
    jsonb_build_object('staff_id', p_staff_id));

  perform chat.log_event(
    'ownership_transferred', p_family_id, 'staff', v_actor,
    jsonb_build_object('from_staff_id', v_prev.staff_id, 'to_staff_id', p_staff_id,
                       'reason', p_reason));

  return v_id;
end;
$$;

comment on function chat.assign_family_supervisor is
  'The only way a family changes primary supervisor. Ends the previous '
  'assignment and opens the new one in ONE transaction, so scope is never '
  'ambiguous and never doubled: the previous supervisor is out of scope on the '
  'very next query.';

create or replace function chat.start_family_cover(
  p_family_id uuid,
  p_staff_id  uuid,
  p_ends_at   timestamptz,
  p_reason    text,
  p_actor_id  uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_id    uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'cover requires a reason' using errcode = 'check_violation';
  end if;
  if p_ends_at is null or p_ends_at <= now() then
    raise exception 'cover requires an end in the future' using errcode = 'check_violation';
  end if;
  if chat.staff_role(v_actor) not in ('manager', 'super_admin') then
    raise exception 'only a manager may start cover' using errcode = 'insufficient_privilege';
  end if;

  insert into chat.family_assignment
    (family_id, staff_id, kind, ends_at, assigned_by, reason, organization_id)
  values
    (p_family_id, p_staff_id, 'temporary', p_ends_at, v_actor, p_reason,
     (select organization_id from chat.family where id = p_family_id))
  returning id into v_id;

  perform chat.write_audit(
    v_actor, 'family_cover_started', 'family', p_family_id, p_reason,
    null, jsonb_build_object('staff_id', p_staff_id, 'ends_at', p_ends_at));

  return v_id;
end;
$$;

create or replace function chat.end_family_assignment(
  p_assignment_id uuid, p_reason text, p_actor_id uuid default null
) returns void
language plpgsql
as $$
declare
  v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_row   record;
begin
  select * into v_row from chat.family_assignment where id = p_assignment_id for update;
  if v_row.id is null or v_row.ended_at is not null then
    return;
  end if;
  if v_row.kind = 'primary' then
    raise exception 'a primary assignment ends only by assigning a new supervisor'
      using errcode = 'restrict_violation';
  end if;
  if chat.staff_role(v_actor) not in ('manager', 'super_admin') then
    raise exception 'only a manager may end cover' using errcode = 'insufficient_privilege';
  end if;

  update chat.family_assignment
     set ended_at = now(), ended_by = v_actor, ended_reason = coalesce(p_reason, 'cover ended')
   where id = p_assignment_id;

  perform chat.write_audit(
    v_actor, 'family_cover_ended', 'family', v_row.family_id,
    coalesce(p_reason, 'cover ended'), null,
    jsonb_build_object('staff_id', v_row.staff_id));
end;
$$;

-- Expiry is a fact about time, not a job that has to run: a temporary
-- assignment past its window is out of scope whether or not the worker has
-- swept it. The sweep exists only to make the history tidy.
create or replace function chat.expire_family_assignments(p_at timestamptz default now())
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  update chat.family_assignment
     set ended_at = p_at, ended_reason = 'window expired'
   where kind = 'temporary' and ended_at is null and ends_at is not null and ends_at <= p_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Deactivating a supervisor is refused while they hold ANY live assignment,
-- not merely while they own a family through the mirror column.
create or replace function chat.guard_staff_deactivation()
returns trigger
language plpgsql
as $$
declare
  v_owned    integer;
  v_assigned integer;
begin
  if old.is_active and not new.is_active then
    select count(*) into v_owned from chat.family where owner_id = new.id;
    select count(*) into v_assigned from chat.family_assignment
     where staff_id = new.id and ended_at is null;
    if v_owned > 0 or v_assigned > 0 then
      raise exception
        'cannot deactivate %: still supervising % family/families (% live assignment(s)). '
        'Use chat.offboard_staff() to reassign them first.', old.name, v_owned, v_assigned
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Offboarding must also end temporary cover, or the trigger above would refuse
-- the deactivation offboard_staff() is trying to perform.
create or replace function chat.end_cover_for_staff(p_staff_id uuid, p_reason text)
returns integer
language plpgsql
as $$
declare v_count integer;
begin
  update chat.family_assignment
     set ended_at = now(), ended_reason = p_reason
   where staff_id = p_staff_id and kind = 'temporary' and ended_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. THE scope predicate
-- ---------------------------------------------------------------------------
--
--   parent          -> the family of their contact row
--   teacher         -> the families of the learners they teach
--   admin           -> families assigned to them (primary or live temporary)
--   coverage_admin  -> families with a live temporary assignment to them
--   manager /       -> every family in their organization
--   super_admin
--
-- Everything -- RLS, list endpoints, the moderation queue, search, dashboards
-- -- filters on this. There is no second definition anywhere.

create or replace function chat.staff_family_ids(p_staff_id uuid, p_at timestamptz default now())
returns setof uuid
language sql
stable
as $$
  select f.id
    from chat.family f
   where chat.staff_is_organization_wide(p_staff_id)
     and f.organization_id = (select organization_id from chat.staff where id = p_staff_id)
  union
  select a.family_id
    from chat.family_assignment a
   where a.staff_id = p_staff_id
     and a.ended_at is null
     and a.starts_at <= p_at
     and (a.ends_at is null or a.ends_at > p_at)
$$;

create or replace function chat.staff_in_scope(p_family_id uuid, p_staff_id uuid default null)
returns boolean
language sql
stable
as $$
  select case
    when p_family_id is null then false
    else exists (
      select 1 from chat.staff_family_ids(coalesce(p_staff_id, chat.current_staff_id())) fid
       where fid = p_family_id)
  end
$$;

comment on function chat.staff_in_scope is
  'Is this family inside this supervisor''s CURRENT authorized scope? Derived '
  'live from chat.family_assignment, so a reassignment takes effect on the next '
  'statement -- there is no cache to invalidate and no session to wait out.';

-- staff_can_see_family() is the name every existing policy already calls. Its
-- meaning is corrected here rather than its call sites being rewritten: it used
-- to return true for every admin.
create or replace function chat.staff_can_see_family(p_family_id uuid, p_staff_id uuid default null)
returns boolean
language sql
stable
as $$
  select chat.staff_in_scope(p_family_id, coalesce(p_staff_id, chat.current_staff_id()))
$$;

comment on function chat.staff_can_see_family is
  'CHANGED IN PHASE 1. Before: any admin, coverage or manager could see any '
  'family (red-team A-1/RT-011). Now: assignment scope, with managers and '
  'super_admins organization-wide.';

-- The families a teacher reaches, through the learners they teach.
create or replace function chat.teacher_family_ids(p_teacher_id uuid)
returns setof uuid
language sql
stable
as $$
  select distinct l.family_id from chat.learner l where l.teacher_id = p_teacher_id
$$;

-- The families the current caller reaches, whichever kind of principal they are.
-- One function, so a new list endpoint cannot invent its own answer.
create or replace function chat.current_family_ids()
returns setof uuid
language sql
stable
as $$
  select family_id from chat.contact
   where account_id = chat.current_account_id() and is_active
  union
  select l.family_id from chat.learner l
    join chat.teacher t on t.id = l.teacher_id
   where t.account_id = chat.current_account_id() and t.is_active
  union
  select f from chat.staff_family_ids(chat.current_staff_id()) f
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants and tenancy
-- ---------------------------------------------------------------------------

alter table chat.family_assignment enable row level security;

drop policy if exists family_assignment_organization_isolation on chat.family_assignment;
create policy family_assignment_organization_isolation on chat.family_assignment
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

grant select on chat.family_assignment to authenticated;
grant select, insert, update, delete on chat.family_assignment to service_role;

-- A supervisor sees their own assignments; a manager sees the organization's.
create policy family_assignment_visible on chat.family_assignment for select to authenticated
  using (staff_id = chat.current_staff_id()
         or chat.staff_is_organization_wide(chat.current_staff_id()));

-- ---------------------------------------------------------------------------
-- 5. The legacy entry points now write through the assignment
-- ---------------------------------------------------------------------------
--
-- chat.transfer_ownership() is the name the rest of the schema, the ingestion
-- path and the Admin Web contract already call. Its SEMANTICS are unchanged
-- (manager only, reason required, audit and event in the same transaction);
-- what changes is where the truth lands. Writing chat.family.owner_id directly
-- would leave the assignment history -- and therefore every scope decision --
-- stale, so it now delegates and the mirror trigger updates owner_id.

create or replace function chat.transfer_ownership(
  p_family_id   uuid,
  p_to_staff_id uuid,
  p_reason      text,
  p_actor_id    uuid default null
) returns void
language plpgsql
as $$
begin
  perform chat.assign_family_supervisor(p_family_id, p_to_staff_id, p_reason, p_actor_id);
end;
$$;

comment on function chat.transfer_ownership is
  'Kept as the stable entry point; delegates to chat.assign_family_supervisor(). '
  'chat.family.owner_id is now a mirror of the live primary assignment.';

-- Offboarding must release temporary cover too, or the deactivation guard would
-- refuse the very deactivation offboarding is performing.
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
  v_cover     integer;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'offboarding requires a reason' using errcode = 'check_violation';
  end if;
  if chat.staff_role(v_actor) not in ('manager', 'super_admin') then
    raise exception 'only a manager may offboard staff' using errcode = 'insufficient_privilege';
  end if;

  if p_to_staff_id is not null then
    v_targets := array[p_to_staff_id];
  else
    select array_agg(s.id order by owned.n, s.name)
      into v_targets
      from chat.staff s
      left join lateral (
        select count(*) as n
          from chat.family_assignment a
         where a.staff_id = s.id and a.kind = 'primary' and a.ended_at is null
      ) owned on true
     where s.is_active and s.department is null
       and s.role in ('admin', 'coverage_admin') and s.id <> p_staff_id;
  end if;

  if v_targets is null or cardinality(v_targets) = 0 then
    raise exception 'no active admin is available to take over these families'
      using errcode = 'restrict_violation';
  end if;

  for v_family in
    select a.family_id as id
      from chat.family_assignment a
      join chat.family f on f.id = a.family_id
     where a.staff_id = p_staff_id and a.kind = 'primary' and a.ended_at is null
     order by f.display_name
  loop
    v_new_owner := v_targets[(v_index % cardinality(v_targets)) + 1];
    perform chat.assign_family_supervisor(
      v_family.id, v_new_owner, format('offboarding: %s', p_reason), v_actor);
    v_index := v_index + 1;
    family_id := v_family.id;
    new_owner_id := v_new_owner;
    return next;
  end loop;

  v_cover := chat.end_cover_for_staff(p_staff_id, format('offboarding: %s', p_reason));

  update chat.staff
     set is_active = false, left_at = coalesce(left_at, now()), presence = 'offline'
   where id = p_staff_id;

  -- Access ends with the role. Sessions are revoked and the account is
  -- deactivated in the SAME transaction as the reassignment, so there is no
  -- window in which someone with no families still holds a live token.
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
                       'cover_ended', v_cover,
                       'orphaned_coverage_rules', v_orphaned));

  perform chat.log_event(
    'ownership_transferred', null, 'staff', v_actor,
    jsonb_build_object('offboarded_staff_id', p_staff_id,
                       'families_transferred', v_index,
                       'orphaned_coverage_rules', v_orphaned));
end;
$$;

-- Every path that creates a family opens its primary assignment. A trigger
-- rather than an edit to each caller: chat.family.owner_id is NOT NULL, so the
-- owner is known at insert, and a creation path added later cannot forget.
create or replace function chat.open_primary_assignment_for_new_family()
returns trigger
language plpgsql
as $$
begin
  insert into chat.family_assignment
    (organization_id, family_id, staff_id, kind, assigned_by, reason)
  values
    (new.organization_id, new.id, new.owner_id, 'primary', null,
     'family created with this supervisor')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists family_opens_primary_assignment on chat.family;
create trigger family_opens_primary_assignment
  after insert on chat.family
  for each row execute function chat.open_primary_assignment_for_new_family();

-- The Jawwid Core ingestion path names the first supervisor. Only the role
-- vocabulary changes: `coverage` no longer exists, and a super_admin is not
-- less privileged than a manager.
create or replace function chat.assign_family_owner(
  p_core_parent_id uuid,
  p_owner_id       uuid,
  p_reason         text,
  p_actor_id       uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_actor           uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_inbox           chat.core_parent_inbox%rowtype;
  v_family_id       uuid;
  v_contact         uuid;
  v_conversation_id uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'assigning an owner requires a reason' using errcode = 'check_violation';
  end if;
  if chat.staff_role(v_actor) not in ('manager', 'super_admin') then
    raise exception 'only a manager may assign a family owner'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from chat.staff
                 where id = p_owner_id and is_active and department is null
                   and role in ('admin', 'coverage_admin')) then
    raise exception 'the owner must be an active admin or coverage admin'
      using errcode = 'check_violation';
  end if;

  select * into v_inbox from chat.core_parent_inbox where core_parent_id = p_core_parent_id;
  if not found then
    raise exception 'no waiting Jawwid Core parent with id %', p_core_parent_id
      using errcode = 'no_data_found';
  end if;

  insert into chat.family (display_name, owner_id, language, core_parent_id)
  values (coalesce(v_inbox.display_name, 'Family'), p_owner_id,
          coalesce(v_inbox.language, 'ar'), p_core_parent_id)
  returning id into v_family_id;

  insert into chat.contact (family_id, name, relationship, role_preset,
                            can_message, can_view_progress, can_manage_schedule,
                            can_manage_billing, can_manage_contacts, can_cancel)
  values (v_family_id, coalesce(v_inbox.display_name, 'Parent'), 'parent',
          'primary_guardian', true, true, true, true, true, true)
  returning id into v_contact;

  update chat.family set primary_contact_id = v_contact where id = v_family_id;

  insert into chat.conversation (type, family_id, direct_key, title)
  values ('direct', v_family_id, 'family:' || v_family_id::text, 'Jawwid')
  returning id into v_conversation_id;

  insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
  values (v_conversation_id, 'contact', v_contact, 'parent');

  insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
  values (v_conversation_id, 'staff', p_owner_id, 'admin');

  delete from chat.core_parent_inbox where core_parent_id = p_core_parent_id;

  perform chat.write_audit(v_actor, 'family_owner_assigned', 'family', v_family_id, p_reason,
                           null, jsonb_build_object('owner_id', p_owner_id));
  perform chat.log_event('subscription_synced', v_family_id, 'staff', v_actor,
                         jsonb_build_object('created', true, 'core_parent_id', p_core_parent_id));
  return v_family_id;
end;
$$;
