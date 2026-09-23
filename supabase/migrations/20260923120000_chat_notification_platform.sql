-- Jawwid Chat -- the notification platform.
--
-- The engine that already existed (dedupe_key, templates, rules, quiet hours,
-- device tokens) is NOT rebuilt here. This migration finishes it into a product
-- by separating four things that were sharing one row:
--
--   EVENT         something happened            chat.outbox_event / chat.event_log
--   NOTIFICATION  a person needs to know        chat.notification
--   DELIVERY      an attempt on one channel     chat.notification_delivery  (new)
--   ACTION        they read it / opened it      notification.read_at / opened_at
--
-- Three concrete defects are fixed:
--
--   1. One notification row WAS one channel, so "the parent has this" and "the
--      push to their iPad failed" could not both be true.
--   2. Text was rendered at send time and discarded. A schedule change kept only
--      its variables, so re-rendering later would rewrite history -- exactly what
--      a "moved from 5:00 PM to 6:00 PM" notification must never do.
--   3. There was no read state. `opened` (tapped a push) was standing in for
--      `read` (seen in the app). They are different facts.

-- ---------------------------------------------------------------------------
-- Priority vocabulary
-- ---------------------------------------------------------------------------
-- The product speaks LOW / NORMAL / HIGH / URGENT. The schema said 'critical'.
-- Renamed rather than aliased: two words for one level is how a rule ends up
-- unmatched by a query that spells it the other way.

alter table chat.notification      drop constraint if exists notification_priority_check;
alter table chat.notification_rule drop constraint if exists notification_rule_priority_check;

update chat.notification      set priority = 'urgent' where priority = 'critical';
update chat.notification_rule set priority = 'urgent' where priority = 'critical';

alter table chat.notification
  add constraint notification_priority_check
  check (priority in ('low', 'normal', 'high', 'urgent'));
alter table chat.notification_rule
  add constraint notification_rule_priority_check
  check (priority in ('low', 'normal', 'high', 'urgent'));

-- ---------------------------------------------------------------------------
-- Categories -- data, not a CASE statement
-- ---------------------------------------------------------------------------
-- `is_optional` is what makes a category muteable. A parent may silence class
-- reminders; they may not silence an approval decision, and the rule that says
-- so is a row rather than a branch in a service.

create table if not exists chat.notification_category (
  key           text primary key,
  is_optional   boolean not null default true,
  display_order integer not null default 100
);

comment on table chat.notification_category is
  'The notification taxonomy. is_optional = false means the category cannot be '
  'muted; a trigger on chat.notification_preference enforces it, so a client '
  'cannot do through the API what the product forbids.';

insert into chat.notification_category (key, is_optional, display_order) values
  ('messaging', true,  10),
  ('calls',     true,  20),
  ('classes',   true,  30),
  ('academy',   true,  40),
  ('billing',   true,  50),
  ('approvals', false, 60),
  ('account',   false, 70)
on conflict (key) do update
  set is_optional = excluded.is_optional, display_order = excluded.display_order;

-- ---------------------------------------------------------------------------
-- chat.notification -- the user-facing notification
-- ---------------------------------------------------------------------------

alter table chat.notification
  -- The NOTIFICATION type (MESSAGE_RECEIVED). Distinct from event_type, which
  -- is the SYSTEM EVENT that produced it (message_published). Nullable so rows
  -- written before this migration stay valid; the engine always sets it.
  add column if not exists type            text,
  add column if not exists category        text not null default 'messaging'
                                           references chat.notification_category (key),

  -- Rendered ONCE, at creation, in the recipient's locale, and never touched
  -- again. This is what preserves "moved from 5:00 PM to 6:00 PM" after the
  -- schedule moves a third time.
  add column if not exists title           text,
  add column if not exists body            text,

  -- Deep link. entity_type/entity_id is the durable pair; deeplink is the
  -- client route derived from it, stored so an older client does not have to
  -- know how to build a route it has never seen.
  add column if not exists entity_type     text,
  add column if not exists entity_id       uuid,
  add column if not exists deeplink        text,

  -- WHICH CHILD. A parent must never have to guess.
  add column if not exists learner_id      uuid references chat.learner (id) on delete set null,
  -- WHO it is about. An actor id, never a contact channel.
  add column if not exists sender_id       uuid,

  -- Collapses a burst from one sender. NULL means "never group this".
  add column if not exists group_key       text,

  -- Bypasses preferences and category muting. Set from the type registry.
  add column if not exists is_essential    boolean not null default false,

  -- READ is the user having seen it in the app. OPENED (already present) is the
  -- user having acted on a push. Neither implies the other.
  add column if not exists read_at         timestamptz,
  add column if not exists expires_at      timestamptz;

alter table chat.notification
  drop constraint if exists notification_entity_check;
alter table chat.notification
  add constraint notification_entity_check check (
    entity_type is null or entity_type in (
      'conversation', 'message', 'call', 'learner', 'announcement', 'subscription'));

