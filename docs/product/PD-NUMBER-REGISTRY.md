# Product decision numbers and migration slots — the registry

Several sessions build in parallel. On 2026-10-22 two pairs of them claimed
the same decision number (PD-23 twice, PD-24 twice) and two branches shipped
migrations with the same timestamp. This file is the one place a number is
claimed. The decision text itself still lives in
[`JAWUID-CHAT-PRODUCT-BOUNDARY.md`](JAWUID-CHAT-PRODUCT-BOUNDARY.md) §4.

## Rules

1. **Claim before you write.** Add a row here (in its own small PR, or in a
   message to the department-head session, which lands it) before any code,
   doc or migration names the number. A number that is not in this table is
   not yours.
2. **Amendments keep the parent number.** A follow-up to an open or closed
   decision is "PD-N amendment", not a new number.
3. **Migration timestamps are unique and sort last at merge time.** Before
   merging, rename your migration so its timestamp is later than the newest
   file in `supabase/migrations/` on `main`, and differs from every other
   open branch in the table below. `scripts/db/apply.sh` keys the ledger on
   the whole filename, so a duplicate timestamp does not fail — it silently
   orders by the suffix instead. Do not rely on that.
4. **One merge at a time.** Merge `origin/main` into your branch, re-run the
   gates, then merge. If `main` moved while CI ran, repeat. The merge order
   below is the queue.

## Numbers

| PD | Subject | Branch | State |
|----|---------|--------|-------|
| PD-1 … PD-21 | see the boundary doc §4 | — | CLOSED, on `main` |
| PD-22 | Every account has its own time zone | `claude/multi-timezone-accounts-afdfa6` | MERGED #109 |
| PD-22 amendment | Warn families before a clock change (DST) | `claude/pd22-dst-warning` | MERGED #115 |
| PD-23 | Convenient login: session policy, devices, app lock, keep me signed in | `claude/biometric-convenient-auth-4049fd` | MERGED #111 |
| PD-24 | Change a family's supervisor without losing anything | `claude/supervisor-transfer` | MERGED #107 |
| PD-25 | Parent self-recovery (reset code, forgot email) | `claude/parent-account-recovery-6cd585` | MERGED #112 |
| PD-26 | The Teacher Supervision page (leaves, absences, lateness, grants, complaints) | `claude/admin-teacher-management-41f08a` | MERGED #108 (renumbered from "PD-24") |
| PD-27 | Payments: Stripe payment links, bank-transfer receipts, cash, invoices, instalment reminders | `claude/payment-subscription-system-c58769` | MERGED #117 |
| PD-28 | Teacher web: the Flutter app built for the browser, for teachers | `claude/pd28-teacher-web-fbd19a` | MERGED #120 |
| PD-29 | Materials: open library by subject and age, practice this week from the lesson report, memorization progress map | `claude/pd29-materials-ef11b4`, `claude/pd29-materials-clients` | MERGED #121 + #122 |
| PD-30 | Subscriptions, lesson balance and payment-based group lock | `claude/pd30-api`, `claude/pd30-subscription-lock-f3e070` | PR #126 + #127 |
| PD-31 | Scheduling: trial time slots, reschedule redesign, a parent's child schedule, change teacher | `claude/pd31-scheduling-*` | in progress |
| PD-32 | Parent feedback about the teacher (amends PD-26), Starred in Chats, New Students redesign, sign-up code without time expiry (amends PD-16), Trial labels | `claude/pd32-feedback-ui-*` | in progress |
| PD-33 | Hand over to backup: a temporary cover with automatic return (built on PD-8 backup links) | `claude/pd33-backup-handover-3bb0f2` | in progress |
| PD-34 | Notifications: one pipeline, the per-account Notification Center, preferences and quiet hours (P1 of P1–P5) | `claude/pd34-notifications-c31e79` | P1 API in review |
| PD-35 | Teacher supervisors: the visible seat (join/leave by choice), teacher assignment and scope, report corrections, evaluations, escalation | `claude/pd35-teacher-supervisors-8efcc6` | in progress |
| PD-36 | @mentions that summon a non-member in charge (admin, manager, super admin) to step in; parents' @supervisor / @admin; never widens authorization; joins through PD-35's seat primitive | `claude/pd36-mentions-b0f99d` | in progress |
| PD-37 | Chat parity with WhatsApp/Messenger: read receipts (author-only ticks + Message info), typing, presence; first PR closes RT-012 (receipt roster leak) | `claude/pd37-chat-parity-*` | in progress |
| PD-38 | Scheduling calendar: academy and teacher views, shifts by category, supervisor colors, filters, capacity statistics | `claude/pd38-schedule-calendar-b9fe8f`, `claude/pd38-admin-web` | P1: PR #139 (API) + #142 (Admin Web) |
| PD-39 | next free number | — | — |

## Migration slots claimed on 2026-10-22

| Slot | Owner |
|------|--------|
| `20261022130000` | PD-22 — `chat_pd022_account_time_zone` |
| `20261022140000` | PD-23 — `chat_pd023_session_policy` (renamed from `130000`; merged after 150000 by an accepted exception: no shared tables) |
| `20261022150000` | PD-26 — `chat_pd026_teacher_supervision` (renamed from `pd024`) |
| `20261022160000` | PD-25 — `chat_pd025_parent_self_recovery` |
| `20261022163000` | PD-22 amendment — `chat_pd022_clock_shift_warning` |
| `20261022170000` | PD-27 — `chat_pd027_payments` |
| `20261022180000` | PD-29 — `chat_pd029_materials` |

## Migration slots claimed on 2026-10-26

| Slot | Owner |
|------|--------|
| `20261026110000` | PD-31 — scheduling |
| `20261026120000` | PD-32 — parent feedback, sign-up code expiry |
| `20261026130000` | PD-33 — `chat_pd033_supervisor_cover` |
| `20261026140000` | PD-30 — `chat_pd030_subscription_lock` (moved from `100000`: it rebuilds PD-31's lesson-outcome constraint, so it runs after 110000) |
| `20261026160000` | PD-35 — `chat_pd035_conversation_seat` (PR #131) |
| `20261026160003` | PD-35 — `chat_pd035_seat_security_fixes` (security-review fixes for #131, fixed forward; PR #143) |
| `20261026160004` | PD-35 — `chat_pd035_teacher_supervisor` (PR #136; renumbered from 160001 to sort after 160003) |
| `20261026160005` | PD-35 — `chat_pd035_reports_evaluations` (PR #138; renumbered from 160002) |
| `20261026170000` | PD-36 — `chat_pd036_mentions` (sub-slots `170001…` if needed; slot map fixed by the department head 2026-10-26) |
| `20261026180000` | PD-37 — chat read cursors / presence (P1a; sub-slots `180001…`). The RT-012 fix PR has no migration. |
| `20261026190000` | PD-34 — `chat_pd034_notifications` (P1; later P1 PRs take `190001`, `190002`…) |
| `20261026190001` | PD-34 amendment — `chat_pd034_chat_push_policy` (owner 2026-10-27: chat quiet hours + cap with summary) |

The slot map is fixed by the department head (2026-10-26): 180000 PD-37, 190000 PD-34, 200000 the PD-29 amendment.
| `20261026200000` | PD-29 amendment — `chat_pd029_material_opens` |
| `20261026210000` | PD-38 — `chat_pd038_schedule_calendar` |

The next free slot is `20261026220000` (fixed slot map: 130000 PD-33, 140000 PD-30, 160000 PD-35, 170000 PD-36, 180000 PD-37, 190000 PD-34, 200000 PD-29 amendment, 210000 PD-38).
