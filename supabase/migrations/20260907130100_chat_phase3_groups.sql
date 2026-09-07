-- Jawwid Chat -- Phase 3: Groups as first-class business entities.
--
-- Canonical design: docs/recovery/PHASE-3-REPORT.md.
--
-- A GROUP IS NOT A CONVERSATION.
--
-- chat.conversation already has a `class_group` type, and it would have been
-- easy to call that "the group". It is not, and conflating them would be a
-- one-way mistake:
--
--   * A Conversation is a MESSAGING entity governed by the Phase 2 model --
--     participants, BR-1, moderation, receipts, realtime.
--   * A Group is a BUSINESS entity -- which students are taught together, by
--     which teachers, and what that arrangement's history is.
--
-- They have different lifecycles, different membership (learners vs. actors),
-- different authorization, and different reasons to exist. Deriving group
-- identity from a conversation would mean a group could not outlive its
-- conversation, could not exist before one, and could not be reorganised
-- without rewriting messaging history.
--
-- Phase 3 therefore creates NO conversation, attaches none, and adds no
-- conversation_id column. The `class_group` conversation type is preserved
-- untouched and remains dormant. If a group ever needs a conversation, the
-- extension is a join table added by a later migration -- which requires no
-- change to chat.group and cannot disturb a group's stable id.
--
-- STABLE IDENTITY is the whole point of the table. chat.group.id survives a
-- rename, a teacher change, a membership change, closure and archival. A
-- replacement group is a DIFFERENT row with its own id, linked by
-- replaced_by_group_id -- never the old id reused, which would silently rewrite
-- the past.

-- ---------------------------------------------------------------------------
-- 1. The group
-- ---------------------------------------------------------------------------

