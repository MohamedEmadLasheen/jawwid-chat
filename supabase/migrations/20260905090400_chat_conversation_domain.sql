-- Jawwid Chat -- thread, case, message, task, handoff (brief SS3 "Conversation").
--
-- Brief SS1: "One continuous thread per family (WhatsApp-like). Topics are cases
-- layered on the thread." Brief SS12: "thread is UNIQUE per family; cases never
-- create a second thread." That uniqueness is a database constraint here, not a
-- convention -- there is no way to write a second thread for a family.
--
-- The brief calls the case table `case`; CASE is a reserved word in SQL, so it
-- is chat.support_case here. Every column name is otherwise unchanged.

create table chat.thread (
  id                       uuid primary key default gen_random_uuid(),
  family_id                uuid not null unique references chat.family (id) on delete cascade,
  last_customer_message_at timestamptz,
  last_staff_message_at    timestamptz,
  last_staff_id            uuid references chat.staff (id) on delete set null,

  -- Derived, never written: the family is waiting on Jawwid.
  needs_reply              boolean generated always as (
                             last_customer_message_at is not null
                             and (last_staff_message_at is null
                                  or last_customer_message_at > last_staff_message_at)
                           ) stored,

  -- Brief SS4 stickiness: a staff member who just replied keeps the thread past
  -- shift end until sticky_until, after which on_duty() resumes.
  sticky_handler_id        uuid references chat.staff (id) on delete set null,
  sticky_until             timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint thread_sticky_is_complete
    check ((sticky_handler_id is null) = (sticky_until is null))
);

create index thread_needs_reply_idx on chat.thread (family_id) where needs_reply;

create trigger thread_set_updated_at
  before update on chat.thread
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------------

create table chat.support_case (
  id                 uuid primary key default gen_random_uuid(),
  thread_id          uuid not null references chat.thread (id) on delete cascade,
  family_id          uuid not null references chat.family (id) on delete cascade,
  learner_id         uuid references chat.learner (id) on delete set null,

  type               text not null check (type in (
                       'technical', 'billing', 'schedule', 'renewal', 'cancellation',
                       'complaint', 'onboarding', 'at_risk', 'academic', 'general')),
  severity           text check (severity in ('low', 'medium', 'high')),
  is_blocking        boolean not null default false,
  status             text not null default 'open' check (status in (
                       'open', 'waiting_customer', 'waiting_internal', 'scheduled',
                       'resolved', 'closed')),

  handler_id         uuid references chat.staff (id) on delete set null,

  -- Brief SS3: relationship case types are owner-locked automatically. Set by
  -- trigger from chat.config, never by the caller.
  owner_locked       boolean not null default false,

  due_at             timestamptz,
  follow_up_reason   text,
  escalation_level   integer not null default 0 check (escalation_level >= 0),
  escalated_to_id    uuid references chat.staff (id) on delete set null,
  opened_by          uuid references chat.staff (id) on delete set null,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  reopen_count       integer not null default 0 check (reopen_count >= 0),
  root_cause         text,
  resolution_summary text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint support_case_resolved_has_timestamp
    check (status not in ('resolved', 'closed') or resolved_at is not null),
  constraint support_case_closed_has_timestamp
    check (status <> 'closed' or closed_at is not null)
);

create index support_case_family_open_idx on chat.support_case (family_id)
  where status not in ('resolved', 'closed');
create index support_case_handler_idx on chat.support_case (handler_id)
  where status not in ('resolved', 'closed');
create index support_case_due_idx on chat.support_case (due_at)
  where due_at is not null and status not in ('resolved', 'closed');
create index support_case_type_history_idx on chat.support_case (family_id, type, created_at desc);

create trigger support_case_set_updated_at
  before update on chat.support_case
  for each row execute function chat.set_updated_at();

-- A case must belong to its family's own thread.
create or replace function chat.assert_case_thread_matches_family()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from chat.thread t
    where t.id = new.thread_id and t.family_id = new.family_id
  ) then
    raise exception 'case thread % does not belong to family %', new.thread_id, new.family_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger support_case_thread_matches_family
  before insert or update of thread_id, family_id on chat.support_case
  for each row execute function chat.assert_case_thread_matches_family();

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

