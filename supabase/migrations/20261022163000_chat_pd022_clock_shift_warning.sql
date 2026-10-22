-- PD-22 (closed 2026-10-22) -- the daylight-saving warning PD-22 promised families.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-22, and
-- docs/architecture/TIME-ZONES.md ("When the clocks change").
--
-- A weekly lesson stays anchored in the TEACHER's zone (learner_schedule_slot.
-- timezone, usually Africa/Cairo). When Egypt changes its clocks (summer time
-- ends at the end of the last Thursday of October and starts on the last Friday
-- of April) and a family's zone does not (the Gulf), the family's local lesson
-- time moves by an hour. The worker (SchedulingService.scheduleClockShiftWarnings)
-- finds each parent whose local time moves and tells them once per regular time
-- per change, three days before the first lesson at the new time.
--
-- WHAT THIS ADDS
--
--   template lesson_clock_shift (ar + en). Push privacy (2026-10-14): it names
--     nobody. {day} and {time} are that first lesson's date and clock time in
--     the RECIPIENT's zone, rendered at send time (NotificationService.
--     inRecipientZone), so the text is right for the one person reading it.
--   rule lesson_clock_shift_parent: 3 days before that lesson, parents, quiet
--     hours respected. Rules are data: a different lead time is an UPDATE.

insert into chat.notification_template (key, locale, version, title, body)
select v.key, v.locale, 1, v.title, v.body
  from (values
    ('lesson_clock_shift', 'en', 'Jawwid', 'The clocks are changing: from {day}, the lesson starts at {time} your time.'),
    ('lesson_clock_shift', 'ar', 'جَوِّد',  'بسبب تغيير التوقيت، تبدأ الحصة ابتداءً من {day} الساعة {time} بتوقيتك.')
  ) as v(key, locale, title, body)
 where not exists (
   select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale and t.version = 1);

insert into chat.notification_rule (key, event_type, offset_seconds, template_key, recipient_role, respect_quiet_hours)
values ('lesson_clock_shift_parent', 'lesson_clock_shift', -259200, 'lesson_clock_shift', 'parent', true)
on conflict (key) do nothing;