create table if not exists chat.group (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  name            text not null,
  -- The staff member answerable for the group. Constrained to the same
  -- population that may hold a family, so a group cannot be parked on a
  -- departmental or inactive staff member.
  owner_id        uuid not null references chat.staff (id) on delete restrict,
  state           text not null default 'active'
                    check (state in ('active', 'closed', 'archived')),
  -- Why a successor exists. Set on the OLD group, pointing forward.
  replaced_by_group_id uuid references chat.group (id) on delete set null,
  closed_at       timestamptz,
  closed_reason   text,
  archived_at     timestamptz,
  archived_reason text,
  created_by      uuid references chat.staff (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint group_name_not_blank check (length(btrim(name)) > 0),
  constraint group_not_replaced_by_itself check (replaced_by_group_id is distinct from id),
  -- A lifecycle state and its stamp cannot disagree.
  constraint group_closed_is_stamped
    check (state <> 'closed' or closed_at is not null),
  constraint group_archived_is_stamped
    check (state <> 'archived' or (archived_at is not null and closed_at is not null))
);

comment on table chat.group is
  'A durable BUSINESS entity: which students are taught together and by whom. '
  'NOT a conversation -- Phase 3 creates no conversation for a group and adds '
  'no conversation_id. The id is stable across rename, teacher change, '
  'membership change, closure and archival.';

comment on column chat.group.replaced_by_group_id is
  'Set on the OLD group when a replacement is created. The old group keeps its '
  'own id and its entire history; the replacement gets a NEW id.';

create index if not exists group_organization_idx on chat.group (organization_id);
create index if not exists group_active_idx on chat.group (organization_id, name)
  where state = 'active';
create index if not exists group_owner_idx on chat.group (owner_id) where state <> 'archived';

drop trigger if exists group_set_updated_at on chat.group;
create trigger group_set_updated_at
  before update on chat.group
  for each row execute function chat.set_updated_at();

-- A group belongs to an active, family-facing staff member -- the same rule
-- chat.guard_family_assignment() applies to families.
create or replace function chat.guard_group_owner()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    if not exists (select 1 from chat.staff s
                   where s.id = new.owner_id and s.is_active and s.department is null
                     and s.role in ('admin', 'coverage_admin', 'manager', 'super_admin')) then
      raise exception 'a group must belong to an active, family-facing staff member'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists group_owner_is_guarded on chat.group;
create trigger group_owner_is_guarded
  before insert or update on chat.group
  for each row execute function chat.guard_group_owner();

-- ---------------------------------------------------------------------------
-- 2. Lifecycle: active -> closed -> archived, and never backwards
-- ---------------------------------------------------------------------------
--
-- Enforced in the DATABASE, not only in a service. An archived group is
-- historical evidence; a service-only rule would leave it one forgotten call
-- site away from being edited.

create or replace function chat.guard_group_lifecycle()
returns trigger
language plpgsql
as $$
begin
  -- An archived group is frozen ENTIRELY. Only replaced_by_group_id may still
  -- be set, because a replacement is recorded after the fact and records a
  -- relationship rather than changing the archived group's own content.
  if old.state = 'archived' then
    if new.state is distinct from old.state
       or new.name is distinct from old.name
       or new.owner_id is distinct from old.owner_id
       or new.closed_at is distinct from old.closed_at
       or new.archived_at is distinct from old.archived_at then
      raise exception 'group % is archived and cannot be modified', old.id
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if old.state = 'closed' and new.state = 'active' then
    raise exception 'a closed group cannot be reopened; create a replacement group instead'
      using errcode = 'restrict_violation';
  end if;

  if old.state = 'active' and new.state = 'archived' then
    raise exception 'a group must be closed before it is archived'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists group_lifecycle_is_guarded on chat.group;
create trigger group_lifecycle_is_guarded
  before update on chat.group
  for each row execute function chat.guard_group_lifecycle();

-- ---------------------------------------------------------------------------
-- 3. Membership -- students, with history
-- ---------------------------------------------------------------------------

create table if not exists chat.group_member (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references chat.group (id) on delete cascade,
  learner_id     uuid not null references chat.learner (id) on delete cascade,
  joined_at      timestamptz not null default clock_timestamp(),
  added_by       uuid references chat.staff (id) on delete set null,
  left_at        timestamptz,
  removed_by     uuid references chat.staff (id) on delete set null,
  removed_reason text,

  constraint group_member_window_ordered check (left_at is null or left_at >= joined_at)
);

comment on table chat.group_member is
  'Which students are in a group, WITH HISTORY. A departure is left_at on the '
  'row, never a deleted row: "Maryam was previously a member" has to stay '
  'answerable. Re-joining opens a NEW row, so the periods are distinguishable.';

-- CURRENT membership is exactly one live row per (group, learner). Re-adding a
-- current member is refused by the database, so the operation is idempotent
-- without the service having to remember to check.
create unique index if not exists group_member_one_live
  on chat.group_member (group_id, learner_id) where left_at is null;

create index if not exists group_member_group_idx on chat.group_member (group_id, joined_at desc);
create index if not exists group_member_learner_idx on chat.group_member (learner_id)
  where left_at is null;

-- ---------------------------------------------------------------------------
-- 4. Teachers -- with history
-- ---------------------------------------------------------------------------

create table if not exists chat.group_teacher (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references chat.group (id) on delete cascade,
  teacher_id     uuid not null references chat.teacher (id) on delete restrict,
  started_at     timestamptz not null default clock_timestamp(),
  added_by       uuid references chat.staff (id) on delete set null,
  ended_at       timestamptz,
  removed_by     uuid references chat.staff (id) on delete set null,
  removed_reason text,

  constraint group_teacher_window_ordered check (ended_at is null or ended_at >= started_at)
);

comment on table chat.group_teacher is
  'Which teachers currently teach a group, WITH HISTORY. A group may have '
  'several at once, which is why this is not a column on chat.group. Removing '
  'a teacher stamps ended_at; the row is never deleted.';

create unique index if not exists group_teacher_one_live
  on chat.group_teacher (group_id, teacher_id) where ended_at is null;

create index if not exists group_teacher_group_idx on chat.group_teacher (group_id, started_at desc);
create index if not exists group_teacher_teacher_idx on chat.group_teacher (teacher_id)
  where ended_at is null;

-- A teacher must be active when added. Ending stays possible afterwards, so an
-- offboarding can always close its own rows.
create or replace function chat.guard_group_teacher()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from chat.teacher t
                   where t.id = new.teacher_id and t.is_active and t.left_at is null) then
      raise exception 'only an active teacher may be added to a group'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists group_teacher_is_guarded on chat.group_teacher;
