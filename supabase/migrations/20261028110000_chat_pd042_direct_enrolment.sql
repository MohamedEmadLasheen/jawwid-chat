-- PD-42 (2026-10-28) -- supervisors enter their own families by hand (the
-- migration from Jawwid Core), with a carried-over package; and the
-- amendment PD-30-amendment-carried-over.
--
-- Record: docs/product/pd042-direct-enrolment-plan.md (v3.2, approved);
-- docs/product/pd-registry/PD-42.md, PD-30-amendment-carried-over.md.
--
-- PR-1, DATA ONLY. Nothing here changes what an existing caller sees: every
-- PD-16 enrolment stays as it was, and every existing ledger row counts as
-- before (lessons_used_before = 0). The API that writes the new rows is PR-2.
--
-- WHAT IS NEW
--
--   create_intake_family         a family entered by hand, owned by its entrant
--                                (family.owner_id); noted as created in this
--                                transaction. enrol_learner notes each child.
--   student_enrolment            keyed by its own id. origin trial | intake,
--     (generalised)              kind new_family | added_children. A trial
--                                enrolment keeps lesson_id (still unique) and
--                                its PD-16 rules. An intake is written by a
--                                supervisor for a family they own, lists ONLY
--                                children created in the same transaction
--                                (never an existing child), and a new family
--                                comes with at least one contact key. One
--                                new_family row per family. account_id may be
--                                null for an intake (no e-mail yet), set once.
--                                assigned_by / assigned_at: entered by / at.
--   learner_intake               who entered each child and when, written only
--                                by the intake that created the child.
--   enrol_learner                also for an intake: a holder of
--                                new_students.manage who owns the family (or
--                                is entering it now); the teacher is optional.
--   learner_supervision          always names its assigner, the authenticated
--                                actor; only the Operations manager (or the
--                                super admin) places or moves a child, except a
--                                supervisor placing on themself a child they
--                                are entering now. chat.syncing_supervision
--                                opens it for the academy's own import.
--   family_sales_owner           the Sales supervisor accountable for a family,
--                                beside (never instead of) PD-8 supervision.
--                                Set by the Sales manager or the super admin;
--                                a Sales member owns only a family they are
--                                entering in the same transaction.
--   family_contact_key           HMAC of a family's normalised e-mail or E.164
--                                number, per academy: one family per parent.
--                                No plain value; removed only with the family.
--   staff_owns_family            "their own family": super admin, Operations
--                                manager, Sales manager, PD-8 supervisor (self)
--                                or their department manager, Sales owner. Not
--                                a covering backup.
--   staff_may_handle_family      the same, plus every Sales member while
--                                sales.family_scope is 'all' (PR-4 wires it).
--   learner_subscription         source 'carried_over' with lessons_used_before
--                                (Core's completed lessons, exactly as entered),
--                                over_confirmed_by (completed above the total:
--                                a manager's own entry), plan_months 1..24 for
--                                this source only. Remaining is never stored:
--                                the compute below subtracts lessons_used_before.
--   subscriptions.carry_over     a permission key, in the four Operations and
--                                Sales bundles.
--
-- PD-30-AMENDMENT-CARRIED-OVER (owner 2026-10-28, "Allow, tightly limited").
-- A supervisor's carried_over row is refused unless ALL hold:
--   1. the child was entered through the new form (chat.learner_intake);
--   2. created_by is the staff member who entered the child;
--   3. it is written within 14 days of that intake;
--   4. the child has no other standing ledger row (decided under a row lock);
--   5. created_by owns the family (staff_owns_family) and holds
--      subscriptions.carry_over.
-- Everything else stays with can_grant_subscription_exception (the super
-- admin, the Operations Manager, the Sales Manager). Condition 4 holds for
-- them too: a carried-over package never sits on top of another.
-- Raising the entitlement again (a re-add with more lessons left than the row
-- it replaces) once the child has used a lesson in Chat is the managers' too:
-- grace is derived from the balance, so this is what keeps it given once. A
-- carried-over row is voided only by its entrant within the 14 days, or by
-- the three managers.
--
-- REFUSALS are check_violation or insufficient_privilege with a message the
-- API maps, never a bare unique_violation (Prisma drops 23505's message): the
-- unique indexes stay as the concurrency backstop behind the guards.
--
-- Down (data written since is lost):
--   drop table chat.learner_intake, chat.family_contact_key, chat.family_sales_owner;
--   drop function chat.staff_may_handle_family, chat.staff_owns_family,
--     chat.sales_family_scope, chat.guard_learner_supervision_assigner,
--     chat.create_intake_family, chat.pd042_note_created,
--     chat.pd042_created_in_this_transaction, chat.pd042_record_learner_intake;
--   alter table chat.learner_subscription drop column lessons_used_before,
--     drop column over_confirmed_by; restore its source / plan_months checks,
--     guard_learner_subscription and compute_learner_access from 20261026140000;
--   restore student_enrolment's primary key on lesson_id, unique family_id,
--     not null account_id, and guard_student_enrolment / enrol_learner from
--     20261021140000 (only possible while no intake row exists);
--   delete the subscriptions.carry_over rows (under chat.pd040_catalogue_change).

-- ===========================================================================
-- 1. Settings, the families and children an intake creates, and "their own family"
-- ===========================================================================

-- PD-42 S3: 'all' (today: every Sales member reaches every family) until the
-- owner switches it to 'own' after the intake is verified. Written by the API
-- at boot from SALES_FAMILY_SCOPE (PR-4); absent means 'all'.
create or replace function chat.sales_family_scope()
returns text
language sql
stable
set search_path = chat, pg_temp
as $$
  select case when (select value #>> '{}' from chat.config where key = 'sales.family_scope') = 'own' then 'own' else 'all' end;
$$;

-- What THIS transaction's intake created, as transaction-local lists (the
-- pattern of chat.syncing_assignment): chat.create_intake_family adds the
-- family, chat.enrol_learner each child. Only what is on these lists may be
-- self-owned by a Sales member (review P1-B) or listed by an intake
-- enrolment (review P1-A); nothing that already existed can be re-listed.
create or replace function chat.pd042_created_in_this_transaction(p_list text, p_id uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select p_id::text = any (string_to_array(coalesce(nullif(current_setting(p_list, true), ''), ''), ','));
$$;

create or replace function chat.pd042_note_created(p_list text, p_id uuid)
returns void
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  perform set_config(p_list, concat_ws(',', nullif(current_setting(p_list, true), ''), p_id::text), true);
end;
$$;

-- A family a supervisor enters by hand: owned (family.owner_id, PD-24) by its
-- entrant until an Operations supervisor takes it.
create or replace function chat.create_intake_family(p_display_name text, p_actor_id uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor uuid := chat.trusted_staff_actor(p_actor_id);
  v_org   uuid;
  v_id    uuid;
begin
  select s.organization_id into v_org from chat.staff s where s.id = v_actor and s.is_active and s.left_at is null;
  if v_org is null or not chat.staff_has_permission(v_actor, 'new_students.manage') then
    raise exception 'a family is entered by a Sales or Operations supervisor, or their manager'
      using errcode = 'insufficient_privilege';
  end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 120 then
    raise exception 'a family has a name' using errcode = 'check_violation';
  end if;
  insert into chat.family (organization_id, display_name, owner_id, language)
  values (v_org, btrim(p_display_name), v_actor, 'ar')
  returning id into v_id;
  perform chat.pd042_note_created('chat.pd042_entered_families', v_id);
  return v_id;
end;
$$;

create table chat.family_sales_owner (
  family_id        uuid primary key references chat.family (id) on delete cascade,
  organization_id  uuid not null references chat.organization (id),
  staff_id         uuid not null references chat.staff (id),
  assigned_by      uuid not null references chat.staff (id),
  assigned_at      timestamptz not null default now(),
  reason           text check (reason is null or length(btrim(reason)) between 1 and 500)
);

comment on table chat.family_sales_owner is
  'PD-42: the Sales supervisor accountable for a family (renewals, payments, the data they entered). Beside PD-8 supervision, never instead of it: chat reach, the family group and covers stay with chat.learner_supervision. Current state; every change is audited.';

create index family_sales_owner_staff_idx on chat.family_sales_owner (staff_id);

create or replace function chat.guard_family_sales_owner()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_org uuid;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from chat.family f where f.id = old.family_id) then
      raise exception 'a family''s Sales owner is changed, never removed' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  select organization_id into v_org from chat.family where id = new.family_id;
  if v_org is null then
    raise exception 'a Sales owner is for a family' using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  if not exists (select 1 from chat.staff s where s.id = new.staff_id and s.organization_id = v_org
                    and s.is_active and s.left_at is null)
     or chat.sales_department_role(new.staff_id) is null then
    raise exception 'a family''s Sales owner is a live member of the Sales department'
      using errcode = 'check_violation';
  end if;
  if not chat.staff_of(new.assigned_by, v_org) then
    raise exception 'a Sales owner is set by staff of the family''s organization' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and new.family_id is distinct from old.family_id then
    raise exception 'a Sales owner row stays with its family' using errcode = 'check_violation';
  end if;
  -- The Sales manager or the super admin set and change it. A Sales member
  -- owns only the family they are entering in this very transaction (review
  -- P1-B): never one that already existed.
  if not (exists (select 1 from chat.staff s where s.id = new.assigned_by and s.organization_id = v_org and s.role = 'super_admin')
          or chat.sales_department_role(new.assigned_by) = 'manager'
          or (tg_op = 'INSERT' and new.assigned_by = new.staff_id
              and chat.pd042_created_in_this_transaction('chat.pd042_entered_families', new.family_id))) then
    raise exception 'a family''s Sales owner is set by the Sales manager or the super admin; a Sales member owns only a family they are entering'
      using errcode = 'insufficient_privilege';
  end if;
  new.assigned_at := now();
  return new;
end;
$$;

create trigger family_sales_owner_is_coherent
  before insert or update or delete on chat.family_sales_owner
  for each row execute function chat.guard_family_sales_owner();

-- "Their own family", whatever the Sales switch says: the families PD-42's
-- own actions (enter, add a child, carry a package over) are scoped to. A
-- covering backup acts FOR a supervisor; it does not own their families
-- (review P2): the 'backup' basis of chat.staff_reaches_family is left out.
create or replace function chat.staff_owns_family(p_staff uuid, p_family uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select exists (
    select 1
      from chat.staff s
      join chat.family f on f.id = p_family and f.organization_id = s.organization_id
     where s.id = p_staff and s.is_active and s.left_at is null
       and (s.role = 'super_admin'
            or chat.is_operations_manager(s.id, f.organization_id)
            or chat.sales_department_role(s.id) = 'manager'
            or exists (select 1
                         from chat.learner_supervision ls
                         join chat.learner l on l.id = ls.learner_id
                        where l.family_id = f.id
                          and chat.staff_acts_for(s.id, ls.supervisor_id, now()) in ('self', 'manager'))
            or exists (select 1 from chat.family_sales_owner o where o.family_id = f.id and o.staff_id = s.id)));
$$;

-- The same, plus every Sales member while sales.family_scope is 'all' (PR-4
-- calls it from the write guards of the family-scoped tables).
create or replace function chat.staff_may_handle_family(p_staff uuid, p_family uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select chat.staff_owns_family(p_staff, p_family)
      or (chat.sales_family_scope() = 'all'
          and chat.sales_department_role(p_staff) = 'member'
          and exists (select 1 from chat.staff s join chat.family f on f.id = p_family and f.organization_id = s.organization_id
                       where s.id = p_staff and s.is_active and s.left_at is null));
$$;

-- ===========================================================================
-- 2. One family per parent: the contact keys
-- ===========================================================================

create table chat.family_contact_key (
  organization_id  uuid not null references chat.organization (id),
  -- HMAC-SHA256 (hex) of the normalised e-mail (trimmed, lower case) or of the
  -- number in E.164, under a server key (contactKeyHash, keyed like PD-43's
  -- code hash with its own label). The plain value lives only in the parent
  -- file (G-07); a database read or backup cannot be reversed to it.
  key_hash         text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  family_id        uuid not null references chat.family (id) on delete cascade,
  kind             text not null check (kind in ('email', 'phone')),
  created_by       uuid references chat.staff (id),
  created_at       timestamptz not null default now(),
  primary key (organization_id, key_hash)
);

comment on table chat.family_contact_key is
  'PD-42 S1: keyed hashes of each family''s parents'' e-mail / E.164 number. The primary key makes a second family for the same parent impossible within an academy. Holds no plain contact value. Never edited; removed only with its family.';

create index family_contact_key_family_idx on chat.family_contact_key (family_id);

create or replace function chat.guard_family_contact_key()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_org uuid;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from chat.family f where f.id = old.family_id) then
      raise exception 'a contact key is never removed while its family exists' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'a contact key never changes' using errcode = 'check_violation';
  end if;
  select organization_id into v_org from chat.family where id = new.family_id;
  if v_org is null then
    raise exception 'a contact key is for a family' using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  -- Said in words before the primary key would (Prisma drops 23505's message).
  if exists (select 1 from chat.family_contact_key k where k.organization_id = v_org and k.key_hash = new.key_hash) then
    raise exception 'this parent is already in Chat' using errcode = 'check_violation';
  end if;
  if new.created_by is not null and not chat.staff_of(new.created_by, v_org) then
    raise exception 'a contact key is added by staff of the family''s organization' using errcode = 'insufficient_privilege';
  end if;
  new.created_at := now();
  return new;
end;
$$;

create trigger family_contact_key_is_coherent
  before insert or update or delete on chat.family_contact_key
  for each row execute function chat.guard_family_contact_key();

-- ===========================================================================
-- 3. The enrolment record, generalised; who entered each child
-- ===========================================================================

alter table chat.student_enrolment add column id uuid not null default gen_random_uuid();
alter table chat.student_enrolment drop constraint student_enrolment_pkey;
alter table chat.student_enrolment add constraint student_enrolment_pkey primary key (id);
alter table chat.student_enrolment alter column lesson_id drop not null;
alter table chat.student_enrolment add constraint student_enrolment_lesson_id_key unique (lesson_id);

alter table chat.student_enrolment
  add column origin text not null default 'trial' check (origin in ('trial', 'intake')),
  add column kind   text not null default 'new_family' check (kind in ('new_family', 'added_children'));

alter table chat.student_enrolment add constraint student_enrolment_trial_names_its_lesson
  check ((origin = 'trial') = (lesson_id is not null));

alter table chat.student_enrolment drop constraint student_enrolment_family_id_key;
create unique index student_enrolment_one_new_family on chat.student_enrolment (family_id) where kind = 'new_family';
create index student_enrolment_family_idx on chat.student_enrolment (family_id);

alter table chat.student_enrolment alter column account_id drop not null;
-- PD-16's trial enrolment always made the parent an account; an intake may
-- not have an e-mail yet, and added children reuse the family's parent.
alter table chat.student_enrolment add constraint student_enrolment_trial_family_has_an_account
  check (origin <> 'trial' or kind <> 'new_family' or account_id is not null);

comment on table chat.student_enrolment is
  'PD-16 / PD-42: a family or children Chat created -- from an assigned trial form (origin trial, keyed by its lesson) or entered by a supervisor (origin intake). assigned_by / assigned_at: who entered them and when, immutable. Who supervises the children is chat.learner_supervision (live), never a copy here.';

-- Who entered each child, once (review P1-A): written only by the intake
-- enrolment that CREATED the child, so the carried-over package's conditions
-- 1-3 read a fact nobody can restart by listing an existing child again.
create table chat.learner_intake (
  learner_id       uuid primary key references chat.learner (id) on delete cascade,
  organization_id  uuid not null references chat.organization (id),
  family_id        uuid not null references chat.family (id) on delete cascade,
  enrolment_id     uuid not null references chat.student_enrolment (id),
  entered_by       uuid not null references chat.staff (id),
  entered_at       timestamptz not null
);

comment on table chat.learner_intake is
  'PD-42: the staff member who entered a child by hand, and when -- written by the intake enrolment that created the child, never edited or removed. PD-30-amendment-carried-over reads it.';

create index learner_intake_enrolment_idx on chat.learner_intake (enrolment_id);

create or replace function chat.guard_learner_intake()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from chat.learner l where l.id = old.learner_id) then
      raise exception 'who entered a child is never removed' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'who entered a child never changes' using errcode = 'check_violation';
  end if;
  if coalesce(current_setting('chat.pd042_writing_learner_intake', true), '') <> 'on' then
    raise exception 'who entered a child is recorded by their intake enrolment only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger learner_intake_is_written_by_its_enrolment
  before insert or update or delete on chat.learner_intake
  for each row execute function chat.guard_learner_intake();

create or replace function chat.guard_student_enrolment()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'an enrolment is never deleted' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    -- S1: a replay of an intake (same id) writes nothing. A BEFORE trigger runs
    -- ahead of ON CONFLICT, so the skip is decided here.
    if exists (select 1 from chat.student_enrolment e where e.id = new.id) then
      return null;
    end if;
    if not exists (select 1 from chat.family f where f.id = new.family_id and f.organization_id = new.organization_id)
       or not exists (select 1 from chat.contact c where c.id = new.contact_id and c.family_id = new.family_id
                         and (new.account_id is null or c.account_id = new.account_id)) then
      raise exception 'an enrolment names its family, and a parent of that family (with that parent''s account)'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from unnest(new.learner_ids) l
                where not exists (select 1 from chat.learner x where x.id = l and x.family_id = new.family_id)) then
      raise exception 'an enrolment''s children belong to its family' using errcode = 'check_violation';
    end if;
    if new.kind = 'new_family'
       and exists (select 1 from chat.student_enrolment e where e.family_id = new.family_id and e.kind = 'new_family') then
      raise exception 'this family was already entered; add the children to it instead' using errcode = 'check_violation';
    end if;
    if new.origin = 'trial' then
      if not exists (select 1 from chat.trial_subscription s
                      where s.lesson_id = new.lesson_id and s.organization_id = new.organization_id and s.withdrawn_at is null) then
        raise exception 'a trial enrolment names a live subscription form' using errcode = 'check_violation';
      end if;
      if not chat.is_operations_manager(new.assigned_by, new.organization_id) then
        raise exception 'only the Operations manager or the super admin enrols a new student'
          using errcode = 'insufficient_privilege';
      end if;
    else
      -- PD-42 intake: a supervisor (or their manager) for a family they own...
      if not chat.staff_has_permission(new.assigned_by, 'new_students.manage')
         or not chat.staff_owns_family(new.assigned_by, new.family_id) then
        raise exception 'a family is entered by its own Sales or Operations supervisor, or their manager'
          using errcode = 'insufficient_privilege';
      end if;
      -- ...listing only children this very intake created (review P1-A): an
      -- existing child (PD-16, Core, an earlier intake) is never re-listed.
      if exists (select 1 from unnest(new.learner_ids) l
                  where not chat.pd042_created_in_this_transaction('chat.pd042_entered_learners', l)
                     or exists (select 1 from chat.student_enrolment e where l = any (e.learner_ids))) then
        raise exception 'an intake lists only the children it creates; an existing child is never entered again'
          using errcode = 'check_violation';
      end if;
      -- A new family is entered with at least one contact key (S1).
      if new.kind = 'new_family'
         and not exists (select 1 from chat.family_contact_key k where k.family_id = new.family_id) then
        raise exception 'a family is entered with its parent''s e-mail or number' using errcode = 'check_violation';
      end if;
    end if;
    if new.group_conversation_id is not null then
      raise exception 'an enrolment is born without its group' using errcode = 'check_violation';
    end if;
    new.assigned_at := now();
    return new;
  end if;
  -- UPDATE: the group, once; and an intake parent's account, once (the
  -- sign-in e-mail entered later).
  if (new.id, new.lesson_id, new.organization_id, new.family_id, new.contact_id, new.learner_ids,
      new.assigned_by, new.assigned_at, new.origin, new.kind)
     is distinct from
     (old.id, old.lesson_id, old.organization_id, old.family_id, old.contact_id, old.learner_ids,
      old.assigned_by, old.assigned_at, old.origin, old.kind) then
    raise exception 'only the family''s group, or a missing parent account, is added to an enrolment'
      using errcode = 'check_violation';
  end if;
  if new.account_id is distinct from old.account_id then
    if old.account_id is not null or new.account_id is null then
      raise exception 'an enrolment''s parent account is set once' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from chat.contact c where c.id = new.contact_id and c.account_id = new.account_id) then
      raise exception 'the account is the enrolment parent''s own' using errcode = 'check_violation';
    end if;
  end if;
  if new.group_conversation_id is distinct from old.group_conversation_id then
    if old.group_conversation_id is not null then
      raise exception 'an enrolment''s group is recorded once' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from chat.conversation c
                    where c.id = new.group_conversation_id and c.family_id = new.family_id and c.type = 'family_group') then
      raise exception 'the group is the family''s own family group' using errcode = 'check_violation';
    end if;
    new.group_created_at := now();
  end if;
  return new;
end;
$$;

-- The intake enrolment records who entered each of its children.
create or replace function chat.pd042_record_learner_intake()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if new.origin = 'intake' then
    perform set_config('chat.pd042_writing_learner_intake', 'on', true);
    insert into chat.learner_intake (learner_id, organization_id, family_id, enrolment_id, entered_by, entered_at)
    select l, new.organization_id, new.family_id, new.id, new.assigned_by, new.assigned_at
      from unnest(new.learner_ids) l;
    perform set_config('chat.pd042_writing_learner_intake', 'off', true);
  end if;
  return null;
end;
$$;

create trigger student_enrolment_records_learner_intake
  after insert on chat.student_enrolment
  for each row execute function chat.pd042_record_learner_intake();

-- A child with the teacher Sales chose (PD-16), or entered by a supervisor
-- (PD-42), whose teacher may not be known yet.
create or replace function chat.enrol_learner(
  p_family_id  uuid,
  p_name       text,
  p_teacher_id uuid,
  p_actor_id   uuid
) returns uuid
language plpgsql
as $$
declare
  v_actor   uuid := chat.trusted_staff_actor(p_actor_id);
  v_family  chat.family%rowtype;
  v_teacher chat.teacher%rowtype;
  v_id      uuid := gen_random_uuid();
begin
  select * into v_family from chat.family where id = p_family_id;
  if v_family.id is null then
    raise exception 'family % does not exist', p_family_id using errcode = 'no_data_found';
  end if;
  if not chat.is_operations_manager(v_actor, v_family.organization_id)
     and not (chat.staff_has_permission(v_actor, 'new_students.manage')
              and (chat.staff_owns_family(v_actor, v_family.id)
                   -- the first child of a family the actor is entering in
                   -- this transaction: nothing makes it theirs yet.
                   or (v_family.owner_id = v_actor
                       and chat.pd042_created_in_this_transaction('chat.pd042_entered_families', v_family.id)))) then
    raise exception 'a child is enrolled by the Operations manager, the super admin, or the family''s own supervisor'
      using errcode = 'insufficient_privilege';
  end if;
  if p_teacher_id is not null then
    select * into v_teacher from chat.teacher where id = p_teacher_id;
    if v_teacher.id is null or v_teacher.organization_id is distinct from v_family.organization_id then
      raise exception 'the teacher belongs to the family''s organization' using errcode = 'insufficient_privilege';
    end if;
    if not v_teacher.is_active or v_teacher.left_at is not null then
      raise exception 'an inactive teacher cannot take a learner' using errcode = 'check_violation';
    end if;
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise exception 'a child has a name' using errcode = 'check_violation';
  end if;

  perform set_config('chat.syncing_assignment', 'on', true);
  insert into chat.learner (id, organization_id, family_id, name, teacher_id)
  values (v_id, v_family.organization_id, v_family.id, btrim(p_name), p_teacher_id);
  perform set_config('chat.syncing_assignment', 'off', true);
  perform chat.pd042_note_created('chat.pd042_entered_learners', v_id);
  return v_id;
end;
$$;

-- ===========================================================================
-- 4. Supervision: who may place a child on a supervisor
-- ===========================================================================
-- Named, always, by the authenticated actor (chat.trusted_staff_actor refuses
-- a request role naming somebody else). The Operations manager of the child's
-- academy (or the super admin) places any child and moves it; an Operations
-- supervisor places on themself only a child they are entering in this very
-- transaction -- never one that already exists (review P2). The academy's own
-- import (and test fixtures standing in for it) opens chat.syncing_supervision
-- for its statement, as chat.syncing_assignment does for teachers.

create or replace function chat.guard_learner_supervision_assigner()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.supervisor_id is not distinct from old.supervisor_id
     and new.assigned_by is not distinct from old.assigned_by then
    return new;
  end if;
  if coalesce(current_setting('chat.syncing_supervision', true), '') = 'on' then
    return new;
  end if;
  if new.assigned_by is null then
    raise exception 'a supervision names who assigned it' using errcode = 'check_violation';
  end if;
  perform chat.trusted_staff_actor(new.assigned_by);
  if chat.is_operations_manager(new.assigned_by, new.organization_id) then
    return new;
  end if;
  if tg_op = 'INSERT'
     and new.assigned_by = new.supervisor_id
     and chat.pd042_created_in_this_transaction('chat.pd042_entered_learners', new.learner_id) then
    return new;
  end if;
  raise exception 'an Operations supervisor places on themself only a child they are entering; anyone else is placed by the Operations manager'
    using errcode = 'insufficient_privilege';
end;
$$;

-- After guard_learner_supervision (alphabetical), which sets organization_id.
create trigger learner_supervision_zz_assigner_is_entitled
  before insert or update on chat.learner_supervision
  for each row execute function chat.guard_learner_supervision_assigner();

-- ===========================================================================
-- 5. Families made through PD-16: their Sales owner
-- ===========================================================================
-- The Sales member who recorded the trial's form, while they are still a live
-- member of Sales in the same academy; nobody otherwise (the Sales manager can
-- set one later). assigned_by = the recorder is a self-assignment, which the
-- guard accepts only for a family listed as entered in this transaction: the
-- backfill lists exactly the PD-16 families for its own statement, then clears it.

select set_config('chat.pd042_entered_families',
  coalesce((select string_agg(e.family_id::text, ',') from chat.student_enrolment e where e.origin = 'trial' and e.kind = 'new_family'), ''),
  true);

insert into chat.family_sales_owner (family_id, organization_id, staff_id, assigned_by, reason)
select e.family_id, e.organization_id, t.recorded_by, t.recorded_by, 'recorded the trial''s subscription form (PD-16), carried over by PD-42'
  from chat.student_enrolment e
  join chat.trial_subscription t on t.lesson_id = e.lesson_id and t.organization_id = e.organization_id
  join chat.staff s on s.id = t.recorded_by and s.organization_id = e.organization_id and s.is_active and s.left_at is null
 where e.origin = 'trial' and e.kind = 'new_family'
   and chat.sales_department_role(t.recorded_by) is not null
on conflict (family_id) do nothing;

select set_config('chat.pd042_entered_families', '', true);

-- ===========================================================================
-- 6. The carried-over package (PD-30's ledger)
-- ===========================================================================

alter table chat.learner_subscription
  add column lessons_used_before integer not null default 0 check (lessons_used_before between 0 and 1000),
  add column over_confirmed_by   uuid references chat.staff (id);

alter table chat.learner_subscription drop constraint learner_subscription_source_check;
alter table chat.learner_subscription add constraint learner_subscription_source_check
  check (source in ('payment_request', 'instalment_plan', 'staff', 'backfill', 'carried_over'));

alter table chat.learner_subscription drop constraint learner_subscription_plan_months_check;
alter table chat.learner_subscription add constraint learner_subscription_plan_months_check
  check (plan_months is null or plan_months in (1, 3, 6, 12) or (source = 'carried_over' and plan_months between 1 and 24));

alter table chat.learner_subscription drop constraint learner_subscription_staff_named;
alter table chat.learner_subscription add constraint learner_subscription_staff_named
  check (source not in ('staff', 'instalment_plan', 'carried_over') or created_by is not null);

alter table chat.learner_subscription add constraint learner_subscription_used_before_is_carried_over
  check (source = 'carried_over' or (lessons_used_before = 0 and over_confirmed_by is null));

-- PD-42 F1: completed above the total is entered as it is, by a manager.
alter table chat.learner_subscription add constraint learner_subscription_over_is_confirmed
  check ((lessons_used_before > lessons_included) = (over_confirmed_by is not null));

create unique index learner_subscription_one_carried_over on chat.learner_subscription (learner_id)
  where source = 'carried_over' and voided_at is null;

comment on column chat.learner_subscription.lessons_used_before is
  'PD-42: a carried-over package''s lessons completed before the child was entered in Chat, exactly as entered. Counted by chat.compute_learner_access; 0 for every other source.';

create or replace function chat.guard_learner_subscription()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_learner  chat.learner%rowtype;
  v_intake   chat.learner_intake%rowtype;
  v_previous chat.learner_subscription%rowtype;
  v_day      date;
  v_manager  boolean;
  v_entrant  boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'a subscription is voided, never deleted' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    select * into v_learner from chat.learner where id = new.learner_id;
    if v_learner.id is null then
      raise exception 'a subscription is for a child' using errcode = 'foreign_key_violation';
    end if;
    new.organization_id := v_learner.organization_id;
    new.family_id := v_learner.family_id;
    if new.created_by is not null and not chat.staff_of(new.created_by, new.organization_id) then
      raise exception 'a subscription is added by staff of its organization' using errcode = 'insufficient_privilege';
    end if;
    -- A subscription with no payment behind it is free lessons: the three
    -- roles only, with a reason, starting from a week ago to a month ahead.
    if new.source = 'staff' then
      if not chat.can_grant_subscription_exception(new.created_by) then
        raise exception 'a subscription with no payment is added by the super admin, the Operations Manager or the Sales Manager'
          using errcode = 'insufficient_privilege';
      end if;
      if new.note is null then
        raise exception 'a subscription with no payment says why' using errcode = 'check_violation';
      end if;
      if new.starts_on < chat.pd030_today() - 7 or new.starts_on > chat.pd030_today() + 30 then
        raise exception 'a subscription added by hand starts from a week ago to a month ahead' using errcode = 'check_violation';
      end if;
    end if;
    -- PD-42 and PD-30-amendment-carried-over: the package a child already had
    -- in Jawwid Core, carried over as it stood.
    if new.source = 'carried_over' then
      -- One decision at a time per child: condition 4 cannot race (review P2).
      perform 1 from chat.learner l where l.id = new.learner_id for update;
      -- Condition 4, for everyone: never on top of another package.
      if exists (select 1 from chat.learner_subscription s where s.learner_id = new.learner_id and s.voided_at is null) then
        raise exception 'a carried-over package is only for a child with no other package' using errcode = 'check_violation';
      end if;
      select * into v_intake from chat.learner_intake i where i.learner_id = new.learner_id;
      v_manager := chat.can_grant_subscription_exception(new.created_by);
      if v_intake.learner_id is not null then
        -- It counts from the child's intake day: lessons held in Chat since
        -- then use it, and Core's count covers everything before (PD-42 F5).
        v_day := (v_intake.entered_at at time zone chat.pd030_zone())::date;
        if new.starts_on <> v_day then
          raise exception 'a carried-over package starts on the day the child was entered (%)', v_day
            using errcode = 'check_violation';
        end if;
      elsif new.starts_on < chat.pd030_today() - 7 or new.starts_on > chat.pd030_today() + 30 then
        raise exception 'a subscription added by hand starts from a week ago to a month ahead' using errcode = 'check_violation';
      end if;
      -- Conditions 1, 2, 3 and 5, read from who entered the child.
      v_entrant := v_intake.learner_id is not null
        and new.created_by = v_intake.entered_by
        and now() <= v_intake.entered_at + interval '14 days'
        and chat.staff_owns_family(new.created_by, new.family_id)
        and chat.staff_has_permission(new.created_by, 'subscriptions.carry_over');
      -- Grace once: a re-add that leaves more lessons than the row it replaces,
      -- after the child has used any lesson in Chat, is the managers'.
      if v_entrant then
        select * into v_previous from chat.learner_subscription s
         where s.learner_id = new.learner_id and s.source = 'carried_over' and s.voided_at is not null
         order by s.voided_at desc limit 1;
        if v_previous.id is not null
           and chat.learner_lessons_used(new.learner_id, v_previous.starts_on) > 0
           and new.lessons_included - new.lessons_used_before > v_previous.lessons_included - v_previous.lessons_used_before then
          v_entrant := false;
        end if;
      end if;
      if not v_entrant and not v_manager then
        raise exception 'a carried-over package is entered by the supervisor who entered the child, within 14 days, for their own family; otherwise by the super admin, the Operations Manager or the Sales Manager'
          using errcode = 'insufficient_privilege';
      end if;
      -- F1: completed above the package is a manager's entry, confirmed by
      -- that same manager (review P2: no named confirmer is trusted).
      if new.lessons_used_before > new.lessons_included
         and (not v_manager or new.over_confirmed_by is distinct from new.created_by) then
        raise exception 'completed lessons above the package are entered and confirmed by the super admin, the Operations Manager or the Sales Manager'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
    if new.request_id is not null and not exists (
      select 1 from chat.payment_request r
       where r.id = new.request_id and r.family_id = new.family_id and r.learner_id = new.learner_id) then
      raise exception 'a request credits the child it was made for' using errcode = 'check_violation';
    end if;
    if new.voided_at is not null then
      raise exception 'a subscription is added standing' using errcode = 'check_violation';
    end if;
    new.created_at := now();
    return new;
  end if;

  if (new.id, new.organization_id, new.learner_id, new.family_id, new.plan_months, new.lessons_included,
      new.starts_on, new.source, new.request_id, new.plan_ref, new.note, new.created_by, new.created_at,
      new.lessons_used_before, new.over_confirmed_by)
     is distinct from
     (old.id, old.organization_id, old.learner_id, old.family_id, old.plan_months, old.lessons_included,
      old.starts_on, old.source, old.request_id, old.plan_ref, old.note, old.created_by, old.created_at,
      old.lessons_used_before, old.over_confirmed_by) then
    raise exception 'a subscription never changes; void it and add another' using errcode = 'check_violation';
  end if;
  if old.voided_at is not null then
    raise exception 'a voided subscription is final' using errcode = 'check_violation';
  end if;
  if new.voided_by is not null and not chat.staff_of(new.voided_by, new.organization_id) then
    raise exception 'a subscription is voided by staff of its organization' using errcode = 'insufficient_privilege';
  end if;
  -- A carried-over package is corrected (voided) by the supervisor who entered
  -- it, within 14 days of the child's intake, or by the three managers (review P2).
  if old.source = 'carried_over' and new.voided_at is not null then
    select * into v_intake from chat.learner_intake i where i.learner_id = old.learner_id;
    if new.voided_by is null
       or not (chat.can_grant_subscription_exception(new.voided_by)
               or (new.voided_by = old.created_by
                   and v_intake.entered_by = new.voided_by
                   and now() <= v_intake.entered_at + interval '14 days')) then
      raise exception 'a carried-over package is corrected by the supervisor who entered it within 14 days, or by the super admin, the Operations Manager or the Sales Manager'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

-- PD-30's state, with a carried-over package's completed lessons counted.
-- Identical to 20261026140000 for every row whose lessons_used_before is 0.
create or replace function chat.compute_learner_access(
  p_learner uuid,
  out state text,
  out reasons text[],
  out excepted text[],
  out balance integer,
  out grace_left integer,
  out overdue_instalment_id uuid,
  out overdue_due_on date)
language plpgsql
stable
security definer
set search_path = chat, pg_temp
as $$
declare
  v_today    date := chat.pd030_today();
  v_grace    integer := chat.pd030_grace_lessons();
  v_family   uuid;
  v_from     date;
  v_included integer;
  v_before   integer;
  v_exc_bal  boolean;
  v_exc_due  boolean;
  v_in_grace boolean := false;
begin
  reasons := '{}';
  excepted := '{}';
  select l.family_id into v_family from chat.learner l where l.id = p_learner;

  select bool_or(e.kind in ('balance', 'both')), bool_or(e.kind in ('overdue', 'both'))
    into v_exc_bal, v_exc_due
    from chat.subscription_exception e
   where e.learner_id = p_learner and e.revoked_at is null and e.valid_until >= v_today;

  select min(s.starts_on), sum(s.lessons_included)::integer, sum(s.lessons_used_before)::integer
    into v_from, v_included, v_before
    from chat.learner_subscription s
   where s.learner_id = p_learner and s.voided_at is null;

  if v_from is not null then
    balance := v_included - v_before - chat.learner_lessons_used(p_learner, v_from);
    if balance <= 0 then
      grace_left := greatest(v_grace + balance, 0);
      if grace_left > 0 then
        v_in_grace := true;
      elsif coalesce(v_exc_bal, false) then
        excepted := excepted || 'balance'::text;
      else
        reasons := reasons || 'balance'::text;
      end if;
    end if;
  end if;

  select i.id, i.due_date into overdue_instalment_id, overdue_due_on
    from chat.family_instalment i
   where i.family_id = v_family
     and (i.learner_id is null or i.learner_id = p_learner)
     and i.voided_at is null and i.paid_on is null
     and i.due_date < v_today
     and chat.pd030_overdue_from() is not null
     and i.due_date >= chat.pd030_overdue_from()
   order by i.due_date, i.created_at
   limit 1;
  if overdue_instalment_id is not null then
    if coalesce(v_exc_due, false) then
      excepted := excepted || 'overdue'::text;
      overdue_instalment_id := null;
      overdue_due_on := null;
    else
      reasons := reasons || 'overdue'::text;
    end if;
  end if;

  state := case when cardinality(reasons) > 0 then 'locked' when v_in_grace then 'grace' else 'open' end;
end;
$$;

-- ===========================================================================
-- 7. The permission key (PD-40's catalogue changes only by migration)
-- ===========================================================================

select set_config('chat.pd040_catalogue_change', 'on', true);

-- BEGIN GENERATED pd042 catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values
  ('subscriptions.carry_over', 'subscriptions', 'carry_over', 'Carry over a package from Jawwid Core', 'ترحيل باقة الطالب من جوِّد كور', 'finance', false, 'PD-42');

insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'operations', 'subscriptions.carry_over'),
  ('manager', 'sales', 'subscriptions.carry_over'),
  ('supervisor', 'operations', 'subscriptions.carry_over'),
  ('supervisor', 'sales', 'subscriptions.carry_over');
-- END GENERATED pd042 catalogue rows

select set_config('chat.pd040_catalogue_change', 'off', true);

-- ===========================================================================
-- 8. Fail closed
-- ===========================================================================

alter table chat.family_sales_owner enable row level security;
alter table chat.family_contact_key enable row level security;
alter table chat.learner_intake enable row level security;
revoke all on chat.family_sales_owner, chat.family_contact_key, chat.learner_intake from public, anon, authenticated, chat_app;

revoke all on function chat.sales_family_scope() from public;
revoke all on function chat.staff_owns_family(uuid, uuid) from public;
revoke all on function chat.staff_may_handle_family(uuid, uuid) from public;
revoke all on function chat.guard_family_sales_owner() from public;
revoke all on function chat.guard_family_contact_key() from public;
revoke all on function chat.guard_learner_supervision_assigner() from public;
revoke all on function chat.pd042_created_in_this_transaction(text, uuid) from public;
revoke all on function chat.pd042_note_created(text, uuid) from public;
revoke all on function chat.create_intake_family(text, uuid) from public;
revoke all on function chat.guard_learner_intake() from public;
revoke all on function chat.pd042_record_learner_intake() from public;
