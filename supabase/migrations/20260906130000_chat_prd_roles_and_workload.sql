-- Jawwid Chat -- PRD v0.1 conformance: the canonical role model (D-1) and the
-- fourth workload state (D-2).
--
-- AUTHORITY
--   docs/product/jawwid-chat-prd-v0.1.md, sha256 3e63ec01...a1b697.
--   Plan: docs/integration/02-domain-conformance-plan.md, gates D-1 and D-2.
--   Product decisions: X-1 (roles), applied verbatim.
--
-- D-1 -- PRD section 3 defines the role set exactly:
--     parent, student, teacher, admin, coverage_admin, manager, super_admin
--   This database had ('admin','coverage','manager','finance','technical','academic'),
--   which is the superseded brief's set. Four defects, all corrected here:
--     (a) super_admin was absent -- PRD section 3 grants it "Everything, plus
--         users, roles, policies, templates, automations, integrations, audit
--         logs", and section 11.1 scopes contact data to "manager and
--         super_admin endpoints".
--     (b) the coverage role was named `coverage`, not `coverage_admin`.
--     (c) finance / technical / academic are NOT PRD roles.
--     (d) teacher / parent / student are PRD roles, not external actors.
--
-- X-1 ON DEPARTMENTS -- "Remove finance, technical and academic as RBAC roles...
--   DO NOT delete or discard department/task-routing concepts if they represent
--   operational departments rather than identity roles."
--   The department concept is ALREADY separate: chat.task.type carries
--   ('finance','technical','academic','other') and is untouched by this
--   migration. chat.staff.department is added so a staff member's operational
--   department survives independently of their RBAC role.
--
-- D-2 -- PRD section 5.3 states four workload states: Low, Medium, High,
--   Critical. "State changes to High or Critical notify the manager; Critical
--   can optionally open the owner's families to a coverage admin." The optional
--   coverage escalation is Phase 2 (section 13 row 11) and is NOT built here;
--   the STATE is MVP and was missing.
--
-- STILL OPEN, DELIBERATELY NOT DECIDED HERE
--   * The critical threshold value is part of the PRD's own open question 6
--     (section 15.2) -- "the initial workload weights and thresholds". The key
--     below is a placeholder so the mechanism is testable; it is not a tuned
--     value and is marked as such.
--   * What RBAC role a departmental staff member holds. The PRD has no such
--     role. This migration refuses to guess -- see the guard below.

-- ---------------------------------------------------------------------------
-- 1. Departments become a domain concept, separate from RBAC (X-1)
-- ---------------------------------------------------------------------------

alter table chat.staff
  add column if not exists department text
    check (department is null or department in ('finance', 'technical', 'academic'));

comment on column chat.staff.department is
  'Operational department, NOT an RBAC role (PRD section 3 has no departmental '
  'roles; product decision X-1 keeps the concept but separates it from '
  'identity). Task routing continues to use chat.task.type, which is '
  'independent of this column and of chat.staff.role.';

-- Carry any departmental role across before the role set narrows.
update chat.staff
   set department = role
 where role in ('finance', 'technical', 'academic')
   and department is null;

-- ---------------------------------------------------------------------------
-- 2. Refuse to guess an RBAC role for departmental staff
-- ---------------------------------------------------------------------------
-- PRD section 3 offers no role for someone who only completes tasks and never
-- messages families. Silently mapping them to `admin` would grant family access
-- they never had; silently deactivating them would remove a working account.
-- Both are product decisions. On an empty database this is a no-op.

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from chat.staff
   where role in ('finance', 'technical', 'academic');

  if v_count > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = format(
        '%s staff row(s) hold a departmental role. PRD v0.1 section 3 defines no '
        'RBAC role for departmental staff, so this migration will not choose one.',
        v_count),
      hint =
        'Resolve open decision X-6 (see docs/integration/02-domain-conformance-plan.md), '
        'set chat.staff.role to a PRD role and chat.staff.department to the '
        'department, then re-run.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The canonical role set (D-1)
-- ---------------------------------------------------------------------------

update chat.staff set role = 'coverage_admin' where role = 'coverage';

alter table chat.staff drop constraint if exists staff_role_check;
alter table chat.staff
  add constraint staff_role_check check (role in
    ('parent', 'student', 'teacher', 'admin', 'coverage_admin', 'manager', 'super_admin'));

comment on column chat.staff.role is
  'PRD v0.1 section 3, exactly: parent, student, teacher, admin, coverage_admin, '
  'manager, super_admin. `coverage` was the superseded brief''s name for '
  'coverage_admin; finance / technical / academic were never PRD roles and are '
  'now chat.staff.department.';

