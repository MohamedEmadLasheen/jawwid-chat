# PD-46: Schedule ↔ Chat in real time, and the supervisor's Upcoming lessons (plan)

**State:** **APPROVED.** On 2026-10-28 the owner answered Q1–Q8 "Approve all 8 (Recommended)", relayed verbatim by the department head (§7). No feature code is written. PR-1 waits for the department head's GO (machine load).
**Claim:** `docs/product/pd-registry/PD-46.md`. **PR-1's migration slot is `20261028240000`**, assigned by the department head and claimed in `docs/product/migration-slots/20261028240000.md`. Later PRs that need DDL (PR-2's card key if it does not land with PR-1, and PR-4) ask for their own slots.
**Base:** `main` @ `03fd9175`. All paths are relative to the repository root. SQL migrations live in `supabase/migrations/`, abbreviated `mig/`.
**Frozen:** the call workstreams W1–W8, `lib/core/realtime/realtime_socket.dart` and `lib/core/realtime/call_realtime_client.dart`. Nothing here edits them (§3.6).

The owner's request (2026-10-28), items 4 and 5, relayed by the department head:

> 4. Bidirectional real-time Schedule↔Chat integration.
> 5. Prioritize upcoming lessons in the supervisor's Chat, with "no intervention needed" marking.

---

## Summary

- **One table, many writers.** Every surface reads the same lesson table, `chat.lesson`: the Schedule (PD-38), the Chat "+" tickets, the Teachers queue and the teacher's calendar. But at least **nine services and two SQL functions** write it (§1.1), and **none of them announces a change in real time.** The only lesson events, `lesson.closed` and `lesson.makeup_resolved`, are Core-bound and carry no `conversationId`, so they never reach a socket (§1.2).
- **The two sides diverge in three places:**
  1. A Chat card is a **frozen snapshot** posted once and never updated (except the report card).
  2. Lessons from materialization, transfer, PD-30 holds and pauses **post no card and emit no event**.
  3. The old attention engine reads a **Core-synced `learner.next_class_at`**, not `chat.lesson` (§1.4).
- **Design:**
  - **One writer.** Every lesson mutation goes through `LessonWriter`, which writes the row and, **in the same transaction**, one outbox event `lesson.changed { lessonId, revision, change }`.
  - **A revision per lesson.** A trigger on `chat.lesson` bumps `revision`, so a write that bypasses the writer is still counted.
  - **An idempotency key** on the outbox and on cards: `lesson:<id>:<revision>:<change>`.
  - **Fan-out:** the worker sends that *signal*, not content, to the teacher's, the supervisors' and the schedule watchers' actor rooms, and to the family's conversation rooms. Clients refetch through their existing authorized routes.
  - **Cards:** one card per relevant change, deduplicated by the same key.
- **Item 5: an "Upcoming lessons" strip at the top of the Admin Web Chat list.** It is a live list, not messages:
  - it shows the lessons in the supervisor's PD-8 / PD-35 scope that start between **−15 and +10 min** of now;
  - each has a one-tap **"No intervention needed"** mark, which is per lesson, audited and reversible;
  - a lesson **leaves the strip by itself** once it has an outcome or is 10 minutes past its start.
  - It sends **no push** in v1, so PD-34 quiet hours are untouched.
  - Reading it needs `schedule.view`. Marking needs a new key, `lessons.watch` (Q4).
- **Delivery:** five PRs (§6). The first adds the writer, the revision and the event, and is invisible to users.

---

## 1. Audit: how lesson changes flow on `main`

### 1.1 Who writes `chat.lesson`

There is one table, Prisma `Lesson` → `chat.lesson` (`apps/api/prisma/schema.prisma:1322-1363`). It has `updated_at` but **no revision or version column**.

