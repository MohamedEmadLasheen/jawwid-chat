-- =============================================================================
-- Staff profiles on the restricted runtime role (chat_app)
-- =============================================================================
--
-- Depends on 20261013150000 (profile tables), 20261014090000
-- (trusted_staff_actor, caller_is_server_side), 20261014110000. Forward-only.
--
-- WHAT THE PROFILE API NEEDS ON chat_app, AND HOW IT GETS IT
--   It needs facts it must NOT read through broad grants: login facts from
--   chat.account, workload counts across families / conversations /
--   approvals, profile audit history, and an audit WRITE. Each is a narrowly
--   scoped SECURITY DEFINER function that decides on its own who may see what,
--   from the TRUSTED session identity -- never a parameter:
--
--     chat.current_staff_may_view(staff)      self, a direct report of a manager,
--                                             or anyone in the super admin's org
--     chat.staff_login_facts(ids)             has_login, status, last_login_at
--                                             (subject: own row only)
--     chat.staff_workload(ids)                the counts StaffWorkloadService
--     chat.staff_distinct_teachers(ids)       documents, moved here verbatim
--     chat.organization_workload_totals()     super admin only
--     chat.staff_profile_activity(ids, n)     profile audit rows; managers and the
--                                             super admin, for profiles they view
--     chat.record_staff_profile_audit(...)    audit INSERT whose actor is the
--                                             trusted actor (server side: named;
--                                             request role: the session)
--
--   chat.caller_is_server_side() is redefined first: it must name the INVOKING
--   role, which inside a definer function is not current_user.
--
--   On a server-side connection (owner / service) the functions answer for the
--   ids given -- the API has already authorized them -- so ONE implementation
--   serves both connection modes.
--
-- THE TWO HAZARDS IN feat/account-avatar's runtime grants, RESOLVED HERE:
--   * chat_app needs NO privilege on chat.account: identity resolution (login,
--     token -> account -> principal) stays on the server-side connection, and the
--     profile reads login facts through staff_login_facts. No UPDATE grant.
--   * audit writes do not need INSERT on chat.audit_log (which RLS would refuse
--     anyway, there being no insert policy): record_staff_profile_audit writes
--     the row with the trusted actor, so a request role can only ever write
--     audit rows AS ITSELF, for the profile entity.
--
-- One policy is added: a staff member may read their own manager's profile
-- row (job title on "Reports to"), matching what the API shows.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Who is calling -- correct inside SECURITY DEFINER functions too
-- ---------------------------------------------------------------------------
-- 20261014090000 decided "server side" from current_user. Inside a SECURITY
-- DEFINER function current_user is the function OWNER, so a definer function
-- that asked would always hear "server side" -- verified 2026-10-14 (definer:
-- current_user=postgres, role=chat_app). The invoking role is the SET ROLE value
-- when one is set, else the session user. A real chat_app login cannot SET ROLE
-- to the owner or to service_role (verified: permission denied), so this cannot
-- be raised by the caller.
create or replace function chat.invoking_role()
returns name
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select case when current_setting('role') in ('none', '') then session_user
              else current_setting('role')::name end
$$;

create or replace function chat.caller_is_server_side()
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select r.rolsuper
      or pg_has_role(r.rolname, (select c.relowner from pg_class c where c.oid = 'chat.family'::regclass), 'MEMBER')
      or pg_has_role(r.rolname, 'service_role', 'MEMBER')
    from pg_roles r
   where r.rolname = chat.invoking_role()
$$;

