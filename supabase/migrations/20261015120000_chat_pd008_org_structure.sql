-- PD-8 (2026-10-15) -- organizational structure and per-learner supervision.
--
-- Record: docs/architecture/ORG-SCOPE-PD8.md.
--
-- WHAT CHANGES
--
--   Staff conversation scope used to be derived from family.owner_id, the
--   coverage engine's on_duty() and the sticky handler; a manager read the whole
--   organization. PD-8 replaces all of that with explicit, academy-authored
--   facts:
--
--     chat.department            Operations / Teachers / Sales, one manager each
--     chat.department_member     which supervisors belong to which department
--     chat.learner_supervision   which supervisor is responsible for which CHILD
--                                (supersedes BR-4's one-owner-per-family for scope)
--     chat.supervisor_backup     a backup link, DORMANT until activated
--     chat.conversation_learner  the learners a supervisor-created family group
--                                is about (conversation type 'family_group')
--
--   and ONE function decides whether a staff member may access a conversation:
--   chat.staff_conversation_access(). The API asks it on every read path and
--   builds its staff list from chat.staff_visible_conversation_ids(), so the
--   per-conversation check and the list cannot disagree. The request-role RLS
--   policy on chat.message asks the same function, so a connection that is not
--   the API owner is held to the same rule.
--
-- WHAT DOES NOT CHANGE
--
--   family.owner_id stays (NOT NULL, transfer_ownership, workload). It is no
--   longer a conversation-scope input. on_duty() and sticky handling stay in
--   the schema; neither grants access any more.
--
-- FAIL CLOSED. A learner with no supervision row is visible to no supervisor
-- (super admin only) until the Operations Manager assigns one; a manager with no
-- department reads only what they are personally in charge of.

-- ===========================================================================
-- 1. Departments
-- ===========================================================================

create table chat.department (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  kind            text not null check (kind in ('operations', 'teachers', 'sales')),
  display_name    text not null check (length(btrim(display_name)) between 1 and 120),
  manager_id      uuid references chat.staff (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint department_one_kind_per_organization unique (organization_id, kind)
);

comment on table chat.department is
  'PD-8: a department of the academy. Its manager reads the conversations of its members (chat.staff_conversation_access).';

-- A manager runs at most one department: their scope is that department.
create unique index department_one_per_manager on chat.department (manager_id)
  where manager_id is not null;

create trigger department_updated_at before update on chat.department
  for each row execute function chat.set_updated_at();

create or replace function chat.guard_department()
returns trigger
language plpgsql
as $$
declare
  v_manager chat.staff%rowtype;
begin
  if new.manager_id is not null then
    select * into v_manager from chat.staff where id = new.manager_id;
    if v_manager.id is null then
      raise exception 'department manager does not exist' using errcode = 'foreign_key_violation';
    end if;
    if v_manager.organization_id is distinct from new.organization_id then
      raise exception 'a department manager belongs to the department''s organization'
        using errcode = 'insufficient_privilege';
    end if;
    if v_manager.role <> 'manager' then
      raise exception 'a department is managed by a staff member with the manager role'
        using errcode = 'check_violation';
    end if;
    if not v_manager.is_active or v_manager.left_at is not null then
      raise exception 'an inactive staff member cannot manage a department'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'a department never moves between organizations' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger department_is_coherent before insert or update on chat.department
  for each row execute function chat.guard_department();

create table chat.department_member (
  staff_id        uuid primary key references chat.staff (id) on delete cascade,
  organization_id uuid not null,
  department_id   uuid not null references chat.department (id),
  position        text not null check (position in ('supervisor', 'backup_supervisor')),
  assigned_by     uuid references chat.staff (id),
  assigned_at     timestamptz not null default now()
);

comment on table chat.department_member is
  'PD-8: a supervisor''s department and position. One department per staff member. Managers are chat.department.manager_id, never members.';

create index department_member_department_idx on chat.department_member (department_id);

create or replace function chat.guard_department_member()
returns trigger
language plpgsql
as $$
declare
  v_staff chat.staff%rowtype;
  v_dept  chat.department%rowtype;
begin
  select * into v_staff from chat.staff where id = new.staff_id;
  select * into v_dept  from chat.department where id = new.department_id;
  if v_staff.id is null or v_dept.id is null then
    raise exception 'department member references a row that does not exist'
      using errcode = 'foreign_key_violation';
  end if;
  if v_staff.organization_id is distinct from v_dept.organization_id then
    raise exception 'a department member belongs to the department''s organization'
      using errcode = 'insufficient_privilege';
  end if;
  -- Supervisors are the family-facing working roles. A manager runs a
  -- department (department.manager_id) and the super admin is above all of them.
  if v_staff.role not in ('admin', 'coverage') then
    raise exception 'only an admin or coverage staff member can be a department supervisor'
      using errcode = 'check_violation';
  end if;
  -- Moving a supervisor out of Operations would leave learners pointing at
  -- someone who is no longer an Operations supervisor: reassign them first.
  if tg_op = 'UPDATE'
     and (new.department_id <> old.department_id or new.position <> old.position)
     and exists (select 1 from chat.learner_supervision ls where ls.supervisor_id = old.staff_id) then
    raise exception 'reassign this supervisor''s learners before moving them'
      using errcode = 'check_violation';
  end if;
  new.organization_id := v_dept.organization_id;
  return new;
end;
$$;

create trigger department_member_is_coherent before insert or update on chat.department_member
  for each row execute function chat.guard_department_member();

create or replace function chat.guard_department_member_delete()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from chat.learner_supervision ls where ls.supervisor_id = old.staff_id) then
    raise exception 'reassign this supervisor''s learners before removing them from the department'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger department_member_keeps_learners before delete on chat.department_member
  for each row execute function chat.guard_department_member_delete();

-- ===========================================================================
-- 2. Per-learner supervision
-- ===========================================================================

create table chat.learner_supervision (
  learner_id      uuid primary key references chat.learner (id) on delete cascade,
  organization_id uuid not null,
  supervisor_id   uuid not null references chat.staff (id),
  assigned_by     uuid references chat.staff (id),
  assigned_at     timestamptz not null default now(),
  reason          text
);

comment on table chat.learner_supervision is
  'PD-8: the ONE supervisor responsible for a child. Children of one family may have different supervisors. Current state only; every change is in chat.audit_log.';

create index learner_supervision_supervisor_idx on chat.learner_supervision (supervisor_id);

create or replace function chat.guard_learner_supervision()
returns trigger
language plpgsql
as $$
declare
  v_learner_org uuid;
  v_staff       chat.staff%rowtype;
begin
  select organization_id into v_learner_org from chat.learner where id = new.learner_id;
  select * into v_staff from chat.staff where id = new.supervisor_id;
  if v_learner_org is null or v_staff.id is null then
    raise exception 'learner supervision references a row that does not exist'
      using errcode = 'foreign_key_violation';
  end if;
  if v_staff.organization_id is distinct from v_learner_org then
    raise exception 'a supervisor and the learner belong to one organization'
      using errcode = 'insufficient_privilege';
  end if;
  if not v_staff.is_active or v_staff.left_at is not null then
    raise exception 'an inactive staff member cannot supervise a learner'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1
      from chat.department_member m
      join chat.department d on d.id = m.department_id
     where m.staff_id = new.supervisor_id
       and m.position = 'supervisor'
       and d.kind = 'operations'
  ) then
    raise exception 'a learner is supervised by a primary supervisor of the Operations department'
      using errcode = 'check_violation';
  end if;
  new.organization_id := v_learner_org;
  return new;