| Change | Writer (file:line) | Card posted? | Outbox event? |
|---|---|---|---|
| One-off lesson | `LessonService.schedule`, `apps/api/src/lessons/lesson.service.ts:199` | **no** | **no** (audit `lesson.scheduled`, `:214`) |
| Outcome (absent, apology, cancel, no-show, held) | `LessonService.close`, `lesson.service.ts:936` (write `:965`) | yes (`:627-911`) | `lesson.closed` (Core only, `:997`) |
| Late excuse / ruling | `lesson.service.ts:780`, `:904` | yes | no |
| Make-up booked | `SchedulingService.bookMakeup`, `apps/api/src/lessons/scheduling.service.ts:582` | yes (`:596`) | `lesson.makeup_resolved` (Core only, `:649`) |
| PD-31 move | `moveLesson`: closes the old row `rescheduled` at `:732`, inserts the new one with `movedFrom` at `:738` | yes, `lesson_moved` (`:753`) | **no** (audit `lesson.moved`, `:759`) |
| Blocked occurrence | `scheduleBlocked`, `scheduling.service.ts:900` | no | no |
| Weekly times changed | `applyScheduleTx`, `scheduling.service.ts:1276` (future lessons → `rescheduled`) | yes (`:450`, `:510`) | no |
| Materialize from weekly slots | SQL `chat.materialize_lessons()` (`mig/20261019120000_chat_pd011_trials.sql:374`, insert `:403`), called at `scheduling.service.ts:1049` and `:1241` | **no** | **no** |
| Transfer to another teacher | SQL `chat.transfer_learner` (`mig/20261026110000_chat_pd031_scheduling.sql:469`, writes `:573`, `:577`), called from `apps/api/src/lessons/lifecycle.service.ts:324` | yes, `learner_transferred` (`:337`) | `learner.transferred` (`:352`), no lesson ids |
| Pause a learner | `suspendLessons`, `lifecycle.service.ts:687` | yes (`:630`, `:655`) | `learner.enrollment_changed` |
| PD-30 subscription hold | raw `UPDATE chat.lesson SET outcome='suspended'`, `apps/api/src/subscriptions/subscription-effects.service.ts:298` | yes (`:228-284`) | **no** |
| Trials (PD-11 T4) | `apps/api/src/lessons/trial.service.ts:171, 253, 309, 318, 360, 470, 536` | via `trial-group.service.ts:234` | no |
| Corrections, report delete | `apps/api/src/lessons/lesson-record.service.ts:131, 262` | report card rewritten in place (`:386-400`) | `message.updated` |
| Reminder bookkeeping | `scheduling.service.ts:1098` (`remindersScheduledAt`) | no | no |

These triggers run on `chat.lesson`:
- `lesson_updated_at`, `lesson_is_coherent` and `lesson_is_kept` (`mig/20261018120000_chat_pd011_lessons.sql:94, 280, 292`; `chat.guard_lesson` is redefined at `pd031_scheduling.sql:53`);
- `lesson_moved_occurrence_stays_moved` (`pd031_scheduling.sql:279`);
- the PD-12 violation trigger (`mig/20261019140000_chat_pd012_s2_discipline.sql:259`);
- the PD-30 access triggers (`mig/20261026140000_chat_pd030_subscription_lock.sql:637, 663`).

**None of them writes to the outbox or calls `pg_notify`.**

### 1.2 Outbox and realtime

- **Outbox:** `chat.outbox_event` (`schema.prisma:492-505`) has the columns type, payload, status, attempts and available_at. It has **no idempotency key**.
- **Writing:** `OutboxService.enqueue` writes inside the caller's transaction (`apps/api/src/communication/outbox/outbox.service.ts:17-27`).
- **Draining:** `OutboxWorker.drain` (`outbox.worker.ts:36`) claims rows `pending → …` (`:52`) and delivers **at least once**.
- **Fan-out:** `publish` (`:79`) switches on the type. The default branch sends to the conversation room or drops an event that has no `conversationId` (`:304-312`). The actor-room delivery used by `inbox.changed` (`:242-246`, `realtime.toUsers`) is the pattern this plan reuses.
- **Rooms:** `conversation:{id}`, `actor:{id}`, `session:` and `account:` (`apps/api/src/communication/contracts/events.ts:487-494`).
- **Existing dedupe:** notifications have a unique `dedupe_key` (`mig/20261026190000_chat_pd034_notifications.sql:50`). Messages have a partial unique index on `client_message_id` (`mig/20260905093000_chat_communication.sql:306`), but cards never set it.

### 1.3 Lesson cards in Chat

- **How a card is posted:** `LessonService.postCard`/`postCardInto` (`lesson.service.ts:1034, 1053`) inserts a CARD message plus a `message_card` row (`kind`, `lessonId`, `payload`; `:1090`) and enqueues `message.created` + `conversation.updated`.
- **Kinds:** `apps/api/src/communication/contracts/vocab.ts:313-389`. A second card writer exists at `apps/api/src/supervision/card-poster.ts:86`.
- **No dedupe and no update:** each change posts a **new** card. `message_card` has no unique key on `(lesson_id, kind)`, so a retried transaction or a double tap can post twice.
- **The payload is a snapshot.** For example, `lesson_moved` stores `startsAt`/`previousStartsAt`. Flutter renders only from `card.payload` (`lib/features/lessons/presentation/lesson_card_view.dart:24-176`), so a lesson changed after its card is posted keeps showing the old time on that card.
- **The live part of Chat:** the "+" tickets (`GET conversations/:id/lesson-tickets`, `apps/api/src/lessons/lesson.controller.ts:57` → `ticketsFor`, `lesson.service.ts:459`) read `chat.lesson` live. But Flutter refetches them only when the menu opens or a ticket is used (`lib/features/messages/presentation/chat_screen.dart:374, 450`).

