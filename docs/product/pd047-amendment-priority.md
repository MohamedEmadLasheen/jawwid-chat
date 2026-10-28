# PD-47 amendment: task priority, colour and the financial tier (plan)

**State:** **revision 2, APPROVED.** On 2026-10-28 the owner confirmed the thresholds and every question in §10, relayed by the department head. No code is written yet. Build order: PR-1b, then PR-2 and PR-2b (§8).
**Claim:** `docs/product/pd-registry/PD-47-amendment-priority.md`. It amends `docs/product/pd047-tasks-plan.md`.
**Slots:**
- PR-1b is `20261029200000`, assigned by the department head and claimed in `docs/product/migration-slots/20261029200000.md`.
- PR-2 (the Phase A sources) is `20261029210000` and PR-2b (the financial sources) is `20261029233000`, both assigned by the department head on 2026-10-28 so that 200000 < 210000 < 233000, each claimed in `docs/product/migration-slots/`. `20261029170000` is released.

**Base:** `main` @ `90b9d2d7`. `mig/` is `supabase/migrations/`.

## What changed in revision 2

The owner answered Q-P1 and Q-P2 and changed the rules on 2026-10-28. Their words, relayed verbatim by the department head:

> "Financial tasks must have the highest priority, especially package expirations, upcoming installment payments, overdue payments, and subscription renewals. These tasks should be clearly prioritized and color-coded based on how urgent they are. I don't want teachers' routine lesson reports turning red immediately after every lesson, because that would make genuinely urgent financial alerts less noticeable. Please design the priority rules so that:
> - 🔴 Red highlights critical financial deadlines, overdue payments, and actions requiring immediate attention.
> - 🟡 Yellow highlights upcoming package expirations, installment due dates, and renewals that need attention soon.
> - 🟢 Green indicates tasks that are not urgent.
>
> Routine lesson reports should remain yellow until their 24-hour deadline passes, then turn red only if overdue. Financial tasks should be prioritized above routine operational tasks when sorting the task list. Please propose clear time thresholds for package expiration and installment reminders before implementing the rules."

Q-P2: "To the minute".

| Change | Where |
|---|---|
| A source rule may **replace** the generic due-date floor. Lesson reports have **no due-soon floor** (Yellow until overdue). | §2 |
| A **category**: financial or operational. Financial sorts first **inside each colour**. | §3, §4 |
| Four **financial sources**, mapped to the systems that own them today, each with a dedupe key and a double-notification check | §5 |
| **Proposed thresholds**, which the owner approves before anything is built | §6 |
| Q-P1 is closed (no Red on creation for routine reports). Q-P2 is closed: **to the minute**. | §10 |

The owner's earlier decisions (2026-10-28) stand:
- a manual High, Medium or Low, set by the creator;
- the effective level is the higher of that choice and the floor;
- the responsible manager and the super admin change it, and every change goes in the history;
- inside a level, soonest due first, then tasks with no due date, oldest first.

---

## 1. Data

- **`chat.work_task.priority`** is `text not null default 'medium'` with `check in ('high', 'medium', 'low')`. It holds the **manual** level only.
- **`chat.work_task.category`** is `text not null default 'operational'` with `check in ('financial', 'operational')`.
  - A system task takes its category from its source (§5).
  - For a manual task, a manager may tick "financial" when creating it (Q-F3).
  - It never changes after creation; the guard keeps it immutable.
- **`chat.work_task.source_floor`** is `text null` with `check in ('high', 'medium')`. A source that is not driven by a date sets it, for example the package balance in §6. It is written by the source's trigger in the same transaction as the change it follows, and recorded as an event (§2.3).
- **The effective level is never stored.** One SQL function computes it at read time: `chat.work_task_effective(priority, floor_rule, due_at, source_floor, state, as_of, zone) → (rank, level, reason, overdue)`.
  - `overdue` is true when the floor rule says the task is past its deadline, whether or not that raised the level. It is what the overdue filter and the Dashboard's overdue tiles count.
  - **Deviation (PR-1b, accepted by the department head 2026-10-28):** there is **no TypeScript mirror**. The clients draw the level the server sends and never compute it, so the SQL function itself is tested on a boundary grid in `apps/api/test/integration/tasks-priority-pd047.spec.ts`.