-- ---------------------------------------------------------------------------
-- 4. Role predicates -- one definition each, so the next role change is local
-- ---------------------------------------------------------------------------

-- PRD section 3: super_admin is "Everything". Every manager-gated policy in
-- 20260905091200 calls chat.is_manager(), so widening it here reaches all of
-- them without recreating a single policy.
create or replace function chat.is_manager()
returns boolean
language sql
stable
as $$ select chat.current_staff_role() in ('manager', 'super_admin') $$;

comment on function chat.is_manager is
  'True for manager and super_admin. PRD section 3 gives super_admin everything '
  'the manager has and more; the extra super_admin-only surfaces (users, roles, '
  'policies, templates, integrations) are application concerns, not RLS ones.';

-- The staff who work families. Replaces the inline
-- ('admin','coverage','manager') list that appeared in ten policies.
create or replace function chat.is_family_staff()
returns boolean
language sql
stable
as $$ select chat.current_staff_role()
              in ('admin', 'coverage_admin', 'manager', 'super_admin') $$;

comment on function chat.is_family_staff is
  'Staff who may work a family: admin, coverage_admin, manager, super_admin. '
  'One definition, so a future role change is a one-line edit rather than a '
  'sweep across ten RLS policies.';

-- ---------------------------------------------------------------------------
-- 5. Functions carrying the old role literals
-- ---------------------------------------------------------------------------

create or replace function chat.staff_can_see_family(p_family_id uuid, p_staff_id uuid default null)
returns boolean
language sql
stable
as $$
  select case coalesce((select role from chat.staff
                         where id = coalesce(p_staff_id, chat.current_staff_id())), '')
    when 'manager'        then true
    when 'super_admin'    then true
    when 'admin'          then true
    when 'coverage_admin' then true
    when ''               then false
    else exists (
      select 1 from chat.task t
      where t.family_id = p_family_id
        and t.owner_id = coalesce(p_staff_id, chat.current_staff_id()))
  end
$$;

comment on function chat.staff_can_see_family is
  'PRD section 3 scopes: manager and super_admin see everything; admin and '
  'coverage_admin see the families they work. Anyone else sees only families '
  'they hold a task on, and never messages them.';

create or replace function chat.may_assist(
  p_staff_id uuid, p_family_id uuid, p_at timestamptz default now()
) returns boolean
language plpgsql
stable
as $$
declare
  v_on_duty      uuid := chat.effective_handler(p_family_id, p_at);
  v_role         text := (select role from chat.staff where id = p_staff_id);
  v_last_message timestamptz;
  v_waiting      numeric;
begin
  if v_role not in ('admin', 'coverage_admin', 'manager', 'super_admin') then
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
  -- Departmental staff never message families (they now carry a PRD role plus
  -- chat.staff.department; the role test below is what stops them).
  if v_role is null or v_role not in ('admin', 'coverage_admin', 'manager', 'super_admin') then
    return false;
  end if;

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

-- Ownership invariants and the Core integration owner check both asserted the
-- target of a transfer is an admin or coverage admin.
create or replace function chat.is_ownership_eligible(p_staff_id uuid)
returns boolean
language sql
stable
as $$
  select exists (select 1 from chat.staff
                  where id = p_staff_id and is_active
                    and role in ('admin', 'coverage_admin'))
$$;

comment on function chat.is_ownership_eligible is
  'BR-4: a family''s primary owner is an admin. coverage_admin is included '
  'because 20260905090700 and 20260905090900 both already allowed it as a '
  'transfer target; this migration renames the role without widening the rule.';

-- ---------------------------------------------------------------------------
-- 6. RLS policies that inlined the old role list
-- ---------------------------------------------------------------------------
-- Recreated against chat.is_family_staff(). Manager-gated policies are NOT
-- recreated: they call chat.is_manager(), which section 4 already widened.

drop policy if exists family_edited_by_admins on chat.family;
create policy family_edited_by_admins on chat.family for update to authenticated
  using (chat.is_family_staff() and chat.staff_can_see_family(id))
  with check (chat.is_family_staff());

drop policy if exists contact_edited_by_admins on chat.contact;
create policy contact_edited_by_admins on chat.contact for all to authenticated
  using (chat.is_family_staff() and chat.staff_can_see_family(family_id))
  with check (chat.is_family_staff());

drop policy if exists learner_edited_by_admins on chat.learner;
create policy learner_edited_by_admins on chat.learner for all to authenticated
  using (chat.is_family_staff() and chat.staff_can_see_family(family_id))
  with check (chat.is_family_staff());

