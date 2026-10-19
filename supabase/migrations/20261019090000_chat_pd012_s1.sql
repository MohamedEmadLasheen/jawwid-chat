-- PD-12 S1 (closed 2026-10-18) -- the teacher supervision conversation, student
-- certificates, and teacher leave.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-11 and PD-12, and
-- docs/admin/pd012-s1.md. Reconciled 2026-10-19 with PD-11 T1-T3 and the
-- PD-10 Teacher File (20261018170000): leave days are PD-11's teacher_day_off.
--
-- WHAT IS NEW
--
--   conversation type 'teacher_supervision'
--                              one staff-only conversation per teacher with the
--                              Teachers department (PD-11, pulled forward to S1 by
--                              PD-12). Its staff scope is the Teachers department,
--                              decided in chat.staff_conversation_access like
--                              every other basis. No contact may ever join it.
--   chat.message_card_kind     the card kinds, as rows. PD-11 enumerated them in a
--                              CHECK; a later migration re-writing that CHECK
--                              would silently drop kinds another branch added, so
--                              a kind is now a row and adding one is an INSERT.
--   chat.learner_certificate   a STUDENT certificate -- never a teacher's
--                              qualification document (Teacher Profile V2).
--                              requested -> issued | declined, once.
--   chat.teacher_leave_allowance
--                              the days of leave a teacher has in a year, typed
--                              in by the Teachers department. Append-only: the
--                              latest row for a (teacher, year) is the allowance.
--   chat.teacher_leave_request a teacher's request for leave.
--                              requested -> approved | declined | withdrawn,
--                              approved -> cancelled.
--   teacher_day_off.leave_request_id
--                              an approved leave IS its rows in PD-11's
--                              chat.teacher_day_off (the one record of days off,
--                              which the scheduler reads); this links each one
--                              to the request that made it.
--
-- THE BALANCE IS NEVER STORED. It is the allowance minus the teacher_day_off
-- rows in the year, computed on every read, so a cancelled leave restores it
-- with no correction step and no counter can drift.
--
-- FAIL CLOSED. RLS on, no grant to any request role on the new tables: only the
-- server reads or writes them.

-- ===========================================================================
-- 1. The Teachers department, as one predicate
-- ===========================================================================

-- 'manager' | 'member' | NULL. The department tables' own triggers guarantee
-- that the department and the staff member share an organization.
create or replace function chat.teachers_department_role(p_staff uuid)
returns text
language sql
stable
as $$
  select case
    when exists (select 1 from chat.department d
                  where d.kind = 'teachers' and d.manager_id = p_staff) then 'manager'
    when exists (select 1 from chat.department_member m
                   join chat.department d on d.id = m.department_id
                  where d.kind = 'teachers' and m.staff_id = p_staff) then 'member'
  end;
$$;

revoke all on function chat.teachers_department_role(uuid) from public;

-- ===========================================================================
-- 2. The teacher supervision conversation
-- ===========================================================================

alter table chat.conversation drop constraint conversation_type_check;
alter table chat.conversation add constraint conversation_type_check
  check (type in ('direct', 'student_group', 'class_group', 'official', 'family_group', 'teacher_supervision'));

alter table chat.conversation add column supervised_teacher_id uuid references chat.teacher (id);

comment on column chat.conversation.supervised_teacher_id is
  'PD-11/PD-12: the teacher a teacher_supervision conversation is about. Set for that type only, never changed.';

alter table chat.conversation add constraint conversation_teacher_supervision_shape
  check ((type = 'teacher_supervision') = (supervised_teacher_id is not null)
     and (type <> 'teacher_supervision'
          or (family_id is null and learner_id is null and direct_key is null)));

-- One live supervision conversation per teacher.
create unique index conversation_one_supervision_per_teacher
  on chat.conversation (supervised_teacher_id)
  where supervised_teacher_id is not null and archived_at is null;