---

## 2. The floor: per source, to the minute

### 2.1 The rules

Each source names its **floor rule**. Manual tasks use `generic`. The effective level of a pending task is the highest of three things:
- the manual priority;
- the level its rule gives at `as_of`;
- its `source_floor`.

| Rule | High (Red) | Medium (Yellow) | Used by |
|---|---|---|---|
| `generic` | overdue, or due within 24 h | due within 3 days | manual tasks; most operational sources |
| `overdue_only` | overdue only | always, while pending (the routine floor) | routine, high-volume work: §2.2 |
| `instalment` | from the start of the due day (D0, academy day) | from D−7 | upcoming and overdue instalments (§6) |
| `none` | only through `source_floor` | only through `source_floor` | the package balance (§6) |

- A closed task shows its manual level, with no floor.
- `reason` is `manual`, `due_soon`, `overdue` or `source`, whichever raised the level. When two apply, the higher level's reason wins.
- "Due within 24 h" is measured **to the minute** against `due_at` (owner, Q-P2). The academy-day rules (`instalment`) use `schedule.timezone` (`mig/20260905090100_chat_config_defaults.sql:17`, Africa/Cairo), the same "today" as `statusOf` (`apps/api/src/billing/instalment.ts:15-20`).

### 2.2 Routine sources without a due-soon floor

The owner named lesson reports. These have the same shape: routine, one per lesson, and done within a day by the person who taught it. **Recommended for `overdue_only` (Q-F1):**

| Source | Volume | Why routine |
|---|---|---|
| `lesson_report` | one per lesson held (about 2,000 a week) | the owner's example |
| `report_correction` | per correction request | the same teacher fixes the same report |
| `trial_outcome` (attendance part) | one per trial lesson | the teacher's after-lesson step, like a report |
| `makeup_owed` | per teacher-cancelled lesson | handled from the Needs action queue, inside a 7-day window (`lesson.service.ts:423`) |

Every other operational source keeps `generic`: leave, violation, ruling, case, unsupervised family or teacher, set-up, new students, complaints, feedback, schedule change, certificates.

### 2.3 Events

- **`priority_changed`:** a person changed the manual level. It records before and after, and is allowed only for a decider (§9).
- **`source_raised`:** a source moved `source_floor`, for example when the package balance reached 0. The actor is `system`, which #228's event CHECK must allow for this kind (PR-1b extends it).
- Both are written by the history trigger and count as recorded changes for the guard, so the rule that every change is an event holds.
- `task.changed` gains the changes `priority_changed` and `source_raised`.

---

## 3. Sort

On every pending view (`mine`, `team`, `decisions`, `all`):

```
ORDER BY rank DESC,                                 -- red, yellow, green: colour first
         (category = 'financial') DESC,             -- inside a colour, financial first
         (due_at IS NULL), due_at ASC,              -- most overdue first, then soonest
         created_at ASC, id ASC                     -- undated: oldest first; a total order
```

- **Colour stays primary.** A Red operational task (an overdue leave decision) stays above a Yellow financial one (an instalment due next week). That is the department head's reading of "prioritized above routine operational tasks".
- **Alternative for the owner, one line (Q-F2):** financial strictly first, `ORDER BY (category = 'financial') DESC, rank DESC, …`. Then every financial task, Yellow ones included, sits above every operational task, Red included.
- **Stable paging.** The first page fixes `as_of`, and the cursor carries `{ as_of, rank, financial, has_due, due_at, created_at, id }`.
- **Index:** a partial `(organization_id, due_at nulls last, created_at, id)` over pending tasks; the per-assignee pending indexes gain `due_at`. A perf spec covers 20,000 pending tasks.
- **The Closed tab** keeps `closed_at DESC`.
- **Filters:** `?level=`, `?overdue=` and `?category=`, so each Dashboard tile has a list that equals it.