### 1.4 The Schedule, the queues and notifications

- **Schedule (PD-38):** `CalendarService.calendar` (`apps/api/src/calendar/calendar.service.ts:205-240`) reads `chat.calendar_lessons` and `chat.calendar_capacity`, both over `chat.lesson`. **This is the same source of truth as the tickets.**
  - Admin Web `/schedule` is fetch-only: `staleTime: 30_000` (`apps/admin-web/src/features/schedule/hooks.ts`) plus refetch on window focus.
  - The teacher's Flutter calendar uses plain `FutureProvider`s (`lib/features/lessons/presentation/teacher_calendar.dart:78`), refreshed by pull-to-refresh.
  - **Neither listens to a socket.**
- **Admin Web's socket handlers** (`apps/admin-web/src/core/realtime/RealtimeProvider.tsx:44-66`) listen for `task.updated`, `coverage.changed`, `ownership.changed`, `unattended.changed` and `escalation.created`. The API emits none of these.
- **Teachers queue:** `GET lessons/needs-action` (`lesson.controller.ts:36-40` → `lesson.service.ts:342`) is a live query. It covers overdue lessons, awaiting close, rulings, overdue make-ups, returns and requests. Nothing about it is stored.
- **Attention engine (pre-PD-8):** `chat.attention_signals` has a `class_imminent` signal (`mig/20260905090800_chat_attention_and_workload.sql:114-135`) that reads **`chat.learner.next_class_at`**, a Core-synced cache. **This is the one place a "soon" signal disagrees with the Schedule.**
- **Reminders (PD-34):** `scheduleDueReminders` (`scheduling.service.ts:1059-1101`) runs from the worker sweep every 300 s (`apps/api/src/worker.ts:80, 337-345`).
  - It calls `ReminderService.scheduleForEvent` (`apps/api/src/communication/notifications/reminder.service.ts:57`). The dedupe key is `rule:subject:recipient` (`:49`).
  - On a move, cancel or hold it calls `cancelForSubject` (`:123`; callers `lesson.service.ts:977`, `scheduling.service.ts:737`, `subscription-effects.service.ts:303`).
  - The T-30 (parent) and T-15 (teacher) rules ignore quiet hours. `lesson` is a locked category (`apps/api/src/platform/app-config.service.ts:85`).

### 1.5 Scope and permissions

- **Supervisor scope:** `CalendarService.scopeOf` (`calendar.service.ts:91-117`) already returns the union a supervisor needs:
  - `ownLearners`: PD-8, via `chat.learner_supervision` / `supervisedLearnerIds` (`lesson.service.ts:1244`);
  - `namedTeachers`: PD-35, `TeacherScopeService.scopeOf`, `apps/api/src/platform/teacher-scope.ts:96`.
- **Keys** (`apps/api/src/platform/permissions/catalogue.ts`): `schedule.view`/`schedule.manage` (`:86-87`), `lessons.view`/`lessons.manage` (`:89-90`) and `supervision.chats`.
- **No "acknowledged" or "no intervention needed" concept exists anywhere** (grep: none).

### 1.6 The Flutter realtime path

- Chat has no socket of its own. `lib/features/conversations/application/chat_realtime.dart` rides `CallRealtimeClient.chatSignals` (`call_realtime_client.dart:91`) under the "NO SECOND CONNECTION" rule (`chat_realtime.dart:18-20`).
- The frozen client already passes **every** frame through `decodeChatSignal` (`call_realtime_client.dart:274`), which lives in the **chat-owned** `lib/core/realtime/chat_signal.dart:82-114`.
- A new signal therefore needs a change to `chat_signal.dart` only. Today that function drops any frame without a `conversationId` (`:104`); §3.6 handles this.

---

## 2. What "relevant change" means