create or replace function chat.guard_teacher_supervision_conversation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.supervised_teacher_id is distinct from old.supervised_teacher_id then
    raise exception 'a supervision conversation is about one teacher, for good' using errcode = 'check_violation';
  end if;
  if new.supervised_teacher_id is not null and not exists (
    select 1 from chat.teacher t
     where t.id = new.supervised_teacher_id and t.organization_id = new.organization_id
  ) then
    raise exception 'a supervision conversation belongs to its teacher''s organization'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger conversation_teacher_supervision_coherent
  before insert or update of supervised_teacher_id, organization_id on chat.conversation
  for each row execute function chat.guard_teacher_supervision_conversation();

-- Who may be a member, at the row: the teacher it is about, as teacher; staff of
-- the Teachers department, as admin. Never a contact -- this is a staff room.
create or replace function chat.guard_teacher_supervision_member()
returns trigger
language plpgsql
as $$
declare
  v_conv record;
begin
  if new.left_at is not null then
    return new;
  end if;
  select id, type, supervised_teacher_id into v_conv from chat.conversation where id = new.conversation_id;
  if v_conv.type is distinct from 'teacher_supervision' then
    return new;
  end if;
  if new.actor_kind = 'contact' then
    raise exception 'a supervision conversation never admits a family contact' using errcode = 'check_violation';
  elsif new.actor_kind = 'teacher' then
    if new.member_role <> 'teacher' or new.actor_id <> v_conv.supervised_teacher_id then
      raise exception 'a supervision conversation admits only the teacher it is about'
        using errcode = 'check_violation';
    end if;
  elsif new.actor_kind = 'staff' then
    if new.member_role <> 'admin' or chat.teachers_department_role(new.actor_id) is null then
      raise exception 'a supervision conversation admits staff of the Teachers department, as admin'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger conversation_member_teacher_supervision_eligible
  before insert or update of actor_id, actor_kind, member_role, left_at on chat.conversation_member
  for each row execute function chat.guard_teacher_supervision_member();

-- THE decision (PD-8), with one new basis branch: a teacher_supervision
-- conversation is accessible to the Teachers department and to nobody else
-- below the super admin. The rest of the function is PD-8's, unchanged.
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

  -- PD-12: the Teachers department is the supervision conversation's staff
  -- side. Its manager is a party here, not a manager stepping in.
  if c.type = 'teacher_supervision' then
    return case when chat.teachers_department_role(p_staff) is not null then 'member' end;
  end if;

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

-- The chat list (PD-8), with the supervision conversations as one more
-- candidate set. Still filtered through the exact decision above.
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
              and cm.actor_id in (select id from principals)
           union
           select c.id from chat.conversation c
            where c.type = 'teacher_supervision' and c.organization_id = s.organization_id
              and chat.teachers_department_role(p_staff) is not null)
    select k.id from candidates k
     where chat.staff_conversation_access(p_staff, k.id, p_at) is not null;
end;
$$;

