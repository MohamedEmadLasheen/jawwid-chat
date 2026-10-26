# PD-30: Subscriptions, lesson balance, the payment lock and its exceptions

Record: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-30.
Migration: `supabase/migrations/20261026100000_chat_pd030_subscription_lock.sql`.
Code: `apps/api/src/platform/subscription-lock.ts` (enforcement reader),
`apps/api/src/platform/subscription-policy.ts` (who grants exceptions),
`apps/api/src/billing/subscription-ledger.service.ts` + `subscription-reads.ts` (ledger, balance,
Lesson N of M), `apps/api/src/subscriptions` (cards, pushes, lesson holds, renewal requests; the
worker sweep).

## The pieces

| Thing | Table | What it is |
|---|---|---|
| Subscription | `chat.learner_subscription` | One per child per purchase: plan months, lessons included, start day, where it came from (`payment_request`, `instalment_plan`, `staff`, `backfill`). Append-only; voided with a reason. |
| Exception | `chat.subscription_exception` | Lets one child go on past the balance (`balance`), an overdue instalment (`overdue`) or both, until a day at most 90 days ahead. Revoked once. |
| State | `chat.learner_access` | The child's state now: `open`, `grace` or `locked`, the reasons, the balance, the grace lessons left, the overdue instalment, and `held` (lessons on hold). |
| Event | `chat.learner_access_event` | Every change of state, in order; `applied_at` once its cards went out. |
| Renewal request | `chat.renewal_request` | A parent's "please renew", once per child per academy day. |

**The state is the database's.** `chat.refresh_learner_access(learner)` computes it and is called by
triggers on every write that can change it: a lesson's outcome, a ledger row, an exception, an
instalment, a payment request (paid / unpaid). The worker sweep (every minute) calls it for every child,
because an instalment becomes overdue by the calendar.

## How a child's lessons are counted

- **Used** = the child's `regular` and `makeup` lessons with outcome `held` or `student_no_show`,
  starting on or after the first standing subscription's start day (academy zone, `schedule.timezone`).
- **Balance** = all standing subscriptions' lessons − used. Grace lessons come out of the next one.
- **Grace**: at balance 0 two more lessons may happen ("2 left", then "1 left"); at −2 the child is locked.
  `subscription.grace_lessons` in `chat.config` (default 2).
- **Overdue**: an instalment of the family, or of this child, unpaid (`paid_on` null — paid in part is
  still unpaid), not voided, due before today and **on or after `subscription.overdue_from`**
  — go-live: the academy day enforcement was FIRST switched on (recorded once by the worker, see
  *Switch*). Unset until then, and then no instalment locks.

## The one question: `chat.learner_lesson_lock(learner)`

`chat.learner_lesson_lock(p_learner uuid) returns text`: NULL when the child is open (grace included);
`'balance'` or `'overdue'` when locked, `'overdue'` winning when both apply; an active exception covering a
reason has already removed it. SECURITY DEFINER, fixed `search_path`, EXECUTE granted to `chat_app`.
It is computed NOW from the inputs (`chat.compute_learner_access`) — an instalment that fell overdue at
midnight or an exception that ran out counts at once, and a stale or missing `chat.learner_access` row
never opens a group the inputs lock (fail closed). The stored row is what the worker announces and holds
from. It answers the STATE, whatever `SUBSCRIPTION_LOCK_ENFORCED` says; callers apply the switch. Every PD-30
check goes through it (`SubscriptionLockReader.lockOf` / `isLocked`: canSend, calls, reactions, booking,
the hold that stops the materializer), and other features ask it too (PD-31's moves and bookings, via
`SchedulingService.lockOf()`).

## What "locked" does (when `SUBSCRIPTION_LOCK_ENFORCED=true`)

| | Parent | Teacher | Staff (supervisor, managers, super admin) |
|---|---|---|---|
| Message, edit, reaction, pin, forward into, delete for everyone, upload, in the child's family / student group | 403 `COMM.SUBSCRIPTION_LOCKED` | 403 | allowed |
| Call in that group (`call-capability` says `canCall: false`) | refused | refused | allowed |
| The family's direct chat with the supervisor | never locked | — | — |
| Book a lesson / make-up for the child | refused | refused | refused (grant an exception instead) |
| Banner (`GET /conversations/:id` → `paymentLock`) | child + reason + `canPay` | child only ("lessons paused") | child + reason, `readOnly: false` |

