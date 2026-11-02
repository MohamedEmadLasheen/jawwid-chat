# PD-52 — the teacher-records pages

Record: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-52. Plan: `docs/product/pd052-teacher-records-pages-plan.md`.

Two Admin Portal pages replace PD-26's Teacher Supervision page:

- **Attendance & complaints** (`/teacher-attendance`, super admin `/admin/teacher-attendance`): leave, lateness, excuses & absences, and complaints. Parents' suggestions sit behind the "Suggestions" view on Complaints.
- **Grants & testimonials** (`/teacher-grants`, super admin `/admin/teacher-grants`): grants (PD-11 bonuses), plus testimonials. Testimonials are the parents' praise, read in place from `chat.parent_feedback`, and the staff's own testimonials.

Choosing a teacher (`&teacher=`) shows that teacher's strip on either page: leave, the ladder, open complaints, and this year's grants and testimonials. Old `/teachers/supervision?section=…` links redirect to the matching section (`TeacherSupervisionPage.tsx`, `supervisionRedirect`).

## Who sees what

| Basis | Teachers | Rows | Rights |
|---|---|---|---|
| Super admin | all | all | all, with amounts |
| Teachers department | PD-35 scope | all of those teachers' rows | view, record, decide; the Teacher File; the leave balance |
| Operations | teachers of their families, plus the 30-day window (PD-26 amendment) | their own families' child rows only | view, record, decide; no balance, no Teacher File, no amounts |
| Sales | teachers of trials they read in the last 30 days, and current teachers of the families they own (PD-42) | rows about those trials and families; teacher-level rows hidden | view and record; never decide |

An out-of-scope teacher or row answers 404. The page offers only what `GET /teacher-records/access` returns; the client never guesses.

## Keys (PD-40)

| Key | Grants |
|---|---|
| `teacher_attendance.view` / `.record` / `.decide` | page A: see, record, decide |
| `teacher_grants.view` / `.record` | page B: see; record a grant without an amount or a testimonial, correct a testimonial, reply to or share praise |

Every route still accepts the old `teacher_supervision.view` / `.record` (`@Requires` is any-of). The old keys are removed in a later PR, after a release, once no role holds them:

```sql
select r.key, p.permission_key
  from chat.access_role_permission p join chat.access_role r on r.id = p.role_id
 where p.permission_key like 'teacher_supervision.%';
```

`/dashboard/teachers` still requires `teacher_supervision.view` (the dashboard's), so it moves with that PR.

## Routes added by PD-52

| Method | Path | Notes |
|---|---|---|
| GET | `/teacher-records/access` | the basis and the actions offered; a parent, a teacher or a stranger gets "nothing" (200) |
| GET | `/teacher-records/testimonials?teacher=&month=&voided=include` | praise ∪ staff testimonials, narrowed; each staff item carries `canCorrect`, each praise item `sharedAt` |
| POST | `/teachers/:id/testimonials` | `{ body, source, learnerId?, familyId?, prospectId? }` |
| POST | `/teacher-records/entries/:id/void` | `{ reason }`, once per complaint or testimonial; never a parent's own complaint or a resolved one |
| GET | `/teacher-records/teachers/:id/summary` | the strip; a section outside the caller's keys is `null`, never 0 |
| POST | `/teacher-records/praise/:id/share` | PR-8: a card in the teacher's supervision chat, once (409 after) |

## Database rules

- `chat.teacher_supervision_entry` gains `testimonial` and `entry_void` kinds, plus the student, family and trial links. The table is append-only. A void hides its target, which is never deleted.
- **Guards:**
  - a linked student belongs to the family, and the teacher teaches or taught them (a lesson that has started);
  - a void is once per target;
  - a testimonial is corrected only by the department that recorded it, the Operations Manager or the super admin (`chat.may_void_testimonial`).
- **Sales writes** go through `chat.may_record_teacher_row`. `chat.may_supervise_teacher` is not widened, so Sales never decides.

## Notifications (PD-34)

- `teacher_complaint_received` (push) and `teacher_praise_received` (push, low).
- Both go to the teacher's owner and the student's supervisors, and open the matching page.
- The teacher is never notified of a complaint or praise. Staff share praise deliberately (PR-8).

## Sharing praise with the teacher (PR-8)

- **Who:** staff with `teacher_grants.record` who can see the praise.
- **What the teacher gets:** a `teacher_praise_shared` card in their supervision chat. The card holds the child's first name and the parent's words, cut to 500 characters, never the parent's name.
- **The app:** it renders the server's plain text; there is no app change.
- **Publishing** praise anywhere public (the teacher's profile, Stories) needs the parent's consent. It is not built (plan §11 e).

## The app (PR-7)

The parent's "Feedback about the teacher" card on the child's profile has two shortcuts, "Praise the teacher" and "Report a problem". Each opens the form with that category already chosen.