revoke all on function chat.staff_conversation_access(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_visible_conversation_ids(uuid, timestamptz) from public;
revoke all on function chat.guard_teacher_supervision_conversation() from public;
revoke all on function chat.guard_teacher_supervision_member() from public;

-- ===========================================================================
-- 3. Card kinds become rows
-- ===========================================================================

create table chat.message_card_kind (
  kind text primary key check (kind ~ '^[a-z][a-z_]{1,62}$')
);

comment on table chat.message_card_kind is
  'The kinds a chat.message_card may have. Add a kind with an INSERT; never re-write a CHECK that lists them.';

insert into chat.message_card_kind (kind) values
  -- PD-11 T1
  ('lesson_report'), ('lesson_absence'), ('lesson_apology'),
  ('lesson_teacher_apology'), ('lesson_cancelled'),
  ('lesson_late_apology'), ('lesson_ruling'),
  -- PD-11 T2-T3
  ('lesson_makeup_booked'), ('lesson_makeup_resolved'),
  ('schedule_change_requested'), ('schedule_change_decided'),
  ('learner_transferred'), ('learner_handover'),
  ('learner_suspended'), ('learner_return_soon'), ('learner_resumed'),
  ('teacher_bonus'),
  -- PD-12 S1
  ('certificate_requested'), ('certificate_issued'), ('certificate_declined'),
  ('leave_requested'), ('leave_approved'), ('leave_declined'),
  ('leave_withdrawn'), ('leave_cancelled');

alter table chat.message_card drop constraint message_card_kind_check;
alter table chat.message_card add constraint message_card_kind_known
  foreign key (kind) references chat.message_card_kind (kind);

alter table chat.message_card_kind enable row level security;
revoke all on chat.message_card_kind from public, anon, authenticated, chat_app;

-- ===========================================================================
-- 4. Student certificates
-- ===========================================================================

create table chat.learner_certificate (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references chat.organization (id),
  learner_id          uuid not null references chat.learner (id),
  requested_by        uuid not null references chat.teacher (id),
  title               text not null check (length(btrim(title)) between 1 and 120),
  achievement         text not null check (length(btrim(achievement)) between 1 and 1000),
  achieved_on         date not null,
  grade               text check (grade is null or length(btrim(grade)) between 1 and 60),
  printed_name        text not null check (length(btrim(printed_name)) between 1 and 120),
  note                text check (note is null or length(btrim(note)) between 1 and 1000),
  state               text not null default 'requested' check (state in ('requested', 'issued', 'declined')),
  requested_at        timestamptz not null default now(),
  -- The request's card, in the teacher's supervision conversation.
  request_message_id  uuid unique references chat.message (id),
  decided_by          uuid references chat.staff (id),
  decided_at          timestamptz,
  decline_reason      text check (decline_reason is null or length(btrim(decline_reason)) between 1 and 1000),
  -- issued: the file, and the group it was delivered into. The key lives in that
  -- conversation's namespace, so every existing read path signs it for that
  -- conversation's members and for nobody else.
  conversation_id     uuid references chat.conversation (id),
  object_key          text unique,
  mime_type           text check (mime_type is null or mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  byte_size           integer check (byte_size is null or byte_size between 1 and 20971520),
  file_name           text check (file_name is null or length(btrim(file_name)) between 1 and 200),
  issued_message_id   uuid unique references chat.message (id),

  constraint learner_certificate_decision_is_whole
    check ((state = 'requested') = (decided_by is null) and (decided_by is null) = (decided_at is null)),
  constraint learner_certificate_declined_has_a_reason
    check ((state = 'declined') = (decline_reason is not null)),
  constraint learner_certificate_issued_has_its_file
    check ((state = 'issued') = (object_key is not null)
       and (object_key is null) = (conversation_id is null)
       and (object_key is null) = (mime_type is null)
       and (object_key is null) = (byte_size is null)
       and (object_key is null) = (file_name is null)),
  constraint learner_certificate_file_lives_in_its_conversation
    check (object_key is null or object_key ~ ('^conversations/' || conversation_id::text || '/[^/]+$')),
  constraint learner_certificate_issued_message_only_when_issued
    check (issued_message_id is null or state = 'issued')
);

comment on table chat.learner_certificate is
  'PD-12: a STUDENT certificate. Requested by the learner''s teacher, issued (with its file) or declined once by the Teachers department; never deleted.';

create index learner_certificate_open_idx on chat.learner_certificate (organization_id, requested_at)
  where state = 'requested';
create index learner_certificate_learner_idx on chat.learner_certificate (learner_id, requested_at desc);

create or replace function chat.guard_learner_certificate()
returns trigger
language plpgsql
as $$
declare
  v_learner chat.learner%rowtype;
  v_teacher chat.teacher%rowtype;
  v_conv    record;
begin
  if tg_op = 'INSERT' then
    select * into v_learner from chat.learner where id = new.learner_id;
    select * into v_teacher from chat.teacher where id = new.requested_by;
    if v_learner.organization_id is distinct from new.organization_id
       or v_teacher.organization_id is distinct from new.organization_id then
      raise exception 'a certificate, its learner and its teacher share one organization'
        using errcode = 'insufficient_privilege';
    end if;
    if v_learner.teacher_id is distinct from new.requested_by then
      raise exception 'a certificate is requested by the learner''s assigned teacher'
        using errcode = 'check_violation';
    end if;
    if not v_teacher.is_active or v_teacher.left_at is not null then
      raise exception 'an inactive teacher cannot request a certificate' using errcode = 'check_violation';
    end if;
    if new.state <> 'requested' or new.request_message_id is not null or new.issued_message_id is not null then
      raise exception 'a certificate is born requested, before its card' using errcode = 'check_violation';
    end if;
    new.requested_at := now();
    return new;
  end if;

  -- UPDATE
  if (new.id, new.organization_id, new.learner_id, new.requested_by, new.title, new.achievement,
      new.achieved_on, new.grade, new.printed_name, new.note, new.requested_at)
     is distinct from
     (old.id, old.organization_id, old.learner_id, old.requested_by, old.title, old.achievement,
      old.achieved_on, old.grade, old.printed_name, old.note, old.requested_at) then
    raise exception 'what a certificate request says is written once' using errcode = 'check_violation';
  end if;

  -- The request card is attached once, in the transaction that wrote the row.
  if new.request_message_id is distinct from old.request_message_id
     and old.request_message_id is not null then
    raise exception 'a certificate''s request card is attached once' using errcode = 'check_violation';
  end if;

  if new.state is distinct from old.state then
    if old.state <> 'requested' then
      raise exception 'a certificate is decided once' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from chat.staff s
                    where s.id = new.decided_by and s.organization_id = new.organization_id
                      and s.is_active and s.left_at is null) then
      raise exception 'a certificate is decided by active staff of its organization'
        using errcode = 'insufficient_privilege';
    end if;
    if new.state = 'issued' then
      select id, type, learner_id, organization_id, archived_at into v_conv
        from chat.conversation where id = new.conversation_id;
      if v_conv.id is null or v_conv.organization_id <> new.organization_id or v_conv.archived_at is not null
         or not (
           (v_conv.type = 'student_group' and v_conv.learner_id = new.learner_id)
           or (v_conv.type = 'family_group' and exists (
                 select 1 from chat.conversation_learner cl
                  where cl.conversation_id = v_conv.id and cl.learner_id = new.learner_id))) then
        raise exception 'a certificate is delivered into a live group about its learner'
          using errcode = 'check_violation';
      end if;
    end if;
    new.decided_at := now();
    return new;
  end if;

  -- No decision in this write: nothing about it may move, except the issued
  -- card being attached once.
  if (new.decided_by, new.decided_at, new.decline_reason, new.conversation_id, new.object_key,
      new.mime_type, new.byte_size, new.file_name)
     is distinct from
     (old.decided_by, old.decided_at, old.decline_reason, old.conversation_id, old.object_key,
      old.mime_type, old.byte_size, old.file_name) then
    raise exception 'a certificate''s decision is written once' using errcode = 'check_violation';
  end if;
  if new.issued_message_id is distinct from old.issued_message_id and old.issued_message_id is not null then
    raise exception 'a certificate''s delivery card is attached once' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger learner_certificate_is_coherent before insert or update on chat.learner_certificate
  for each row execute function chat.guard_learner_certificate();

create or replace function chat.forbid_learner_certificate_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'a certificate is never deleted; decline it' using errcode = 'check_violation';
end;
$$;

create trigger learner_certificate_is_kept before delete on chat.learner_certificate
  for each row execute function chat.forbid_learner_certificate_delete();

-- ===========================================================================
-- 5. Teacher leave
-- ===========================================================================

create extension if not exists btree_gist;

create table chat.teacher_leave_allowance (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  teacher_id       uuid not null references chat.teacher (id),
  leave_year       integer not null check (leave_year between 2000 and 2100),
  days             integer not null check (days between 0 and 366),
  note             text check (note is null or length(btrim(note)) between 1 and 500),
  set_by           uuid not null references chat.staff (id),
  set_at           timestamptz not null default now()
);

comment on table chat.teacher_leave_allowance is
  'PD-12: a teacher''s leave allowance per calendar year, typed in by the Teachers department. Append-only; the latest row for (teacher, year) is the allowance.';

create index teacher_leave_allowance_latest_idx
  on chat.teacher_leave_allowance (teacher_id, leave_year, set_at desc);

create or replace function chat.guard_teacher_leave_allowance()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a leave allowance is never edited; set a new one' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from chat.teacher t where t.id = new.teacher_id and t.organization_id = new.organization_id)
     or not exists (select 1 from chat.staff s where s.id = new.set_by and s.organization_id = new.organization_id
                      and s.is_active and s.left_at is null) then
    raise exception 'a leave allowance is set by active staff of the teacher''s organization'
      using errcode = 'insufficient_privilege';
  end if;
  new.set_at := now();
  return new;
end;
$$;

create trigger teacher_leave_allowance_append_only
  before insert or update or delete on chat.teacher_leave_allowance
  for each row execute function chat.guard_teacher_leave_allowance();

create table chat.teacher_leave_request (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references chat.organization (id),
  teacher_id          uuid not null references chat.teacher (id),
  first_day           date not null,
  last_day            date not null,
  reason              text not null check (length(btrim(reason)) between 1 and 1000),
  state               text not null default 'requested'
                        check (state in ('requested', 'approved', 'declined', 'withdrawn', 'cancelled')),
  requested_at        timestamptz not null default now(),
  request_message_id  uuid unique references chat.message (id),
  decided_by          uuid references chat.staff (id),
  decided_at          timestamptz,
  decision_note       text check (decision_note is null or length(btrim(decision_note)) between 1 and 1000),
  ended_at            timestamptz,
  ended_by            uuid,

  constraint teacher_leave_request_range
    check (last_day >= first_day and last_day - first_day < 62
       and extract(year from first_day) = extract(year from last_day)),
  constraint teacher_leave_request_decision_is_whole
    check ((decided_by is null) = (decided_at is null)
       and (state in ('approved', 'declined', 'cancelled')) = (decided_by is not null)),
  constraint teacher_leave_request_declined_has_a_note
    check (state <> 'declined' or decision_note is not null),
  constraint teacher_leave_request_end_is_whole
    check ((ended_at is null) = (ended_by is null)
       and (state in ('withdrawn', 'cancelled')) = (ended_at is not null)),
  -- A teacher's open and approved requests never overlap.
  constraint teacher_leave_request_no_overlap
    exclude using gist (teacher_id with =, daterange(first_day, last_day, '[]') with &&)
    where (state in ('requested', 'approved'))
);

comment on table chat.teacher_leave_request is
  'PD-12: a teacher''s leave request. Approval writes its PD-10 day_off entries; the balance is computed from those, never stored.';

create index teacher_leave_request_open_idx on chat.teacher_leave_request (organization_id, requested_at)
  where state = 'requested';
create index teacher_leave_request_teacher_idx on chat.teacher_leave_request (teacher_id, first_day desc);

create or replace function chat.guard_teacher_leave_request()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from chat.teacher t
                    where t.id = new.teacher_id and t.organization_id = new.organization_id
                      and t.is_active and t.left_at is null) then
      raise exception 'leave is requested by an active teacher of the organization'
        using errcode = 'insufficient_privilege';
    end if;
    if new.state <> 'requested' or new.request_message_id is not null then
      raise exception 'a leave request is born requested, before its card' using errcode = 'check_violation';
    end if;
    if new.first_day < current_date then
      raise exception 'leave is requested for days that have not passed' using errcode = 'check_violation';
    end if;
    new.requested_at := now();
    return new;
  end if;

  if (new.id, new.organization_id, new.teacher_id, new.first_day, new.last_day, new.reason, new.requested_at)
     is distinct from
     (old.id, old.organization_id, old.teacher_id, old.first_day, old.last_day, old.reason, old.requested_at) then
    raise exception 'what a leave request says is written once' using errcode = 'check_violation';
  end if;
  if new.request_message_id is distinct from old.request_message_id and old.request_message_id is not null then
    raise exception 'a leave request''s card is attached once' using errcode = 'check_violation';
  end if;

  if new.state is distinct from old.state then
    if not ((old.state = 'requested' and new.state in ('approved', 'declined', 'withdrawn'))
         or (old.state = 'approved' and new.state = 'cancelled')) then
      raise exception 'a leave request cannot go from % to %', old.state, new.state
        using errcode = 'check_violation';
    end if;
    if new.state in ('approved', 'declined') then
      if not exists (select 1 from chat.staff s
                      where s.id = new.decided_by and s.organization_id = new.organization_id
                        and s.is_active and s.left_at is null) then
        raise exception 'leave is decided by active staff of the organization'
          using errcode = 'insufficient_privilege';
      end if;
      new.decided_at := now();
    elsif new.state = 'withdrawn' then
      if new.ended_by is distinct from new.teacher_id then
        raise exception 'only the teacher withdraws their own request' using errcode = 'insufficient_privilege';
      end if;
      new.ended_at := now();
    elsif new.state = 'cancelled' then
      if (new.decided_by, new.decided_at, new.decision_note) is distinct from (old.decided_by, old.decided_at, old.decision_note) then
        raise exception 'cancelling keeps the approval it cancels' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from chat.staff s
                      where s.id = new.ended_by and s.organization_id = new.organization_id
                        and s.is_active and s.left_at is null) then
        raise exception 'approved leave is cancelled by active staff of the organization'
          using errcode = 'insufficient_privilege';
      end if;
      new.ended_at := now();
    end if;
    return new;
  end if;

  if (new.decided_by, new.decided_at, new.decision_note, new.ended_at, new.ended_by)
     is distinct from (old.decided_by, old.decided_at, old.decision_note, old.ended_at, old.ended_by) then
    raise exception 'a leave decision is written once' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger teacher_leave_request_is_coherent before insert or update on chat.teacher_leave_request
  for each row execute function chat.guard_teacher_leave_request();