| Direction | Relevant | Not relevant |
|---|---|---|
| **Schedule → Chat** (a lesson changed; the family, teacher and supervisor should see it in Chat) | created one-off or make-up · moved (PD-31) · cancelled / apology / no-show · held · paused or held by PD-30 · transferred to another teacher · trial booked or decided | materialization of ordinary weekly lessons (the family already has the weekly time; a card per week would be spam) · reminder bookkeeping · corrections that change no time or outcome · `updated_at` touches |
| **Chat → Schedule** (something done in Chat changes the calendar) | a ticket used in Chat (apology, make-up, move request approved, cancel) · a supervisor's ruling · a transfer started from a profile | messages, reactions, reads · a schedule *request* not yet approved (it shows as pending in the queue, not on the calendar) |

**Chat → Schedule is already one source.** A ticket used in Chat calls the same service that writes `chat.lesson`, so the Schedule only needs the **signal** to refetch.
**Schedule → Chat is the real gap:** missing cards for some changes, stale snapshots, and no live refresh.

---

## 3. Design

### 3.1 One writer

- **`LessonWriter`** (new, in `apps/api/src/lessons/`) becomes the **only** TypeScript path that inserts or updates `chat.lesson`. Each call takes the caller's `tx` and a `change` (§3.3). It then:
  - writes the row(s);
  - calls `LessonEvents.record(tx, lessonIds, change, actor)`, which enqueues the outbox event in **the same transaction**;
  - optionally posts the card through the existing `postCard`, keyed (§3.4).
- **Migration path:** the existing writers in §1.1 call the writer instead of `tx.lesson.*` or raw `UPDATE`. A guard (`scripts/qa/guards.sh lesson-writer`) fails CI on any new `lesson.update|create|updateMany` or `UPDATE chat.lesson` outside `LessonWriter` and the migrations.
- **The SQL writers** (`materialize_lessons`, `transfer_learner`) are kept as they are. They are set-based and already transactional. Their TypeScript callers pass the affected ids, which both functions can return, to `LessonEvents.record`.

### 3.2 A revision on the row: ordering and the safety net

- **New column:** `chat.lesson.revision bigint not null default 0`.
- **Trigger:** a `BEFORE UPDATE` trigger `lesson_bumps_revision` sets `NEW.revision = OLD.revision + 1` whenever a field a reader sees changes (`starts_at`, `ends_at`, `teacher_id`, `outcome`, `kind`, `learner_id`). It is a separate function, per the shared-trigger rule.
- **Ordering:** each event carries `revision`. A client keeps the highest revision seen per lesson and ignores a lower one. A refetch always returns the current row, so an out-of-order signal costs one redundant read and never shows an old state.
- **Safety net:** an `AFTER` trigger records `(lesson_id, revision)` into `chat.lesson_change_unannounced` when the writer did not mark the transaction (`set_config('chat.lesson_writer', 'on', true)`). A 60-second sweep then announces those rows as `change: 'external'`. A missed writer therefore shows up late, never silently. A metric on this table's inflow tells us which writer still bypasses `LessonWriter`.

### 3.3 The event

```
lesson.changed {
  lessonId, revision, change,           // change: created | moved | cancelled | outcome | held
                                        //         | paused | transferred | trial | external
  teacherId, learnerId|null, organizationId,
  startsAt, previousStartsAt|null,      // for the Upcoming strip's window test, not shown
  conversationIds: string[]             // the family's DIRECT/group rooms that get a card or a refresh
}
```

- It is a **signal**. Clients refetch through their existing authorized routes: `/calendar`, `/me/calendar`, `lesson-tickets` and the conversation. The event shows nobody anything the read path would refuse, which follows the RT-009 rule that a room is not authorization.
- **Fan-out** in `OutboxWorker.publish` (a new `case`, beside `INBOX_CHANGED`):
  1. `toUsers([teacher actor])`, so the teacher's calendar and list refresh;
  2. `toUsers(scope readers)`: the staff whose `CalendarService.scopeOf` covers the lesson (the PD-8 supervisor of the learner, the PD-35 supervisors of the teacher, managers). This is computed **at delivery**, so a scope change in between is respected;
  3. `toThread(conversationId)` for each listed conversation, which the Chat already reacts to with `conversation.updated`.
- **Volume:** materialization of ordinary weeks emits **one** batched `schedule.refreshed { teacherIds }` per sweep, not one event per lesson (§2).

### 3.4 Idempotency and no duplicate cards