---

## 4. API and interface

- **Every task carries:**
  - `manualPriority`, `effectivePriority`;
  - `priorityReason` (`manual | due_soon | overdue | source`);
  - `category`;
  - `asOf` on the list.
  Clients draw what the server sent and never compute the level.
- **Never colour alone.** The priority chip has three parts:
  - **an icon:** a triangle with "!" for High, a clock for Medium, a down-chevron for Low;
  - **a text label:** High / Medium / Low, in ar: عالية / متوسطة / منخفضة;
  - **a reason**, when the level was raised: "Overdue" / "متأخرة", "Due soon" / "قريبة الموعد", or the source's own words, such as "Balance used up" / "نفد رصيد الحصص".

  The icon is `aria-hidden`, and the chip's accessible name is the full text.
- **The Finance tag** sits beside the chip on every financial task: a banknote icon plus the text "Finance" / "مالية". It is neutral-styled, so it never competes with the level's colour.
- **Contrast, under the gold rule** (only accent-700 may carry text):

  | Level | Light | Dark |
  |---|---|---|
  | High | `danger-700` on `danger-50` | `danger-200` on `danger-950` |
  | Medium | `accent-700` on `accent-50` | neutral `text-strong` on `accent-900`, icon `accent-300` |
  | Low | `success-700` on `success-50` | `success-200` on `success-950` |

  - A contrast spec fails the build below 4.5:1 for text and 3:1 for the icon.
  - The layout is RTL-correct, and icons are not mirrored.
- **Surfaces:**
  - Admin Web Tasks (PR-3): server order, a level and category filter, and the priority control for deciders.
  - The Flutter teacher "To do" (PR-5): read-only chip.
  - The Dashboard: `tasks.*_urgent` (effective High) and `tasks.*_financial` tiles, each equal to its filtered list.

---

## 5. Financial sources: who owns them today