create or replace function chat.forbid_teacher_leave_request_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'a leave request is never deleted' using errcode = 'check_violation';
end;
$$;

create trigger teacher_leave_request_is_kept before delete on chat.teacher_leave_request
  for each row execute function chat.forbid_teacher_leave_request_delete();

-- An approved leave IS its rows in PD-11's chat.teacher_day_off. The link says
-- which request made each one; a day off recorded directly has none.
alter table chat.teacher_day_off
  add column leave_request_id uuid references chat.teacher_leave_request (id);

create index teacher_day_off_leave_idx
  on chat.teacher_day_off (leave_request_id) where leave_request_id is not null;

create or replace function chat.guard_day_off_leave_link()
returns trigger
language plpgsql
as $$
declare
  v_request chat.teacher_leave_request%rowtype;
begin
  if new.leave_request_id is null then
    return new;
  end if;
  select * into v_request from chat.teacher_leave_request where id = new.leave_request_id;
  if v_request.teacher_id is distinct from new.teacher_id
     or new.day not between v_request.first_day and v_request.last_day then
    raise exception 'a leave day belongs to its request''s teacher and dates' using errcode = 'check_violation';
  end if;
  if v_request.state <> 'approved' then
    raise exception 'only an approved leave writes days off' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger teacher_day_off_leave_link_is_coherent
  before insert on chat.teacher_day_off
  for each row execute function chat.guard_day_off_leave_link();

