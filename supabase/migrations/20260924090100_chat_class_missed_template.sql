-- Jawwid Chat -- the one notification the attendance projection produces.
--
-- class_missed only. `class_attended` is projected into chat.class_attendance
-- and notifies nobody: "your child attended their class" is the normal case,
-- and a platform that announces the normal case teaches parents to swipe
-- everything away -- including the one that matters.
--
-- The text names the child and the time, because a parent of three reading this
-- on a lock screen has to know which child and which class without opening
-- anything. `class_time` and `class_date` are rendered in the FAMILY's timezone
-- at creation and frozen on the row, exactly as the reminder and reschedule
-- templates are.

insert into chat.notification_template (key, locale, title, body) values
  ('class_missed', 'ar', 'فات {student_name} حصته',
   'لم يحضر {student_name} حصة {class_time} يوم {class_date}.'),
  ('class_missed', 'en', '{student_name} missed a class',
   '{student_name} did not attend the {class_time} class on {class_date}.')
-- Matching the catalog migration's idiom: templates are versioned, and an
-- existing row is left alone rather than rewritten under a notification that
-- already quoted it.
on conflict (key, locale, version) do nothing;