A family group with several children locks when any one of them is locked; lessons stay per child. A
family group with no `conversation_learner` rows (legacy) is taken to be about every child of its family.

**Holds.** On the next sweep after a lock, the child's **regular** lessons that have not started become
`suspended` with `outcome_by_kind = 'system'` and note `subscription` — owed to no one (payroll pays
only `held` / `student_no_show`), out of every statistic, reminders cancelled — and the materializer
creates none (`chat.learner_suspended_on` asks `chat.learner_access.held`; its only caller is the
materializer, which looks only forward, so the "any day" answer for a held child changes nothing past).
Staff and the family read "Suspended — payment" (`suspendedFor: 'payment'`); a TEACHER reads only
"suspended" (no `suspendedFor`, no note) — nothing financial reaches a teacher. On unlock the next sweep clears `held` and
materializes: a suspended row does not hold its slot, so each regular time gets exactly one lesson again,
and the Schedule hides the held copy (in the query, before the row limit). Make-ups already booked are
not held.

**Not owed, not counted** — where that is decided: PD-18 payroll pays only
`PAID_OUTCOMES = ['held', 'student_no_show']` (`apps/api/src/teacher-file/teacher-payroll.service.ts`),
and PD-15's month leaves `suspended` out of `totalScheduled`
(`monthSummary`, `apps/api/src/lessons/stats.service.ts`). `pd030-subscription-lock-http.spec.ts`
("holds: …") asserts both: the teacher's `totalScheduled` drops by exactly the held lessons and returns
when they are re-materialized, and `PAID_OUTCOMES` excludes `suspended`.

**Lock order.** A child's `chat.learner_access` row first, then its lesson rows — everywhere: the hold
takes the access row and then suspends lessons, and an outcome written on a lesson takes the access row
in a BEFORE trigger (`chat.pd030_lesson_locks_access_first`), before the lesson's own row lock. The
state row is written only when the computed state differs.

**Switch.** `SUBSCRIPTION_LOCK_ENFORCED` (API and worker; `true` / `1` / `yes` / `on`, any case; both
processes log the effective value at boot). On in staging, off in production until the owner sets the
GitHub variable `SUBSCRIPTION_LOCK_ENFORCED=true` for the `production` environment and redeploys. With it
off the ledger, the balance, the state and both screens work; nothing is refused, held or announced, and
any holds are released on the next sweep.

**Switching it on.** The first worker pass that sees it on records, once (whoever wins the insert),
`subscription.enforced_since` and go-live `subscription.overdue_from` = that academy day; marks the
changes recorded while it was off as applied; and tells every family whose child is ALREADY in grace or
locked — the same cards and pushes a change sends (the group: "paused"; the family's chat with its
supervisor: why; a push to the parents and the supervisor). It then writes `subscription.announced_at`,
and holds begin on the NEXT pass, never before the announcements.

## Who may do what

| | Super admin | Operations Manager | Sales Manager | Ops supervisor (in reach) / Sales member | Teacher | Parent |
|---|---|---|---|---|---|---|
| Read a child's ledger, state, exceptions | ✓ | ✓ | ✓ | ✓ | — | own children's standing via `/me/billing` (no exceptions) |
| Add a subscription with no payment (free lessons: a reason, start from a week ago to a month ahead) | ✓ | ✓ | ✓ | **no** | — | — |
| Void a subscription (`canRecord`) | ✓ | ✓ | ✓ | ✓ | — | — |
| Grant / revoke an exception | ✓ | ✓ | ✓ | **no** (403 `COMM.SUBSCRIPTION_DENIED`) | — | — |
| Ask to renew | — | — | — | — | — | ✓ (once a day per child) |

The database enforces the three roles too (`chat.can_grant_subscription_exception`, in the guards of
`chat.subscription_exception` — grant AND revoke — and of `chat.learner_subscription` for `source =
'staff'`): a direct SQL write by anyone else is refused. Lessons a payment bought (a paid link, an
instalment plan) stay with the payment recorders. A paid request credits its lessons only on the
TRANSITION to paid (or when Assign names its child); a voided credit never comes back on a later update.

