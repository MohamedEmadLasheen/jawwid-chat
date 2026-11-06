---
pd: PD-30
kind: amendment
subject: The group chat stays open when a child is locked for payment; only new lesson bookings pause (owner 2026-11-06)
branch: claude/pd030-chat-stays-open
pr:
state: IN PROGRESS
---
Owner, 2026-11-06: "I prefer keeping the parent-teacher group chat fully accessible even when a
family runs out of lessons or has an overdue instalment. Only new lesson bookings should be paused."
D-1 and D-2 of `../pd030-chat-stays-open-plan.md` approved by the owner the same day
("Approve D-1 and D-2"). D-3 (wording) is still open.

Why: a chat locked behind payment can read as paying to unlock an app feature (App Store 3.1.1,
Google Play Payments §2); risk R-3 of `../../release/app-review-notes-payments.md`.

What changes from PD-30 (2026-10-26):

1. **Chat.** A locked child's family or student group is writable and callable for the parent, the
   teacher and staff: messages, reactions, delete for everyone, calls. The lock is no longer asked
   by `canSend` / `canCall` (`AuthorizationService`). `paymentLock.readOnly` is false for everyone,
   so an app build from before this change keeps its composer.
2. **Bookings stay paused.** A lesson or make-up booked for the child, a move, and new weekly times
   are refused with `COMM.SUBSCRIPTION_LOCKED`, as before.
3. **D-1: lessons already on the calendar go ahead.** The hold sets `chat.learner_access.held`,
   which stops the materializer; it no longer suspends booked lessons. The materializer runs
   `lesson.materialize_weeks` ahead (4 by default), so a locked child keeps up to that many weeks of
   lessons booked before the lock.
4. **D-2: only a lesson package's instalment locks.** An overdue instalment locks only when it names a
   standing lesson package (`family_instalment.lesson_subscription_id`, R-4); migration
   `20261106130000_chat_pd030_lock_lesson_instalments`. So an instalment that locks is always one the
   family can pay in the app.

Still to do (D-3, the owner's wording): the group card ("the lessons are paused"), the supervisor
card, the push texts, and an informational banner above the composer in the app and Admin Web. Until
then the cards and pushes keep their PD-30 texts, and the app shows no banner.

`SUBSCRIPTION_LOCK_ENFORCED` stays off in production until the owner turns it on.
