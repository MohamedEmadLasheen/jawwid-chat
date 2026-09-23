-- Jawwid Chat -- notification catalogue: templates, rules, retention, operations.
--
-- Everything a parent reads is a row here. No user-facing string for a
-- notification exists in TypeScript or Dart, in either language.
--
-- WHY THERE ARE "_child" VARIANTS
-- ------------------------------
-- "Ahmed's teacher sent you a message" and "Mr Yusuf sent you a message" are
-- not the same sentence with a different word -- in Arabic they are different
-- constructions. Rendering the first by pasting a name into the second is how
-- a bilingual product ends up with copy that reads like a machine wrote it.
-- The registry picks the key; the template owns the sentence.

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

insert into chat.notification_template (key, locale, title, body) values
  -- Messaging -------------------------------------------------------------
  ('message_received', 'ar', '{sender_name}', 'أرسل لك رسالة.'),
  ('message_received', 'en', '{sender_name}', 'Sent you a message.'),

  ('message_received_child', 'ar', 'معلّم {student_name}', 'أرسل لك رسالة.'),
  ('message_received_child', 'en', '{student_name}''s teacher', 'Sent you a message.'),

  ('voice_message_received', 'ar', '{sender_name}', 'أرسل لك رسالة صوتية.'),
  ('voice_message_received', 'en', '{sender_name}', 'Sent you a voice message.'),

  ('voice_message_received_child', 'ar', 'معلّم {student_name}', 'أرسل لك رسالة صوتية.'),
  ('voice_message_received_child', 'en', '{student_name}''s teacher',
   'Sent you a voice message.'),

  ('media_message_received', 'ar', '{sender_name}', 'أرسل لك مرفقاً.'),
  ('media_message_received', 'en', '{sender_name}', 'Sent you an attachment.'),

  ('media_message_received_child', 'ar', 'معلّم {student_name}', 'أرسل لك مرفقاً.'),
  ('media_message_received_child', 'en', '{student_name}''s teacher',
   'Sent you an attachment.'),

  -- The grouped rollup. Never used for anything but messaging.
  ('messages_grouped', 'ar', '{sender_name}', '{count} رسائل جديدة.'),
  ('messages_grouped', 'en', '{sender_name}', '{count} new messages.'),

  ('messages_grouped_child', 'ar', 'معلّم {student_name}', '{count} رسائل جديدة.'),
  ('messages_grouped_child', 'en', '{student_name}''s teacher', '{count} new messages.'),

  -- Academy / supervisor voice, used when the sender speaks for Jawwid rather
  -- than as a named person.
  ('academy_message', 'ar', 'جوّيد', 'وصلتك رسالة جديدة من أكاديمية جوّيد.'),
  ('academy_message', 'en', 'Jawwid Academy', 'You have a new message from Jawwid Academy.'),

  -- Calls -----------------------------------------------------------------
  ('missed_call_child', 'ar', 'مكالمة فائتة', 'مكالمة فائتة من معلّم {student_name}.'),
  ('missed_call_child', 'en', 'Missed call', 'Missed call from {student_name}''s teacher.'),

  -- Classes ---------------------------------------------------------------
  -- The old/new pair is in the sentence on purpose. The notification row keeps
  -- this rendered text forever, so a second reschedule cannot rewrite what the
  -- parent was told the first time.
  ('class_schedule_changed', 'ar', 'تغيّر موعد حصة {student_name}',
   'انتقلت حصة {student_name} من {old_time} إلى {new_time} يوم {new_date}.'),
  ('class_schedule_changed', 'en', '{student_name}''s class time changed',
   '{student_name}''s class moved from {old_time} to {new_time} on {new_date}.'),

  ('class_scheduled', 'ar', 'حصة جديدة لـ {student_name}',
   'تم تحديد حصة {student_name} في {new_time} يوم {new_date}.'),
  ('class_scheduled', 'en', 'New class for {student_name}',
   '{student_name}''s class is set for {new_time} on {new_date}.'),

  ('class_cancelled', 'ar', 'إلغاء حصة {student_name}',
   'تم إلغاء حصة {student_name} التي كانت في {old_time} يوم {old_date}.'),
  ('class_cancelled', 'en', '{student_name}''s class was cancelled',
   '{student_name}''s class on {old_date} at {old_time} has been cancelled.'),

  -- Academy ---------------------------------------------------------------
  -- The announcement's own title and body are rendered into these, so the
  -- academy voice is consistent and the admin still writes the content.
  ('announcement', 'ar', '{announcement_title}', '{announcement_body}'),
  ('announcement', 'en', '{announcement_title}', '{announcement_body}'),

  ('announcement_important', 'ar', 'إعلان مهم · {announcement_title}', '{announcement_body}'),
  ('announcement_important', 'en', 'Important · {announcement_title}', '{announcement_body}'),

  ('announcement_urgent', 'ar', 'عاجل من جوّيد · {announcement_title}', '{announcement_body}'),
  ('announcement_urgent', 'en', 'Urgent from Jawwid · {announcement_title}',
   '{announcement_body}')
