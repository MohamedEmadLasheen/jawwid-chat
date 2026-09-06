-- Jawwid Chat -- Jawwid Core ingestion.
--
-- One function per synced entity. Every one of them is idempotent on the
-- external id and ordered by the event's source time, so the boundary can be
-- driven by an at-least-once webhook with no ordering guarantee -- which is what
-- PRD SS11.2 assumes ("at-least-once delivery with idempotent message ids").
--
-- Each returns the affected row id, or NULL when the payload legitimately does
-- not apply yet (an unknown family, a stale redelivery). NULL is an outcome, not
-- an error: the boundary acknowledges it so Core stops retrying.

-- System messages -----------------------------------------------------------
-- PRD SS7.3: a teacher change "adds the new teacher and removes the old one,
-- with a system message". Sequence is assigned under the conversation's row
-- lock, matching how chat.message.seq is assigned everywhere else.

create or replace function chat.post_system_message(
  p_conversation_id uuid,
  p_body            text
) returns uuid
language plpgsql
as $$
declare
  v_seq     bigint;
  v_message uuid;
begin
  update chat.conversation
     set last_seq = last_seq + 1,
         last_activity_at = now()
   where id = p_conversation_id
  returning last_seq into v_seq;

  if v_seq is null then
    return null;
  end if;

  insert into chat.message (conversation_id, seq, author_type, author_id,
                            type, body, visibility)
  values (p_conversation_id, v_seq, 'system', null, 'system', p_body, 'customer')
  returning id into v_message;

  insert into chat.outbox_event (type, payload)
  values ('message.created',
          jsonb_build_object('message_id', v_message,
                             'conversation_id', p_conversation_id,
                             'origin', 'core_sync'));
  return v_message;
end;
$$;

-- Student Groups ------------------------------------------------------------
-- PRD SS7.3: "One official Student Group per student, created automatically from
-- Jawwid Core relationships: the parent, every assigned teacher, and the
-- family's primary owner."
--
-- NOT IMPLEMENTED HERE, DELIBERATELY: whether coverage admins are permanent
-- silent members or join only during their window is PRD SS15.2 open question 4.
-- Until that is decided, this function does not add them, and chat.conversation_member
-- .is_silent is left for whoever implements the answer.

