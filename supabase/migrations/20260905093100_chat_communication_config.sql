-- Jawwid Chat -- communication configuration, reminder rules and templates.
--
-- Every number the communication engine uses is a chat.config row. No threshold,
-- window or retry budget is compiled into a service. Every reminder schedule is
-- a chat.notification_rule row, so operations can retune without a deploy.
--
-- Values marked [hypothesis] are initial guesses to be recalibrated from
-- chat.event_log, consistent with the config seeding convention.

-- ---------------------------------------------------------------------------
-- Config
-- ---------------------------------------------------------------------------

insert into chat.config (key, value, scope, description) values
  ('communication.delete_for_everyone_window_minutes', '60'::jsonb, 'communication',
   '[hypothesis] How long a sender may delete a message for everyone.'),
  ('communication.page_size_default', '50'::jsonb, 'communication',
   'Default message page size.'),
  ('communication.page_size_max', '100'::jsonb, 'communication',
   'Hard cap on message page size, so a client cannot request an unbounded read.'),
  ('handoff.grace_minutes', '15'::jsonb, 'communication',
   '[hypothesis] Stickiness window: a staff member who just replied keeps the '
   'conversation past shift end while still online.'),
  ('realtime.typing_ttl_seconds', '8'::jsonb, 'communication',
   'Typing indicator TTL in Redis. Typing is never persisted to Postgres.'),
  ('realtime.presence_ttl_seconds', '45'::jsonb, 'communication',
   'Presence key TTL. A crashed process expires on its own.'),
  ('notification.max_attempts', '5'::jsonb, 'communication',
   '[hypothesis] Push delivery retry budget before a notification is failed.'),
  ('notification.quiet_hours_enabled', 'true'::jsonb, 'communication',
   'Master switch for quiet hours. Calls and critical rules are exempt.'),
  ('approval.student_group_teacher_default', 'true'::jsonb, 'communication',
   'Default teacher_requires_approval for a newly created student group.'),
  ('approval.student_group_parent_default', 'true'::jsonb, 'communication',
   'Default parent_requires_approval for a newly created student group.'),
  ('call.token_ttl_seconds', '120'::jsonb, 'communication',
   'LiveKit room token lifetime. Short-lived by design.'),
  ('call.ring_timeout_seconds', '45'::jsonb, 'communication',
   '[hypothesis] Unanswered call becomes a missed call after this long.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Bilingual templates
-- ---------------------------------------------------------------------------
-- Variables are {placeholders} substituted at render time. Automated messages
-- are sent under the official Jawwid identity, never as a named admin.

insert into chat.notification_template (key, locale, title, body) values
  ('class_reminder', 'ar', 'جوّيد',
   'أهلاً {parent_name}، نذكّركم أن حصة {student_name} تبدأ {class_time} يوم {class_date}.'),
  ('class_reminder', 'en', 'Jawwid',
   'Hello {parent_name}, a reminder that {student_name}''s class starts at {class_time} on {class_date}.'),

  ('schedule_change', 'ar', 'جوّيد',
   'تم تعديل موعد حصة {student_name} إلى {class_time} يوم {class_date}.'),
  ('schedule_change', 'en', 'Jawwid',
   '{student_name}''s class has been rescheduled to {class_time} on {class_date}.'),

  ('renewal_reminder', 'ar', 'جوّيد',
   'اشتراك {student_name} ينتهي في {renewal_date}. يسعدنا استمراركم معنا.'),
  ('renewal_reminder', 'en', 'Jawwid',
   '{student_name}''s subscription ends on {renewal_date}. We would love to continue with you.'),

  ('payment_reminder', 'ar', 'جوّيد',
   'تذكير بدفعة {amount} {currency} المستحقة في {due_date}.'),
  ('payment_reminder', 'en', 'Jawwid',
   'A reminder about the {amount} {currency} payment due on {due_date}.'),

  ('new_message', 'ar', '{sender_name}', '{preview}'),
  ('new_message', 'en', '{sender_name}', '{preview}'),

  ('pending_approval', 'ar', 'جوّيد',
   'رسالة بانتظار الموافقة في مجموعة {student_name}.'),
  ('pending_approval', 'en', 'Jawwid',
   'A message is awaiting approval in {student_name}''s group.'),

  ('approval_decision', 'ar', 'جوّيد',
   'تم {decision} رسالتك في مجموعة {student_name}.'),
  ('approval_decision', 'en', 'Jawwid',
   'Your message in {student_name}''s group was {decision}.'),

  ('incoming_call', 'ar', 'مكالمة واردة', 'مكالمة من {caller_name}.'),
  ('incoming_call', 'en', 'Incoming call', 'Call from {caller_name}.'),

  ('missed_call', 'ar', 'مكالمة فائتة', 'مكالمة فائتة من {caller_name}.'),
  ('missed_call', 'en', 'Missed call', 'Missed call from {caller_name}.'),

  ('group_call_started', 'ar', 'جوّيد',
   'بدأ {caller_name} مكالمة في مجموعة {student_name}.'),
  ('group_call_started', 'en', 'Jawwid',
   '{caller_name} started a call in {student_name}''s group.')
on conflict (key, locale, version) do nothing;

-- ---------------------------------------------------------------------------
-- Reminder rules
-- ---------------------------------------------------------------------------
-- offset_seconds is relative to the anchor event time; negative is "before".

insert into chat.notification_rule
  (key, event_type, offset_seconds, template_key, recipient_role, channel, priority, respect_quiet_hours) values
  -- Class reminders. T-24h and T-30m.
  ('class_reminder_t24h', 'class_scheduled',  -86400, 'class_reminder',   'parent', 'push', 'normal',   true),
  ('class_reminder_t30m', 'class_scheduled',   -1800, 'class_reminder',   'parent', 'push', 'critical', false),

  ('schedule_change',     'schedule_changed',      0, 'schedule_change',  'parent', 'push', 'high',     true),

  -- Renewal: D-14, D-7, D-1, D0.
  ('renewal_d14', 'renewal_due', -1209600, 'renewal_reminder', 'parent', 'push', 'normal', true),
  ('renewal_d7',  'renewal_due',  -604800, 'renewal_reminder', 'parent', 'push', 'normal', true),
  ('renewal_d1',  'renewal_due',   -86400, 'renewal_reminder', 'parent', 'push', 'high',   true),
  ('renewal_d0',  'renewal_due',        0, 'renewal_reminder', 'parent', 'push', 'high',   true),

  -- Payment: D-7, D-3, D0, D+3, D+7.
  ('payment_d7',   'payment_due', -604800, 'payment_reminder', 'parent', 'push', 'normal', true),
  ('payment_d3',   'payment_due', -259200, 'payment_reminder', 'parent', 'push', 'normal', true),
  ('payment_d0',   'payment_due',       0, 'payment_reminder', 'parent', 'push', 'high',   true),
  ('payment_p3',   'payment_due',  259200, 'payment_reminder', 'parent', 'push', 'high',   true),
  ('payment_p7',   'payment_due',  604800, 'payment_reminder', 'parent', 'push', 'high',   true),

  -- Communication events.
  ('new_message',       'message_published', 0, 'new_message',       'participant', 'push', 'normal',   true),
  ('pending_approval',  'approval_requested', 0, 'pending_approval',  'approver',    'push', 'high',     true),
  ('approval_decision', 'approval_decided',   0, 'approval_decision', 'sender',      'push', 'normal',   true),

  -- Calls always break through quiet hours.
  ('incoming_call',      'call_started',  0, 'incoming_call',      'callee',      'push', 'critical', false),
  ('missed_call',        'call_missed',   0, 'missed_call',        'callee',      'push', 'high',     true),
  ('group_call_started', 'group_call_started', 0, 'group_call_started', 'participant', 'push', 'critical', false)
on conflict (key) do nothing;
