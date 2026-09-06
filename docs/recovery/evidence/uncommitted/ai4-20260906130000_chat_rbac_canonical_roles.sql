-- Jawwid Chat -- canonical RBAC roles (PRD v0.1 section 3).
--
-- PRD role vocabulary:
--   parent · student · teacher · admin · coverage_admin · manager · super_admin
--
-- chat.staff holds Jawwid's INTERNAL staff, so only the staff-side subset is
-- valid here: admin, coverage_admin, manager, super_admin.
--   · parent  lives in chat.contact
--   · teacher is a separate identity that does not yet exist (D-4). This
--     migration deliberately does NOT create it.
--
-- WHAT THIS MIGRATION CHANGES
--   1. 'coverage'                    -> 'coverage_admin'   (rename, evidence below)
--   2. 'super_admin'                 -> added
--   3. 'finance','technical','academic' -> demoted to LEGACY, moved to
--      chat.staff.department, and blocked from any new assignment.
--
-- EVIDENCE FOR coverage -> coverage_admin (not assumed):
--   · PRD section 3 defines coverage_admin as "Coverage supervisor", scoped to
--     "families routed to her by the coverage schedule during the active
--     coverage window".
--   · chat.staff_can_see_family already grants role 'coverage' the same family
--     visibility as 'admin'; chat.assign_family_owner and
--     chat.transfer_ownership already accept 'coverage' as an owner.
--   · docs/qa/rbac-matrix.md models 'coverage' as the coverage supervisor with
--     "same permissions as admin -- role label only".
--   These describe the same actor, so this is a rename, not a remapping.
--
-- WHY finance/technical/academic ARE NOT SIMPLY DELETED
--   They are not authorization roles in the PRD, but they do encode real
--   operational data: which internal department a staff member belongs to, for
--   task routing. chat.task.type is already ('finance','technical','academic',
--   'other'), and chat.staff_can_see_family's ELSE branch is what limits such
--   staff to families where they hold a task. Deleting the values would delete
--   the department membership and silently change that behaviour.
--
--   So the concept moves to chat.staff.department, the legacy role values are
--   retained for existing rows only, and a trigger makes them unassignable.
--
--   UNRESOLVED (documented, not guessed): the PRD defines no staff role for
--   internal department users. Until product answers, such users keep their
--   legacy role value and gain a department; no new ones can be created.
--   See docs/integration/rbac-canonicalization.md section 11.

-- ---------------------------------------------------------------------------
-- 1 · Department -- preserve the operational concept before touching roles
-- ---------------------------------------------------------------------------

alter table chat.staff add column if not exists department text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_department_check') then
    alter table chat.staff add constraint staff_department_check
      check (department is null or department in ('finance', 'technical', 'academic'));
  end if;
end $$;

comment on column chat.staff.department is
  'Operational department for task routing. NOT an authorization role -- authorization is chat.staff.role (PRD section 3).';

update chat.staff
   set department = role
 where role in ('finance', 'technical', 'academic')
   and department is null;

-- ---------------------------------------------------------------------------
-- 2 · Rename the coverage role on existing data
-- ---------------------------------------------------------------------------

update chat.staff set role = 'coverage_admin' where role = 'coverage';

-- ---------------------------------------------------------------------------
-- 3 · Canonical constraint (legacy values retained for existing rows only)
-- ---------------------------------------------------------------------------

alter table chat.staff drop constraint if exists staff_role_check;
alter table chat.staff add constraint staff_role_check check (
  role in (
    -- canonical, assignable (PRD section 3, staff-side subset)
    'admin', 'coverage_admin', 'manager', 'super_admin',
    -- legacy, migration-only: existing rows survive, new rows are refused by
    -- chat.reject_legacy_staff_role() below
    'finance', 'technical', 'academic'
  )
);

create or replace function chat.reject_legacy_staff_role()
returns trigger language plpgsql as $$
declare
  legacy constant text[] := array['finance', 'technical', 'academic', 'coverage'];
begin
  -- Fail closed: a legacy value may persist on a row that already had it, but
  -- may never be introduced or moved onto another row.
  if new.role = any (legacy) then
    if tg_op = 'INSERT' then
      raise exception
        'chat.staff.role %L is a legacy value and cannot be assigned. Canonical roles are admin, coverage_admin, manager, super_admin (PRD section 3); use chat.staff.department for finance/technical/academic.',
        new.role using errcode = 'check_violation';
    elsif old.role is distinct from new.role then
      raise exception
        'chat.staff.role cannot be changed to the legacy value %L (PRD section 3).',
        new.role using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_role_canonical on chat.staff;
create trigger staff_role_canonical
  before insert or update of role on chat.staff
  for each row execute function chat.reject_legacy_staff_role();

-- ---------------------------------------------------------------------------
-- 4 · Dependent functions -- role lists only; every other semantic is preserved
-- ---------------------------------------------------------------------------

-- Family-facing roles. super_admin is "everything" (PRD section 3), so it joins
-- manager wherever manager appears.
create or replace function chat.family_facing_roles()
returns text[] language sql immutable as $$
  select array['admin', 'coverage_admin', 'manager', 'super_admin']::text[];
$$;

-- Roles that may OWN a family (PRD BR-4: the owner is an admin).
create or replace function chat.family_owner_roles()
returns text[] language sql immutable as $$
  select array['admin', 'coverage_admin']::text[];
