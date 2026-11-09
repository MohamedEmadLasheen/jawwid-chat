# Account deletion in the store builds: App Review notes

Store readiness 2026-11-03, blocker 4 (App Store 5.1.1(v); Google Play account deletion).
Owner decision **O-3 (2026-11-07):** "the teacher requests deletion in the app; staff close the
lessons and payroll; the account is deleted within 30 days."

## 1. What the app does

- **A parent, or a teacher with nothing open:** Settings → Delete account → password → deleted at
  once. Every session ends.
- **A teacher with a future lesson, an assigned student or open payroll:** the same screen offers
  "Request account deletion". After the password and a confirmation that shows the date, the
  screen shows "Requested on X; your account will be deleted by Y", with "Cancel request". Staff
  get a task and reminders at day 21 and day 28. If the request is still open at day 30, the
  server deletes the account itself (`chat.complete_account_deletion_request`, run by the worker).
- **On the web**, without the app: the deletion page (`/account-deletion`) does the same with the
  sign-in name and password.
- **Never "contact the academy":** the code `AUTH.TEACHER_DELETION_BLOCKED` is retired.

Retention is unchanged (Privacy Policy §10.3; erasure migration `20261102210000`). Payments,
invoices, receipts, payroll rows and the audit log are kept, attributed to "Deleted user".

## 2. App Store Connect: App Review Information → Notes (paste, one line)

> Account deletion (5.1.1(v)): Settings → Delete account. Parents, and teachers with nothing open,
> are deleted immediately; a teacher who still has lessons or payroll open requests deletion in the
> same screen, sees the date, and the account is deleted automatically within 30 days.

## 3. Before submission (owner)

- The teacher demo account should have a lesson ahead, so the reviewer can see the request flow;
  the parent demo account shows immediate deletion. The review cohort's teacher always has one:
  its child is assigned to it and has weekly lessons.
- Deleting a demo account deletes it for good, and the demo teacher is **not** exempt from the
  30-day deadline: App Review checks that promise, so it holds for this account as for any other.
- **Repair is re-running the review cohort command** (`apps/api/src/cli/review-cohort.ts`) with the
  same `--email-domain` and password files:
  - a deleted parent account is created again and given back its seats in the family's chats;
  - a deleted teacher account (erased by staff or at its deadline) is created again, and the child
    is moved to it, as the Teachers manager moves a learner (`chat.transfer_learner`). The family
    group seat and the lessons ahead follow, and the weekly times are set again;
  - while a teacher's request is only pending, the account still signs in and nothing needs
    repair. The reviewer can cancel it from the same screen.
- No spare account is needed: re-run the command after a demo account is deleted, and before the
  next submission.