create or replace function chat.current_staff_may_view(p_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select exists (
    select 1
      from chat.staff me
      join chat.staff t on t.id = p_staff_id and t.organization_id = me.organization_id
     where me.id = chat.current_staff_id()
       and me.is_active and me.left_at is null
       and (t.id = me.id
            or me.role = 'super_admin'
            or chat.current_staff_manages(t.id))
  )
$$;

-- Ids the caller may see: all of them on the server side, else the viewable ones.
create or replace function chat.viewable_staff_ids(p_staff_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select id from unnest(p_staff_ids) as u(id)
   where chat.caller_is_server_side() or chat.current_staff_may_view(id)
$$;

create or replace function chat.staff_login_facts(p_staff_ids uuid[])
returns table (staff_id uuid, has_login boolean, status text, last_login_at timestamptz, subject text)
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select s.id, a.id is not null, a.status, a.last_login_at,
         case when chat.caller_is_server_side() or s.id = chat.current_staff_id() then a.subject end
    from chat.staff s
    left join chat.account a on a.id = s.account_id
   where s.id in (select chat.viewable_staff_ids(p_staff_ids))
$$;

create or replace function chat.staff_workload(p_staff_ids uuid[])
returns table (
  staff_id uuid, assigned_families int, students int, contacts int, teachers int,
  open_conversations int, awaiting_reply int, pending_approvals int, direct_reports int
)
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  with ids as (
    select s.id, s.organization_id from chat.staff s
     where s.id in (select chat.viewable_staff_ids(p_staff_ids))
  ),
  fam as (
    select f.id, f.owner_id from chat.family f join ids on ids.id = f.owner_id
     where f.organization_id = ids.organization_id and f.state <> 'churned'
  )
  select ids.id,
    (select count(*) from fam where fam.owner_id = ids.id)::int,
    (select count(*) from chat.learner l join fam on fam.id = l.family_id where fam.owner_id = ids.id)::int,
    (select count(*) from chat.contact c join fam on fam.id = c.family_id where fam.owner_id = ids.id and c.is_active)::int,
    (select count(distinct t.id) from chat.learner l join fam on fam.id = l.family_id
       join chat.teacher t on t.id = l.teacher_id
      where fam.owner_id = ids.id and t.is_active and t.left_at is null)::int,
    (select count(*) from chat.conversation c join fam on fam.id = c.family_id
      where fam.owner_id = ids.id and c.archived_at is null and c.resolved_at is null)::int,
    (select count(*) from chat.conversation c join fam on fam.id = c.family_id
      where fam.owner_id = ids.id and c.archived_at is null and c.resolved_at is null
        and c.last_customer_message_at is not null
        and (c.last_staff_message_at is null or c.last_customer_message_at > c.last_staff_message_at))::int,
    (select count(*) from chat.message_approval a join chat.conversation c on c.id = a.conversation_id
       join fam on fam.id = c.family_id where fam.owner_id = ids.id and a.decision = 'pending')::int,
    (select count(*) from chat.staff_reporting_line r join chat.staff m on m.id = r.staff_id
      where r.manager_id = ids.id and m.is_active and m.left_at is null)::int
  from ids
$$;

create or replace function chat.staff_distinct_teachers(p_staff_ids uuid[])
returns int
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select count(distinct t.id)::int
    from chat.learner l
    join chat.family f on f.id = l.family_id
    join chat.staff s on s.id = f.owner_id and s.organization_id = f.organization_id
    join chat.teacher t on t.id = l.teacher_id
   where f.owner_id in (select chat.viewable_staff_ids(p_staff_ids))
     and f.state <> 'churned' and t.is_active and t.left_at is null
$$;

create or replace function chat.organization_workload_totals(p_organization_id uuid)
returns table (
  families int, students_in_families int, active_parent_contacts int, active_teachers int,
  teachers_with_students int, open_conversations int, awaiting_reply int, pending_approvals int,
  families_owned_by_inactive_staff int
)
language plpgsql
stable
security definer
set search_path = chat, pg_temp
as $$
begin
  if not chat.caller_is_server_side() and not exists (
       select 1 from chat.staff me where me.id = chat.current_staff_id() and me.role = 'super_admin'
          and me.is_active and me.organization_id = p_organization_id) then
    raise exception 'the organization totals belong to the super admin' using errcode = 'insufficient_privilege';
  end if;
  return query
  with fam as (
    select f.id, f.owner_id from chat.family f
     where f.organization_id = p_organization_id and f.state <> 'churned'
  )
  select
    (select count(*) from fam)::int,
    (select count(*) from chat.learner l join fam on fam.id = l.family_id)::int,
    (select count(*) from chat.contact c join fam on fam.id = c.family_id where c.is_active)::int,
    (select count(*) from chat.teacher t where t.organization_id = p_organization_id and t.is_active and t.left_at is null)::int,
    (select count(distinct t.id) from chat.learner l join fam on fam.id = l.family_id
       join chat.teacher t on t.id = l.teacher_id where t.is_active and t.left_at is null)::int,
    (select count(*) from chat.conversation c join fam on fam.id = c.family_id
      where c.archived_at is null and c.resolved_at is null)::int,
    (select count(*) from chat.conversation c join fam on fam.id = c.family_id
      where c.archived_at is null and c.resolved_at is null and c.last_customer_message_at is not null
        and (c.last_staff_message_at is null or c.last_customer_message_at > c.last_staff_message_at))::int,
    (select count(*) from chat.message_approval a join chat.conversation c on c.id = a.conversation_id
       join fam on fam.id = c.family_id where a.decision = 'pending')::int,
    (select count(*) from fam join chat.staff s on s.id = fam.owner_id where not s.is_active or s.left_at is not null)::int;
end;
$$;

create or replace function chat.staff_profile_activity(p_staff_ids uuid[], p_limit int)
returns table (id bigint, actor_id uuid, action text, entity_id uuid, before jsonb, after jsonb, reason text, at timestamptz)
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select a.id, a.actor_id, a.action, a.entity_id, a.before, a.after, a.reason, a.at
    from chat.audit_log a
   where a.entity = 'staff_profile'
     and a.entity_id in (select chat.viewable_staff_ids(p_staff_ids))
     and (chat.caller_is_server_side() or chat.current_staff_role() in ('manager', 'super_admin'))
   order by a.at desc, a.id desc
   limit least(greatest(p_limit, 0), 200)
$$;

create or replace function chat.record_staff_profile_audit(
  p_actor_id uuid, p_action text, p_staff_id uuid, p_before jsonb, p_after jsonb, p_reason text
) returns bigint
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  v_actor uuid := chat.trusted_staff_actor(p_actor_id);
  v_id    bigint;
begin
  if p_action !~ '^(staff_profile|staff_responsibility|staff_reporting_line)\.' then
    raise exception 'not a staff-profile audit action: %', p_action using errcode = 'check_violation';
  end if;
  if not chat.caller_is_server_side() and not chat.current_staff_may_view(p_staff_id) then
    raise exception 'the actor may not act on this profile' using errcode = 'insufficient_privilege';
  end if;
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor, p_action, 'staff_profile', p_staff_id, p_before, p_after, p_reason)
  returning id into v_id;
  return v_id;
end;
$$;

-- A staff member reads their own manager's profile row ("Reports to").
drop policy if exists staff_profile_visible_to_reports on chat.staff_profile;
create policy staff_profile_visible_to_reports on chat.staff_profile for select to authenticated
  using (exists (select 1 from chat.staff_reporting_line l
                  where l.staff_id = chat.current_staff_id() and l.manager_id = staff_profile.staff_id));

-- Grants: these functions authorize internally, so the request role may call
-- them; nobody else needs to.
do $grants$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'chat.invoking_role()', 'chat.current_staff_may_view(uuid)', 'chat.viewable_staff_ids(uuid[])',
    'chat.staff_login_facts(uuid[])', 'chat.staff_workload(uuid[])',
    'chat.staff_distinct_teachers(uuid[])', 'chat.organization_workload_totals(uuid)',
    'chat.staff_profile_activity(uuid[], integer)',
    'chat.record_staff_profile_audit(uuid, text, uuid, jsonb, jsonb, text)'] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end
$grants$;

do $assert$
begin
  if has_table_privilege('chat_app', 'chat.account', 'SELECT')
     or has_table_privilege('chat_app', 'chat.account', 'UPDATE')
     or has_table_privilege('chat_app', 'chat.audit_log', 'INSERT') then
    raise exception 'chat_app must not hold direct privileges on chat.account or INSERT on chat.audit_log';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'chat'::regnamespace and p.prosecdef
               and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then
    raise exception 'a SECURITY DEFINER function in chat has no fixed search_path';
  end if;
end
$assert$;