comment on column chat.notification.title is
  'Rendered at creation in the recipient''s locale and frozen. Re-rendering '
  'later would let a second schedule change silently rewrite the first '
  'notification''s text, which is the one thing a schedule notification must '
  'not do.';
comment on column chat.notification.read_at is
  'The user saw it in the app. NOT delivery, and NOT opened_at (acted on a '
  'push). Three different facts, three columns.';
comment on column chat.notification.is_essential is
  'Bypasses category muting. A cancelled class reaches a parent who silenced '
  'class reminders.';

-- Indexes -------------------------------------------------------------------
--
-- notification_recipient_idx (recipient_id, created_at desc) already exists and
-- serves the default notification-centre page. These add only what that index
-- cannot answer:

-- Unread count and the Unread tab. PARTIAL on read_at is null, so the index
-- holds only unread rows -- it stays small as history grows, which is the whole
-- point: counting unread must not get slower because a family has 200k read
-- notifications.
create index if not exists notification_unread_idx
  on chat.notification (recipient_id, created_at desc)
  where read_at is null and status <> 'cancelled';

-- The per-category tabs (Messages / Classes / Calls / Academy / Payments).
create index if not exists notification_recipient_category_idx
  on chat.notification (recipient_id, category, created_at desc);

-- Grouping a sender's burst, and collapsing it in the centre.
create index if not exists notification_group_idx
  on chat.notification (recipient_id, group_key, created_at desc)
  where group_key is not null;

-- Retention sweeps and the "hide an expired announcement" read path.
create index if not exists notification_expiry_idx
  on chat.notification (expires_at) where expires_at is not null;

-- Support answering "show me every notification for this class change".
create index if not exists notification_entity_idx
  on chat.notification (entity_type, entity_id) where entity_id is not null;

-- Deliberately NOT indexed: type, event_type, family_id, learner_id. They are
-- low-cardinality filters always applied together with recipient_id, which the
-- indexes above already lead on, so a separate index would be written on every
-- insert and read by nothing.

-- ---------------------------------------------------------------------------
-- chat.notification_delivery -- one row per channel per device
-- ---------------------------------------------------------------------------

create table if not exists chat.notification_delivery (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references chat.notification (id) on delete cascade,
  recipient_id    uuid not null,
  channel         text not null check (channel in ('in_app', 'push')),
  -- NULL for in_app: the channel is the account, not a device.
  device_token_id uuid references chat.device_token (id) on delete set null,
  platform        text,

  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'sent', 'delivered',
                                    'failed', 'skipped')),
  -- Why a delivery was deliberately not attempted. A suppressed push is
  -- recorded, never silently dropped -- support has to be able to answer
  -- "why did my phone not buzz?".
  skip_reason     text,
  attempts        integer not null default 0,
  sent_at         timestamptz,
  delivered_at    timestamptz,
  failed_at       timestamptz,
  next_attempt_at timestamptz,
  error_code      text,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table chat.notification_delivery is
  'DELIVERY, which is not the notification. A parent holds one notification and '
  'it may have three deliveries: in-app, a push to their phone, a push to their '
  'tablet. delivered means a provider or client acknowledged it; it is never '
  'inferred from a successful send.';
comment on column chat.notification_delivery.skip_reason is
  'RECIPIENT_ACTIVE, PREFERENCE_OFF, NO_DEVICE_TOKEN. A skipped delivery is a '
  'recorded decision, not a missing row.';

-- One in-app delivery per notification; one push delivery per device. Two
-- partial indexes rather than one UNIQUE constraint, because NULL device ids
-- are distinct to a UNIQUE constraint and would let in-app rows duplicate.
create unique index if not exists notification_delivery_in_app_uidx
  on chat.notification_delivery (notification_id, channel)
  where device_token_id is null;
create unique index if not exists notification_delivery_device_uidx
  on chat.notification_delivery (notification_id, channel, device_token_id)
  where device_token_id is not null;

-- The retry sweep: claim everything owed an attempt. PARTIAL, so it indexes
-- only rows still in flight rather than the whole delivery history.
create index if not exists notification_delivery_due_idx
  on chat.notification_delivery (next_attempt_at)
  where status in ('pending', 'processing');

-- Operations: "what is failing, and why" over a window.
create index if not exists notification_delivery_status_idx
  on chat.notification_delivery (status, created_at desc);

create index if not exists notification_delivery_notification_idx
  on chat.notification_delivery (notification_id);

drop trigger if exists notification_delivery_set_updated_at on chat.notification_delivery;
create trigger notification_delivery_set_updated_at
  before update on chat.notification_delivery
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- chat.notification_preference
-- ---------------------------------------------------------------------------
-- In-app is deliberately absent: the notification centre is the history, and a
-- preference that erases history is a defect. Only push is muteable.

create table if not exists chat.notification_preference (
  actor_id     uuid not null,
  category     text not null references chat.notification_category (key),
  push_enabled boolean not null default true,
  updated_at   timestamptz not null default now(),
  primary key (actor_id, category)
);

comment on table chat.notification_preference is
  'Push only. In-app notifications are never disableable -- the centre is the '
  'record of what happened, and a setting that loses it is a bug.';