| Owner's term | What it is in the data today | Owned by | Task source | Assignee | Dedupe key (one task, not a daily duplicate) |
|---|---|---|---|---|---|
| **Package expiration** | **No end date exists.** A package is lessons. Balance = included − used, in `chat.compute_learner_access` (`mig/20261026140000_chat_pd030_subscription_lock.sql:421-494`, redefined `mig/20261028110000…:~836-905`). Grace is 2 lessons after 0 (`subscription.grace_lessons`, `:94-101`), then the group locks. **Nothing warns before 0** (`billing/subscription-reads.ts:21,140` only reads `lessonsLeft`). | PD-30 | **new: `package_low`** | the family's Sales owner (`chat.family_sales_owner`, PD-42), else the Sales manager (Q-F4) | `package_low:<learnerId>:<id of the learner's newest chat.learner_subscription row>`. A new purchase adds a row, which completes the open task; the next depletion makes a new key |
| **Upcoming instalment** | `chat.family_instalment` (`mig/20261021150000…:149`). Status: `due` on the due day, `overdue` after (`billing/instalment.ts:15-20`). | PD-17 / PD-27 | **new: `instalment`** (replaces plan §3.6's `instalment_overdue`) | `responsibleSupervisor`: the child's PD-8 supervisor, or the family's billing supervisor (`billing/billing.service.ts:203-218`); else the Operations manager | `instalment:<instalmentId>`. **One task carries the instalment from D−7 through overdue**: it goes Yellow, then Red, and is completed by its payment |
| **Overdue payment** | the same instalment past its due day. PD-30 locks the child's group from D+1 (`mig/20261026140000…:472-489`). | PD-27 / PD-30 | the **same `instalment` task**, Red with reason `overdue` | as above | as above. No second task |
| **Subscription renewal** | `chat.renewal_request`: a parent taps "Request renewal" from the locked banner (`subscriptions/subscription-effects.service.ts:204-238`), at most once a day per child (`mig/20261026140000…:811`). **There is no recurring billing**: Stripe is one-off Checkout (`billing/stripe.gateway.ts:94`), with no `invoice.payment_failed`. | PD-30 | **new: `renewal_request`** (plan §3.6, now financial) | the family's Sales owner, else the Sales manager | `renewal_request:<learnerId>:<id of the newest learner_subscription row>`, so repeat taps on later days join the same task (a history comment) |
| (related) **Receipt to review** | `chat.payment_receipt.status = 'pending'` (`mig/20261022170000_chat_pd027_payments.sql:206`). There is **no staff alert today** (`billing/parent-payments.service.ts:66-120`). | PD-27 | **new: `receipt_review`**, financial | the family's responsible billing supervisor, else the Operations manager | `receipt_review:<receiptId>` |
| (related) **Failed card payment** | the Checkout `async_payment_failed` webhook marks it failed and tells nobody (`billing/checkout.service.ts:159-174`) | PD-27 | **new, optional: `checkout_failed`** (Q-F5) | as for the instalment | `checkout_failed:<checkoutId>` |

### No double notification

Today's alerts, from `communication/notifications/notification-catalog.ts:57-88`:

| Today | Recipients | With PD-47 |
|---|---|---|
| `payment_d7/d3/d0/p3/p7` | **parents only** | unchanged. The `instalment` task is the first staff signal, so nothing is doubled. |
| `subscription_grace`, `subscription_locked`, `subscription_unlocked` | parents and the **child's supervisor** (`subscription-effects.service.ts:379-405`) | unchanged. The `package_low` task goes to the **Sales owner**, not the supervisor. Its PD-34 notification fires once, when it is assigned, and never per grace step. |
| `subscription_renewal_requested` | **every Sales member** (`subscription-effects.service.ts:407-423`) | **replaced** by the task's assignment notification to the one owner (Q-F6). Keeping both would push the owner twice and everyone else needlessly. |
| receipts, failed checkouts, low balance | nobody on the staff side | the new tasks are the first staff signal |

---

## 6. THRESHOLDS: CONFIRMED by the owner 2026-10-28 ("Approve as proposed")

| Task | 🟡 Yellow | 🔴 Red | Completed when | Why these numbers |
|---|---|---|---|---|
| **Package expiration** (`package_low`) | created when the balance is **2 lessons or fewer** | when the balance reaches **0**, the moment PD-30's grace begins (`source_floor` → high) | the balance rises above 2 (a new package or an exception) | 2 lessons is about one week at the common 2-a-week plans, enough time to sell a renewal. 0 is when PD-30 starts the 2-lesson grace (`subscription.grace_lessons` = 2), after which the group locks. |
| **Upcoming instalment** (`instalment`) | from **D−7** (the instalment's due day minus 7, 00:00 academy time) | from **D0**, the due day itself | a payment settles it, or it is voided (voided means acknowledged, plan Q4) | D−7 is when parents get their first reminder (`payment_d7`, `mig/20260905093100…:114`), so staff see it the same day. D0 is the parents' "high" reminder (`payment_d0`), and PD-30 locks from D+1, so the due day is the last day to act. |
| **Overdue payment** | — | **immediately** (from D+1, academy day) | as above | overdue status starts at D+1 (`instalment.ts:17`), the same moment the group locks (`mig/20261026140000…:472-489`) |
| **Subscription renewal** (`renewal_request`) | — | **immediately on request**: a request only exists while the child is locked | a new package lifts the lock | the child cannot attend until it is handled |
| **Receipt to review** | on upload | **48 h** after upload | approved or rejected | the parent has paid and is waiting, and reminders do not pause for a pending receipt (`parent-payments.service.ts:66-120`) |
| **Failed card payment** (optional) | — | immediately | a later payment settles the instalment | money expected and not received |

One table rule: **the instalment and package floors replace the generic 24 h / 3-day floor** for these sources. A manager can still raise any task by hand.

---

## 7. Everything else, kept from revision 1

- the manual level and who may change it (§9);
- the `priority_changed` history event;
- the level computed at read time with `as_of`;
- never colour alone;
- ar and en, RTL;
- 4.5:1 contrast;
- Dashboard tiles equal to their lists.

---

## 8. Delivery

| PR | Content | Slot |
|---|---|---|
| **PR-1b** | `priority`, `category`, `source_floor`; `chat.work_task_effective` with the four floor rules; `priority_changed` and `source_raised` in the guard and the history trigger; indexes; the sort plus the `as_of` keyset; filters; `POST tasks/:id/priority`; create takes `priority` and `category`; DTO fields; the urgent and financial Dashboard tiles; specs | **`20261029200000`** (assigned) |
| PR-2 | the Phase A sources, with their floor rule (`lesson_report` and `report_correction` are `overdue_only`) | `20261029210000` |
| **PR-2b** | **the financial sources** (owner Q-F5: `checkout_failed` included) (`instalment`, `package_low`, `renewal_request`, `receipt_review`, and `checkout_failed` if Q-F5 says yes). Their completion triggers on `chat.family_instalment`, the payment ledger, `chat.learner_subscription`, `chat.renewal_request` and `chat.payment_receipt`, and `notifySales` replaced (Q-F6). Moved **ahead** of the other Phase B sources, because the owner named finance first. | **`20261029233000`** (assigned) |
| PR-3 / PR-5 | the chip, the Finance tag, the tokens | none |

**Order:** #228 → PR-1b → PR-2 → PR-2b → the rest of Phase B.

---

## 9. Who may change the level

- **The responsible manager** (the line manager, or the creating manager per plan §3.7) **and the super admin**: the same people as for the due date.
- **Not** the assignee, a teacher's supervisor or another organization.
- `source_floor` is the source's alone. A person can raise a task above it, never below it.

---

## 10. Owner decisions

**DECIDED 2026-10-28.** The owner answered every question below, relayed by the department head. Q-F7: "Approve as proposed". Q-F2: "Colour first, finance first within". Q-F1: all three confirmed. Q-F3 to Q-F6: "Family's Sales owner", which also covers replacing the push to every Sales member, Finance on manual tasks, and a task for a failed card payment. Each recommendation is therefore the decision.

| # | Question | Decision |
|---|---|---|
| Q-P1 | Lesson reports Red from creation? | **CLOSED** by the owner: Yellow until overdue (`overdue_only`). |
| Q-P2 | Minutes or calendar days? | **CLOSED** by the owner: to the minute. |
| **Q-F1** (CONFIRMED 2026-10-28) | Which other routine sources get `overdue_only`? | **`report_correction`, `trial_outcome` attendance and `makeup_owed`** (§2.2). All are routine and high-volume, and none should drown out finance. |
| **Q-F2** (CONFIRMED 2026-10-28) | Colour first with finance second inside each colour, or finance strictly first? | **Colour first, finance second inside each colour.** An overdue operational task is still more urgent than an instalment due next week. |
| **Q-F3** (CONFIRMED 2026-10-28) | May a manager tick "financial" on a manual task? | **Yes.** It is a sort tier and a tag only, so it adds no permission and no risk. |
| **Q-F4** (CONFIRMED 2026-10-28) | Who owns a package that is running out: Sales (sells the renewal) or the child's supervisor (already gets the PD-30 grace push)? | **The family's Sales owner, else the Sales manager.** Renewing is a sale, and the supervisor keeps today's pushes. |
| **Q-F5** (CONFIRMED 2026-10-28) | Add a task when a card payment fails? | **Yes, Red.** Today nobody is told (`checkout.service.ts:159-174`). |
| **Q-F6** (CONFIRMED 2026-10-28) | Replace the "renewal requested" push to every Sales member with the task's notification to the family's Sales owner? | **Yes.** One accountable person, and no double push. |
| **Q-F7** (CONFIRMED 2026-10-28) | Approve the thresholds in §6 (2 lessons / 0 lessons; D−7 / D0 / D+1; 48 h for receipts)? | **Approve as proposed.** Each one sits on a timing PD-27 or PD-30 already uses. |
