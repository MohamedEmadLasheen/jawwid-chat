-- PD-22 (closed 2026-10-22) -- every account has its own time zone.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-22, and
-- docs/architecture/TIME-ZONES.md.
--
-- WHAT THIS ADDS
--
--   chat.actor_time_zone   one row per person (parent contact, teacher, staff):
--                          the IANA zone their times are shown and sent in, and
--                          whether it follows the phone ("automatic", the default,
--                          like a phone's "Set automatically") or was picked by
--                          hand. The phone reports its OS zone; no location is
--                          ever read.
--   lesson reminder templates v2, which say the lesson's time. The time is
--                          rendered at SEND time in the recipient's zone, so a
--                          parent who flew from Kuwait to Cairo overnight is told
--                          the Cairo time.
--
-- WHAT THIS DOES NOT CHANGE
--
--   How time is stored. Every moment is already a timestamptz, and a weekly
--   lesson is a wall-clock time in the TEACHER's zone (PD-11 T2). PD-22 keeps
--   that anchor: when Egypt changes its clocks and the Gulf does not, the
--   family's local time moves, the teacher's does not, and no teacher is ever
--   double-booked by a clock change.
--   The academy's calendar. Instalment due dates, the payroll month and leave
--   days are dates in schedule.timezone, not moments, and are never converted.
--
-- WHO READS IT. The API's owner connection only (fail closed: RLS on, no grant to
-- any request role). A person reads and writes their own row through
-- /me/time-zone; staff see a family's zone only as "the family's local time"
-- beside a lesson in Admin Web.

create table chat.actor_time_zone (
  actor_id        uuid primary key,
  organization_id uuid not null references chat.organization (id),
  time_zone       text not null check (length(time_zone) between 1 and 64),
  automatic       boolean not null default true,
  updated_at      timestamptz not null default now()
);

comment on table chat.actor_time_zone is
  'PD-22: the zone a person sees and is notified in. automatic = follows the phone''s OS zone.';

-- A trigger, not a CHECK, as for teacher_availability: pg_timezone_names is not
-- immutable, and a CHECK that reads it could refuse a restore.
create or replace function chat.guard_actor_time_zone()
returns trigger
language plpgsql
as $$
begin
  if not chat.is_time_zone(new.time_zone) then
    raise exception 'actor_time_zone: % is not an IANA time zone', new.time_zone
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger actor_time_zone_guard
  before insert or update on chat.actor_time_zone
  for each row execute function chat.guard_actor_time_zone();

revoke all on function chat.guard_actor_time_zone() from public;

alter table chat.actor_time_zone enable row level security;
revoke all on chat.actor_time_zone from public, anon, authenticated, chat_app;

-- Push privacy (2026-10-14) kept these texts free of names AND of times, because
-- one time read in another zone is wrong. With the recipient's own zone known,
-- the time is right for the reader; names stay out.
insert into chat.notification_template (key, locale, version, title, body)
select v.key, v.locale, 2, v.title, v.body
  from (values
    ('lesson_reminder_tomorrow', 'en', 'Jawwid', 'Reminder: there is a lesson tomorrow at {time}.'),
    ('lesson_reminder_tomorrow', 'ar', 'جوّيد',  'تذكير: لديكم حصة غدًا الساعة {time}.'),
    ('lesson_reminder_soon',     'en', 'Jawwid', 'A lesson starts in 30 minutes, at {time}.'),
    ('lesson_reminder_soon',     'ar', 'جوّيد',  'تبدأ الحصة بعد ٣٠ دقيقة، الساعة {time}.'),
    ('lesson_reminder_teacher',  'en', 'Jawwid', 'Your next lesson starts in 15 minutes, at {time}.'),
    ('lesson_reminder_teacher',  'ar', 'جوّيد',  'تبدأ حصتك القادمة بعد ١٥ دقيقة، الساعة {time}.')
  ) as v(key, locale, title, body)
 where not exists (
   select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale and t.version = 2);
