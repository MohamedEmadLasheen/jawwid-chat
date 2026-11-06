# PD-30 amendment, D-3: the approved wording

**Status: APPROVED by the owner, 2026-11-06**, with these decisions:
1. The new wording applies everywhere: the chat cards, the pushes, the app's banner and Admin Web.
2. Lessons already scheduled go ahead as normal. Only new lesson bookings pause.
3. The group chat and the parent–supervisor chat stay fully accessible.
4. The financial reason and the "Go to Subscriptions" button are shown to the parent only.
5. A teacher never sees payment details, overdue instalments or the family's financial status:
   only that new bookings are paused and the chat stays open.
6. The Arabic parent button is «عرض الاشتراكات».

The subscription lock is not switched on in production until the app update is released and the
owner explicitly approves production activation.

Every text a family or the staff read when a child's new lesson bookings pause (PD-30 amendment,
`pd-registry/PD-30-amendment-chat-open.md`). Each one replaces a text written when PD-30 locked the
chat.

What the wording must say, from the approved decisions:
- Only **new** lessons pause. Lessons already booked go ahead (D-1).
- The chat stays open. No text says the group, the chat or the app is paused or closed.
- Payment is described as renewing the **lessons**, never as unlocking the app or the chat
  (store policy, `docs/release/app-review-notes-payments.md` R-3).
- The financial reason is never shown in the group the teacher is in. Only the parent and the
  supervisor read it (PD-4).

`{learner}` is the child's name. `{reason}` is one or both of the existing reason texts ("the
subscription's lessons are used up", "an instalment is overdue"), which are kept as they are.

## 1. Card in the child's group (parent and teacher read it)

When it is posted: new bookings pause.

| | Before | Approved |
|---|---|---|
| EN | ⏸️ {learner}'s lessons are paused. | ⏸️ New lessons for {learner} are paused for now. Lessons already booked go ahead, and this chat stays open. |
| AR | ⏸️ توقفت حصص {learner} مؤقتًا. | ⏸️ توقّف حجز حصص جديدة لـ{learner} مؤقتًا. الحصص المحجوزة مسبقًا تُقام في موعدها، والمحادثة تبقى مفتوحة. |
| Title in the app, EN | Lessons paused | New lessons paused |
| Title in the app, AR | توقفت الحصص مؤقتًا | توقّف حجز الحصص الجديدة |

## 2. Card in the parent–supervisor chat (with the reason)

When it is posted: new bookings pause.

| | Before | Approved |
|---|---|---|
| Heading, EN | ⏸️ {learner}'s lessons are paused | ⏸️ New lessons for {learner} are paused |
| Heading, AR | ⏸️ توقفت حصص {learner} | ⏸️ توقّف حجز حصص جديدة لـ{learner} |
| Reason lines | (unchanged) | (unchanged) |
| Last line, EN | Renew or pay the instalment in Subscriptions. | Lessons already booked go ahead. To book new lessons, renew or pay the instalment in Subscriptions. |
| Last line, AR | جدّدوا الاشتراك أو ادفعوا القسط من «الاشتراكات». | الحصص المحجوزة مسبقًا تُقام في موعدها. لحجز حصص جديدة، جدّدوا الاشتراك أو ادفعوا القسط من «الاشتراكات». |
| Title in the app, EN | Lessons paused — payment | New lessons paused — payment |
| Title in the app, AR | توقفت الحصص — الدفع | توقّف حجز الحصص الجديدة — الدفع |

## 3. Card in the child's group when bookings open again

| | Before | Approved |
|---|---|---|
| EN | ▶️ {learner}'s lessons are back on. | ▶️ New lessons for {learner} are back on the schedule. |
| AR | ▶️ عادت حصص {learner}. | ▶️ عادت الحصص الجديدة لـ{learner} إلى الجدول. |
| Title in the app, EN | Lessons are back on | New lessons are back on |
| Title in the app, AR | عادت الحصص | عادت الحصص الجديدة |

## 4. Push notifications (to the parents and the supervisor)

The title stays "Jawwid" / "جَوِّد".