end;
$$;

create trigger learner_supervision_is_coherent before insert or update on chat.learner_supervision
  for each row execute function chat.guard_learner_supervision();

-- ===========================================================================
-- 3. Backup supervisors -- dormant until activated
-- ===========================================================================

create table chat.supervisor_backup (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  primary_id      uuid not null references chat.staff (id),
  backup_id       uuid not null references chat.staff (id),
  created_by      uuid references chat.staff (id),
  created_at      timestamptz not null default now(),
  -- Activation window. NULL activated_at = dormant: the link exists but grants
  -- nothing. Deactivation and expiry both end access without deleting the link.
  activated_at    timestamptz,
  active_until    timestamptz,
  activated_by    uuid references chat.staff (id),
  deactivated_at  timestamptz,
  deactivated_by  uuid references chat.staff (id),
  -- The link itself is retired (never deleted): history stays in the table.
  ended_at        timestamptz,
  ended_by        uuid references chat.staff (id),
  constraint supervisor_backup_not_self check (primary_id <> backup_id),
  constraint supervisor_backup_window_is_ordered
    check (active_until is null or (activated_at is not null and active_until > activated_at))
);

comment on table chat.supervisor_backup is
  'PD-8: B may act for P (read and reply in P''s conversations) ONLY while the link is activated, not deactivated, not expired and not ended. Configured by the Operations Manager or the super admin.';