create or replace function chat.guard_notification_preference()
returns trigger
language plpgsql
as $$
declare
  v_optional boolean;
begin
  if new.push_enabled then
    return new;
  end if;

  select is_optional into v_optional
    from chat.notification_category where key = new.category;

  if not coalesce(v_optional, false) then
    raise exception
      'notification category % is not optional and cannot be muted', new.category
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists notification_preference_guard on chat.notification_preference;
create trigger notification_preference_guard
  before insert or update on chat.notification_preference
  for each row execute function chat.guard_notification_preference();

drop trigger if exists notification_preference_set_updated_at on chat.notification_preference;
create trigger notification_preference_set_updated_at
  before update on chat.notification_preference
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- chat.announcement -- a first-class entity
-- ---------------------------------------------------------------------------

create table if not exists chat.announcement (
  id           uuid primary key default gen_random_uuid(),

  -- Bilingual at the source. Arabic is the academy's primary language and is
  -- required; English is optional and falls back to Arabic, matching
  -- chat.notification_template.
  title_ar     text not null,
  body_ar      text not null,
  title_en     text,
  body_en      text,

  priority     text not null default 'normal'
               check (priority in ('normal', 'important', 'urgent')),

  target_type  text not null check (target_type in (
                 'all_parents', 'all_teachers', 'all_staff',
                 'contacts', 'families', 'learners')),
  -- Empty for the all_* targets; the explicit set otherwise.
  target_ids   uuid[] not null default '{}',

  image_url    text,
  action_label_ar text,
  action_label_en text,
  action_url   text,

  status       text not null default 'draft'
               check (status in ('draft', 'published', 'cancelled')),
  publish_at   timestamptz not null default now(),
  expires_at   timestamptz,

  created_by   uuid not null,
  published_at timestamptz,
  -- Set once the fan-out has run. The fan-out is idempotent anyway (one
  -- dedupe_key per announcement per recipient), so this is an observability
  -- marker rather than a lock.
  fanned_out_at timestamptz,
  recipient_count integer,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint announcement_expiry_after_publish
    check (expires_at is null or expires_at > publish_at),
  constraint announcement_targets_present
    check (target_type in ('all_parents', 'all_teachers', 'all_staff')
           or cardinality(target_ids) > 0)
);

comment on table chat.announcement is
  'Academy announcements are an entity, not a special kind of push. Publishing '
  'one produces ordinary notifications through the ordinary engine, so they '
  'inherit dedupe, preferences, quiet hours, delivery tracking and history.';

-- Urgent is a real escalation: it bypasses quiet hours and cannot be grouped.
-- Only a manager or an admin may declare one, enforced here as well as in the
-- service, so a compromised or buggy client cannot mark everything urgent.
create or replace function chat.guard_announcement_authority()
returns trigger
language plpgsql
as $$
declare
  v_role text;
begin
  if new.priority <> 'urgent' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.priority = 'urgent' then
    return new;
  end if;

  select role into v_role from chat.staff where id = new.created_by;

  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception
      'only an admin or a manager may publish an urgent announcement'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists announcement_authority_guard on chat.announcement;
create trigger announcement_authority_guard
  before insert or update on chat.announcement
  for each row execute function chat.guard_announcement_authority();

drop trigger if exists announcement_set_updated_at on chat.announcement;
create trigger announcement_set_updated_at
  before update on chat.announcement
  for each row execute function chat.set_updated_at();

-- The publisher sweep: what is due to go out.
create index if not exists announcement_publish_idx
  on chat.announcement (publish_at)
  where status = 'published' and fanned_out_at is null;

-- The admin list, newest first.
create index if not exists announcement_status_idx
  on chat.announcement (status, publish_at desc);

alter table chat.notification
  add column if not exists announcement_id uuid references chat.announcement (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Tenancy -- the same restrictive model 20260906120000 applies to root entities
-- ---------------------------------------------------------------------------
-- notification_delivery and notification_preference are NOT root entities: every
-- row is reached through chat.notification / an actor, so they inherit tenancy
-- through their parent, exactly as conversation_member and message_receipt do.

do $mig$
declare
  t text;
begin
  foreach t in array array['announcement', 'notification_category'] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'chat' and table_name = t and column_name = 'organization_id'
    ) then
      execute format('alter table chat.%I add column organization_id uuid', t);
    end if;

    execute format(
      'update chat.%I set organization_id = chat.default_organization_id() where organization_id is null', t);
    execute format(
      'alter table chat.%I alter column organization_id set default chat.default_organization_id()', t);
    execute format(
      'alter table chat.%I alter column organization_id set not null', t);

    if not exists (
      select 1 from pg_constraint
       where conname = t || '_organization_fk'
         and conrelid = ('chat.' || quote_ident(t))::regclass
    ) then
      execute format(
        'alter table chat.%I add constraint %I foreign key (organization_id) references chat.organization(id)',
        t, t || '_organization_fk');
    end if;
  end loop;
end;
$mig$;