- **The key:** `lesson:<lessonId>:<revision>:<change>`.
  - **Outbox:** add `idempotency_key text unique` (nullable for old events). `LessonEvents.record` inserts with `ON CONFLICT DO NOTHING`, so a retried transaction cannot enqueue twice.
  - **Cards:** add `message_card.idempotency_key text unique`, nullable. `postCard` accepts the key and, on conflict, returns the existing message instead of posting. One change gives one card, even across a retry or a double tap.
- **Delivery stays at least once.** Clients treat a duplicate signal as a no-op through the revision (§3.2).
- **Stale snapshots (owner Q2):**
  - The recommendation is that a card stays a **record of what happened** ("Moved from Mon 5:00 PM to Tue 6:00 PM"), which is what chat history is for.
  - The card's lesson footer ("Now: Tue 6:00 PM · Held") reads **live** from the lesson. It is fetched with the tickets and refreshed on `lesson.changed`.
  - So no history is ever rewritten, but nobody acts on an old time.

### 3.5 What each surface does with the signal

| Surface | On `lesson.changed` / `schedule.refreshed` |
|---|---|
| Admin Web `/schedule` | `invalidateQueries(['calendar'])` if the lesson's `startsAt` falls in the window on screen (else nothing). Debounce 1 s. |
| Admin Web Chat | refetch the open conversation's tickets and the Upcoming strip (§4). |
| Flutter teacher calendar and list | `ref.invalidate` the calendar/list providers for the affected day. |
| Flutter chat (parent, teacher) | refetch lesson tickets and the live card footers of the open conversation. |

### 3.6 Flutter without touching the frozen files

- `call_realtime_client.dart:274` already hands every frame to `decodeChatSignal` in the chat-owned `chat_signal.dart`. PR-3 adds `ChatSignalKind.lessonChanged` there:
  - it accepts `lesson.changed` / `schedule.refreshed` **without** a `conversationId`;
  - `ChatSignal` gains a nullable `lessonId`;
  - the comment saying "null only for reconnected" is updated.
- `chat_realtime.dart` (chat-owned) routes the new kind to the calendar providers.
- **No edit** to `realtime_socket.dart` or `call_realtime_client.dart`, and no second connection.

---

## 4. Item 5: the supervisor's "Upcoming lessons" in Chat

### 4.1 What the supervisor sees

- **Placement:** a strip pinned **above the conversation list** in Admin Web Chat (`apps/admin-web/src/features/chat/ConversationList.tsx`), collapsed to a count when empty. It is not a message, not a push, and not a thread.
- **Rows:** one row per lesson in scope that starts in the window **[now − 15 min, now + 10 min]** (Q1), sorted by start. Each row shows:
  - start time (12-hour, academy clock) · learner · teacher · state (*starting in 6 min*, *started 3 min ago*);
  - a hint when the family's chat has an unanswered message (the old `class_imminent` idea, now read from `chat.lesson`);
  - a tap target that opens the family's conversation;
  - a **"No intervention needed"** button.
- **Scope:** `CalendarScope` from `CalendarService.scopeOf` (§1.5), which is the PD-8 learners plus the PD-35 teachers. The strip and the Schedule therefore cannot disagree about whose lessons a supervisor sees. Managers see their department's lessons. The super admin sees none by default (Q5).
- **Endpoint:** `GET /lessons/upcoming` uses `@Requires('schedule.view')`. It is one indexed statement over `chat.lesson (starts_at)`, joined with the mark table, scope applied in SQL. Polling every 60 s is the floor, and `lesson.changed` refreshes it at once.

### 4.2 "No intervention needed"

- **Table** `chat.lesson_watch_mark`: `lesson_id`, `organization_id`, `marked_by`, `marked_at`, `cleared_by`, `cleared_at`, `note`.
  - At most **one live mark per lesson** (partial unique index `where cleared_at is null`).
  - Rows are never deleted. Unmarking sets `cleared_*`.