drop policy if exists family_note_visible_to_staff on chat.family_note;
create policy family_note_visible_to_staff on chat.family_note for select to authenticated
  using (chat.is_family_staff());

drop policy if exists family_note_written_by_admins on chat.family_note;
create policy family_note_written_by_admins on chat.family_note for insert to authenticated
  with check (chat.is_family_staff() and author_id = chat.current_staff_id());

drop policy if exists thread_edited_by_admins on chat.thread;
create policy thread_edited_by_admins on chat.thread for update to authenticated
  using (chat.is_family_staff() and chat.staff_can_see_family(family_id))
  with check (chat.is_family_staff());

drop policy if exists message_written_by_staff on chat.message;
create policy message_written_by_staff on chat.message for insert to authenticated
  with check (
    author_type = 'staff'
    and author_id = chat.current_staff_id()
    and (
      (visibility = 'internal' and chat.is_family_staff())
      or
      (visibility = 'customer'
       and chat.staff_may_send(
             chat.current_staff_id(),
             (select t.family_id from chat.thread t where t.id = thread_id),
             on_behalf_mode))
    ));

drop policy if exists task_created_by_admins on chat.task;
create policy task_created_by_admins on chat.task for insert to authenticated
  with check (chat.is_family_staff() and chat.staff_can_see_family(family_id));

drop policy if exists task_updated_by_assignee_or_admins on chat.task;
create policy task_updated_by_assignee_or_admins on chat.task for update to authenticated
  using (owner_id = chat.current_staff_id()
         or (chat.is_family_staff() and chat.staff_can_see_family(family_id)))
  with check (owner_id = chat.current_staff_id() or chat.is_family_staff());

drop policy if exists handoff_written_by_admins on chat.handoff;
create policy handoff_written_by_admins on chat.handoff for insert to authenticated
  with check (chat.is_family_staff());

drop policy if exists event_log_visible_to_staff on chat.event_log;
create policy event_log_visible_to_staff on chat.event_log for select to authenticated
  using (chat.is_family_staff()
         and (family_id is null or chat.staff_can_see_family(family_id)));

-- chat.support_case is being removed by the OD-01 conversation reconciliation.
-- Recreate its policy only while the table still exists, so this migration is
-- correct both before and after that work lands.
do $$
begin
  if exists (select 1 from pg_tables
              where schemaname = 'chat' and tablename = 'support_case') then
    execute 'drop policy if exists case_edited_by_admins on chat.support_case';
    execute $p$
      create policy case_edited_by_admins on chat.support_case for all to authenticated
        using (chat.is_family_staff() and chat.staff_can_see_family(family_id))
        with check (chat.is_family_staff())
    $p$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. D-2 -- the fourth workload state
-- ---------------------------------------------------------------------------

insert into chat.config (key, value, scope, description) values
  ('workload.level.critical', '25', 'workload',
   'PLACEHOLDER, NOT A TUNED VALUE. PRD v0.1 section 5.3 requires a Critical '
   'state; section 15.2 open question 6 leaves the initial workload thresholds '
   'to M0. This exists so the mechanism is testable and must be set from real '
   'operational data before launch.')
on conflict (key) do nothing;

create or replace function chat.workload_level(p_staff_id uuid, p_at timestamptz default now())
returns text
language plpgsql
stable
as $$
declare
  v_score       numeric := chat.workload_score(p_staff_id, p_at);
  v_high        numeric := coalesce((select capacity_override from chat.staff where id = p_staff_id),
                                    chat.config_num('workload.level.high'));
  v_critical    numeric := chat.config_num('workload.level.critical');
  v_needs_reply integer;
begin
  select count from chat.workload_units(p_staff_id, p_at) into v_needs_reply
   where unit = 'needs_reply';

  if v_score >= v_critical then
    return 'CRITICAL';
  end if;

  -- A burst of unanswered families is HIGH regardless of the score. It is not
  -- promoted to CRITICAL: the PRD does not say it should be, and inventing the
  -- promotion would change when the manager is alerted.
  if v_needs_reply >= chat.config_int('workload.reply_burst') then
    return 'HIGH';
  end if;

  if v_score >= v_high then
    return 'HIGH';
  elsif v_score >= chat.config_num('workload.level.medium') then
    return 'MEDIUM';
  end if;
  return 'LOW';
end;
$$;

comment on function chat.workload_level is
  'PRD v0.1 section 5.3: Low, Medium, High, Critical. staff.capacity_override '
  'replaces the HIGH threshold for one person. Workload-triggered coverage is '
  'Phase 2 (section 13 row 11) and is deliberately not implemented here.';