create unique index supervisor_backup_live_pair on chat.supervisor_backup (primary_id, backup_id)
  where ended_at is null;
create index supervisor_backup_backup_idx on chat.supervisor_backup (backup_id) where ended_at is null;

create or replace function chat.guard_supervisor_backup()
returns trigger
language plpgsql
as $$
declare
  v_primary chat.staff%rowtype;
  v_backup  chat.staff%rowtype;
  v_pdept   uuid;
  v_bdept   uuid;
begin
  if tg_op = 'UPDATE' and (new.primary_id <> old.primary_id or new.backup_id <> old.backup_id) then
    raise exception 'a backup link never changes its two people; end it and create another'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and old.ended_at is not null then
    raise exception 'an ended backup link is history and is never edited'
      using errcode = 'check_violation';
  end if;
  select * into v_primary from chat.staff where id = new.primary_id;
  select * into v_backup  from chat.staff where id = new.backup_id;
  if v_primary.id is null or v_backup.id is null then
    raise exception 'backup link references a staff member that does not exist'
      using errcode = 'foreign_key_violation';
  end if;
  if v_primary.organization_id is distinct from v_backup.organization_id then
    raise exception 'a backup link cannot cross organizations' using errcode = 'insufficient_privilege';
  end if;
  select m.department_id into v_pdept
    from chat.department_member m join chat.department d on d.id = m.department_id
   where m.staff_id = new.primary_id and m.position = 'supervisor' and d.kind = 'operations';
  select m.department_id into v_bdept
    from chat.department_member m
   where m.staff_id = new.backup_id;
  if v_pdept is null then
    raise exception 'only a primary supervisor of the Operations department has a backup'
      using errcode = 'check_violation';
  end if;
  if v_bdept is distinct from v_pdept then
    raise exception 'a backup supervisor belongs to the primary supervisor''s department'
      using errcode = 'check_violation';
  end if;
  if new.activated_at is not null and (not v_backup.is_active or v_backup.left_at is not null) then
    raise exception 'an inactive staff member cannot be activated as a backup'
      using errcode = 'check_violation';
  end if;
  new.organization_id := v_primary.organization_id;
  return new;
end;
$$;

create trigger supervisor_backup_is_coherent before insert or update on chat.supervisor_backup
  for each row execute function chat.guard_supervisor_backup();

-- ===========================================================================
-- 4. Supervisor-created family groups
-- ===========================================================================

-- The constraint was declared inline in 20260905093000, so its name is the
-- generated one; find it rather than assume it.
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'chat.conversation'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%type%direct%student_group%class_group%official%';
  if v_name is not null then
    execute format('alter table chat.conversation drop constraint %I', v_name);
  end if;
end;
$$;

alter table chat.conversation add constraint conversation_type_check
  check (type in ('direct', 'student_group', 'class_group', 'official', 'family_group'));

-- A family group is about one family's children: never a cross-family room
-- (BR-2/BR-3 -- parents of different families never meet in it).
alter table chat.conversation add constraint conversation_family_group_has_family
  check (type <> 'family_group' or family_id is not null);

create table chat.conversation_learner (
  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  learner_id      uuid not null references chat.learner (id),
  organization_id uuid not null,
  added_by        uuid references chat.staff (id),
  added_at        timestamptz not null default now(),
  primary key (conversation_id, learner_id)
);

comment on table chat.conversation_learner is
  'PD-8: the children a family_group is about. Its staff scope is the supervisor of these learners, and every member must be connected to one of them.';

create index conversation_learner_learner_idx on chat.conversation_learner (learner_id);

create or replace function chat.guard_conversation_learner()
returns trigger
language plpgsql
as $$
declare
  v_conv    record;
  v_learner record;