-- A day of an APPROVED leave is removed only by cancelling the leave: the
-- cancel path marks the request cancelled first, in the same transaction, and
-- then deletes its future days. Any other writer (the Schedules tab, the
-- Teacher File) would otherwise leave a request that still reads "approved".
create or replace function chat.guard_day_off_leave_delete()
returns trigger
language plpgsql
as $$
begin
  if old.leave_request_id is not null and exists (
    select 1 from chat.teacher_leave_request r
     where r.id = old.leave_request_id and r.state = 'approved'
  ) then
    raise exception 'this day off belongs to an approved leave; cancel the leave instead'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger teacher_day_off_leave_day_is_kept
  before delete on chat.teacher_day_off
  for each row execute function chat.guard_day_off_leave_delete();

-- ===========================================================================
-- 6. Request roles: none
-- ===========================================================================

alter table chat.learner_certificate      enable row level security;
alter table chat.teacher_leave_allowance  enable row level security;
alter table chat.teacher_leave_request    enable row level security;

revoke all on chat.learner_certificate, chat.teacher_leave_allowance, chat.teacher_leave_request
  from public, anon, authenticated, chat_app;

revoke all on function chat.guard_learner_certificate() from public;
revoke all on function chat.forbid_learner_certificate_delete() from public;
revoke all on function chat.guard_teacher_leave_allowance() from public;
revoke all on function chat.guard_teacher_leave_request() from public;
revoke all on function chat.forbid_teacher_leave_request_delete() from public;
revoke all on function chat.guard_day_off_leave_link() from public;
revoke all on function chat.guard_day_off_leave_delete() from public;