- **Who:** anyone whose scope covers the lesson and who holds **`lessons.watch`** (a new PD-40 key, Q4).
- **Shared by default (Q3):** a mark hides the row for every supervisor with the same lesson in scope, and the row says who marked it. A PD-35 teacher supervisor and a PD-8 family supervisor watching the same lesson should not both have to act.
- **Audited:** every mark and unmark writes the audit log (`lesson.watch_marked` / `lesson.watch_cleared`) with actor, lesson and time.
- **Reversible:** a marked lesson moves to a collapsed *"Marked (n)"* group under the strip until it auto-clears, and can be unmarked there.
- **Auto-clear:** a lesson leaves the strip, marked or not, when **(a)** it has any outcome (held, absent, apology, cancelled…) or **(b)** it is more than 10 min past its start (the window's end). No lesson row records "started": there is no call↔lesson link, and the frozen call stack is not touched to add one (Q6). The mark row stays for the audit trail.
- **A move:** re-opens a mark. A changed `starts_at` (a new revision) clears the live mark, because "nothing needed" was said about the old time.

### 4.3 Notifications, quiet hours, PD-40

- **No push in v1 (Q7).** The strip is a working surface for someone already in Chat. The teacher and the family already get the T-15/T-30 reminders (PD-34, exempt from quiet hours). A supervisor push every lesson would be the spam the owner ruled out.
- If the owner wants one later, it would be a single catalog entry in category `lesson`:
  - *"Starting now, not yet held"*, at start + 5 min, only when unmarked and without an outcome;
  - deduplicated with the existing `rule:subject:recipient` key, cancelled by `cancelForSubject` on any change;
  - quiet hours respected (it is not the teacher's own reminder).
- **PD-40:**
  - reading uses the existing `schedule.view`;
  - marking uses the new `lessons.watch` (risk `pii`, introducedBy `PD-46`), granted by default to supervisor roles and managers;
  - the route declares it, so the PD-40 route guard keeps passing.

---

## 5. Risks

- **Writer migration breadth.** §1.1 has about 25 write sites. PR-1 is mechanical but wide, so the safety-net trigger (§3.2) goes in **first**, making a missed site visible rather than silent.
- **Fan-out cost.** Scope readers per lesson are computed at delivery. A weekly materialization of about 2,000 lessons must stay one batched signal (§3.3). The worker test will assert that bound.
- **Admin Web's dead realtime handlers** (§1.4) are not reused. The new handler is registered in `useChatRealtime.ts` / a schedule hook, beside the live ones.

---

## 6. Delivery (after approval)

| PR | Content | Slot |
|---|---|---|
| PR-1 | `lesson.revision` + bump trigger + unannounced table; `outbox_event.idempotency_key`; `LessonEvents.record`; `lesson.changed` + `schedule.refreshed` in `events.ts` and the worker's fan-out; integration spec | **`20261028240000`** (assigned) |
| PR-2 | `LessonWriter` and the move of every §1.1 writer; the `lesson-writer` guard; `message_card.idempotency_key` + keyed `postCard` (same slot if landed together, else a second) | 0–1 |
| PR-3 | Clients: Admin Web `/schedule` + Chat ticket refresh; Flutter `chat_signal.dart` kind + calendar/ticket invalidation; live card footer | none |
| PR-4 | Item 5 API: `chat.lesson_watch_mark`, `GET /lessons/upcoming`, mark/unmark, `lessons.watch` key, audit | one slot |
| PR-5 | Item 5 Admin Web strip, en/ar, RTL, 12-hour, 44 px targets | none |

Each PR: failing tests first, CI G-19 as the integration proof, and no local containers.

---

## 7. Owner decisions

**DECIDED 2026-10-28.** The owner's answer, relayed verbatim by the department head:

> "Approve all 8 (Recommended)"

Every recommendation below is therefore the decision. The table keeps the question for the record.

| # | Question | Decision |
|---|---|---|
| Q1 | The window for "upcoming". | **−15 / +10 min**, a config value (`lesson.upcoming_before_minutes` = 15, `lesson.upcoming_after_minutes` = 10). |
| Q2 | When a lesson changes after its card was posted, should the old card be rewritten? | **No.** A card is history. Add a **live "Now:" footer** and post a new card for the change. |
| Q3 | Is "No intervention needed" shared or personal? | **Shared** per lesson, showing who marked it. One decision per lesson, audited. |
| Q4 | Who may mark? | A new key **`lessons.watch`**, by default for supervisors (PD-8 and PD-35) and managers. Reading stays `schedule.view`. |
| Q5 | Does the super admin see the strip? | **No by default**, because the whole academy is noise. They can open it from the Schedule's Today view. |
| Q6 | Should "the teacher joined the call" count as *started*? | **Not in v1.** No call↔lesson link exists, and the call stack is frozen. Use the outcome or start + 10 min. |
| Q7 | Push the supervisor? | **No push in v1.** If wanted later: one push at start + 5 min, only when unmarked and without an outcome, respecting quiet hours. |
| Q8 | Should weekly materialization post cards? | **No.** Ordinary weekly lessons refresh the calendars silently. Only the changes in §2 post a card. |
