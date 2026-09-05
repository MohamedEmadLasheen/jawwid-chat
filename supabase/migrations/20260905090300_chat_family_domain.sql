-- Jawwid Chat -- the family domain (brief SS3 "Core").
--
-- The family is the unit of ownership, of the inbox, and of the thread.
-- Not the phone number, not the conversation, not the employee.
--
-- Columns named core_* mirror an identifier owned by Jawwid Core. They are
-- deliberately NOT foreign keys (ADR-004): the `chat` schema references neither
-- `auth` nor `public`, so Core can change or move without chat blocking it.
-- Reconciliation happens in the chat.core_* boundary, not in the planner.

create table chat.family (
  id                 uuid primary key default gen_random_uuid(),
  display_name       text not null,

  -- Brief SS0: one family -> one primary owner. NOT NULL, and changeable only
  -- through chat.transfer_ownership() (enforced later in this series).
  owner_id           uuid not null references chat.staff (id) on delete restrict,
  primary_contact_id uuid,

  tier               text not null default 'standard'
                       check (tier in ('standard', 'priority')),
  tier_reason        text,

  state              text not null default 'onboarding'
                       check (state in ('onboarding', 'active', 'at_risk',
                                        'renewal_due', 'paused', 'churned')),
  state_reason       text,
  state_changed_at   timestamptz not null default now(),

  language           text not null default 'ar' check (language in ('ar', 'en')),

  manual_flag        text check (manual_flag in ('urgent')),
  manual_flag_reason text,

  core_parent_id     uuid unique,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- A flag that changes what the whole team sees must say why.
  constraint family_manual_flag_has_reason
    check (manual_flag is null or manual_flag_reason is not null),
  constraint family_priority_tier_has_reason
    check (tier <> 'priority' or tier_reason is not null)
);

create index family_owner_idx on chat.family (owner_id);
create index family_state_idx on chat.family (state);

create trigger family_set_updated_at
  before update on chat.family
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
-- Brief SS2: "Store flags, display presets." The six capability flags are the
-- authority; role_preset is a label for the UI and is never consulted by an
-- authorization check.

create table chat.contact (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null references chat.family (id) on delete cascade,
  app_user_id         uuid,
  name                text not null,
  relationship        text,
  role_preset         text not null
                        check (role_preset in ('primary_guardian', 'billing_authorized',
                                               'authorized_contact', 'secondary_read_only')),
  can_message         boolean not null default false,
  can_view_progress   boolean not null default false,
  can_manage_schedule boolean not null default false,
  can_manage_billing  boolean not null default false,
  can_manage_contacts boolean not null default false,
  can_cancel          boolean not null default false,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on column chat.contact.app_user_id is
  'Jawwid Core auth user id. A contact without one exists in the CS record but '
  'cannot sign in and therefore never passes an RLS check.';

create index contact_family_idx on chat.contact (family_id) where is_active;
create unique index contact_app_user_family_uniq
  on chat.contact (family_id, app_user_id) where app_user_id is not null;

create trigger contact_set_updated_at
  before update on chat.contact
  for each row execute function chat.set_updated_at();

alter table chat.family
  add constraint family_primary_contact_fk
  foreign key (primary_contact_id) references chat.contact (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Learners
-- ---------------------------------------------------------------------------

create table chat.learner (
  id                   uuid primary key default gen_random_uuid(),
  family_id            uuid not null references chat.family (id) on delete cascade,
  name                 text not null,
  level                text,
  teacher_id           uuid,
  schedule_ref         text,
  next_class_at        timestamptz,
  last_attended_at     timestamptz,
  consecutive_absences integer not null default 0 check (consecutive_absences >= 0),
  core_child_id        uuid unique,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on column chat.learner.teacher_id is
  'Carried from the brief SS3. Jawwid Core has no teacher entity today (its own '
  'PRD lists live classes as a V1 non-goal), so this stays null until Core '
  'gains one. Nothing in the attention or coverage engines reads it.';

comment on column chat.learner.next_class_at is
  'Drives the "class in progress or within N minutes" attention signal. Null '
  'while Core has no class schedule to sync.';

create index learner_family_idx on chat.learner (family_id);
create index learner_next_class_idx on chat.learner (next_class_at)
  where next_class_at is not null;

create trigger learner_set_updated_at
  before update on chat.learner
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- Subscriptions (mirror of Core)
-- ---------------------------------------------------------------------------
-- Jawwid Core owns billing. This mirror exists so the family side panel and the
-- attention engine can read renewal and payment state without chat querying
-- Core's tables directly.

create table chat.subscription (
  id                   uuid primary key default gen_random_uuid(),
  family_id            uuid not null references chat.family (id) on delete cascade,
  learner_id           uuid references chat.learner (id) on delete set null,
  plan                 text,
  status               text not null check (status in (
                         'trialing', 'free', 'active', 'grace_period', 'expired',
                         'cancelled', 'paused', 'pending_payment', 'failed_payment',
                         'refunded', 'lifetime')),
  ends_at              timestamptz,
  renewal_due_at       timestamptz,
  last_payment_status  text check (last_payment_status in ('succeeded', 'failed', 'refunded')),
  last_payment_at      timestamptz,
  core_subscription_id uuid unique,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on column chat.subscription.status is
  'Mirrors public.subscriptions.status verbatim so the boundary needs no '
  'translation table. If Core widens its vocabulary this CHECK must widen too.';

create index subscription_family_idx on chat.subscription (family_id);
create index subscription_renewal_idx on chat.subscription (renewal_due_at)
  where renewal_due_at is not null;

create trigger subscription_set_updated_at
  before update on chat.subscription
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- Family notes
-- ---------------------------------------------------------------------------
-- Brief SS5: "Any admin May open any family and write internal notes any time."

create table chat.family_note (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references chat.family (id) on delete cascade,
  author_id  uuid not null references chat.staff (id) on delete restrict,
  body       text not null,
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index family_note_family_idx on chat.family_note (family_id, pinned, created_at desc);

create trigger family_note_set_updated_at
  before update on chat.family_note
  for each row execute function chat.set_updated_at();
