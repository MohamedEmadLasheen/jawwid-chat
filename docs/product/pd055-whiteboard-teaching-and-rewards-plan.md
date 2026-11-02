# PD-55 · A whiteboard for teaching children — writing, drawing, and rewards

**The owner's request (2026-11-02):** "The whiteboard is not flexible enough when it comes
to writing, drawing, and explaining lessons… make it much more flexible and user-friendly
for writing, drawing, and teaching. Most importantly, it should include engaging
encouragement and motivational features to reward and motivate children throughout the
lesson."

**What the owner hit:** in the teacher portal (`/teacher/#/boards`), the Text tool opens a
modal "Write here" dialog with Save and Cancel. The teacher cannot type on the board.

**Status:** the product decisions are made (department head, 2026-11-02, items A1–A6 and
B1–B5 below). This document is the plan only. Builds on PD-39 (the board, as built) and
fits PD-54 (student boards, planned and not built).

Migration slots: `20261102120000` (PR-3) and `20261102130000` (PR-4), assigned by the
department head.

---

## 0. Summary

| | Plan |
|---|---|
| **Writing** | Text is typed **on the board, where the teacher taps**. No dialog. Edit in place, a double tap re-edits, and text can be moved, resized and rotated. Size, colour and bold sit on a floating bar beside it. Arabic first; each paragraph's direction follows its first strong character. |
| **Drawing** | PD-39 already has pressure, smoothing, palm rejection, the highlighter and both erasers. PD-55 adds width presets, a quick colour row, a **freehand lasso** (move, resize, copy, delete) and a better stroke model where needed. |
| **Explaining** | A **laser pointer** whose trail fades and is never saved. A **dotted** page joins blank, lined (Arabic handwriting lines), and grid. A **floating contextual toolbar** with 44 px targets, plus keyboard shortcuts on the web. |
| **Rewards** | A **reward tray** of stars, stickers and praise stamps, with **one-tap celebrations** that the child sees on the family's phone. There is a **star tally per child per lesson** with a progress bar toward a small badge. The tally shows on the board and on the lesson report the parent already reads. |
| **Never** | Leaderboards, comparisons between children, negative marks, Quran or religious text in the tray, or emoji (they draw as boxes in the browser build). |
| **Data** | **One new append-only table**, `chat.learner_reward_event`, under row-level security: the learner's teacher writes; the family and the teacher's supervisors read. Plus one constraint change (a `dotted` layout). Board documents keep PD-39's format; new fields are additive. |
| **Delivery** | This plan, then six PRs. PR-1, inline text (the owner's pain point), comes first. The rewards are behind `rewards.enabled` (default off) until QA passes. |

---

## 1. What exists today (checked on main `7bf41725`)

The PD-39 MVP is broader than the owner's experience suggests. What is missing is mostly
**how it feels**, plus three tools. Every item asked for is listed here against the code.

| Item | Today | PD-55 |
|---|---|---|
| A1 text | `BoardTool.text` opens `_askText`, an `AlertDialog` (`board_editor_screen.dart`). `TextElement` has text, box, size and colour. It has no bold, no rotation, and no in-place edit. | **Rebuilt** (PR-1). |
| A2 pressure, smoothing | Pressure is read from a stylus (`_pressure`, `board_canvas.dart`). Strokes are quadratic-smoothed (`_smooth`, `board_painter.dart`). | Kept. Add a light input filter for mouse and finger (PR-2). |
| A2 palm rejection | Once a stylus is seen, touch pans instead of drawing (`_stylusSeen`). | Kept, plus a test on an iPad layout. |
| A2 widths, colours | 4 widths and 8 colours inside menus. | **Visible presets** on the bar: 3 widths and 6 colours, with one tap each (PR-2). |
| A2 highlighter, erasers | `highlighter`, `eraser` (whole stroke) and `areaEraser` (splits strokes) exist. | Kept; the area eraser gets a visible radius (PR-2). |
| A3 lasso | Rectangle marquee only (`_Drag.marquee`). Move, resize and delete exist; copy does not. | **Freehand lasso** plus copy and paste (PR-2). |
| A4 laser | None. | **New** (PR-3). |
| A5 backgrounds | `plain`, `ruled`, `narrow_ruled`, `grid` and `arabic_lines`, in 5 colours. | **Add `dotted`** (PR-3, a migration: the layout column has a CHECK). |
| A6 toolbar | A fixed top toolbar. Undo and redo shortcuts exist on the web. | **Floating contextual bar**, 44 px targets, the full shortcut set (PR-1 base, PR-6 polish). |
| B1 stamps | 8 `StampKind`s (star, check, heart, thumbs-up, ممتاز, أحسنت, Excellent, Well done), drawn from icons and our font. | Becomes the **reward tray**, with more stickers, رائع, بطل and custom praise (PR-4). |
| B2–B5 | Nothing. | **New** (PR-4, PR-5). |

### Two findings that shape the plan

**F1. There is no live board sync, and children have no login.** PD-39's live board share
(design §5.1) was never built, so nothing a teacher draws reaches a family while the lesson
runs. PD-54 §6.1 confirms that the child watches the **parent's device**, with no student
account. The celebration (B2) therefore cannot ride a board sync that does not exist. It
rides the reward event instead:

1. The teacher taps.
2. The API writes a `learner_reward_event`.
3. In the same transaction, it enqueues `learner.reward_given` through the outbox.
4. The event is delivered on the existing realtime channel to that learner's family
   contacts, with the RT-009 check at delivery time.
5. The family's app plays the celebration over whatever screen is open.

This is **independent of PD-39 §5.1**: when a live board share is built, it changes nothing
here.

The laser pointer (A4) is a local overlay for now: useful while teaching on a shared
screen, in person, or on a projector. Its realtime message type is reserved, so the live
share can carry it later. It is never saved in either case.

**F2. PD-54 (the student board and the parent's board viewer) is not built.** The parent's
place for the tally is therefore the **lesson report card the family already receives**
(PD-11 and PD-15). When PD-54's history ships, the same tally is shown beside the lesson
snapshot from the same API; nothing is re-modelled.

---

## 2. A — Writing, drawing and explaining

### A1 · Inline text (PR-1)

```
 ┌──────────────── board (page coordinates) ─────────────────┐
 │                                                           │
 │    ┌─────────────────────────────┐   ┌─ floating bar ───┐ │
 │    │ نكتب الحرف ب في أول الكلمة| │   │ A− A+ ■■■■ B ⟲ ✓ │ │
 │    └─────────────────────────────┘   └──────────────────┘ │
 │      ↑ caret where the teacher tapped; the box grows       │
 │        as they type and wraps at the width they dragged    │
 └───────────────────────────────────────────────────────────┘
```

- **Tap to type.** With the Text tool, a tap creates an empty `TextElement` at that point
  and opens an `EditableText` **overlaid exactly on it**: positioned by the canvas's
  page-to-screen transform and scaled with the zoom.
  - The keyboard opens on a tablet.
  - No dialog, and nothing modal: pan and zoom still work while editing.
- **Commit** happens on a tap outside, Escape, or switching tool. It is one undo step for
  the whole edit. An empty text is discarded, with nothing to undo.
- **Re-edit:**
  - a **double tap** on any text, with any tool;
  - Enter on a selected text (web);
  - the caret goes to the tap point.
- **Move, resize, rotate:**
  - the selection frame gains a **rotate handle** above the box;
  - dragging the side handles changes the **wrap width**, while the corners scale the font;
  - rotation snaps to 0°, 90°, 180° and 270° within 5° (Shift snaps every 15° on the web).
- **Style bar** (floats above the text while it is selected or edited):
  - A− / A+ through the presets 24, 32, 48, 64, 96 and 144;
  - the 6 quick colours;
  - **bold**;
  - a done check.
  - The last style is remembered per board for the next text.
- **Direction:**
  - each paragraph takes its direction from its first strong character, the same rule as
    chat's `text_direction.dart`;
  - Arabic paragraphs are right-aligned and Latin ones left-aligned;
  - a mixed line follows the Unicode bidirectional algorithm (SkParagraph);
  - the default font is the app's Arabic-first face.
- **Document format** (additive, so PD-39 boards open unchanged): `TextElement` gains
  `bold` (bool, default false) and `rotation` (radians, default 0).
  - The server's document check already allows extra fields on `text`; only `verse` is
    closed (`whiteboard-document.ts`).
  - An older client keeps the fields: it saves elements it does not fully understand as they
    came.
- **Quran paths are not touched:** `quran_text_repository.dart`, the Quran fonts, and
  `VerseElement` are Code Owner paths. Verses keep their own insert flow.

### A2 · Pen ergonomics (PR-2)

- **Presets on the bar, not in menus:**
  - 3 widths (fine 3, medium 6, bold 12; the highlighter uses 3× each);
  - 6 colours (ink, red, blue, green, orange, purple; on a dark page, white replaces ink).
  - A long press opens the existing full palette.
- **Smoothing:** keep `_smooth`. Add a small input filter (a one-euro or moving average over
  the last 3 points) for mouse and finger, which jitter most. A stylus keeps its raw points
  and pressure.
- **Pressure:** unchanged (Apple Pencil, or any stylus that reports it). Mouse and finger
  use a constant width.
- **Erasers:**
  - the stroke eraser removes whole strokes;
  - the area eraser shows its circle under the pointer and splits strokes (both exist);
  - the inverted stylus end still erases.
- **Palm rejection:** unchanged behaviour (touch pans once a pen is seen), now covered by a
  widget test on an iPad-size layout.

### A3 · Lasso (PR-2)

- A **freehand lasso**:
  - an element is selected when its bounds' centre lies inside the closed path, or when a
    stroke has at least 50% of its points inside;
  - a quick click-drag on empty space with the Select tool is still the rectangle (that
    marquee is kept).
- A selection can be:
  - moved;
  - resized (the corners keep proportions; Shift frees them);
  - rotated (text, stamps and images);
  - **copied, then pasted** offset by 24 px (Ctrl/Cmd+C/V, also on the bar);
  - deleted (Delete or Backspace);
  - duplicated (Ctrl/Cmd+D).
- Verses and images can be selected and moved like anything else. Copying a verse copies
  the **reference**, never text, so PD-39's rule holds.

### A4 · Laser pointer (PR-3)

- The tool draws a bright trail that **fades over 700 ms** and then disappears.
- It lives only in an overlay layer above the page painter: never in `BoardPage`, never in
  undo, never saved or exported.
  - A test asserts that a page's saved JSON and its export are byte-identical before and
    after laser use.
- A realtime message type `board.laser` is **reserved and documented** (throttled to
  20 Hz, as PD-39 §5.1) and **not sent** until a live board share exists.

### A5 · Page backgrounds (PR-3)

- **Blank** (`plain`), **lined** (`arabic_lines`: a baseline and an upper guide spaced for
  children's letters, as built), **grid**, and a new **dotted** (`dotted`: a 32-unit dot
  grid).
- Ruled and narrow-ruled stay.
- The page-settings sheet shows the four as large thumbnails first, then "More".
- **Migration `20261102120000_chat_pd055_board_dotted_layout`:** it widens the
  `whiteboard_page.layout` CHECK to include `'dotted'`.
  - The API's `LAYOUTS` and the export renderer (it draws through the same painter) are
    updated with it.
  - It is additive and idempotent (G-19). The rollback re-narrows the check after mapping
    `dotted` back to `plain`.

### A6 · Floating toolbar, touch, keyboard (PR-1 base, PR-6 polish)

```
 ┌────────────────────────────────────────────────────────────────────┐
 │ ← Board title            ↶ ↷        Page 2/5 ▾       ⋯   Share/Export│  top: board-level
 ├────────────────────────────────────────────────────────────────────┤
 │                                                                    │
 │                    [ the page ]                                    │
 │                                                                    │
 │   ┌──────────────────────────────────────────────────────────┐     │
 │   │ ✋ ▢lasso ✎pen ▤hl ⌫ T ◯shape ✦laser │ ★ Rewards │ ●●●●●● ─ ━ █ │  bottom: tools,
 │   └──────────────────────────────────────────────────────────┘     │  then the CONTEXT
 └────────────────────────────────────────────────────────────────────┘  of the active tool
```

- **Two bars:**
  - board-level at the top (back, undo/redo, pages, more);
  - a **floating tool dock** at the bottom centre, which the teacher can drag to either
    side.
  - The dock's right part is **contextual**: pen widths and colours for the pen, the text
    style for text, the eraser mode for the eraser, and the selection actions for a
    selection.
- **Every target is at least 44×44 px** (the 48 dp Material minimum on touch). A test walks
  the dock's tappable widgets and checks their sizes.
- **Web shortcuts:**

  | Keys | Tool or action |
  |---|---|
  | `V` | select / lasso |
  | `H` | hand |
  | `P` | pen |
  | `I` | highlighter |
  | `E` | eraser (`Shift+E` area eraser) |
  | `T` | text |
  | `L` | laser |
  | `S` | shapes |
  | `R` | rewards |
  | `1`–`3` | width presets |
  | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | undo, redo (exist) |
  | Ctrl/Cmd+C, V, D | copy, paste, duplicate |
  | Delete | delete |
  | Escape | end the edit or clear the selection |
  | Space-drag | pan |

  - Shortcuts never fire while typing in a text box.
  - A "Keyboard shortcuts" sheet (`?`) lists them in both languages.

---

## 3. B — Encouragement for children aged 5–12

### The rules (decided; enforced in code and tests)

1. **The teacher controls everything.** Nothing is awarded automatically, and the child
   cannot award anything.
2. **Praise only:**
   - no negative marks, no "lost a star", no red crosses on a child;
   - a mistaken award can be **undone by its teacher within 2 minutes**. The undone award
     disappears from the family's view, and nothing negative is ever shown.
3. **No comparisons, ever:**
   - no leaderboard, no ranking, no "top of the class";
   - one family never sees another child's tally;
   - the API has no route that returns more than one learner's tally to a family.
4. **General praise only:** no Quran, du'a or other religious text in the tray. A teacher
   may type their own praise (at most 40 characters). It is the teacher's words, shown as
   typed.
5. **No emoji:** stickers are drawn from bundled icons and our fonts (PD-39 §4.1).

### B1 · The reward tray (PR-4)

```
 ┌─ Rewards ───────────────────────────────────────────── ✕ ─┐
 │ For:  ( Adam ✓ )  ( Jana )  ( Everyone )                  │  learners of the teacher's
 │                                                           │  lesson(s) happening now
 │ ★ Star                                                    │
 │ Stickers:  medal  trophy  rocket  sun  rainbow  crown     │  drawn icons, not emoji
 │            balloon  heart  thumbs-up  check               │
 │ Praise:   [ممتاز] [أحسنت] [رائع] [بطل]                      │
 │           [Excellent] [Well done] [Great] [Champion]       │
 │           [+ My own words…]                               │
 │                                                           │
 │ [ Celebrate ]                        Adam ★★★★☆ 4/6 → Silver│
 └───────────────────────────────────────────────────────────┘
```

- **One tap places it.**
  - On a tablet, the tapped reward drops at the centre of the visible page with a small pop
    animation. The teacher can drag it anywhere.
  - On the web, it follows the pointer until the next click.
  - It is a normal `stamp` element (move, resize, rotate, delete).
- **"For":** the learners of the teacher's lessons that are **on now**, meaning between 10
  minutes before the start and 30 minutes after the end, and not cancelled, voided or a
  no-show.
  - When one learner is on, they are preselected.
  - With a learner chosen, placing a reward **also records it** for that child: one star
    toward their tally. With "Everyone", one is recorded per learner.
  - With no lesson on, the tray still decorates the board, and the "For" row reads "Rewards
    count during a lesson".
- **Praise stamps:** ممتاز, أحسنت, رائع, بطل and Excellent, Well done, Great, Champion,
  each in the app's display face. Custom praise goes through a single-line field, at most
  40 characters.
- **The sticker set** is a closed catalogue in code and on the server (the
  `sticker_key` check), so the parent's app can draw every key.
  - New stickers ship with a client release plus a one-line server allow-list change.
  - The keys: `star`, `medal`, `trophy`, `rocket`, `sun`, `rainbow`, `crown`, `balloon`,
    `heart`, `thumbs_up`, `check`.
  - Each is a Material icon with a fill colour from `BoardPalette`.

### B2 · Celebration (PR-4)

- **Celebrate** (one tap) sends a celebration for the chosen learner(s).
  - On the **family's app**, it plays a 2.5-second **confetti and stars burst** over the
    current screen (our own painter, with no new package). It shows a line such as "Your
    teacher celebrated Adam!", plus the tally line when a star came with it.
  - On the teacher's board, it plays the same burst locally, so the teacher sees what the
    child sees.
- **Reach:** through the reward event and realtime (finding F1), so it works while the
  family is on a call screen, in a chat, or anywhere in the app.
  - The overlay is mounted in the **app shell** (`MaterialApp.builder`), not in any call
    file, so the frozen call code is untouched.
  - A celebration that arrives while the app is in the background is **not** pushed. The
    report card shows the result afterwards, and a burst arriving late is noise.
- **Sound:**
  - a 0.8-second chime **generated in the repo by a script** (a few sine notes, so it is
    our own work with no licence question), played with `just_audio` (already a
    dependency);
  - **on** by default on the family's device, **off** by default on the teacher portal and
    for staff;
  - a mute toggle is on the overlay itself and in Settings › Notifications;
  - silent when the device is muted (iOS ambient session).
- **Accessibility:**
  - the burst respects "reduce motion" (a gentle fade with a star badge instead of
    particles);
  - the text line is announced to screen readers;
  - nothing flashes more than 3 times a second.

### B3 · Star tally and badges (PR-5)

- **Per child, per lesson:** each recorded star, sticker or praise counts **one star**; a
  celebration counts none.
- **Badges** at configurable thresholds:
  - the key is `rewards.lesson_badge_thresholds`, default `[3, 6, 10]`;
  - the badges are **Bronze ★, Silver ★, Gold ★**, drawn as a ribbon around a star;
  - they are named for the effort ("Great effort", "Amazing effort", "Superstar"), never as
    a rank.
- **Where it shows:**
  - **On the board:** the tray's "For" chip shows the child's stars and a progress bar to
    the next badge. It is a HUD, not a page element, so it is never saved or exported.
  - **On the family's app:** the celebration line ("4 stars — 2 more for Silver!"), and the
    **lesson report card** (PD-11 / PD-15), which gains a row: "★ 7 stars · Silver ·
    ممتاز, أحسنت".
  - **Later, PD-54:** the same tally beside each lesson snapshot, from the same API.
- **Never shown:** a class total, another child's stars, or a lesson with zero stars
  presented as zero. The row is simply absent.

### B4 · Guardrails, tested

- The family routes return **one learner** and are checked against **the caller's own
  family**. A test proves that family A gets 404 on family B's child.
- No API field, event or screen carries a rank, a total over learners, or a comparison. A
  test greps the DTOs and l10n keys for "rank", "leader", "top" and "best of".
- An undo is the only "removal", and it is a neutral event (§4) that the family never sees.

### B5 · Persistence and access (PR-4 table, PR-5 reads)

See §4.

---

## 4. Data model and access

### 4.1 `chat.learner_reward_event` (migration `20261102130000_chat_pd055_learner_rewards`, PR-4)

```
chat.learner_reward_event                      append-only
  id               uuid pk default gen_random_uuid()
  organization_id  uuid not null  -> chat.organization
  learner_id       uuid not null  -> chat.learner
  lesson_id        uuid not null  -> chat.lesson        (rewards count only in a lesson)
  teacher_id       uuid not null  -> chat.teacher       (who gave it)
  board_id         uuid null      -> chat.whiteboard    (where, when placed on a board)
  kind             text not null  check in ('star','sticker','praise','celebration','undo')
  sticker_key      text null      check in (the closed catalogue)      -- kind = 'sticker'
  praise_key       text null      check in ('excellent','well_done','great','champion',
                                            'excellent_ar','well_done_ar','great_ar','champion_ar')
  praise_text      text null      check (char_length <= 40)            -- custom words
  undoes           uuid null      -> chat.learner_reward_event         -- kind = 'undo'
  client_event_id  uuid not null
  created_at       timestamptz not null default now()
  unique (teacher_id, client_event_id)        -- a retried tap records once
  index (learner_id, lesson_id), index (lesson_id)
```

**The guard trigger** (`security definer`, pinned `search_path`, PUBLIC revoked):
- the lesson is this learner's, taught by this teacher, in this organisation, and
  `now()` is inside the award window (§3 B1);
- `sticker_key` / `praise_*` are set exactly when `kind` needs them;
- an `undo` names an event of the **same teacher, learner and lesson**, made at most 2
  minutes earlier, not itself an undo and not already undone.

**Append-only:** a trigger refuses UPDATE and DELETE, and a statement trigger refuses
TRUNCATE. This is the same pattern as `whiteboard_access_log` and `parent_notice_ack`.

**Row-level security** (enabled; **no blanket policy**; the memory of the `for all to
chat_app using (true)` trap applies):

```sql
-- write: the learner's own teacher, as themself
create policy learner_reward_event_insert on chat.learner_reward_event
  for insert to authenticated
  with check (
    teacher_id in (select chat.current_actor_ids())
    and teacher_id = (select l.teacher_id from chat.learner l where l.id = learner_id));

-- read: that teacher; the learner's family contacts; the teacher's supervisors
create policy learner_reward_event_read on chat.learner_reward_event
  for select to authenticated
  using (
    teacher_id in (select chat.current_actor_ids())
    or exists (select 1 from chat.learner l join chat.contact c on c.family_id = l.family_id
                where l.id = learner_id and c.is_active and c.id in (select chat.current_actor_ids()))
    or (select l.teacher_id from chat.learner l where l.id = learner_id)
         in (select chat.staff_supervised_teacher_ids(chat.current_staff_id())));
```

- Grants: `select, insert` to `authenticated` only; no update or delete for anyone.
- Workers connect as `chat_service` (RLS bypassed by design) and only read.
- A **runtime-RLS spec** connects as `chat_app` and checks four things:
  - an unrelated parent sees **zero** rows;
  - another teacher can neither insert nor read;
  - a supervisor of a different teacher sees nothing;
  - UPDATE and DELETE fail for every role.
- **The API makes the same decisions in code first.** It does not depend on RLS: RLS is
  the second line, as on every other domain table.

**Config rows** (same migration): `rewards.enabled` (false), `rewards.lesson_badge_thresholds`
(`[3,6,10]`), `rewards.award_window_before_minutes` (10) and
`rewards.award_window_after_minutes` (30).

**Rollback** (`db/rollback/20261102130000_pd055_learner_rewards.down.sql`): drops the
table, its functions and the config rows. Turning the switch off is the first lever, and
it keeps the data.

### 4.2 API (PR-4 writes, PR-5 reads)

| Route | Who | Notes |
|---|---|---|
| `GET /teacher/rewards/now` | a teacher | The learners of their lessons that are on now, with each one's tally. It feeds the tray's "For". |
| `POST /learners/:learnerId/rewards` `{lessonId, kind, stickerKey?, praiseKey?, praiseText?, boardId?, clientEventId}` | the learner's teacher (`@NotForStaff`, not a support session) | 201 `{event, tally}`. It is idempotent on `clientEventId` and throttled (30 per minute per teacher). |
| `POST /learners/:learnerId/rewards/:id/undo` | the same teacher, within 2 minutes | 201 `{tally}`. |
| `GET /lessons/:lessonId/rewards` | the lesson's teacher; the learner's family contacts; staff with `lessons.view` who supervise the teacher | `{stars, badge, nextBadgeAt, praise[]}`, for **one** learner (a lesson has one learner). |

- **Events:** `learner.reward_given {learnerId, lessonId, kind, stickerKey?, praiseKey?,
  praiseText?, tally}`, enqueued in the **same transaction** as the row.
  - It is delivered to the learner's live family contacts and to the teacher's own other
    sessions. Delivery checks each recipient at delivery time (RT-009 `withDeliveryLocks`),
    so a contact removed after the award gets nothing.
  - An undo emits `learner.reward_undone {lessonId, eventId, tally}` to the same audience.
    The family's app quietly updates the tally.
- **Report card:** the lesson-report DTO the family reads gains an optional
  `rewards: {stars, badge, praise[]}`, null when there are none.
- **PD-40:** no new staff key. Staff reads go through the existing `lessons.view`, scoped by
  `staff_supervised_teacher_ids`. The route table is regenerated in the PR.

---

## 5. Delivery

Each PR:
- starts with failing tests;
- carries both Arabic and English strings;
- is verified in Flutter web (the teacher portal) and at iOS sizes (iPad editing, iPhone
  family view);
- runs the full Flutter suite before it is reported, under the load rule.

| # | PR | Content | Tests (failing first) | Risk / rollback |
|---|---|---|---|---|
| 0 | **Plan** (this) | This document, PD-55, two slot claims. | — | — |
| 1 | **Inline text** (the owner's pain point) | The `_askText` dialog is removed. Tap to type in place; double tap to re-edit; the text style bar (size presets, colour, bold); rotate; wrap-width handles. `TextElement.bold` and `.rotation`. Direction per paragraph. The floating dock's skeleton with 44 px targets. | **Widgets:** tapping with the Text tool shows an `EditableText` at the tap point and no `AlertDialog`; typed text commits on tap-outside as one undo step; empty text is discarded; a double tap re-edits; bold, size and colour persist through save → reload; an Arabic paragraph lays out RTL and a Latin one LTR; a rotated text hit-tests where it is drawn. **Document:** a PD-39 text without the new fields reads as before; the server accepts the new fields (existing API spec plus a case). **Golden:** AR and EN. | Board UX regression. The PD-39 editor suite runs unchanged. Rollback: revert. |
| 2 | **Pen, eraser, lasso** | Width and colour presets on the dock; the finger and mouse input filter; the visible area-eraser radius; the freehand lasso; copy, paste and duplicate; rotating a selection. | The filter keeps a stylus's raw points; a lasso selects by centre and by 50% of a stroke's points; copy and paste offsets and gives new ids; a copied verse copies the reference only (no text field in its JSON); palm rejection on an iPad-size layout; dock targets ≥ 44 px. | Low. Rollback: revert. |
| 3 | **Laser, backgrounds** + migration `20261102120000` | The laser overlay (700 ms fade); `dotted` in the client, the API `LAYOUTS`, the export renderer and the DB CHECK; the background picker with thumbnails. | The saved page JSON and the export bytes are identical before and after laser use; the laser is never in undo; the API refuses an unknown layout and accepts `dotted`; the migration applies twice cleanly (G-19); the rollback maps `dotted` → `plain`. | Constraint change on a populated table (additive only). Rollback script. |
| 4 | **Reward tray + celebration** + migration `20261102130000` | The table, the guard, RLS, config, the POST routes and undo, the outbox events and realtime delivery. Flutter: the tray, stamp placement, "For", the app-shell celebration overlay, the generated chime, the mute settings. Behind `rewards.enabled`. | **API integration:** the award window; another teacher → 404 and no row; a family contact cannot POST; idempotency (two posts with one `clientEventId` make one row); undo within 2 minutes and not after; UPDATE/DELETE/TRUNCATE refused; the runtime-RLS spec as `chat_app`; an event is enqueued in the same transaction; delivery reaches only that learner's live contacts (a removed contact gets nothing). **Flutter:** the tray places a stamp *and* posts once; "Everyone" posts once per learner; with no lesson on, it decorates only; the overlay plays on a delivered event on any screen and respects reduce-motion; sound is off for the teacher and on for the family, and mutes. | **Privacy** (a child's rewards reaching the wrong family). Mitigated by the predicate matrix, RLS, RT-009 delivery checks, and a security review of the diff. Rollback: switch off. |
| 5 | **Tally + parent view** | `GET /lessons/:id/rewards`, `GET /teacher/rewards/now`, badges from config; the tally HUD in the tray; the report card's rewards row; the celebration line with progress. | Tallies: undo excluded, celebration counts 0, thresholds from config. The family A / family B matrix, and supervisors scoped. No comparison anywhere (the DTO and l10n grep test). The report card shows the row only when stars > 0. Goldens at 375×812, AR and EN. | Low. Rollback: switch off. |
| 6 | **Polish + accessibility** | Shortcuts sheet, dock drag-to-side, Semantics labels on every tool and reward, contrast checks on board colours, the reduce-motion path, a focus order for keyboard use. | A semantics test per tool; contrast ≥ 4.5:1 for dock labels (the gold rule); the keyboard-only flow: create text, style it, award a star. | Low. |

**Order:** 1 → 2 → 3 in sequence; they share the canvas and editor files. 4 can start after
1 (it touches different files: the tray, overlay and API), and 5 needs 4. 6 is last.

**Delegation:** well-specified, self-contained pieces can go to `codex-delegate` with an
exact acceptance test and narrow path globs. For example:
- the background painters (A5);
- the sticker icon catalogue and its painter (B1);
- the chime generator script.

Every delegated diff is reviewed and verified here.

**Machine load:**
- `flutter test --concurrency=2`;
- jest with `--maxWorkers=2` and integration `--runInBand`, on a private database;
- the full Flutter suite before every report.

---

## 6. What this does not touch

- **Quran:** `quran_text_repository.dart`, the Quran fonts, `VerseElement` and
  `apps/api/src/quran/`. These are Code Owner paths; verses keep PD-39's rules.
- **Calls:** no file under the frozen call code. The celebration overlay lives in the app
  shell.
- **PD-39's document rules:** element kinds are unchanged (`stamp` carries the rewards);
  the server's closed verse check is unchanged.
- **PD-54:** no student-board work. When it ships, its history view reads PR-5's API.
- **Children's own input** (a child drawing or tapping) stays out of scope, as in PD-39
  Phase 3.

## 7. Assumptions recorded (inferred, not asked)

1. **One star per recorded reward; a celebration counts none.** This is the simplest tally
   a 5-year-old can follow, and the teacher still chooses what to give.
2. **The award window** runs from 10 minutes before the start to 30 minutes after the end,
   for a lesson that is not cancelled, voided or a no-show. Both values are in config.
3. **Undo within 2 minutes**, by the same teacher, as a neutral event. This fixes a
   mis-tap without ever showing a child something taken away.
4. **No push for a celebration.** It is live or nothing; the report card carries the
   result.
5. **Sound defaults:** on for the family's device and off on the teacher portal and for
   staff. "Off by default for staff" is read as covering the teaching side, so the teacher
   does not hear their own chime.
6. **"Shown on the board"** means the tray's HUD for the teacher, not an element saved
   into the page, so exports and PD-54 history never carry a tally.
7. **The parent's place** is the lesson report card now, and PD-54's history later
   (finding F2).
