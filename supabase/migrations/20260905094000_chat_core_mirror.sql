-- Jawwid Chat -- the Jawwid Core mirror.
--
-- PRD v0.1 SS12.4 names the synced entities: "users and roles, families, parents,
-- students, teachers, enrollments and class sessions, subscriptions, payments
-- and due dates. Each carries an external_id and synced_at; conflicts resolve
-- in favour of Jawwid Core for its own fields."
--
-- Families, learners and subscriptions already had a mirror. Teachers,
-- enrollments and class sessions did not: chat.conversation_member carries
-- actor_kind = 'teacher' with an opaque actor_id that referenced nothing, so a
-- teacher could be named in a group but not identified, and BR-1 could not be
-- evaluated against a real teacher record. This migration gives them one.
--
-- AUTHORITY. Every table here is AUTHORITATIVE IN CORE, MIRRORED IN CHAT. Chat
-- never authors these fields; it applies what the boundary delivers. The one
-- exception is stated on each table where Chat owns a column of its own.
--
-- Nothing here is deleted. PRD BR-5: history belongs to Jawwid, and a record is
-- deactivated rather than removed.

-- Ordering ------------------------------------------------------------------
-- Webhook delivery is not ordered. Every mirrored row records the source time
-- of the event that last wrote it, and an older event is dropped rather than
-- applied, so a delayed redelivery cannot resurrect stale data.

alter table chat.family       add column core_synced_at timestamptz;
alter table chat.learner      add column core_synced_at timestamptz;
alter table chat.subscription add column core_synced_at timestamptz;

comment on column chat.family.core_synced_at is
  'occurred_at of the Jawwid Core event that last wrote the Core-owned fields '
  'of this row. Chat-owned fields (owner_id, tier, state) are untouched by sync.';

create or replace function chat.core_event_is_stale(
  p_existing_synced_at timestamptz,
  p_occurred_at        timestamptz
) returns boolean
language sql
immutable
as $$
  select p_existing_synced_at is not null
     and p_occurred_at is not null
     and p_occurred_at < p_existing_synced_at
$$;

comment on function chat.core_event_is_stale is
  'Last-writer-wins by SOURCE time, not arrival time. Equal timestamps apply, '
  'so a corrected redelivery of the same event still lands.';

-- Teachers ------------------------------------------------------------------
-- AUTHORITATIVE IN CORE, MIRRORED IN CHAT.
-- No phone, no email (BR-2). A teacher is a display name and an opaque account.

create table chat.teacher (
  id              uuid primary key default gen_random_uuid(),
  core_teacher_id uuid not null unique,
  display_name    text not null,
  -- Chat-owned: attached when the teacher first signs in to the Teacher app.
  account_id      uuid unique references chat.account (id) on delete restrict,
  is_active       boolean not null default true,
  deactivated_at  timestamptz,
  core_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- BR-2: a teacher's contact details never exist in this table, so they cannot
-- leak from it. The structural test in db/tests/core_mirror.sql asserts that.
comment on table chat.teacher is
  'The identity behind conversation_member.actor_kind = ''teacher''. Carries no '
  'contact channel of any kind.';

create trigger teacher_set_updated_at
  before update on chat.teacher
  for each row execute function chat.set_updated_at();

create index teacher_active_idx on chat.teacher (id) where is_active;

-- Enrollments ---------------------------------------------------------------
-- AUTHORITATIVE IN CORE, MIRRORED IN CHAT.
-- The student <-> teacher relationship. PRD SS7.3: Student Group membership
-- follows this data, and BR-3 derives who may talk to whom from it.

create table chat.enrollment (
  id                 uuid primary key default gen_random_uuid(),
  core_enrollment_id uuid not null unique,
  learner_id         uuid not null references chat.learner (id) on delete cascade,
  teacher_id         uuid not null references chat.teacher (id) on delete restrict,
  subject            text,
  status             text not null default 'active'
                       check (status in ('active', 'ended', 'cancelled')),
  started_at         timestamptz,
  ended_at           timestamptz,
  core_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger enrollment_set_updated_at
  before update on chat.enrollment
  for each row execute function chat.set_updated_at();

create index enrollment_learner_idx on chat.enrollment (learner_id) where status = 'active';
create index enrollment_teacher_idx on chat.enrollment (teacher_id) where status = 'active';

-- Class sessions ------------------------------------------------------------
-- AUTHORITATIVE IN CORE, MIRRORED IN CHAT.
-- Drives the class reminders of PRD SS8.1 and the "message during or within
-- 15 min of a scheduled class" attention trigger of SS5.4.

create table chat.class_session (
  id                    uuid primary key default gen_random_uuid(),
  core_class_session_id uuid not null unique,
  learner_id            uuid not null references chat.learner (id) on delete cascade,
  teacher_id            uuid references chat.teacher (id) on delete set null,
  starts_at             timestamptz not null,
  ends_at               timestamptz,
  -- Opaque. PRD SS15.2 Q8 (link format, whether links must be masked) is an
  -- open product question, so Chat stores whatever Core sends and renders it
  -- through a template rather than deciding a format here.
  join_url              text,
  status                text not null default 'scheduled'
                          check (status in ('scheduled', 'done', 'cancelled', 'rescheduled')),
  core_synced_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger class_session_set_updated_at
  before update on chat.class_session
  for each row execute function chat.set_updated_at();

create index class_session_upcoming_idx on chat.class_session (starts_at)
  where status = 'scheduled';
create index class_session_learner_idx on chat.class_session (learner_id, starts_at desc);

-- Payments ------------------------------------------------------------------
-- AUTHORITATIVE IN CORE, MIRRORED IN CHAT. Amounts are mirrored because PRD
-- SS8.1 schedules payment reminders off them; no card or account detail is ever
-- accepted, and there is no column that could hold one.

create table chat.payment (
  id              uuid primary key default gen_random_uuid(),
  core_payment_id uuid not null unique,
  family_id       uuid not null references chat.family (id) on delete cascade,
  subscription_id uuid references chat.subscription (id) on delete set null,
  amount          numeric(12, 2),
  currency        text,
  status          text not null check (status in ('due', 'paid', 'failed', 'refunded', 'unknown')),
  due_at          timestamptz,
  paid_at         timestamptz,
  core_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger payment_set_updated_at
  before update on chat.payment
  for each row execute function chat.set_updated_at();

create index payment_family_idx on chat.payment (family_id, due_at desc);
create index payment_outstanding_idx on chat.payment (due_at)
  where status in ('due', 'failed');
