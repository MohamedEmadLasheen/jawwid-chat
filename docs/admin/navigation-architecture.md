# Admin Web navigation architecture (owner-approved 2026-11-21)

Nine rail sections, in this order. Every page has exactly one home. Listing is UX, not security:
each role still sees only the destinations it has a page in, and the server decides every read.
The single source is `apps/admin-web/src/app/navigation.ts` (`DESTINATIONS`, `SECTION_DESTINATION`,
`AREA_DESTINATION`, `ADMIN_AREA_ENTRIES`, `PEOPLE_GROUPS`).

| # | Section | Pages (route) | Server gate (unchanged) |
|---|---|---|---|
| 1 | Conversations | Chat `/chat`; All conversations `/admin/conversations` (super admin); Moderation `/moderation` | role; `moderation.view` |
| 2 | Dashboard | Dashboard `/dashboard`; Tasks `/tasks` | role |
| 3 | People & Organization | *Staff & accounts:* Accounts `/accounts`, Users `/admin/users` · *Teachers:* Teachers `/teachers` (`/admin/teachers`), Credentials review `/teacher-profiles`, Attendance & complaints, Grants & testimonials · *Families:* Parents `/parents`, Students `/students` · *Organization:* `/organization` (`/admin/teams`) | role; `lessonManager` (Students too); `billingReader`; `teacherAttendance`/`teacherGrants` |
| 4 | Sales | Trial lessons `/trials`; New students `/trials/new-students` | `sales`/`operations`/`lessonManager` |
| 5 | Scheduling | Academy calendar `/schedule`; Teachers' schedules `/teachers/schedules`; Student schedules `/schedule/students` | `calendar`; `lessonManager` |
| 6 | Operations | Needs action `/teachers/needs-action`; Materials; Escalations `/cases`; Certificates; Lesson audio | `lessonManager`; `materialsManager`; role; `certificates`; `lessonAudio` |
| 7 | Finance | Instalments `/instalments`; Payments `/payments` | `billingReader` |
| 8 | Communication | Stories `/stories`; Calls `/calls`; Notifications*, WhatsApp* | role |
| 9 | Admin & Settings | *Reports & quality:* Reports & analytics, Quality*, Academy operations*, Forms* · *System:* Approvals*, Integrations*, Audit log*, System settings* | super admin |

\* in development (no backend yet), marked as such.

## What was consolidated, moved, kept
- **One table instead of ten `push()` calls** places the super admin's operator pages; operators use the same destinations.
- **Student schedules** and **Teachers' schedules** render one shared component (`StudentScheduleDesk`); no scheduling logic is duplicated.
- **Moved out of People:** Trials, Schedule, Escalations, Certificates, Instalments, Payments.
- **No URL changed.** `Navigation.test.tsx` ("No URL was lost") opens every rail entry for every role and 45 pre-redesign URLs.
- **Not merged yet** (deliberately, no functional gain for the risk): the two route trees `/teachers/*` and `/admin/teachers/*`; the `/cases` and `/teachers/cases` registrations; Chat + All conversations as tabs of one page. Candidates for a later clean-up PR.
- **Students (PD-60)** is a People entry (`/students`, group Families) backed by `GET /learners`: paginated (max 100), searchable, filterable by teacher, supervisor and status, essential fields only, rows linking to the existing `/students/:id` profile. The server shows exactly the learners whose profile the caller may open (super admin, Teachers department in scope, a child's supervisor). No new table.

## Sales pipeline — proposal (needs a migration slot and an owner decision on lead contact storage)
Stages: New Lead · Contacted · Trial Booked · Trial Completed · Converted · Lost.

| Stage | Source today |
|---|---|
| Trial Booked | `trial_prospect` with a scheduled trial `lesson` (kind=trial) |
| Trial Completed | that lesson held; `trial_outcome` pending or recorded |
| Converted | `trial_outcome.result = subscribed` → New students / `family-intake` hand-over to Operations |
| Lost | `trial_outcome` `not_subscribed`/`no_show`, or an explicit loss |
| **New Lead, Contacted** | **no record exists** |

Safest implementation, using the existing architecture (no second student/lead system): a lead is a
`trial_prospect` with no lesson yet. Add nullable columns to `trial_prospect` — `pipeline_stage`
(`new_lead|contacted|lost`), `lost_reason`, `last_contacted_at`, `next_follow_up_on`, `follow_up_note`
(additive, backwards compatible). Stages 3–5 stay derived on read from lessons/outcomes, never copied.
One read endpoint returns prospects with their derived stage; the UI is a board/list in the Sales section.
Open: whether a lead's phone/e-mail may be stored (today parent contact is confined to
`src/new-students`, G-07) — if not, a lead stays name-only until it books a trial.