create trigger group_teacher_is_guarded
  before insert on chat.group_teacher
  for each row execute function chat.guard_group_teacher();

-- ---------------------------------------------------------------------------
-- 5. Membership changes stop when the group is archived
-- ---------------------------------------------------------------------------
--
-- The lifecycle guard freezes chat.group itself; this freezes the two tables
-- that hang off it, because "archived" would mean very little if the roster
-- could still be rewritten afterwards. Enforced for BOTH child tables by one
-- function, so the rule has a single definition.

create or replace function chat.guard_group_is_mutable()
returns trigger
language plpgsql
as $$
declare
  v_group_id uuid := coalesce(new.group_id, old.group_id);
  v_state    text;
begin
  select state into v_state from chat.group where id = v_group_id;
  -- Cascade-deleted inside this transaction: nothing left to protect.
  if not found then
    return coalesce(new, old);
  end if;
  if v_state = 'archived' then
    raise exception 'group % is archived; its % cannot be changed', v_group_id, tg_table_name
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists group_member_requires_mutable_group on chat.group_member;
create trigger group_member_requires_mutable_group
  before insert or update or delete on chat.group_member
  for each row execute function chat.guard_group_is_mutable();

drop trigger if exists group_teacher_requires_mutable_group on chat.group_teacher;
create trigger group_teacher_requires_mutable_group
  before insert or update or delete on chat.group_teacher
  for each row execute function chat.guard_group_is_mutable();

-- ---------------------------------------------------------------------------
-- 6. Operations
-- ---------------------------------------------------------------------------

create or replace function chat.close_group(
  p_group_id uuid, p_reason text, p_actor_id uuid default null
) returns boolean
language plpgsql
as $$
declare
  v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_state text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'closing a group requires a reason' using errcode = 'check_violation';
  end if;
  select state into v_state from chat.group where id = p_group_id for update;
  if v_state is null then
    raise exception 'no such group %', p_group_id using errcode = 'no_data_found';
  end if;
  if v_state <> 'active' then
    return false;
  end if;

  update chat.group
     set state = 'closed', closed_at = clock_timestamp(), closed_reason = p_reason
   where id = p_group_id;

  perform chat.write_audit(v_actor, 'group.closed', 'group', p_group_id, p_reason,
                           jsonb_build_object('state', 'active'),
                           jsonb_build_object('state', 'closed'));
  perform chat.log_event('group_closed', null, 'staff', v_actor,
                         jsonb_build_object('group_id', p_group_id, 'reason', p_reason));
  return true;
end;
$$;

create or replace function chat.archive_group(
  p_group_id uuid, p_reason text, p_actor_id uuid default null
) returns boolean
language plpgsql
as $$
declare
  v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_state text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'archiving a group requires a reason' using errcode = 'check_violation';
  end if;
  select state into v_state from chat.group where id = p_group_id for update;
  if v_state is null then
    raise exception 'no such group %', p_group_id using errcode = 'no_data_found';
  end if;
  if v_state = 'archived' then
    return false;
  end if;
  if v_state <> 'closed' then
    raise exception 'a group must be closed before it is archived'
      using errcode = 'restrict_violation';
  end if;

  update chat.group
     set state = 'archived', archived_at = clock_timestamp(), archived_reason = p_reason
   where id = p_group_id;

  perform chat.write_audit(v_actor, 'group.archived', 'group', p_group_id, p_reason,
                           jsonb_build_object('state', 'closed'),
                           jsonb_build_object('state', 'archived'));
  perform chat.log_event('group_archived', null, 'staff', v_actor,
                         jsonb_build_object('group_id', p_group_id, 'reason', p_reason));
  return true;
end;
$$;

