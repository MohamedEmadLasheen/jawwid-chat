# PD-30 amendment plan: the group chat stays open; only new lesson bookings pause (R-3)

**Owner decision, 2026-11-06.** When a family runs out of lessons or has an overdue instalment,
the parent–teacher group chat stays fully accessible. Only new lesson bookings pause.

**Status (2026-11-06):** D-1 and D-2 approved by the owner ("Approve D-1 and D-2"). The API part
(PRs 1 and 2 below, without the D-3 texts) is in branch `claude/pd030-chat-stays-open`; the decision
record is `pd-registry/PD-30-amendment-chat-open.md`. D-3 (wording) approved the same day: `pd030-d3-wording.md`.

This closes risk R-3 of `docs/release/app-review-notes-payments.md`. Locking the in-app chat
behind payment can read as "pay to unlock an app feature" (App Store 3.1.1, Google Play
Payments §2).

## 1. What PD-30 does today

| # | Effect when a child is locked | Where |
|---|---|---|
| E-1 | The group is **read-only** for the parent and the teacher: send, react, delete for everyone | `apps/api/src/platform/authorization.service.ts` (`refusePaymentLock` in `canSend`, parent and teacher branches); `message.service.ts` (reactions about :1002, delete about :1582) |
| E-2 | **Calls** in the group are refused (the same rule, through `canCall`) | `authorization.service.ts` |
| E-3 | **Booking** is refused: a new lesson and a make-up | `lesson.service.ts` `assertMayBook`; `scheduling.service.ts` `bookMakeup` |
| E-4 | **Holds**: the child's regular lessons that have not started are suspended, and the materializer stops making new ones | `apps/api/src/subscriptions/subscription-effects.service.ts` (`reconcileHolds`, `learner_access.held`) |
| E-5 | **Cards and pushes**: the group gets "the lessons are paused"; the supervisor chat gets the reason and where to pay | `subscription-effects.service.ts`; `notification-catalog.ts` (`lessons_paused`, `subscription_locked`) |
| E-6 | **Lock banner** replaces the composer | Flutter `lib/features/messages/presentation/chat_screen.dart`, `payment_lock_banner.dart`; Admin Web `features/chat/ChatThread.tsx`, `features/subscriptions/PaymentLockBanner.tsx`; the conversation DTO's `paymentLock` |

All of it is behind `SUBSCRIPTION_LOCK_ENFORCED`. **Production defaults to off**
(`.github/workflows/deploy-production.yml`, `vars.SUBSCRIPTION_LOCK_ENFORCED || 'false'`), so
nothing is refused in production today. Staging has it on. R-3 becomes real only when the owner
turns enforcement on in production.

## 2. Target

| # | After the change |
|---|---|
| E-1 | **Removed.** The group is writable as usual, for the parent and the teacher. |
| E-2 | **Removed.** Calls in the group are allowed, because the chat is "fully accessible". See D-1 for already-booked lessons. |
| E-3 | **Kept.** New lessons and make-ups are refused with `COMM.SUBSCRIPTION_LOCKED`. |
| E-4 | The materializer stays held, since materializing is booking new lessons. **Suspending already-booked lessons: D-1.** |
| E-5 | Cards and pushes say that **new lesson bookings are paused**. The chat is not mentioned as closed. Copy: D-3. |
| E-6 | The banner becomes **informational** and sits above the composer, never instead of it. It keeps the "open subscriptions" button (payment stays in the app). |

## 3. Decisions needed from the owner

- **D-1. Lessons already booked when the lock starts. APPROVED (recommended option), 2026-11-06.**
  Measured: `lesson.materialize_weeks` = 4, so a locked child keeps up to four weeks of lessons
  booked before the lock. Before, they were suspended (E-4).
  "Only new lesson bookings pause" suggests they should go ahead.
  - **Recommended:** a lesson already on the calendar is held as booked. The materializer is still
    held, so no further regular lessons appear.
  - **Dependency:** how far ahead lessons are materialized decides how many lessons a lapsed
    family keeps receiving. Measure the horizon before choosing.