on conflict (key, locale, version) do nothing;

-- The pre-existing class_reminder template is DELIBERATELY NOT CHANGED. It
-- already names the child in its body ("a reminder that {student_name}'s class
-- starts at {class_time}"), and its title is the academy's own name, which is
-- the convention every automated template in 20260905093100 follows: an
-- automated message is sent under the official Jawwid identity and never under
-- a person's. Moving the child's name into the title would have bought nothing
-- the body does not already say, at the cost of breaking that convention in one
-- place -- which is how a product ends up with notifications that look like
-- they came from different systems.

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
-- Existing rules are untouched. These add the schedules the platform now has a
-- real event for.

insert into chat.notification_rule
  (key, event_type, offset_seconds, template_key, recipient_role, channel, priority, respect_quiet_hours) values
  -- The last useful moment to tell a parent. Quiet hours are not respected for
  -- the same reason the T-30m rule does not: a reminder deferred past the class
  -- is not a reminder.
  --
  -- HIGH, not urgent, even though it is the more imminent of the two. T-30m is
  -- already the urgent one, and a class that produces two urgent alerts twenty
  -- minutes apart trains a parent to dismiss both. One escalation per class.
  ('class_reminder_t10m', 'class_scheduled', -600, 'class_reminder', 'parent', 'push', 'high', false),

  ('class_cancelled', 'class_cancelled', 0, 'class_cancelled', 'parent', 'push', 'high', false)
on conflict (key) do nothing;

-- schedule_change already exists and already points at the schedule_change
-- template. Point it at the richer one that keeps the old time, and let it
-- through quiet hours: a parent who learns at 08:00 that the class moved to
-- 07:30 learned nothing.
update chat.notification_rule
   set template_key = 'class_schedule_changed',
       respect_quiet_hours = false,
       priority = 'high'
 where key = 'schedule_change';

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
-- Two different clocks, deliberately not one:
--
--   USER-FACING history   what a parent can scroll back through.
--   OPERATIONAL record    what support reads when a parent says "I never got
--                         it". Deliveries outlive the notification centre entry.
--
-- Nothing here deletes an unread notification, ever, at any age: an unread
-- notification is the system still owing the parent something.

insert into chat.config (key, value, scope, description) values
  ('notification.retention_days', '180'::jsonb, 'communication',
   'How long a READ notification stays in a parent''s history. Unread rows are '
   'never purged by age.'),
  ('notification.delivery_retention_days', '400'::jsonb, 'communication',
   'How long the per-channel delivery record is kept for support and '
   'observability. Longer than the notification it belongs to on purpose.'),
  ('notification.announcement_retention_days', '730'::jsonb, 'communication',
   'Announcements are the academy''s record of what it told families, and are '
   'kept far longer than routine notifications.'),
  ('notification.group_window_seconds', '300'::jsonb, 'communication',
   '[hypothesis] Messages from one sender inside this window collapse into one '
   'notification.'),
  ('notification.delivery_max_attempts', '5'::jsonb, 'communication',
   'Per-channel delivery retry budget. Distinct from notification.max_attempts, '
   'which bounds the notification as a whole.')
on conflict (key) do nothing;

create or replace function chat.purge_notification_history(p_now timestamptz default now())
returns table (notifications_deleted bigint, deliveries_deleted bigint)
language plpgsql
as $$
declare
  v_notifications bigint;
  v_deliveries    bigint;
  v_days          integer := chat.config_int('notification.retention_days');
  v_ann_days      integer := chat.config_int('notification.announcement_retention_days');
  v_del_days      integer := chat.config_int('notification.delivery_retention_days');
begin
  -- Orphan the deliveries first so they survive their notification. They are
  -- the operational record; losing them with the notification is how "we can
  -- see it was created but not whether it ever left the building" happens.
  update chat.notification_delivery d
     set notification_id = null
   where d.notification_id in (
     select n.id from chat.notification n
      where n.read_at is not null
        and n.created_at < p_now - make_interval(days => v_days)
        and (n.announcement_id is null
             or n.created_at < p_now - make_interval(days => v_ann_days))
   );

  with gone as (
    delete from chat.notification n
     where n.read_at is not null
       and n.created_at < p_now - make_interval(days => v_days)
       and (n.announcement_id is null
            or n.created_at < p_now - make_interval(days => v_ann_days))
    returning 1
  )
  select count(*) into v_notifications from gone;

  with gone as (
    delete from chat.notification_delivery d
     where d.created_at < p_now - make_interval(days => v_del_days)
    returning 1
  )
  select count(*) into v_deliveries from gone;

  return query select v_notifications, v_deliveries;
end;
$$;

comment on function chat.purge_notification_history(timestamptz) is
  'User-facing retention. Never touches an UNREAD notification regardless of '
  'age -- an unread notification is an unmet obligation, not stale data.';

-- Deliveries whose notification was purged keep pointing at nothing rather than
-- cascading. Drop the NOT NULL the table was created with so that is possible.
alter table chat.notification_delivery
  alter column notification_id drop not null;

-- ---------------------------------------------------------------------------
-- Operations view
-- ---------------------------------------------------------------------------
-- The questions support has to be able to answer, in one place, without a join
-- written from memory at 11pm. NO title or body: a support view is not a place
-- to read a family's messages.

create or replace view chat.notification_operations as
select
  n.id                    as notification_id,
  n.organization_id,
  n.type                  as notification_type,
  n.event_type,
  n.category,
  n.priority,
  n.recipient_id,
  n.learner_id,
  n.conversation_id,
  n.announcement_id,
  n.dedupe_key,
  n.rule_key,
  n.status,
  n.created_at,
  n.scheduled_at,
  n.sent_at,
  n.read_at,
  n.opened_at,
  n.failure_code,
  n.attempts,
  d.channel,
  d.platform,
  d.status                as delivery_status,
  d.skip_reason,
  d.attempts              as delivery_attempts,
  d.sent_at               as delivery_sent_at,
  d.delivered_at          as delivery_delivered_at,
  d.failed_at             as delivery_failed_at,
  d.error_code,
  d.error_message
from chat.notification n
left join chat.notification_delivery d on d.notification_id = n.id;

comment on view chat.notification_operations is
  'Was it created, for whom, from which event, on which channel, to which '
  'platform, was it sent, delivered, why did it fail, was it opened, when was '
  'it read. Carries no notification text: support diagnoses delivery, it does '
  'not read families'' messages.';

revoke all on chat.notification_operations from public;
grant select on chat.notification_operations to service_role;
