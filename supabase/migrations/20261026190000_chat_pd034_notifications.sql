-- PD-34 P1 (2026-10-26) -- the Notification Center: one inbox record per
-- person per notification, preferences, and the templates it reads.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-34.
--
-- WHAT IS NEW
--
--   chat.notification_item       what a person sees in their Notification
--                                Center: category, severity, the entities it is
--                                about (refs), the action it opens, a group key,
--                                an owner / due / task status for work items,
--                                and read / acted / cancelled. One row per
--                                recipient, UNIQUE dedupe_key -- the same key
--                                shape chat.notification has always used, so a
--                                producer that re-emits converges on one row.
--   chat.notification.item_id    the delivery row (push today; e-mail and
--                                WhatsApp later) links to its item. A legacy
--                                producer leaves it null and the worker adopts
--                                the row into an item once it is sent.
--   chat.notification_preference per person, per category, per channel: on/off.
--                                Which categories a person may switch off is
--                                chat.config (notification.locked_categories),
--                                not schema.
--   chat.notification_settings   per person: show names on the lock screen.
--   item follows its delivery    a delivery cancelled because its reason is
--                                gone (a cancelled lesson, a paid instalment, a
--                                recipient taken out of service) cancels its
--                                item; a delivery revived revives it. So every
--                                existing cancel path -- TypeScript and SQL
--                                (chat.transfer_learner) -- reaches the
--                                Notification Center without being edited.
--   templates                    inbox.* (what the Center shows; names allowed,
--                                it is behind sign-in), *_named push variants
--                                (only when a person turns names on), and a
--                                payment_reminder v2 with no amount on the lock
--                                screen.
--
-- NOTHING ABOUT CALLS CHANGES. chat.notification gains a nullable column and
-- indexes; the dispatcher, the call rules and the call templates are untouched.
--
-- FAIL CLOSED. RLS on, no grant to any request role. Idempotent (G-19).

-- ===========================================================================
-- 1. The inbox record
-- ===========================================================================