begin
  select id, type, family_id, organization_id into v_conv from chat.conversation where id = new.conversation_id;
  select id, family_id, organization_id into v_learner from chat.learner where id = new.learner_id;
  if v_conv.id is null or v_learner.id is null then
    raise exception 'conversation learner references a row that does not exist'
      using errcode = 'foreign_key_violation';
  end if;
  if v_conv.type <> 'family_group' then
    raise exception 'only a family group is anchored to learners' using errcode = 'check_violation';
  end if;
  if v_learner.family_id is distinct from v_conv.family_id
     or v_learner.organization_id is distinct from v_conv.organization_id then
    raise exception 'a family group is about its own family''s children only'
      using errcode = 'check_violation';
  end if;
  new.organization_id := v_conv.organization_id;
  return new;
end;
$$;

create trigger conversation_learner_is_coherent before insert or update on chat.conversation_learner
  for each row execute function chat.guard_conversation_learner();

-- Coherence, judged on the COMMITTED state (deferred): a live family group has
-- at least one learner, and all of them have one and the same supervisor.
-- Reassigning a child therefore has to detach or transfer the groups it is in
-- within the same transaction -- the API does (OrgStructureService); a writer
-- that forgets is refused rather than leaving a group two supervisors can read.
create or replace function chat.assert_family_group_coherent(p_conversation_id uuid)
returns void
language plpgsql
as $$
declare
  v_conv        record;
  v_anchors     int;
  v_supervisors int;
  v_unsupervised int;
begin
  select id, type, archived_at into v_conv from chat.conversation where id = p_conversation_id;
  if v_conv.id is null or v_conv.type <> 'family_group' or v_conv.archived_at is not null then
    return;
  end if;
  select count(*),
         count(distinct ls.supervisor_id),
         count(*) filter (where ls.supervisor_id is null)
    into v_anchors, v_supervisors, v_unsupervised
    from chat.conversation_learner cl
    left join chat.learner_supervision ls on ls.learner_id = cl.learner_id
   where cl.conversation_id = p_conversation_id;
  if v_anchors = 0 then
    raise exception 'family group % has no learner', p_conversation_id using errcode = 'check_violation';
  end if;
  if v_unsupervised > 0 or v_supervisors <> 1 then
    raise exception 'family group % must be about learners of exactly one supervisor', p_conversation_id
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function chat.family_group_coherence_from_anchor()
returns trigger
language plpgsql
as $$
begin
  perform chat.assert_family_group_coherent(coalesce(new.conversation_id, old.conversation_id));
  return null;
end;
$$;

create constraint trigger conversation_learner_coherent
  after insert or update or delete on chat.conversation_learner
  deferrable initially deferred
  for each row execute function chat.family_group_coherence_from_anchor();

create or replace function chat.family_group_coherence_from_supervision()
returns trigger
language plpgsql
as $$
declare
  v_conv uuid;
begin
  for v_conv in
    select cl.conversation_id from chat.conversation_learner cl
     where cl.learner_id = coalesce(new.learner_id, old.learner_id)
  loop
    perform chat.assert_family_group_coherent(v_conv);
  end loop;
  return null;
end;
$$;

create constraint trigger learner_supervision_keeps_groups_coherent
  after insert or update or delete on chat.learner_supervision
  deferrable initially deferred
  for each row execute function chat.family_group_coherence_from_supervision();

create or replace function chat.family_group_coherence_from_conversation()
returns trigger
language plpgsql
as $$
begin
  perform chat.assert_family_group_coherent(new.id);
  return null;
end;
$$;

create constraint trigger conversation_family_group_coherent
  after insert or update of type, archived_at on chat.conversation
  deferrable initially deferred
  for each row execute function chat.family_group_coherence_from_conversation();

-- Membership of a family group, at the row (no incorrect association can be
-- written by any path): a parent belongs to the group's family and may
-- message; a teacher teaches one of the group's learners. Staff eligibility is
-- scope, decided by chat.staff_conversation_access in the API.
create or replace function chat.guard_family_group_member()
returns trigger
language plpgsql
as $$
declare
  v_conv record;
