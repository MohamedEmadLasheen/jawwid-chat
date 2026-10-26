-- Roll back 20261026210000_chat_pd038_schedule_calendar (PD-38 scheduling calendar).
--
-- Drops the work patterns and the supervisor colors with their rows: a shift is
-- re-entered on the Teacher File, a color on the Organization page. Lessons,
-- availability and leave are untouched -- the calendar only read them. The
-- Teacher File KPI's code reads chat.calendar_capacity, so roll back the API
-- release with it.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261026210000_pd038.down.sql

drop function chat.calendar_capacity(uuid, uuid[], date, date, text);
drop function chat.calendar_lessons(uuid, uuid[], timestamptz, timestamptz);
drop function chat.mr_json(tstzmultirange);
drop function chat.mr_minutes(tstzmultirange);
drop function chat.calendar_status(text, text);

drop index chat.lesson_org_starts_idx;

drop trigger teacher_availability_is_archived on chat.teacher_availability;
drop function chat.archive_teacher_availability();
drop table chat.teacher_availability_archive;
drop function chat.guard_teacher_availability_archive();

drop table chat.staff_calendar_color;
drop function chat.guard_staff_calendar_color();
drop table chat.teacher_work_window;
drop function chat.guard_teacher_work_window();
drop table chat.teacher_work_pattern;
drop function chat.guard_teacher_work_pattern();

delete from chat.schema_migrations where version = '20261026210000_chat_pd038_schedule_calendar';