| Push | | Before | Approved |
|---|---|---|---|
| Paused | EN | {learner}'s lessons are paused: {reason}. Renew in Subscriptions. | New lessons for {learner} are paused: {reason}. Booked lessons go ahead. Renew in Subscriptions. |
| Paused | AR | توقفت حصص {learner}: {reason}. جدّدوا الاشتراك من الاشتراكات. | توقّف حجز حصص جديدة لـ{learner}: {reason}. الحصص المحجوزة تُقام في موعدها. جدّدوا الاشتراك من «الاشتراكات». |
| Back on | EN | {learner}'s lessons are back on. Thank you. | New lessons for {learner} are back on the schedule. Thank you. |
| Back on | AR | عادت حصص {learner}. شكرًا لكم. | عادت الحصص الجديدة لـ{learner} إلى الجدول. شكرًا لكم. |

## 5. Banner in the app's chat (new: above the message box, never in place of it)

**Audience (approved, decisions 4 and 5):**
- **The parent** sees the heading, the reason line for each child, the second line, and the
  "Go to Subscriptions" button.
- **The teacher** sees only the heading and the second line, with no reason and no button,
  because the reason is financial (PD-4).

| | Before | Approved |
|---|---|---|
| Heading, EN | Lessons are paused | New lessons are paused |
| Heading, AR | الحصص متوقفة مؤقتًا | حجز الحصص الجديدة متوقف مؤقتًا |
| Reason per child (parent only) | "{name}: lessons used up" / "{name}: instalment {label} overdue since {date}" | (unchanged) |
| Child with no reason given, EN | {name}'s lessons are paused | {name}: new lessons paused |
| Child with no reason given, AR | حصص {name} متوقفة مؤقتًا | {name}: توقّف حجز الحصص الجديدة |
| Second line, EN | This group is paused for now. | The chat stays open, and lessons already booked go ahead. |
| Second line, AR | هذه المجموعة متوقفة مؤقتًا. | المحادثة تبقى مفتوحة، والحصص المحجوزة مسبقًا تُقام في موعدها. |
| Button (parent only), EN | Go to Subscriptions | (unchanged) |
| Button (parent only), AR | الذهاب إلى الاشتراكات | عرض الاشتراكات (owner, decision 6) |

## 6. Banner in Admin Web's chat (staff)

| | Before (interim, PR #484) | Approved |
|---|---|---|
| EN | New lesson bookings are paused. The chat stays open for everyone. | New lesson bookings are paused. Lessons already booked go ahead, and the chat stays open for everyone. |
| AR | حجز الحصص الجديدة متوقف مؤقتًا. المحادثة تبقى مفتوحة للجميع. | حجز الحصص الجديدة متوقف مؤقتًا. الحصص المحجوزة مسبقًا تُقام في موعدها، والمحادثة تبقى مفتوحة للجميع. |

## 7. Unchanged

- **Grace card and push.** These still say "the lessons are used up, {n} grace lesson(s) left
  until renewal". They are still true, and they never mentioned the chat.
- **The parent's "please renew" request** and the staff card it creates.
- **The reason texts** ("lessons used up", "instalment … overdue since …").

## 8. Where it is built (engineering, not for the owner)

- **Cards:** `apps/api/src/lessons/lesson-card.ts` (and, in the app, `cardLessonsPausedBody` for the
  group card's second sentence), the `LESSONS_PAUSED`, `SUBSCRIPTION_LOCKED` and
  `SUBSCRIPTION_UNLOCKED` cases. Cards already posted keep their old text.
- **Pushes:** the rows in `chat.notification_template`. This needs migration
  `20261106170000_chat_pd030_d3_push_wording` (version 2 of each template) and its rollback.
- **Flutter:**
  - in `lib/l10n/app_en.arb` and `app_ar.arb`: `cardLessonsPausedTitle`,
    `cardSubscriptionLockedTitle`, `cardSubscriptionLockedHint`, `cardSubscriptionUnlockedTitle`,
    and the `lockBanner*` keys;
  - `payment_lock_banner.dart` becomes the informational strip in `chat_screen.dart`;
  - widget tests in both languages.
- **Admin Web:** `features/subscriptions/copy.ts` `lockedBanner`, with its tests.
- **Rollout:** ship the Flutter app update before `SUBSCRIPTION_LOCK_ENFORCED` is turned on in
  production. Turning it on is the owner's action.