begin
  if new.left_at is not null then
    return new;
  end if;
  select id, type, family_id into v_conv from chat.conversation where id = new.conversation_id;
  if v_conv.type is distinct from 'family_group' then
    return new;
  end if;
  if new.actor_kind = 'contact' then
    if new.member_role <> 'parent' or not exists (
      select 1 from chat.contact c
       where c.id = new.actor_id and c.family_id = v_conv.family_id and c.is_active and c.can_message
    ) then
      raise exception 'a family group admits only its own family''s messaging contacts as parents'
        using errcode = 'check_violation';
    end if;
  elsif new.actor_kind = 'teacher' then
    if new.member_role <> 'teacher' or not exists (
      select 1 from chat.conversation_learner cl
        join chat.learner l on l.id = cl.learner_id
       where cl.conversation_id = new.conversation_id and l.teacher_id = new.actor_id
    ) then
      raise exception 'a family group admits a teacher only of one of its learners'
        using errcode = 'check_violation';
    end if;
  elsif new.actor_kind = 'staff' then
    if new.member_role not in ('admin', 'observer') then
      raise exception 'staff join a family group as admin or observer' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger conversation_member_family_group_eligible
  before insert or update of actor_id, actor_kind, member_role, left_at on chat.conversation_member
  for each row execute function chat.guard_family_group_member();

-- A teacher who no longer teaches any of a family group's learners leaves it:
-- when a learner's teacher changes (Core sync) and when a learner is detached
-- from the group. Realtime delivery re-checks live membership at emit time
-- (RT-009), so the departure takes effect on the next event.
create or replace function chat.prune_family_group_teachers(p_conversation_id uuid)
returns void
language sql
as $$
  update chat.conversation_member m
     set left_at = now()
   where m.conversation_id = p_conversation_id
     and m.actor_kind = 'teacher'
     and m.left_at is null
     and not exists (
       select 1 from chat.conversation_learner cl
         join chat.learner l on l.id = cl.learner_id
        where cl.conversation_id = p_conversation_id and l.teacher_id = m.actor_id);
$$;

create or replace function chat.prune_teachers_after_anchor_removed()
returns trigger
language plpgsql
as $$
begin
  perform chat.prune_family_group_teachers(old.conversation_id);
  return null;
end;
$$;

create trigger conversation_learner_prunes_teachers
  after delete on chat.conversation_learner
  for each row execute function chat.prune_teachers_after_anchor_removed();

create or replace function chat.prune_teachers_after_teacher_change()
returns trigger
language plpgsql
as $$
declare
  v_conv uuid;
begin
  for v_conv in select cl.conversation_id from chat.conversation_learner cl where cl.learner_id = new.id loop
    perform chat.prune_family_group_teachers(v_conv);
  end loop;
  return null;
end;
$$;

create trigger learner_teacher_change_prunes_family_groups
  after update of teacher_id on chat.learner
  for each row when (old.teacher_id is distinct from new.teacher_id)
  execute function chat.prune_teachers_after_teacher_change();

-- ===========================================================================
-- 5. THE staff conversation scope
-- ===========================================================================

-- Is B's backup link to P live at p_at? Activated, not deactivated, not
-- expired, not ended -- AND both people still sit in the same department and
-- the backup is an active staff member. The last two are re-checked here
-- rather than trusted to whoever moved them, so a link can never outlive the
-- arrangement it was made for.
create or replace function chat.backup_is_active(p_primary uuid, p_backup uuid, p_at timestamptz)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.supervisor_backup b
      join chat.department_member pm on pm.staff_id = b.primary_id and pm.position = 'supervisor'
      join chat.department_member bm on bm.staff_id = b.backup_id and bm.department_id = pm.department_id
      join chat.staff bs on bs.id = b.backup_id and bs.is_active and bs.left_at is null
     where b.primary_id = p_primary and b.backup_id = p_backup
       and b.ended_at is null
       and b.activated_at is not null and b.activated_at <= p_at
       and b.deactivated_at is null
       and (b.active_until is null or b.active_until > p_at));
$$;

-- How may p_staff act for p_principal? 'self' | 'backup' | 'manager' | null.
-- Not transitive: a backup acts for their primary only, a manager for the
-- members of the department they manage only.
create or replace function chat.staff_acts_for(p_staff uuid, p_principal uuid, p_at timestamptz)
returns text
language sql
stable
as $$
  select case
    when p_staff = p_principal then 'self'
    when chat.backup_is_active(p_principal, p_staff, p_at) then 'backup'
    when exists (
      select 1 from chat.department_member m
        join chat.department d on d.id = m.department_id
       where m.staff_id = p_principal and d.manager_id = p_staff) then 'manager'
  end;
$$;

-- The staff members p_staff acts for right now (self included).
create or replace function chat.staff_principals(p_staff uuid, p_at timestamptz)
returns setof uuid
language sql
stable
as $$
  select p_staff
  union
  select b.primary_id from chat.supervisor_backup b
   where b.backup_id = p_staff and chat.backup_is_active(b.primary_id, p_staff, p_at)
  union
  select m.staff_id from chat.department_member m
    join chat.department d on d.id = m.department_id
   where d.manager_id = p_staff;
