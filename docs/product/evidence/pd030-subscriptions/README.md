# PD-30 evidence: subscriptions, the payment lock, exceptions

Captured 2026-10-26 on a private local stack:
- API :3930 and worker, built from this branch, with `SUBSCRIPTION_LOCK_ENFORCED=true`.
- Admin Web :5930.
- Database `pd30_qa` in `jawwid-pd30-int`.

The academy is the synthetic `seed-org-chat` organization (no real people, G-20). The demo data went in through the real routes. In that data, the Teachers department scheduled past lessons and the teachers reported them, which produced these children:

| Child | Setup | State |
|---|---|---|
| Adam El-Sayed | 3 lessons bought, 5 held | locked (balance), lessons on hold, renewal requested |
| Anas Ragab | 3 months / 24 lessons, 1 held | open, 23 left; next report "2 of 24" |
| Belal Hegazy | 2 bought, 2 held | grace, 2 left |
| Dana Taha | 3-month plan for 24 lessons; first instalment due 3 days ago | locked (overdue); an older balance due before go-live is listed only |
| Farida Ali | 1 bought, 3 held | used up, but the Sales Manager granted an exception, so open |

| File | Shows |
|---|---|
| `01-admin-student-locked-ar.jpg` | Student Profile, Subscription (Arabic): locked because the lessons are used up, lessons on hold ("Suspended — payment"), the ledger, Add subscription |
| `02-admin-student-exception-en.jpg` | Student Profile (English): open by exception, negative balance, the exception granted by the Sales Manager with its reason, Revoke |
| `03-admin-locked-group-banner.jpg` | The locked family group in Admin Web chat. The report cards read "Lesson 3 of 3", "4 of 3", "5 of 3" (grace lessons). The group's "lessons paused" card carries no reason. Staff banner: read-only for the parent and teacher, the child and why; staff can still write |
| `04-admin-family-direct-cards.jpg` | The family's direct chat with the supervisor (never locked): renewal requested, "2 grace lessons left", "1 left", and the lock with its reason and where to pay |
| `05-admin-overdue-before-go-live.jpg` | Instalment Payments, "Overdue before go-live" filter: due before go-live, never locks, followed up by hand |
| `06-admin-renewal-requests.jpg` | Payments → Renewal requests: the parent asked; waiting until a subscription is added |
