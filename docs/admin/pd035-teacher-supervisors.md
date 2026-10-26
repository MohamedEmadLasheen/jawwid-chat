# PD-35 — teacher supervisors: runbook

Record: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-35. This page is
for whoever deploys, migrates or turns on the strict scope.

## Migrations

| Slot | What |
|---|---|
| `20261026160000` | the seat primitive (PR #131) |
| `20261026160003` | seat security fixes (PR #143) |
| `20261026160004` | teacher assignment, strict scope, the `supervision` seat (PR #136) |
| `20261026160005` | report correction requests, evaluations, improvement plans (PR #138) |
| `20261026160006` | scope hardening: the assignment guard locks the membership row, the move guard covers a `staff_id` change, the scope re-checks the department |

### A database that applied the OLD numbers fails at 160004

Before review, parts 2 and 3 lived at `20261026160001_chat_pd035_teacher_supervisor`
and `20261026160002_chat_pd035_reports_evaluations`. They were renumbered to
160004 / 160005 so they sort after the security fixes (160003). Those old
numbers were never on `main`, so staging and production cannot have them; only
a local or QA database that ran a PR branch can.

On such a database `scripts/db/apply.sh` stops at 160004 with
`relation "teacher_supervisor_assignment" already exists` (160005 would stop the
same way at `report_correction_request`). Check before deploying:

```sql
select version from chat.schema_migrations
 where version like '20261026160001%' or version like '20261026160002%';
```

Any row means: **rebuild that database from scratch** (reset and re-apply all
migrations, then re-seed). Do not clean it in place -- seats are never deleted
(`conversation_seat_is_coherent` refuses it), evaluations and plans are
append-only, and the old migrations also left triggers on existing tables
(`department_member_keeps_teacher_assignments`, `lesson_report_resolves_correction`),
so a hand-written cleanup is easy to get half right.

## The switch: `TEACHER_SUPERVISOR_STRICT_SCOPE`

- **Off everywhere** (manifest, env templates, `.do` specs, deploy workflows).
  Turning it on is the **owner's decision after QA**, once every active teacher
  has a supervisor (Organization -> Teachers & supervisors shows the count; a
  teacher whose supervisor was deactivated or left the department counts as
  unassigned).
- The database row `chat.config 'teacher_supervisor.strict_scope'` is what SQL
  and the API read (`chat.teacher_scope_strict()`).
- At boot the API and the worker write the variable into that row **only when
  it is set**. A process booted without it leaves the row as it is and logs the
  stored value. A boot that turns the stored value over logs a **warning**
  (`teacher supervisor scope CHANGED at boot`). Give every process the same
  value.

## Re-seating

With the switch on, each teacher's supervision conversation and trial group seat
the teacher's own supervisor and the Teachers Manager; off, the whole Teachers
department. The worker brings every live one of them in line:

- at start, and on every seat sweep, **whenever the switch differs from the one
  the last complete re-seat followed** (`chat.config
  'teacher_supervisor.reseated_strict'`; absent reads as off);
- in both directions -- turning the switch off restores the department;
- for inactive teachers' conversations too;
- one conversation at a time: a failure is logged and counted, the marker is not
  written, and the next seat sweep tries again. Staff who lose their place leave
  the live room (RT-009).

Seats taken by choice (the `supervision` seat, a Sales trial-desk supervisor in a
trial group) are never ended by a re-seat; they end through the seat service.

## Under strict scope, outside the conversations

Everything a teacher supervisor reads or changes about a teacher outside their
scope answers as not found -- the Teacher File, lessons, the roster, statistics,
trials, pauses, leave, discipline, certificates, parent feedback, change of
teacher (the children listed, and the teachers a child may be moved **to**), and
the PD-38 calendar (other teachers' children are anonymous blocks, as for an
Operations supervisor).