- **D-2. What starts the lock. APPROVED (recommended option), 2026-11-06; migration
  `20261106160000_chat_pd030_lock_lesson_instalments`.** An overdue instalment that is not for a lesson package (R-4:
  `lesson_subscription_id` is null) still starts the lock (reason `overdue`).
  - **Recommended:** count only instalments of a lesson package, so a non-lesson debt never
    pauses lessons.
  - This is a change to `chat.compute_learner_access`, which needs a migration slot.
- **D-3. Wording. APPROVED, 2026-11-06 (`pd030-d3-wording.md`).** The group card, the supervisor card, the push texts and the banner, in
  Arabic and English. This replaces the still-pending approved suspension message (A-4,
  roadmap §8.6).

## 4. Work, in reviewable PRs (after D-1 to D-3)

1. **API authorization.**
   - Remove `refusePaymentLock` from `canSend` (parent and teacher), from reactions and from
     delete-for-everyone.
   - Remove it from `canCall` too, per D-1.
   - Keep `assertMayBook`.
   - Turn the PD-30 integration tests round: they assert the lock refuses chat writes, and must
     now assert that writes go through and booking is refused.
2. **API effects.**
   - E-4 per D-1: `reconcileHolds` stops suspending booked lessons and still holds the
     materializer.
   - E-5: new card and notification texts (D-3), in `subscription-effects.service.ts` and
     `notification-catalog.ts`.
   - D-2, if chosen: a migration (claim a slot) for `compute_learner_access`.
3. **Flutter.**
   - `chat_screen.dart` keeps the composer when `paymentLock` is set.
   - `payment_lock_banner.dart` becomes an informational strip with "open subscriptions".
   - Widget tests in both languages.
4. **Admin Web.** `ChatThread.tsx` and `PaymentLockBanner.tsx` get the same treatment, with
   bilingual copy and tests.
5. **Docs.**
   - Amend PD-30: add `docs/product/pd-registry/PD-30-amendment-chat-open.md`, following the
     existing amendment.
   - Mark R-3 resolved in `docs/release/app-review-notes-payments.md`.
   - Update `docs/communication/error-codes.md`: `SUBSCRIPTION_LOCKED` then refuses only booking.

## 5. Dependencies and overlaps

- PR #464 (PD-57 Report sheet, `chat_screen.dart`) is merged; build the Flutter part on main.
- Open PR #478 (PD-57 Block API) changes `authorization.service.ts` and `message.service.ts`
  near the removed lock checks; whichever lands second rebases.
- **No app update is needed for the chat to open.** The app hides its composer and banner only when
  `paymentLock.readOnly` is true (`chat_screen.dart`), and the server now always sends false. The
  Flutter and Admin Web PRs (3 and 4) add the informational banner, which needs the D-3 wording.
- Open PR #449 (PD-32) changes `notification-catalog.ts`. The same applies.
- The API contract for `paymentLock` on `GET /conversations/:id` keeps its shape, so older app
  builds still render, and with `readOnly` false they keep the composer. They also show no banner,
  so the parent loses the banner's "open subscriptions" button until PR 3 ships. Ship PR 3 before
  enforcement is turned on in production.
- Do not turn `SUBSCRIPTION_LOCK_ENFORCED` on in production before this ships. Turning it on is
  an owner action, not part of any PR.

## 6. Acceptance

1. With enforcement on and a child locked:
   - the parent and the teacher send, react, delete and call in the group;
   - booking a lesson or a make-up is refused with `SUBSCRIPTION_LOCKED`;
   - already-booked lessons follow D-1.
2. No client hides the composer for payment.
3. The texts are exactly the approved D-3 wording, in Arabic and English.
4. The full API integration suite, Flutter and Admin Web suites, and guards pass.
