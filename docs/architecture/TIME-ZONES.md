# Time zones (PD-22)

Every person reads times in their own zone. This is the record of how, and of the
one rule that keeps lessons from colliding.

## The rule

**Store instants; anchor weekly lessons in the teacher's zone; word a time for one
reader at a time.**

| What | Stored as | Converted by |
|---|---|---|
| A lesson, a call, a message, a reminder | `timestamptz` (an instant) | the reader's client, at display |
| A weekly lesson time | wall clock + IANA zone of the **teacher** (`learner_schedule_slot`) | Postgres `AT TIME ZONE` when lessons are materialized (PD-11 T2) |
| An instalment due date, a payroll month, a leave day | a `date` on the academy's calendar (`schedule.timezone`) | never: a date is not a moment |
| A person's zone | `chat.actor_time_zone` (zone + automatic) | — |

Why the teacher's zone anchors a weekly lesson: a teacher has students in several
countries. If each lesson followed the family's zone, a clock change in Egypt (which
observes daylight saving; the Gulf does not) would move some of the teacher's lessons
and not others, and two could land on the same hour. Anchored in the teacher's zone,
the teacher's day never moves; a family abroad sees its lesson an hour earlier or later
twice a year.

## Where a person's zone comes from

The app reports the phone's **OS time zone** (`flutter_timezone`) on sign-in and every
time it returns to the foreground: `POST /me/time-zone/device`. While the setting is
automatic, the server records it, so landing in another country updates it with no
action. Location is never read.

Settings -> Date & time has "Set automatically" (on by default) and, when off, a zone
picker: `PUT /me/time-zone { automatic, timeZone }`. A manual choice wins over every
later device report, on every device, until automatic is turned back on. Every answer
is the stored setting, so a phone adopts a choice made on another one.

## Display

- **App.** `AppClock` (`lib/shared/utils/app_clock.dart`) is the one place an instant
  becomes a wall-clock time: `toLocal()` when automatic, the bundled IANA database
  (`package:timezone`, full set: phones report aliases such as `Asia/Kuwait`) when
  manual. A weekly slot is shown by its next real start (`nextStartsAt` on every slot
  DTO), because Monday 23:30 in Cairo is Tuesday in Riyadh. Pickers read the typed wall
  clock in the account's zone (`AppClock.wallClock`).
- **Admin Web.** Every time in `Africa/Cairo`, named; never the staff member's browser
  zone. Beside a lesson, the family's local time where it differs
  (`core/time/academyTime.ts`, `familyTimeZone` on the Student Profile). Times typed
  into forms are Cairo times.
- **Text the server writes for several readers** (scheduled-call and trial cards)
  names its zone: "Friday 23 October at 17:00 (Cairo time)". Clients draw `startsAt`.

## Notifications

Reminder offsets are instants (T-24h, T-30m, T-15m), so they fire at the right moment
everywhere. Their text carries `{time}`, rendered at **send time** in the recipient's
zone (`NotificationService.inRecipientZone`); with no zone known, the academy's time
with its name. Quiet hours use the recipient's zone.

## Tests

- `apps/api/test/unit/time-zone/time-zone.spec.ts` — wall clock to instant across
  Egypt's clock change, next weekly start, weekday shift, zone names.
- `apps/api/test/integration/account-time-zone-pd022.spec.ts` — the endpoints, manual
  vs automatic, teachers, reminder text per recipient, quiet hours.
- `test/shared/app_clock_test.dart`, `test/core/time/time_zone_controller_test.dart` —
  the app's clock and sync.
- `apps/admin-web/src/core/time/academyTime.test.ts` — Cairo wall clock, family time.