create table if not exists chat.notification_item (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  dedupe_key       text not null unique,
  recipient_id     uuid not null,
  rule_key         text,
  rule_version     integer not null default 1,
  event_type       text not null,
  category         text not null check (category in
                     ('lesson', 'payment', 'conversation', 'call', 'task', 'announcement', 'system', 'marketing')),
  severity         text not null default 'normal' check (severity in ('critical', 'high', 'normal', 'low')),
  -- Why this person: parent_of, teacher_of, member, supervisor, backup, manager.
  basis            text,
  -- What it is about, for cancellation and grouping: lesson, instalment, conversation...
  subject_type     text,
  subject_id       text,
  -- Ids only (learnerId, lessonId, conversationId, instalmentId, invoiceId, callId).
  refs             jsonb not null default '{}'::jsonb,
  -- { kind, ...ids }: what the button opens. Never a URL.
  action           jsonb,
  group_key        text,
  requires_action  boolean not null default false,
  owner_id         uuid,
  due_at           timestamptz,
  task_status      text check (task_status is null or task_status in ('open', 'done', 'escalated', 'cancelled')),
  template_key     text not null,
  locale           text not null default 'ar' check (locale in ('ar', 'en')),
  variables        jsonb not null default '{}'::jsonb,
  -- How many events this item stands for (new messages in one conversation).
  item_count       integer not null default 1 check (item_count >= 1),
  -- What happened to the push: scheduled, none, opted_out, rate_limited, muted.
  push_state       text not null default 'none'
                     check (push_state in ('scheduled', 'none', 'opted_out', 'rate_limited', 'muted')),
  -- When it appears in the Center (a reminder appears at its moment, not when planned).
  visible_at       timestamptz not null,
  -- When the recipient's open sockets were told it appeared.
  announced_at     timestamptz,
  read_at          timestamptz,
  acted_at         timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  expires_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table chat.notification_item is
  'PD-34: one Notification Center entry per recipient. Deliveries (chat.notification) link to it by item_id.';

create index if not exists notification_item_inbox_idx
  on chat.notification_item (recipient_id, visible_at desc) where cancelled_at is null;
create index if not exists notification_item_subject_idx
  on chat.notification_item (subject_id) where cancelled_at is null;
-- At most ONE open entry per person per group (a conversation's new
-- messages): concurrent workers upsert into it (ON CONFLICT) instead of racing.
create unique index if not exists notification_item_open_group_uniq
  on chat.notification_item (recipient_id, group_key)
  where group_key is not null and read_at is null and cancelled_at is null;
create index if not exists notification_item_announce_idx
  on chat.notification_item (visible_at) where announced_at is null and cancelled_at is null;

-- Which messages an entry stands for (new messages in one conversation): a
-- message is counted the first time it is recorded here, never again, in any
-- order two workers commit in.
create table if not exists chat.notification_item_message (
  item_id     uuid not null references chat.notification_item (id) on delete cascade,
  message_id  uuid not null,
  primary key (item_id, message_id)
);

-- ===========================================================================
-- 2. Deliveries link to their item
-- ===========================================================================

alter table chat.notification
  add column if not exists item_id uuid references chat.notification_item (id) on delete set null;

create index if not exists notification_item_link_idx
  on chat.notification (item_id) where item_id is not null;
-- The worker's adoption pass: sent legacy rows with no item yet. Messages and
-- ringing calls are never adopted (the first is grouped by the pipeline, the
-- second is over when it stops ringing).
create index if not exists notification_unadopted_idx
  on chat.notification (scheduled_at)
  where item_id is null and event_type not in ('message_published', 'call_started', 'group_call_started');
-- One person's pushes for one conversation, newest first (message coalescing).
create index if not exists notification_message_pair_idx
  on chat.notification (recipient_id, conversation_id, created_at desc)
  where event_type = 'message_published';

-- ===========================================================================
-- 3. Preferences
-- ===========================================================================

create table if not exists chat.notification_preference (
  actor_id         uuid not null,
  organization_id  uuid not null,
  category         text not null check (category in
                     ('lesson', 'payment', 'conversation', 'call', 'task', 'announcement', 'system', 'marketing')),
  channel          text not null default 'push' check (channel in ('push', 'email', 'whatsapp')),
  enabled          boolean not null,
  updated_at       timestamptz not null default now(),
  primary key (actor_id, category, channel)
);

create table if not exists chat.notification_settings (
  actor_id         uuid primary key,
  organization_id  uuid not null,
  -- Names (a child's, an amount) on the lock screen. Null: the academy default.
  show_previews    boolean,
  updated_at       timestamptz not null default now()
);

-- ===========================================================================
-- 4. An item follows its delivery
-- ===========================================================================

create or replace function chat.notification_item_follows_delivery()
returns trigger
language plpgsql
as $$
begin
  if new.item_id is null or new.status is not distinct from old.status then
    return new;
  end if;
  -- READ: the person read it elsewhere; MUTED: they muted the chat. Either
  -- withdraws the push, never the entry.
  if new.status = 'cancelled' and coalesce(new.failure_code, '') not in ('READ', 'MUTED') then
    update chat.notification_item i
       set cancelled_at = now(),
           cancel_reason = coalesce(new.failure_code, 'delivery_cancelled'),
           updated_at = now()
     where i.id = new.item_id
       and i.cancelled_at is null
       and not exists (select 1 from chat.notification n
                        where n.item_id = i.id and n.id <> new.id and n.status <> 'cancelled');
  elsif old.status = 'cancelled' and new.status = 'scheduled' then
    update chat.notification_item
       set cancelled_at = null, cancel_reason = null, updated_at = now()
     where id = new.item_id
       and cancel_reason = coalesce(old.failure_code, 'delivery_cancelled');
  end if;
  return new;
end;
$$;

drop trigger if exists notification_item_follows_delivery on chat.notification;
create trigger notification_item_follows_delivery
  after update of status on chat.notification
  for each row execute function chat.notification_item_follows_delivery();

-- ===========================================================================
-- 4b. Leaving a conversation withdraws its waiting chat pushes
-- ===========================================================================
--
-- A chat push may wait (coalescing, the reading grace, quiet hours). Someone
-- who leaves the conversation, or whose PD-35 seat closes, in that time must
-- not be pushed. Every writer of left_at is covered, whatever the code path.
-- (A seat whose access lapses before the sweep closes it is caught at send
-- time by NotificationPipeline.guardDueMessages.) failure_code AUDIENCE also
-- withdraws the Center entry, by the trigger above.

-- One function per table: each reads only its own table's columns (a shared
-- function branching on TG_TABLE_NAME still fails, because PL/pgSQL resolves
-- every NEW.<field> it plans, and conversation_member has no staff_id).
create or replace function chat.cancel_message_pushes_on_member_left()
returns trigger
language plpgsql
as $$
begin
  if old.left_at is null and new.left_at is not null then
    update chat.notification
       set status = 'cancelled', failure_code = 'AUDIENCE'
     where recipient_id = new.actor_id
       and conversation_id = new.conversation_id
       and event_type = 'message_published'
       and status = 'scheduled';
  end if;
  return new;
end;
$$;

create or replace function chat.cancel_message_pushes_on_seat_left()
returns trigger
language plpgsql
as $$
begin
  if old.left_at is null and new.left_at is not null then
    update chat.notification
       set status = 'cancelled', failure_code = 'AUDIENCE'
     where recipient_id = new.staff_id
       and conversation_id = new.conversation_id
       and event_type = 'message_published'
       and status = 'scheduled';
  end if;
  return new;
end;
$$;

drop trigger if exists member_left_cancels_message_pushes on chat.conversation_member;
create trigger member_left_cancels_message_pushes
  after update of left_at on chat.conversation_member
  for each row execute function chat.cancel_message_pushes_on_member_left();

drop trigger if exists seat_left_cancels_message_pushes on chat.conversation_seat;
create trigger seat_left_cancels_message_pushes
  after update of left_at on chat.conversation_seat
  for each row execute function chat.cancel_message_pushes_on_seat_left();

-- ===========================================================================
-- 5. Templates
-- ===========================================================================

-- What the Center shows. Behind sign-in, so a child's name may appear; the
-- push (the lock screen) keeps its own, generic template.
insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('inbox.lesson_reminder_tomorrow', 'en', 'Lesson tomorrow', '{child}''s lesson is tomorrow at {time}.'),
    ('inbox.lesson_reminder_tomorrow', 'ar', 'حصة غدًا', 'حصة {child} غدًا الساعة {time}.'),
    ('inbox.lesson_reminder_soon', 'en', 'Lesson soon', '{child}''s lesson starts in 30 minutes, at {time}.'),
    ('inbox.lesson_reminder_soon', 'ar', 'الحصة قريبًا', 'تبدأ حصة {child} بعد ٣٠ دقيقة، الساعة {time}.'),
    ('inbox.lesson_reminder_teacher', 'en', 'Lesson in 15 minutes', 'Your lesson with {child} starts at {time}.'),
    ('inbox.lesson_reminder_teacher', 'ar', 'حصة بعد ١٥ دقيقة', 'تبدأ حصتك مع {child} الساعة {time}.'),
    ('inbox.lesson_clock_shift', 'en', 'Lesson time changes', '{child}: from {day}, the lesson starts at {time} your time.'),
    ('inbox.lesson_clock_shift', 'ar', 'تغيّر موعد الحصة', '{child}: ابتداءً من {day} تبدأ الحصة الساعة {time} بتوقيتك.'),
    ('inbox.payment_reminder', 'en', 'Payment due', '{amount} {currency} is due on {due_date}.'),
    ('inbox.payment_reminder', 'ar', 'دفعة مستحقة', 'مبلغ {amount} {currency} مستحق في {due_date}.'),
    ('inbox.payment_received', 'en', 'Payment received', 'We received {amount} {currency}. Invoice {invoice_number} is in Payments.'),
    ('inbox.payment_received', 'ar', 'وصلت الدفعة', 'وصلنا مبلغ {amount} {currency}. الفاتورة {invoice_number} في المدفوعات.'),
    ('inbox.payment_receipt_rejected', 'en', 'Receipt not confirmed', 'Your transfer receipt ({amount} {currency}) was not confirmed: {reason}'),
    ('inbox.payment_receipt_rejected', 'ar', 'لم يُؤكَّد الإيصال', 'لم نتمكن من تأكيد إيصال التحويل ({amount} {currency}): {reason}'),
    ('inbox.new_messages', 'en', 'New messages', 'New messages: {count}'),
    ('inbox.new_messages', 'ar', 'رسائل جديدة', 'رسائل جديدة: {count}'),
    ('inbox.missed_call', 'en', 'Missed call', 'You missed a call.'),
    ('inbox.missed_call', 'ar', 'مكالمة فائتة', 'فاتتك مكالمة.'),
    ('inbox.story_published', 'en', 'New story', 'A new story is waiting for you.'),
    ('inbox.story_published', 'ar', 'حالة جديدة', 'لديك حالة جديدة بانتظارك.'),
    ('inbox.generic', 'en', 'Jawwid', 'You have a new notification.'),
    ('inbox.generic', 'ar', 'جَوِّد', 'لديك إشعار جديد.'),
    -- Lock-screen variants WITH names, used only for someone who turned names on.
    ('lesson_reminder_tomorrow_named', 'en', 'Jawwid', '{child}''s lesson is tomorrow at {time}.'),
    ('lesson_reminder_tomorrow_named', 'ar', 'جَوِّد', 'تذكير: حصة {child} غدًا الساعة {time}.'),
    ('lesson_reminder_soon_named', 'en', 'Jawwid', '{child}''s lesson starts in 30 minutes, at {time}.'),
    ('lesson_reminder_soon_named', 'ar', 'جَوِّد', 'تبدأ حصة {child} بعد ٣٠ دقيقة، الساعة {time}.'),
    ('lesson_reminder_teacher_named', 'en', 'Jawwid', 'Your lesson with {child} starts in 15 minutes, at {time}.'),
    ('lesson_reminder_teacher_named', 'ar', 'جَوِّد', 'تبدأ حصتك مع {child} بعد ١٥ دقيقة، الساعة {time}.'),
    ('payment_reminder_named', 'en', 'Jawwid', 'A reminder about the {amount} {currency} payment due on {due_date}.'),
    ('payment_reminder_named', 'ar', 'جَوِّد', 'تذكير بدفعة {amount} {currency} المستحقة في {due_date}.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);

-- payment_reminder v2: no amount on the lock screen (PD-34 default; names and
-- amounts are in the Center). v1 stays as history.
insert into chat.notification_template (key, locale, version, title, body)
select v.key, v.locale, 2, v.title, v.body
  from (values
    ('payment_reminder', 'en', 'Jawwid', 'A payment is due on {due_date}.'),
    ('payment_reminder', 'ar', 'جَوِّد', 'لديكم دفعة مستحقة في {due_date}.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t
                    where t.key = v.key and t.locale = v.locale and t.version = 2);

-- ===========================================================================
-- 6. Fail closed
-- ===========================================================================

alter table chat.notification_item enable row level security;
alter table chat.notification_preference enable row level security;
alter table chat.notification_settings enable row level security;
alter table chat.notification_item_message enable row level security;
revoke all on chat.notification_item, chat.notification_preference, chat.notification_settings,
  chat.notification_item_message
  from public, anon, authenticated, chat_app;
revoke all on function chat.notification_item_follows_delivery() from public;
revoke all on function chat.cancel_message_pushes_on_member_left() from public;
revoke all on function chat.cancel_message_pushes_on_seat_left() from public;