$$;

create or replace function chat.staff_can_see_family(p_family_id uuid, p_staff_id uuid default null::uuid)
returns boolean language sql stable security definer set search_path to 'chat', 'pg_temp' as $$
  select case coalesce((select role from chat.staff where id = coalesce(p_staff_id, chat.current_staff_id())), '')
    when 'manager'        then true
    when 'super_admin'    then true
    when 'admin'          then true
    when 'coverage_admin' then true
    when ''               then false
    -- Department staff (legacy finance/technical/academic) see only families
    -- where they hold a task. Unchanged.
    else exists (
      select 1 from chat.task t
      where t.family_id = p_family_id
        and t.owner_id = coalesce(p_staff_id, chat.current_staff_id()))
  end
$$;

create or replace function chat.may_assist(p_staff_id uuid, p_family_id uuid, p_at timestamptz default now())
returns boolean language plpgsql stable as $$
declare
  v_on_duty      uuid := chat.effective_handler(p_family_id, p_at);
  v_role         text := (select role from chat.staff where id = p_staff_id);
  v_last_message timestamptz;
  v_waiting      numeric;
begin
  if v_role is null or not (v_role = any (chat.family_facing_roles())) then
    return false;
  end if;
  if v_on_duty is null or v_on_duty = p_staff_id then
    return false;
  end if;

  select last_customer_message_at into v_last_message
  from chat.thread where family_id = p_family_id;

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

create or replace function chat.staff_may_send(p_staff_id uuid, p_family_id uuid, p_mode text, p_at timestamptz default now())
returns boolean language plpgsql stable as $$
declare
  v_role    text := (select role from chat.staff where id = p_staff_id and is_active);
  v_owner   uuid := (select owner_id from chat.family where id = p_family_id);
  v_handler uuid := chat.effective_handler(p_family_id, p_at);
begin
  -- Department staff never message families (PRD section 3: they see and
  -- complete their own tasks only).
  if v_role is null or not (v_role = any (chat.family_facing_roles())) then
    return false;
  end if;

  -- NOTE: the literals below are chat.message.on_behalf_mode values, NOT roles.
  -- 'coverage' here is the handling mode from PRD section 5.2 and is deliberately
  -- NOT renamed.
  return case p_mode
    when 'owner'      then p_staff_id = v_owner and p_staff_id = v_handler
    when 'coverage'   then p_staff_id = v_handler and p_staff_id is distinct from v_owner
    when 'assist'     then chat.may_assist(p_staff_id, p_family_id, p_at)
    when 'escalation' then v_role in ('manager', 'super_admin')
                           or exists (select 1 from chat.support_case c
                                      where c.family_id = p_family_id
                                        and c.escalated_to_id = p_staff_id
                                        and c.status not in ('resolved', 'closed'))
    else false
  end;
end;
$$;

-- Manager-gated operations: super_admin is "everything", so it is accepted too.
do $fns$
declare
  f record;
  src text;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'chat'
       and p.proname in ('offboard_staff', 'assign_family_owner', 'transfer_ownership')
  loop
    src := pg_get_functiondef(f.oid);
    -- manager gate -> manager or super_admin
    src := replace(src,
      'chat.staff_role(v_actor) is distinct from ''manager''',
      'chat.staff_role(v_actor) not in (''manager'', ''super_admin'')');
    -- who may own a family
    src := replace(src, 'role in (''admin'', ''coverage'')', 'role = any (chat.family_owner_roles())');
    src := replace(src, 's.role in (''admin'', ''coverage'')', 's.role = any (chat.family_owner_roles())');
    execute src;
  end loop;
end
$fns$;

-- ---------------------------------------------------------------------------
-- 5 · Dependent RLS policies
-- ---------------------------------------------------------------------------
--
-- Rewritten programmatically from their own current definitions, so only the
-- role array changes and no policy semantics can drift. The target array
-- ARRAY['admin','coverage','manager'] is compared against
-- chat.current_staff_role() and appears nowhere else, so the replacement is
-- unambiguous.

do $pol$
declare
  p record;
  new_qual text;
  new_check text;
  stmt text;
  old_arr constant text := '(ARRAY[''admin''::text, ''coverage''::text, ''manager''::text])';
  new_arr constant text := '(ARRAY[''admin''::text, ''coverage_admin''::text, ''manager''::text, ''super_admin''::text])';
begin
  for p in
    select pol.schemaname, pol.tablename, pol.policyname, pol.permissive, pol.roles,
             pol.cmd as command, pol.qual, pol.with_check
      from pg_policies pol
     where pol.schemaname = 'chat'
       and (coalesce(pol.qual, '') || coalesce(pol.with_check, '')) like '%current_staff_role%'
  loop
    new_qual  := replace(coalesce(p.qual, ''), old_arr, new_arr);
    new_check := replace(coalesce(p.with_check, ''), old_arr, new_arr);

    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);

    stmt := format('create policy %I on %I.%I as %s for %s to %s',
                  p.policyname, p.schemaname, p.tablename,
                  case when p.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
                  lower(p.command),
                  array_to_string(p.roles, ', '));
    if coalesce(p.qual, '') <> '' then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if coalesce(p.with_check, '') <> '' then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;
    execute stmt;
  end loop;
end
$pol$;