$$;

-- Does p_staff reach the family -- act for the supervisor of one of its children?
-- 'self' | 'backup' | 'manager' | 'super_admin' | null.
create or replace function chat.staff_reaches_family(p_staff uuid, p_family uuid, p_at timestamptz default now())
returns text
language plpgsql
stable
as $$
declare
  s     record;
  v_org uuid;
  v     text;
begin
  select id, role, organization_id, (is_active and left_at is null) as live into s
    from chat.staff where id = p_staff;
  select organization_id into v_org from chat.family where id = p_family;
  if s.id is null or not s.live or v_org is null or v_org <> s.organization_id then
    return null;
  end if;
  if s.role = 'super_admin' then return 'super_admin'; end if;
  if s.role not in ('admin', 'coverage', 'manager') then return null; end if;
  select x.basis into v from (
    select chat.staff_acts_for(p_staff, ls.supervisor_id, p_at) as basis
      from chat.learner_supervision ls
      join chat.learner l on l.id = ls.learner_id
     where l.family_id = p_family
  ) x
  where x.basis is not null
  order by case x.basis when 'self' then 1 when 'backup' then 2 else 3 end
  limit 1;
  return v;
end;
$$;

-- THE decision. Returns the BASIS on which p_staff may access the conversation,
-- or NULL for no access:
--
--   super_admin  the organization's super admin: every conversation (PD-8 #3)
--   responsible  supervisor of the learner(s) a group is about
--   member       a live staff member of a direct / ungrouped conversation who
--                (for a family conversation) still reaches the family
--   backup       acting for one of the above through an ACTIVE backup link
--   manager      the department manager of one of the above
--
-- Nothing else grants access: not family.owner_id, not on_duty(), not the
-- sticky handler, not a membership row on its own.
create or replace function chat.staff_conversation_access(
  p_staff        uuid,
  p_conversation uuid,
  p_at           timestamptz default now()
) returns text
language plpgsql
stable
as $$
declare
  s      record;
  c      record;
  v      text;
  m      record;
begin
  select id, role, organization_id, (is_active and left_at is null) as live into s
    from chat.staff where id = p_staff;
  if s.id is null or not s.live then return null; end if;

  select id, type, family_id, learner_id, organization_id into c
    from chat.conversation where id = p_conversation;
  if c.id is null or c.organization_id <> s.organization_id then return null; end if;

  if s.role = 'super_admin' then return 'super_admin'; end if;
  if s.role not in ('admin', 'coverage', 'manager') then return null; end if;

  -- Groups: the supervisor of the learners the group is about.
  if c.type in ('student_group', 'family_group') then
    select x.basis into v from (
      select chat.staff_acts_for(p_staff, ls.supervisor_id, p_at) as basis
        from chat.learner_supervision ls
       where (c.type = 'student_group' and ls.learner_id = c.learner_id)
          or (c.type = 'family_group' and ls.learner_id in (
                select cl.learner_id from chat.conversation_learner cl where cl.conversation_id = c.id))
    ) x
    where x.basis is not null
    order by case x.basis when 'self' then 1 when 'backup' then 2 else 3 end
    limit 1;
    return case v when 'self' then 'responsible' else v end;
  end if;

  -- Everything else: through a live staff member of the conversation. For a
  -- family conversation that member must still reach the family, so a
  -- supervisor whose children were all reassigned away loses the parent's 1:1.
  for m in
    select cm.actor_id from chat.conversation_member cm
     where cm.conversation_id = c.id and cm.left_at is null and cm.actor_kind = 'staff'
  loop
    v := chat.staff_acts_for(p_staff, m.actor_id, p_at);
    continue when v is null;
    if c.family_id is not null and chat.staff_reaches_family(m.actor_id, c.family_id, p_at) is null then
      continue;
    end if;
    return case v when 'self' then 'member' else v end;
  end loop;
  return null;
end;
$$;

-- The ids p_staff may access, for the chat list. A candidate set (anything
-- touching a principal p_staff acts for) filtered through the exact decision
-- above, so the list is never wider than the per-conversation check.
create or replace function chat.staff_visible_conversation_ids(p_staff uuid, p_at timestamptz default now())
returns setof uuid
language plpgsql
stable
as $$
declare
  s record;
