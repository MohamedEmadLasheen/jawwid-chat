-- PD-16 (2026-10-21) -- enrolling a new student from the New Students page,
-- and the parent's own sign-up.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-16.
--
-- WHAT IS NEW
--
--   chat.student_enrolment     one row per subscription form the Operations
--                              manager assigned: the family, parent, account
--                              and children Chat created from Sales' form, and
--                              (later) the family's group. The form itself
--                              stays confined in chat.trial_subscription.
--   chat.enrol_learner         the third writer of chat.learner.teacher_id
--                              (after Core ingestion and chat.transfer_learner):
--                              creates a child with the teacher Sales chose.
--                              Server-side only; the super admin or the
--                              Operations manager; opens the assignment gate
--                              for its own statement only.
--   chat.parent_signup_code    a one-time code that lets a parent whose account
--                              Chat created set their own password. Until a
--                              WhatsApp sender is connected the code is relayed
--                              by the family's supervisor (delivery 'relay').
--   learner_enrollment.stated_age
--                              the age Sales recorded, with the day it was true,
--                              until a date of birth is entered.
--
-- A FORM THAT BECAME A FAMILY IS FROZEN: once enrolled, Sales' form is neither
-- edited nor withdrawn, so the page and the records never disagree.
--
-- FAIL CLOSED. RLS on, no grant to any request role.

-- ===========================================================================
-- 1. Who may enrol: the super admin or the Operations manager
-- ===========================================================================

create or replace function chat.is_operations_manager(p_staff uuid, p_org uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.staff s
     where s.id = p_staff and s.organization_id = p_org and s.is_active and s.left_at is null
       and (s.role = 'super_admin'
            or exists (select 1 from chat.department d
                        where d.organization_id = p_org and d.kind = 'operations' and d.manager_id = s.id)));
$$;

-- ===========================================================================
-- 2. Creating a child with their teacher
-- ===========================================================================

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
  if not chat.is_operations_manager(v_actor, v_family.organization_id) then
    raise exception 'only the Operations manager or the super admin enrols a new student'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_teacher from chat.teacher where id = p_teacher_id;
  if v_teacher.id is null or v_teacher.organization_id is distinct from v_family.organization_id then
    raise exception 'the teacher belongs to the family''s organization' using errcode = 'insufficient_privilege';
  end if;
  if not v_teacher.is_active or v_teacher.left_at is not null then
    raise exception 'an inactive teacher cannot take a learner' using errcode = 'check_violation';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise exception 'a child has a name' using errcode = 'check_violation';
  end if;

  perform set_config('chat.syncing_assignment', 'on', true);
  insert into chat.learner (id, organization_id, family_id, name, teacher_id)
  values (v_id, v_family.organization_id, v_family.id, btrim(p_name), p_teacher_id);
  perform set_config('chat.syncing_assignment', 'off', true);
  return v_id;
end;
$$;

-- ===========================================================================
-- 3. The enrolment record
-- ===========================================================================

create table chat.student_enrolment (
  lesson_id              uuid primary key references chat.trial_subscription (lesson_id),
  organization_id        uuid not null references chat.organization (id),
  family_id              uuid not null unique references chat.family (id),
  contact_id             uuid not null references chat.contact (id),
  account_id             uuid not null references chat.account (id),
  learner_ids            uuid[] not null check (cardinality(learner_ids) between 1 and 10),
  assigned_by            uuid not null references chat.staff (id),
  assigned_at            timestamptz not null default now(),
  group_conversation_id  uuid references chat.conversation (id),
  group_created_by       uuid references chat.staff (id),
  group_created_at       timestamptz,
  constraint student_enrolment_group_is_whole
    check ((group_conversation_id is null) = (group_created_by is null)
       and (group_conversation_id is null) = (group_created_at is null))
);

comment on table chat.student_enrolment is
  'PD-16: a subscription form the Operations manager assigned, and the family, parent, account and children Chat created from it. Who supervises the children is chat.learner_supervision (live), never a copy here.';