-- The replacement gets a NEW id. The old group keeps its own id, its members,
-- its teachers and its entire history; only the forward pointer is added.
create or replace function chat.create_replacement_group(
  p_group_id uuid,
  p_name     text,
  p_reason   text,
  p_actor_id uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_old   record;
  v_new   uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a replacement group requires a reason' using errcode = 'check_violation';
  end if;
  select * into v_old from chat.group where id = p_group_id for update;
  if v_old.id is null then
    raise exception 'no such group %', p_group_id using errcode = 'no_data_found';
  end if;
  if v_old.replaced_by_group_id is not null then
    raise exception 'group % has already been replaced by %',
      p_group_id, v_old.replaced_by_group_id using errcode = 'unique_violation';
  end if;

  insert into chat.group (organization_id, name, owner_id, created_by)
  values (v_old.organization_id, coalesce(nullif(btrim(p_name), ''), v_old.name),
          v_old.owner_id, v_actor)
  returning id into v_new;

  update chat.group set replaced_by_group_id = v_new where id = p_group_id;

  perform chat.write_audit(v_actor, 'group.replaced', 'group', p_group_id, p_reason,
                           jsonb_build_object('replaced_by_group_id', null),
                           jsonb_build_object('replaced_by_group_id', v_new));
  perform chat.log_event('group_replaced', null, 'staff', v_actor,
                         jsonb_build_object('old_group_id', p_group_id,
                                            'new_group_id', v_new, 'reason', p_reason));
  return v_new;
end;
$$;

comment on function chat.create_replacement_group is
  'Creates a NEW group with a NEW stable id and points the old group at it. The '
  'old id is never transferred and the old roster is never moved: the whole '
  'purpose is that the past stays where it was.';

-- ---------------------------------------------------------------------------
-- 7. Tenancy and RLS
-- ---------------------------------------------------------------------------

alter table chat.group         enable row level security;
alter table chat.group_member  enable row level security;
alter table chat.group_teacher enable row level security;

drop policy if exists group_organization_isolation on chat.group;
create policy group_organization_isolation on chat.group
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- GROUP METADATA is visible to family-facing staff, and to a teacher who
-- currently teaches it. Note what is NOT here: no policy makes a group visible
-- to a contact. A parent has no route to a group row at all, which is how
-- "no cross-family disclosure to parents" is enforced structurally rather than
-- by remembering to filter.
drop policy if exists group_visible on chat.group;
create policy group_visible on chat.group
  for select to authenticated
  using (
    chat.staff_is_family_facing(chat.current_staff_id())
    or exists (select 1 from chat.group_teacher gt
                join chat.teacher t on t.id = gt.teacher_id
               where gt.group_id = chat.group.id and gt.ended_at is null
                 and t.account_id = chat.current_account_id() and t.is_active)
  );

-- THE ROSTER IS NARROWER THAN THE GROUP. A group spans families, so an
-- unrestricted roster would hand a supervisor the students of families they do
-- not supervise -- the group-level shape of red-team A-1/RT-011. Organization-
-- wide roles see the whole roster; everyone else sees only the rows whose
-- learner belongs to a family already inside their scope.
drop policy if exists group_member_visible on chat.group_member;
create policy group_member_visible on chat.group_member
  for select to authenticated
  using (
    chat.staff_is_organization_wide(chat.current_staff_id())
    or exists (select 1 from chat.learner l
                where l.id = learner_id and chat.staff_can_see_family(l.family_id))
    or exists (select 1 from chat.group_teacher gt
                join chat.teacher t on t.id = gt.teacher_id
               where gt.group_id = group_member.group_id and gt.ended_at is null
                 and t.account_id = chat.current_account_id() and t.is_active)
  );

drop policy if exists group_teacher_visible on chat.group_teacher;
create policy group_teacher_visible on chat.group_teacher
  for select to authenticated
  using (
    chat.staff_is_family_facing(chat.current_staff_id())
    or exists (select 1 from chat.teacher t
                where t.id = teacher_id and t.account_id = chat.current_account_id())
  );

grant select on chat.group, chat.group_member, chat.group_teacher to authenticated;
grant select, insert, update, delete
  on chat.group, chat.group_member, chat.group_teacher to service_role;