begin
  select id, role, organization_id, (is_active and left_at is null) as live into s
    from chat.staff where id = p_staff;
  if s.id is null or not s.live then return; end if;
  if s.role = 'super_admin' then
    return query select c.id from chat.conversation c where c.organization_id = s.organization_id;
    return;
  end if;
  return query
    with principals as (select chat.staff_principals(p_staff, p_at) as id),
         learners as (
           select ls.learner_id from chat.learner_supervision ls
            where ls.supervisor_id in (select id from principals)),
         candidates as (
           select c.id from chat.conversation c
            where c.type = 'student_group' and c.learner_id in (select learner_id from learners)
           union
           select cl.conversation_id from chat.conversation_learner cl
            where cl.learner_id in (select learner_id from learners)
           union
           select cm.conversation_id from chat.conversation_member cm
            where cm.left_at is null and cm.actor_kind = 'staff'
              and cm.actor_id in (select id from principals))
    select k.id from candidates k
     where chat.staff_conversation_access(p_staff, k.id, p_at) is not null;
end;
$$;

-- The supervisor responsible for a group (the approver of held messages), or
-- NULL for a conversation that is not a group or has no supervised learner.
create or replace function chat.conversation_responsible_supervisor(p_conversation uuid)
returns uuid
language sql
stable
as $$
  select ls.supervisor_id
    from chat.conversation c
    join chat.learner_supervision ls
      on (c.type = 'student_group' and ls.learner_id = c.learner_id)
      or (c.type = 'family_group' and ls.learner_id in (
            select cl.learner_id from chat.conversation_learner cl where cl.conversation_id = c.id))
   where c.id = p_conversation
   limit 1;
$$;

-- These take an arbitrary staff id. They are decisions for the server (the API
-- owner connection), never an oracle a request role could ask about somebody
-- else. Request roles get the current-actor wrapper below and nothing more.
revoke all on function chat.backup_is_active(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_acts_for(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_principals(uuid, timestamptz) from public;
revoke all on function chat.staff_reaches_family(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_conversation_access(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_visible_conversation_ids(uuid, timestamptz) from public;
revoke all on function chat.conversation_responsible_supervisor(uuid) from public;
revoke all on function chat.assert_family_group_coherent(uuid) from public;
revoke all on function chat.prune_family_group_teachers(uuid) from public;

-- The current request actor's access to one conversation, for RLS policies.
-- SECURITY DEFINER because the inputs (membership, supervision) are tables a
-- request role has no grant on; it answers only for chat.current_staff_id().
create or replace function chat.current_staff_conversation_access(p_conversation uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, chat
as $$
  select chat.staff_conversation_access(chat.current_staff_id(), p_conversation, now());
$$;

revoke all on function chat.current_staff_conversation_access(uuid) from public;
grant execute on function chat.current_staff_conversation_access(uuid) to authenticated, service_role;

-- ===========================================================================
-- 6. Database enforcement for request roles
-- ===========================================================================
--
-- chat.conversation, conversation_member, message_attachment, message_approval
-- and call carry no grant for a request role at all (deny by default). The one
-- conversation-content table a request role CAN read is chat.message, and its
-- staff policy let every admin/coverage/manager read every family's messages
-- (chat.staff_can_see_family is true for all three roles). Narrowed to PD-8.

drop policy if exists message_visible_to_staff on chat.message;
create policy message_visible_to_staff on chat.message for select to authenticated
  using (message.conversation_id is not null
         and chat.current_staff_conversation_access(message.conversation_id) is not null);

drop policy if exists message_written_by_staff on chat.message;
create policy message_written_by_staff on chat.message for insert to authenticated
  with check (
    author_type = 'staff'
    and author_id = chat.current_staff_id()
    and message.conversation_id is not null
    and chat.current_staff_conversation_access(message.conversation_id) is not null);

-- The new tables: RLS on, no grant to any request role. Only the server writes
-- or reads the organization structure.
alter table chat.department            enable row level security;
alter table chat.department_member     enable row level security;
alter table chat.learner_supervision   enable row level security;
alter table chat.supervisor_backup     enable row level security;
alter table chat.conversation_learner  enable row level security;

revoke all on chat.department, chat.department_member, chat.learner_supervision,
              chat.supervisor_backup, chat.conversation_learner
  from public, anon, authenticated, chat_app;