create or replace function chat.ensure_student_group(p_learner_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_learner chat.learner%rowtype;
  v_thread  uuid;
  v_id      uuid;
begin
  select * into v_learner from chat.learner where id = p_learner_id;
  if not found then
    return null;
  end if;

  select id into v_id from chat.conversation
   where learner_id = p_learner_id and type = 'student_group' and archived_at is null;
  if v_id is not null then
    return v_id;
  end if;

  select id into v_thread from chat.thread where family_id = v_learner.family_id;

  insert into chat.conversation (type, family_id, thread_id, learner_id, title)
  values ('student_group', v_learner.family_id, v_thread, p_learner_id,
          v_learner.name || ' · Jawwid')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function chat.sync_student_group_membership(p_learner_id uuid)
returns integer
language plpgsql
as $$
declare
  v_group   uuid := chat.ensure_student_group(p_learner_id);
  v_learner chat.learner%rowtype;
  v_family  chat.family%rowtype;
  v_changes integer := 0;
  r         record;
begin
  if v_group is null then
    return 0;
  end if;

  select * into v_learner from chat.learner where id = p_learner_id;
  select * into v_family  from chat.family  where id = v_learner.family_id;

  -- Who should be in the group, per PRD SS7.3.
  create temporary table if not exists _wanted (
    actor_kind text, actor_id uuid, member_role text
  ) on commit drop;
  delete from _wanted;

  -- The parent: the family's primary contact.
  insert into _wanted
  select 'contact', c.id, 'parent'
  from chat.contact c
  where c.id = v_family.primary_contact_id and c.is_active;

  -- Every currently assigned teacher.
  insert into _wanted
  select distinct 'teacher', e.teacher_id, 'teacher'
  from chat.enrollment e
  join chat.teacher t on t.id = e.teacher_id and t.is_active
  where e.learner_id = p_learner_id and e.status = 'active';

  -- The family's primary owner.
  insert into _wanted
  select 'staff', v_family.owner_id, 'admin'
  from chat.staff s where s.id = v_family.owner_id and s.is_active;

  -- Remove members who should no longer be there. Membership is data-driven;
  -- PRD SS7.3 forbids teachers and parents changing it by hand.
  for r in
    select m.id, m.actor_kind, m.actor_id
    from chat.conversation_member m
    where m.conversation_id = v_group and m.left_at is null
      and not exists (select 1 from _wanted w
                      where w.actor_kind = m.actor_kind and w.actor_id = m.actor_id)
  loop
    update chat.conversation_member set left_at = now() where id = r.id;
    v_changes := v_changes + 1;
    if r.actor_kind = 'teacher' then
      perform chat.post_system_message(
        v_group,
        coalesce((select display_name from chat.teacher where id = r.actor_id), 'A teacher')
        || ' is no longer teaching ' || v_learner.name || '.');
    end if;
  end loop;

  -- Add the ones who are missing.
  for r in
    select w.actor_kind, w.actor_id, w.member_role
    from _wanted w
    where not exists (select 1 from chat.conversation_member m
                      where m.conversation_id = v_group and m.left_at is null
                        and m.actor_kind = w.actor_kind and m.actor_id = w.actor_id)
  loop
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
    values (v_group, r.actor_kind, r.actor_id, r.member_role);
    v_changes := v_changes + 1;
    if r.actor_kind = 'teacher' then
      perform chat.post_system_message(
        v_group,
        coalesce((select display_name from chat.teacher where id = r.actor_id), 'A teacher')
        || ' is now teaching ' || v_learner.name || '.');
    end if;
  end loop;

  if v_changes > 0 then
    perform chat.log_event('subscription_synced', v_family.id, null, 'system', null,
                           jsonb_build_object('student_group_membership_changes', v_changes,
                                              'learner_id', p_learner_id));
  end if;

  return v_changes;
end;
$$;

-- Ordering-aware replacements for the three original ingest functions --------
-- Dropped rather than overloaded: a default-valued second parameter would make
-- the one-argument call ambiguous.

drop function if exists chat.ingest_core_parent(jsonb);
drop function if exists chat.ingest_core_learner(jsonb);
drop function if exists chat.ingest_core_subscription(jsonb);

create or replace function chat.ingest_core_parent(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_id   uuid := (p_payload ->> 'core_parent_id')::uuid;
  v_name      text := p_payload ->> 'display_name';
  v_language  text := coalesce(p_payload ->> 'language', 'ar');
  v_family    chat.family%rowtype;
begin
  if v_core_id is null then
    raise exception 'core_parent_id is required' using errcode = 'check_violation';
  end if;

  select * into v_family from chat.family where core_parent_id = v_core_id;

  if not found then
    insert into chat.core_parent_inbox (core_parent_id, display_name, language, payload)
    values (v_core_id, v_name, v_language, p_payload)
    on conflict (core_parent_id) do update
      set display_name = excluded.display_name,
          language     = excluded.language,
          payload      = excluded.payload;
    return null;  -- still awaiting an owner
  end if;

  if chat.core_event_is_stale(v_family.core_synced_at, p_occurred_at) then
    return v_family.id;
  end if;

  -- Core-owned fields only. owner_id, tier and state belong to Chat and are
  -- never touched by a sync (PRD SS12.4: conflicts resolve in favour of Core
  -- FOR ITS OWN FIELDS).
  update chat.family
     set display_name   = coalesce(v_name, display_name),
         language       = coalesce(v_language, language),
         core_synced_at = coalesce(p_occurred_at, now())
   where id = v_family.id;

  return v_family.id;
end;
$$;

create or replace function chat.ingest_core_learner(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_child  uuid := (p_payload ->> 'core_child_id')::uuid;
  v_core_parent uuid := (p_payload ->> 'core_parent_id')::uuid;
  v_family_id   uuid;
  v_learner     chat.learner%rowtype;
  v_id          uuid;
begin
  if v_core_child is null then
    raise exception 'core_child_id is required' using errcode = 'check_violation';
  end if;

  select id into v_family_id from chat.family where core_parent_id = v_core_parent;
  if v_family_id is null then
    return null;  -- the family has no owner yet; the learner arrives with it later
  end if;

  select * into v_learner from chat.learner where core_child_id = v_core_child;
  if found and chat.core_event_is_stale(v_learner.core_synced_at, p_occurred_at) then
    return v_learner.id;
  end if;

  insert into chat.learner (family_id, name, level, schedule_ref, next_class_at,
                            last_attended_at, consecutive_absences, core_child_id,
                            core_synced_at)
  values (v_family_id,
          coalesce(p_payload ->> 'name', 'Learner'),
          p_payload ->> 'level',
          p_payload ->> 'schedule_ref',
          (p_payload ->> 'next_class_at')::timestamptz,
          (p_payload ->> 'last_attended_at')::timestamptz,
          coalesce((p_payload ->> 'consecutive_absences')::integer, 0),
          v_core_child,
          coalesce(p_occurred_at, now()))
  on conflict (core_child_id) do update
    set name                 = excluded.name,
        level                = coalesce(excluded.level, chat.learner.level),
        schedule_ref         = coalesce(excluded.schedule_ref, chat.learner.schedule_ref),
        next_class_at        = excluded.next_class_at,
        last_attended_at     = excluded.last_attended_at,
        consecutive_absences = excluded.consecutive_absences,
        core_synced_at       = excluded.core_synced_at
  returning id into v_id;

  perform chat.sync_student_group_membership(v_id);
  return v_id;
end;
$$;

create or replace function chat.ingest_core_subscription(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_sub    uuid := (p_payload ->> 'core_subscription_id')::uuid;
  v_core_parent uuid := (p_payload ->> 'core_parent_id')::uuid;
  v_family_id   uuid;
  v_existing    chat.subscription%rowtype;
  v_id          uuid;
begin
  if v_core_sub is null then
    raise exception 'core_subscription_id is required' using errcode = 'check_violation';
  end if;

  select id into v_family_id from chat.family where core_parent_id = v_core_parent;
  if v_family_id is null then
    return null;
  end if;

  select * into v_existing from chat.subscription where core_subscription_id = v_core_sub;
  if found and chat.core_event_is_stale(v_existing.core_synced_at, p_occurred_at) then
    return v_existing.id;
  end if;

  insert into chat.subscription (family_id, plan, status, ends_at, renewal_due_at,
                                 last_payment_status, last_payment_at,
                                 core_subscription_id, core_synced_at)
  values (v_family_id,
          p_payload ->> 'plan',
          chat.map_core_subscription_status(p_payload ->> 'status'),
          (p_payload ->> 'ends_at')::timestamptz,
          (p_payload ->> 'renewal_due_at')::timestamptz,
          p_payload ->> 'last_payment_status',
          (p_payload ->> 'last_payment_at')::timestamptz,
          v_core_sub,
          coalesce(p_occurred_at, now()))
  on conflict (core_subscription_id) do update
    set plan                = coalesce(excluded.plan, chat.subscription.plan),
        status              = excluded.status,
        ends_at             = excluded.ends_at,
        renewal_due_at      = excluded.renewal_due_at,
        last_payment_status = excluded.last_payment_status,
        last_payment_at     = excluded.last_payment_at,
        core_synced_at      = excluded.core_synced_at
  returning id into v_id;

  return v_id;
end;
$$;

-- Teachers, enrollments, class sessions, payments ---------------------------

create or replace function chat.ingest_core_teacher(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_id  uuid := (p_payload ->> 'core_teacher_id')::uuid;
  v_existing chat.teacher%rowtype;
  v_id       uuid;
begin
  if v_core_id is null then
    raise exception 'core_teacher_id is required' using errcode = 'check_violation';
  end if;

  select * into v_existing from chat.teacher where core_teacher_id = v_core_id;
  if found and chat.core_event_is_stale(v_existing.core_synced_at, p_occurred_at) then
    return v_existing.id;
  end if;

  insert into chat.teacher (core_teacher_id, display_name, core_synced_at)
  values (v_core_id, coalesce(p_payload ->> 'display_name', 'Teacher'),
          coalesce(p_occurred_at, now()))
  on conflict (core_teacher_id) do update
    set display_name   = excluded.display_name,
        core_synced_at = excluded.core_synced_at
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function chat.ingest_core_enrollment(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_id    uuid := (p_payload ->> 'core_enrollment_id')::uuid;
  v_learner_id uuid;
  v_teacher_id uuid;
  v_existing   chat.enrollment%rowtype;
  v_id         uuid;
begin
  if v_core_id is null then
    raise exception 'core_enrollment_id is required' using errcode = 'check_violation';
  end if;

  select id into v_learner_id from chat.learner
   where core_child_id = (p_payload ->> 'core_child_id')::uuid;
  select id into v_teacher_id from chat.teacher
   where core_teacher_id = (p_payload ->> 'core_teacher_id')::uuid;

  -- Either side may not have arrived yet. Acknowledge and wait; the enrolment
  -- is redelivered, or the backfill picks it up.
  if v_learner_id is null or v_teacher_id is null then
    return null;
  end if;

  select * into v_existing from chat.enrollment where core_enrollment_id = v_core_id;
  if found and chat.core_event_is_stale(v_existing.core_synced_at, p_occurred_at) then
    return v_existing.id;
  end if;

  insert into chat.enrollment (core_enrollment_id, learner_id, teacher_id, subject,
                               status, started_at, ended_at, core_synced_at)
  values (v_core_id, v_learner_id, v_teacher_id,
          p_payload ->> 'subject',
          coalesce(p_payload ->> 'status', 'active'),
          (p_payload ->> 'started_at')::timestamptz,
          (p_payload ->> 'ended_at')::timestamptz,
          coalesce(p_occurred_at, now()))
  on conflict (core_enrollment_id) do update
    set learner_id     = excluded.learner_id,
        teacher_id     = excluded.teacher_id,
        subject        = coalesce(excluded.subject, chat.enrollment.subject),
        status         = excluded.status,
        started_at     = coalesce(excluded.started_at, chat.enrollment.started_at),
        ended_at       = excluded.ended_at,
        core_synced_at = excluded.core_synced_at
  returning id into v_id;

  -- PRD SS7.3: membership follows the data.
  perform chat.sync_student_group_membership(v_learner_id);
  return v_id;
end;
$$;

create or replace function chat.ingest_core_class_session(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_id    uuid := (p_payload ->> 'core_class_session_id')::uuid;
  v_learner_id uuid;
  v_teacher_id uuid;
  v_existing   chat.class_session%rowtype;
  v_id         uuid;
begin
  if v_core_id is null then
    raise exception 'core_class_session_id is required' using errcode = 'check_violation';
  end if;

  select id into v_learner_id from chat.learner
   where core_child_id = (p_payload ->> 'core_child_id')::uuid;
  if v_learner_id is null then
    return null;
  end if;

  select id into v_teacher_id from chat.teacher
   where core_teacher_id = (p_payload ->> 'core_teacher_id')::uuid;

  select * into v_existing from chat.class_session where core_class_session_id = v_core_id;
  if found and chat.core_event_is_stale(v_existing.core_synced_at, p_occurred_at) then
    return v_existing.id;
  end if;

  insert into chat.class_session (core_class_session_id, learner_id, teacher_id,
                                  starts_at, ends_at, join_url, status, core_synced_at)
  values (v_core_id, v_learner_id, v_teacher_id,
          (p_payload ->> 'starts_at')::timestamptz,
          (p_payload ->> 'ends_at')::timestamptz,
          p_payload ->> 'join_url',
          coalesce(p_payload ->> 'status', 'scheduled'),
          coalesce(p_occurred_at, now()))
  on conflict (core_class_session_id) do update
    set teacher_id     = excluded.teacher_id,
        starts_at      = excluded.starts_at,
        ends_at        = excluded.ends_at,
        join_url       = excluded.join_url,
        status         = excluded.status,
        core_synced_at = excluded.core_synced_at
  returning id into v_id;

  -- The attention engine reads learner.next_class_at (PRD SS5.4).
  update chat.learner l
     set next_class_at = (select min(cs.starts_at) from chat.class_session cs
                           where cs.learner_id = l.id and cs.status = 'scheduled'
                             and cs.starts_at > now())
   where l.id = v_learner_id;

  return v_id;
end;
$$;

create or replace function chat.ingest_core_payment(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_id   uuid := (p_payload ->> 'core_payment_id')::uuid;
  v_family_id uuid;
  v_sub_id    uuid;
  v_existing  chat.payment%rowtype;
  v_id        uuid;
begin
  if v_core_id is null then
    raise exception 'core_payment_id is required' using errcode = 'check_violation';
  end if;

  select id into v_family_id from chat.family
   where core_parent_id = (p_payload ->> 'core_parent_id')::uuid;
  if v_family_id is null then
    return null;
  end if;

  select id into v_sub_id from chat.subscription
   where core_subscription_id = (p_payload ->> 'core_subscription_id')::uuid;

  select * into v_existing from chat.payment where core_payment_id = v_core_id;
  if found and chat.core_event_is_stale(v_existing.core_synced_at, p_occurred_at) then
    return v_existing.id;
  end if;

  insert into chat.payment (core_payment_id, family_id, subscription_id, amount,
                            currency, status, due_at, paid_at, core_synced_at)
  values (v_core_id, v_family_id, v_sub_id,
          (p_payload ->> 'amount')::numeric,
          p_payload ->> 'currency',
          coalesce(p_payload ->> 'status', 'unknown'),
          (p_payload ->> 'due_at')::timestamptz,
          (p_payload ->> 'paid_at')::timestamptz,
          coalesce(p_occurred_at, now()))
  on conflict (core_payment_id) do update
    set subscription_id = coalesce(excluded.subscription_id, chat.payment.subscription_id),
        amount          = excluded.amount,
        currency        = excluded.currency,
        status          = excluded.status,
        due_at          = excluded.due_at,
        paid_at         = excluded.paid_at,
        core_synced_at  = excluded.core_synced_at
  returning id into v_id;

  return v_id;
end;
$$;

-- Deactivation --------------------------------------------------------------
-- PRD BR-5: nothing is deleted. A "deleted" entity in Core is deactivated here,
-- and its history stays readable.

create or replace function chat.deactivate_core_entity(
  p_kind text, p_core_id uuid, p_occurred_at timestamptz default null
) returns boolean
language plpgsql
as $$
declare
  v_learner uuid;
  v_hit     boolean := false;
begin
  case p_kind
    when 'teacher' then
      update chat.teacher
         set is_active = false, deactivated_at = coalesce(p_occurred_at, now()),
             core_synced_at = coalesce(p_occurred_at, now())
       where core_teacher_id = p_core_id and is_active;
      v_hit := found;
      -- Their groups lose them, with a system message, like any teacher change.
      for v_learner in
        select distinct e.learner_id from chat.enrollment e
        join chat.teacher t on t.id = e.teacher_id
        where t.core_teacher_id = p_core_id
      loop
        perform chat.sync_student_group_membership(v_learner);
      end loop;

    when 'enrollment' then
      update chat.enrollment
         set status = 'ended', ended_at = coalesce(p_occurred_at, now()),
             core_synced_at = coalesce(p_occurred_at, now())
       where core_enrollment_id = p_core_id and status = 'active'
      returning learner_id into v_learner;
      v_hit := found;
      if v_learner is not null then
        perform chat.sync_student_group_membership(v_learner);
      end if;

    when 'student' then
      -- PRD SS7.3: "A group is archived, never deleted, when a student leaves."
      update chat.conversation c
         set archived_at = coalesce(p_occurred_at, now())
        from chat.learner l
       where l.core_child_id = p_core_id
         and c.learner_id = l.id and c.type = 'student_group' and c.archived_at is null;
      v_hit := found;

    when 'class_session' then
      update chat.class_session
         set status = 'cancelled', core_synced_at = coalesce(p_occurred_at, now())
       where core_class_session_id = p_core_id and status = 'scheduled';
      v_hit := found;

    else
      raise exception 'unknown entity kind %', p_kind using errcode = 'check_violation';
  end case;

  return v_hit;
end;
$$;