create table chat.message (
  id             uuid primary key default gen_random_uuid(),
  thread_id      uuid not null references chat.thread (id) on delete cascade,
  case_id        uuid references chat.support_case (id) on delete set null,

  author_type    text not null check (author_type in ('contact', 'staff', 'system')),
  -- Polymorphic: chat.contact.id, chat.staff.id, or null for system messages.
  -- Not a foreign key precisely because it is polymorphic; the pairing is
  -- enforced by chat.assert_message_author_exists() below.
  author_id      uuid,

  on_behalf_mode text check (on_behalf_mode in ('owner', 'coverage', 'assist', 'escalation')),

  body           text,
  attachments    jsonb not null default '[]'::jsonb,
  visibility     text not null check (visibility in ('customer', 'internal')),
  created_at     timestamptz not null default now(),

  -- Brief SS12: "Every staff message has on_behalf_mode."
  constraint message_staff_declares_on_behalf_mode
    check (author_type <> 'staff' or on_behalf_mode is not null),
  constraint message_only_staff_has_on_behalf_mode
    check (author_type = 'staff' or on_behalf_mode is null),
  -- A customer cannot author an internal note.
  constraint message_contact_is_customer_visible
    check (author_type <> 'contact' or visibility = 'customer'),
  constraint message_author_present
    check (author_type = 'system' or author_id is not null),
  constraint message_has_content
    check (body is not null or jsonb_array_length(attachments) > 0),
  constraint message_attachments_is_array
    check (jsonb_typeof(attachments) = 'array')
);

create index message_thread_idx on chat.message (thread_id, created_at desc);
create index message_case_idx on chat.message (case_id) where case_id is not null;

comment on table chat.message is
  'Immutable (brief SS3). UPDATE and DELETE are refused by trigger: a correction '
  'is a new message, and the customer record is never rewritten.';

create trigger message_is_immutable
  before update or delete on chat.message
  for each row execute function chat.forbid_mutation();

create or replace function chat.assert_message_author_exists()
returns trigger
language plpgsql
as $$
begin
  if new.author_type = 'staff'
     and not exists (select 1 from chat.staff s where s.id = new.author_id) then
    raise exception 'message author % is not a staff member', new.author_id
      using errcode = 'foreign_key_violation';
  elsif new.author_type = 'contact'
     and not exists (select 1 from chat.contact c
                     where c.id = new.author_id and c.family_id = (
                       select family_id from chat.thread where id = new.thread_id)) then
    raise exception 'message author % is not a contact on this family''s thread', new.author_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger message_author_exists
  before insert on chat.message
  for each row execute function chat.assert_message_author_exists();

-- Keeps thread.needs_reply honest. Internal notes are deliberately NOT staff
-- replies: writing a note must never make a waiting family look answered.
create or replace function chat.touch_thread_from_message()
returns trigger
language plpgsql
as $$
begin
  if new.visibility <> 'customer' then
    return new;
  end if;

  if new.author_type = 'contact' then
    update chat.thread
       set last_customer_message_at = greatest(coalesce(last_customer_message_at, new.created_at),
                                               new.created_at)
     where id = new.thread_id;
  elsif new.author_type = 'staff' then
    update chat.thread
       set last_staff_message_at = greatest(coalesce(last_staff_message_at, new.created_at),
                                            new.created_at),
           last_staff_id = new.author_id
     where id = new.thread_id;
  end if;

  return new;
end;
$$;

create trigger message_touches_thread
  after insert on chat.message
  for each row execute function chat.touch_thread_from_message();

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
-- Brief SS2: finance/technical/academic staff "See and complete tasks assigned
-- to them only. Never message families."

create table chat.task (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references chat.support_case (id) on delete cascade,
  family_id  uuid not null references chat.family (id) on delete cascade,
  type       text not null check (type in ('finance', 'technical', 'academic', 'other')),
  title      text not null,
  details    text,
  owner_id   uuid references chat.staff (id) on delete restrict,
  status     text not null default 'open'
               check (status in ('open', 'in_progress', 'done', 'cancelled')),
  due_at     timestamptz,
  result     text,
  created_by uuid references chat.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at    timestamptz,

  constraint task_done_has_timestamp check (status <> 'done' or done_at is not null)
);

create index task_owner_open_idx on chat.task (owner_id)
  where status in ('open', 'in_progress');
create index task_case_idx on chat.task (case_id);
create index task_family_idx on chat.task (family_id);

create trigger task_set_updated_at
  before update on chat.task
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- Handoffs
-- ---------------------------------------------------------------------------
-- Brief SS12: no code path moves a family to a staff member without a logged
-- reason. Every transfer of live handling writes one of these.

create table chat.handoff (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references chat.thread (id) on delete cascade,
  from_staff_id   uuid references chat.staff (id) on delete set null,
  to_staff_id     uuid references chat.staff (id) on delete set null,
  reason          text not null check (reason in (
                    'shift_end', 'absence', 'friday', 'assist', 'escalation',
                    'sticky_expired')),
  summary         text,
  note            text,
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz
);

create index handoff_thread_idx on chat.handoff (thread_id, created_at desc);
create index handoff_unacknowledged_idx on chat.handoff (to_staff_id)
  where acknowledged_at is null;
