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
| PD-27 | Payments: Stripe payment links, bank-transfer receipts, cash, invoices, instalment reminders | `claude/payment-subscription-system-c58769` | PR #117 |
| PD-28 | next free number | — | — |

## Migration slots claimed on 2026-10-22

| Slot | Owner |
|------|--------|
| `20261022130000` | PD-22 — `chat_pd022_account_time_zone` |
| `20261022140000` | PD-23 — `chat_pd023_session_policy` (renamed from `130000`; merged after 150000 by an accepted exception: no shared tables) |
| `20261022150000` | PD-26 — `chat_pd026_teacher_supervision` (renamed from `pd024`) |
| `20261022160000` | PD-25 — `chat_pd025_parent_self_recovery` |
| `20261022163000` | PD-22 amendment — `chat_pd022_clock_shift_warning` |
| `20261022170000` | PD-27 — `chat_pd027_payments` |

The next free slot is `20261022180000`.