Audit actions: `subscription.added`, `subscription.voided`, `subscription_exception.granted`,
`subscription_exception.revoked`, `subscription.renewal_requested`, `subscription.lessons_held`,
`subscription.lessons_released`.

## What people are told

| Change | Family's direct chat (parent + supervisor) | Child's group (incl. teacher) | Push to the parents |
|---|---|---|---|
| → grace (2, then 1 left) | `subscription_grace` | — | `subscription_grace` |
| → locked | `subscription_locked` (why, where to pay) | `lessons_paused` (no reason) | `subscription_locked` |
| locked → open / grace | — | `subscription_unlocked` | `subscription_unlocked` |
| renewal requested | `subscription_renewal_requested` | — | (Sales department: `subscription_renewal_requested`) |

Exactly once per change: `SubscriptionEffects.applyEvents` claims each event `FOR UPDATE SKIP LOCKED`,
posts its cards in the same transaction and marks it applied; pushes go out after it commits.

## Routes

```
GET  /learners/:id/subscription                 billing readers in scope
POST /learners/:id/subscriptions                { lessonsIncluded, reason, planMonths?, startsOn? }   the three roles
POST /subscriptions/:id/void                    { reason }                                            canRecord
POST /learners/:id/subscription-exceptions      { kind: balance|overdue|both, reason, validUntil }    the three roles
POST /subscription-exceptions/:id/revoke        { reason }                                            the three roles
GET  /subscriptions/renewal-requests            billing readers in scope (30 days)
POST /me/subscriptions/:learnerId/renewal-request   a parent of the child (409 the second time a day)
GET  /instalments?beforeGoLive=true             overdue instalments due before go-live (never locking)
```

Changed: `POST /families/:id/payment-requests` (and a trial's) accept `lessonsIncluded` (1–1000, only
for `subscription` / `renewal`); `POST /families/:id/instalments` accepts `lessonsIncluded` with
`learnerId` (+ `planMonths?`, `startsOn?` = the first due date) and credits the child at creation;
`GET /me/billing` gains `subscriptions[]`; `GET /lessons/:id` and lesson tickets gain
`suggestedLessonTotal` beside `suggestedLessonNumber`; a lesson report keeps `lessonTotal`.

```ts
interface ChildSubscription {            // GET /me/billing -> subscriptions[]
  child: { id: string; name: string };
  current: { id: string; planMonths: 1|3|6|12|null; lessonsIncluded: number; startsOn: string } | null;
  lessonsIncluded: number | null;        // every standing subscription together
  lessonsUsed: number | null;
  lessonsLeft: number | null;            // never below 0
  graceLeft: number | null;              // set once the balance ran out
  state: 'open' | 'grace' | 'locked';
  lockReasons: Array<'balance' | 'overdue'>;
  overdue: { instalmentId: string; label: string; dueDate: string } | null;
  hasOpenPayment: boolean;               // false -> offer "Request renewal" instead of Pay
  renewalRequestedToday: boolean;
}
// Staff (GET /learners/:id/subscription -> standing) also get: balance (signed), excepted[], held.

interface PaymentLock {                  // GET /conversations/:id -> paymentLock (null when not locked or enforcement off)
  readOnly: boolean;                     // the viewer's: staff false
  canPay: boolean;                       // a parent
  children: Array<{ id: string; name: string;
    reasons?: Array<'balance'|'overdue'>; overdue?: { label: string; dueDate: string } | null }>; // reasons: not for a teacher
}
```

## Operations

- **See why a child is locked:** Student Profile → Subscription, or
  `select * from chat.learner_access where learner_id = '…'`.
- **Recompute now:** `select chat.refresh_learner_access('…')` (the worker does it each minute).
- **Move go-live:** `update chat.config set value = '"YYYY-MM-DD"' where key = 'subscription.overdue_from'`
  (it is written once, the first time enforcement is seen on).
- **Turn enforcement on in production:** set the `production` environment variable
  `SUBSCRIPTION_LOCK_ENFORCED=true` and redeploy; the next sweep holds the locked children's lessons.
