-- PD-30 amendment D-3 (owner, 2026-11-06; docs/product/pd030-d3-wording.md).
--
-- The chat stays open and lessons already booked go ahead (D-1); only NEW
-- lessons pause. The pushes of 20261026140000 said "{learner}'s lessons are
-- paused", which reads as every lesson stopping. These are version 2 of the
-- two templates: TemplateService reads the newest active version, and version 1
-- stays as history (and for the rollback).
--
-- The pushes go to the parents and the child's supervisor, never the teacher,
-- so {reason} may stay in the paused text.

set local lock_timeout = '5s';

insert into chat.notification_template (key, locale, version, title, body) values
  ('subscription_locked', 'ar', 2, 'جَوِّد',
   'توقّف حجز حصص جديدة لـ{learner}: {reason}. الحصص المحجوزة تُقام في موعدها. جدّدوا الاشتراك من «الاشتراكات».'),
  ('subscription_locked', 'en', 2, 'Jawwid',
   'New lessons for {learner} are paused: {reason}. Booked lessons go ahead. Renew in Subscriptions.'),
  ('subscription_unlocked', 'ar', 2, 'جَوِّد',
   'عادت الحصص الجديدة لـ{learner} إلى الجدول. شكرًا لكم.'),
  ('subscription_unlocked', 'en', 2, 'Jawwid',
   'New lessons for {learner} are back on the schedule. Thank you.')
on conflict (key, locale, version) do update set title = excluded.title, body = excluded.body, is_active = true;