create or replace function chat.guard_student_enrolment()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'an enrolment is never deleted' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from chat.trial_subscription s
                    where s.lesson_id = new.lesson_id and s.organization_id = new.organization_id and s.withdrawn_at is null)
       or not exists (select 1 from chat.family f where f.id = new.family_id and f.organization_id = new.organization_id)
       or not exists (select 1 from chat.contact c where c.id = new.contact_id and c.family_id = new.family_id
                         and c.account_id = new.account_id) then
      raise exception 'an enrolment names a live form, and the family, parent and account made from it'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from unnest(new.learner_ids) l
                where not exists (select 1 from chat.learner x where x.id = l and x.family_id = new.family_id)) then
      raise exception 'an enrolment''s children belong to its family' using errcode = 'check_violation';
    end if;
    if not chat.is_operations_manager(new.assigned_by, new.organization_id) then
      raise exception 'only the Operations manager or the super admin enrols a new student'
        using errcode = 'insufficient_privilege';
    end if;
    if new.group_conversation_id is not null then
      raise exception 'an enrolment is born without its group' using errcode = 'check_violation';
    end if;
    new.assigned_at := now();
    return new;
  end if;
  -- UPDATE: only the group is written, once.
  if (new.lesson_id, new.organization_id, new.family_id, new.contact_id, new.account_id, new.learner_ids,
      new.assigned_by, new.assigned_at)
     is distinct from
     (old.lesson_id, old.organization_id, old.family_id, old.contact_id, old.account_id, old.learner_ids,
      old.assigned_by, old.assigned_at) then
    raise exception 'only the family''s group is added to an enrolment' using errcode = 'check_violation';
  end if;
  if old.group_conversation_id is not null then
    raise exception 'an enrolment''s group is recorded once' using errcode = 'check_violation';
  end if;
  if new.group_conversation_id is not null then
    if not exists (select 1 from chat.conversation c
                    where c.id = new.group_conversation_id and c.family_id = new.family_id and c.type = 'family_group') then
      raise exception 'the group is the family''s own family group' using errcode = 'check_violation';
    end if;
    new.group_created_at := now();
  end if;
  return new;
end;
$$;

create trigger student_enrolment_is_coherent
  before insert or update or delete on chat.student_enrolment
  for each row execute function chat.guard_student_enrolment();

-- Once a form became a family, it stays as it was recorded.
create or replace function chat.freeze_enrolled_subscription()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from chat.student_enrolment e where e.lesson_id = old.lesson_id) then
    raise exception 'this student is already enrolled: the subscription form can no longer change'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trial_subscription_frozen_once_enrolled
  before update on chat.trial_subscription
  for each row execute function chat.freeze_enrolled_subscription();

-- ===========================================================================
-- 4. The parent's sign-up code
-- ===========================================================================

create table chat.parent_signup_code (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  account_id       uuid not null references chat.account (id),
  -- sha-256 of the code; the code itself only while it is relayed by hand.
  code_hash        text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  relay_code       text check (relay_code is null or relay_code ~ '^[0-9]{6}$'),
  delivery         text not null default 'relay' check (delivery in ('relay')),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  attempts         integer not null default 0 check (attempts between 0 and 5),
  used_at          timestamptz,
  superseded_at    timestamptz,
  constraint parent_signup_code_expires_after_creation check (expires_at > created_at)
);

comment on table chat.parent_signup_code is
  'PD-16: a one-time code letting a parent set the password of the account Chat created for them. Short-lived; at most five tries; the plain code is kept only while a supervisor relays it.';

create unique index parent_signup_code_one_live on chat.parent_signup_code (account_id)
  where used_at is null and superseded_at is null;

create or replace function chat.guard_parent_signup_code()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a sign-up code is never deleted' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from chat.account a where a.id = new.account_id and a.organization_id = new.organization_id
                      and a.kind = 'family')
       or not exists (select 1 from chat.student_enrolment e where e.account_id = new.account_id) then
      raise exception 'a sign-up code is for a parent account Chat created at enrolment' using errcode = 'check_violation';
    end if;
    if exists (select 1 from chat.account_credential c where c.account_id = new.account_id) then
      raise exception 'this parent has already signed up' using errcode = 'check_violation';
    end if;
    new.created_at := now();
    if new.expires_at > now() + interval '1 day' then
      raise exception 'a sign-up code lives at most a day' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (new.id, new.organization_id, new.account_id, new.code_hash, new.delivery, new.created_at, new.expires_at)
     is distinct from
     (old.id, old.organization_id, old.account_id, old.code_hash, old.delivery, old.created_at, old.expires_at) then
    raise exception 'a sign-up code''s identity never changes' using errcode = 'check_violation';
  end if;
  if new.attempts < old.attempts
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
     or (old.relay_code is null and new.relay_code is not null) then
    raise exception 'a sign-up code only moves forward' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger parent_signup_code_is_coherent
  before insert or update or delete on chat.parent_signup_code
  for each row execute function chat.guard_parent_signup_code();

-- ===========================================================================
-- 5. The age Sales recorded
-- ===========================================================================

alter table chat.learner_enrollment
  add column stated_age    smallint check (stated_age is null or stated_age between 1 and 99),
  add column stated_age_on date;

alter table chat.learner_enrollment add constraint learner_enrollment_stated_age_is_whole
  check ((stated_age is null) = (stated_age_on is null));

-- ===========================================================================
-- 6. Request roles: none
-- ===========================================================================

alter table chat.student_enrolment    enable row level security;
alter table chat.parent_signup_code   enable row level security;
revoke all on chat.student_enrolment, chat.parent_signup_code from public, anon, authenticated, chat_app;

revoke all on function chat.is_operations_manager(uuid, uuid) from public;
revoke all on function chat.enrol_learner(uuid, text, uuid, uuid) from public, anon, authenticated, chat_app;
revoke all on function chat.guard_student_enrolment() from public;
revoke all on function chat.freeze_enrolled_subscription() from public;
revoke all on function chat.guard_parent_signup_code() from public;
