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
| 4 | Sales | Sales pipeline `/sales/pipeline` (PD-59); Trial lessons `/trials`; New students `/trials/new-students` | `sales` (pipeline); `sales`/`operations`/`lessonManager` |
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

## Sales pipeline (PD-59, built)
Stages: New Lead · Contacted · Trial Booked · Trial Completed · Converted · Lost. Page: **Sales pipeline**
`/sales/pipeline`, first page of Sales, offered on the server's `sales` answer (`GET /lessons/access`: the Sales
department and the super admin) -- NavArea `sales-pipeline`.

| Stage | Where it comes from |
|---|---|
| New Lead, Contacted, Lost *before a trial* | **stored** on the lead: `trial_prospect.pipeline_stage` (+ `lost_reason`, `last_contacted_at`, `next_follow_up_on`, `follow_up_note`) |
| Trial Booked | **derived**: the latest live trial lesson is still ahead |
| Trial Completed | **derived**: that trial has started and no outcome is recorded yet |
| Converted | **derived**: a trial is `subscribed`, or the lead was handed over (`converted_at`) |
| Lost after a trial | **derived**: the latest trial is `not_subscribed` / `no_show` |

No second lead system: a lead is a `trial_prospect`; derived stages are never copied
(`apps/api/src/sales-pipeline/pipeline-stage.ts`). Booking a trial for a lost lead reopens it.

**Contact (decided 2026-11-21).** A lead may carry the parent's name, phone, WhatsApp number and e-mail in the
confined table `chat.sales_lead_contact` (G-07: no request-role grant, RLS on, read and written only by
`src/sales-pipeline`, enforced by `sales-pipeline-confinement.spec.ts`). It is never written to a parent or
contact table before conversion.
- **Who:** the super admin and the Sales department (manager, member), decided on the server on every call.
  Teachers, Operations, Finance and the Teachers department are refused.
- **Lists** carry only whether a phone / WhatsApp / e-mail is on file. **The detail read** returns the contact and
  is audited (`sales_lead.contact_viewed`). Every change is audited by field name, never value
  (`sales_lead.created | stage_changed | contacted | contact_updated | follow_up_changed | converted`); the rows
  appear in each person's action log. No contact value reaches a log line or an error message.
- **Convert** keys the lead's e-mail and numbers with PD-42's contact key and looks for a family that already holds
  one (for a lead a subscribed trial already made Converted: the family Operations enrolled that trial into).
  Found and the caller may handle it -> the lead is **linked** (no second parent). Before the lead's own copy of the
  contact is deleted, every channel the family record lacks is written into the parent file's EMPTY phone / e-mail
  slot and keyed; a channel with no room (a second phone, a WhatsApp number, another e-mail) **refuses** the
  hand-over and keeps the contact. Not found -> the **existing family intake** opens pre-filled and converting again
  links it (a subscribed trial not yet enrolled answers `awaiting_enrolment`). A family that is not the caller's, or
  an e-mail that belongs to a non-family account, gets the intake's one refusal, naming nothing. Every attempt is
  audited with its outcome code (`sales_lead.converted | convert_attempted | convert_refused`), never a value. The
  database also refuses a `converted_family_id` from another organization.

Open (owner): retention of the contact of a lead that is never converted (no purge is built yet).
