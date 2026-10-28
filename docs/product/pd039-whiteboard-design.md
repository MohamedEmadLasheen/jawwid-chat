# PD-39 · The teacher whiteboard — design and MVP proposal

Status: **DECIDED by the owner, 2026-10-28** (all five questions, with safeguards; §10).
Code waits for the department head's GO (machine-load cap). No feature code exists yet.
Claimed in `pd-registry/PD-39.md`. Migration slot `20261028120000` (`chat_pd039_whiteboards`)
is assigned by the department head; earlier claims 20261027110000, 20261027120000 and 20261028110000 went to other PDs.

The owner's request (2026-10-27): "we need to add in teacher account this one: Spahboard
Interactive Whiteboard". The owner sent a feature analysis of Spahboard in eleven groups
(drawing tools, geometry, workspace, imports, games, 3D science, Quranic verses,
calculator/timer/stamps, camera and recording, pages and export, sharing). The owner asked
us to separate **built-in features** from **activities teachers create with the tools**.

This document recommends what to build first, where to build it and how, and what to
leave out. §9 has the owner's five questions and answers. §10 maps each of the owner's
safeguards to its mechanism and test. §11 checks the design against permissions,
storage and backups.

---

## 1. Summary

| | Recommendation |
|---|---|
| **Surface** | The **Flutter teacher portal** (`lib/`). One build serves the laptop browser (PD-28 `/teacher/`, the primary target) and tablets. Phones open boards read-only. No React and no Admin Web. |
| **Engine** | **Build on Flutter** (`CustomPainter` / `Canvas` with CanvasKit). **No new client dependency** in the core MVP. Excalidraw, Fabric.js and Konva are MIT but would mean a JavaScript island inside a Flutter app. tldraw is ruled out: its licence forbids production use without a paid key. |
| **MVP** | Pen, highlighter, eraser, text, shapes, lines and arrows, select/move, undo/redo, zoom/pan, colours and thickness, a small stamp set. Backgrounds (plain, ruled, narrow-ruled, grid, Arabic handwriting lines). Multiple pages. Image import. **Quran verses from a verified Uthmani source**, inserted by reference and never editable. Save to the teacher's account. Export to PNG and PDF. |
| **MVP-b** | PDF page import, but only if the head approves one new dependency (`pdfrx`, MIT) after a lockfile and binary-source review. Otherwise teachers import a page as an image. |
| **Phase 2** | A live "board view" for students during a lesson, with no change to call code. Plus a laser pointer, a timer, Tajweed letter colouring, verse search by words, ruler and auto-shapes, and board replay. |
| **Out of scope / Phase 3** | Games, 3D science, the periodic table, anatomy, the calculator, website and YouTube embeds, camera, and audio/video lesson recording. Games and existing activities are reachable through PD-29 Materials, not rebuilt inside the board. |

---

## 2. Where it lives

### What exists

- **The teacher portal is the Flutter app** (`lib/`). PD-28 (2026-10-24) put the same app
  in a laptop browser at `<admin web>/teacher/`, rendered by CanvasKit, because "teachers use
  their portal in a laptop browser". Teachers also use it on phones and tablets.
- **Admin Web** (React) is for staff. Teachers never sign in there, and PD-28 chose not to
  build a second teacher client.
- The teacher's tabs are **Chats · Schedule · Calls · Settings** (`lib/app/shells/app_shell.dart`).
  The Teacher Account was frozen on 2026-10-01 as "a communication app". PD-9/PD-10 reopened
  it for Schedule. This request reopens it again, by the owner's decision.

### Recommendation: the Flutter teacher portal, laptop first

- **One codebase for every teaching device.** The board written once in Dart runs in the
  PD-28 browser bundle (laptop), on tablets (iPad with Apple Pencil, Android with stylus)
  and on phones. Any web-only engine would need a WebView on mobile and an `HtmlElementView`
  on the web: two embedding paths, two input stacks, and a JavaScript bridge to keep secure.
- **Laptop is the primary target.** Acceptance testing happens in Chrome at `/teacher/` with
  a mouse, a trackpad and a pen tablet. Tablets are the second target.
- **Phones open boards read-only.** A teacher can show a saved board from a phone, but
  drawing is not offered below 600 dp on the shortest side. A phone toolbar would cover
  half the canvas. (Owner question 3.)
- **Entry points.**
  - A **Boards** tab for teachers only, after Schedule. It is shown on the web and on tablets.
  - **Open board** on a lesson in Schedule, which opens or creates that lesson's board.
  - The tab is the one IA change. If the owner prefers no new tab, Boards can sit under
    Schedule instead.

---

## 3. Build or integrate

Licences were read from published metadata only (the npm registry, pub.dev and the
projects' LICENSE files) on 2026-10-27. Nothing was installed or run.

| Option | Licence | Fit with our stack | Arabic / RTL text | Pen and touch | Bundle | Verdict |
|---|---|---|---|---|---|---|
| **Flutter CustomPainter** (ours) | — (our code) | Native. Same app, same auth, same API client, same tests. | SkParagraph + HarfBuzz in CanvasKit. Full Arabic shaping and bidi, with our bundled fonts (IBM Plex Sans Arabic, plus Amiri / Amiri Quran, both OFL 1.1). Already proven in chat. | `Listener` gives pressure, tilt and `PointerDeviceKind.stylus` on iPad, Android and browser Pointer Events. Palm rejection: when a pen is seen, touch pans and zooms instead of drawing. | ~0 new deps. Roughly +0.3–0.5 MB of Dart, plus about 0.5 MB of fonts. | **Recommended** |
| Excalidraw | MIT (© 2020 Excalidraw) | A React component. It would need React inside Flutter web (`HtmlElementView`) and a WebView on mobile, with state bridged through `postMessage`. | Canvas text with long-standing RTL limitations. Only its own font set, so verses in a Quran font would need a fork. The hand-drawn (rough.js) look does not suit Quran text. | Good pen support (perfect-freehand). | npm 0.18.1: **31 dependencies**, 46.8 MB unpacked, several MB shipped. All of it needs a lockfile review on a machine with a malware history. | No |
| tldraw | **tldraw licence**: "Not to use the Software in Production Environments" without a trial or commercial licence. Licence-key enforcement, watermark. | React, same embedding problem. | Reasonable. | Good. | Large. | **Ruled out** (paid key, plus the React island) |
| Fabric.js | MIT (7.4.0, no runtime deps, 22 MB unpacked) | A canvas object model only. We would still build every tool, page, save and UI, in JS, behind a bridge. | Canvas `fillText`. Arabic shaping depends on the browser; no control of OpenType features for Quran marks. | Pointer events; pressure is ours to add. | Small. | No: all the work of building, plus a bridge |
| Konva | MIT (10.9.0, no runtime deps, 1.9 MB) | Same as Fabric. | Same. | Same. | Small. | No: same reason |

**Why build:**

- The hard parts of a teaching board are not the canvas library. They are:
  - Arabic text and Quran rendering;
  - saving to our server under our authz;
  - pages, export and pen ergonomics;
  - in Phase 2, our realtime with per-recipient delivery checks (RT-009).
- An embedded JS engine gives us none of those for free. It costs us a second runtime, a
  bridge to secure, and a dependency tree to audit.
- Flutter's canvas is GPU-backed (CanvasKit on the web, Impeller on mobile) and handles the
  stroke volumes a lesson produces. Committed strokes are cached in one `Picture` per page
  layer, so only the stroke being drawn repaints.

**What we write ourselves:**

- **Stroke smoothing.** About 200 lines. We either port the MIT perfect-freehand algorithm,
  with attribution in the file, or write quadratic smoothing.
- **Hit-testing** by element bounding box, then by geometry.
- **The text editor:** a `TextField` overlay while typing, which becomes a painted element.
- **Undo/redo** as a command stack of element operations.

**Dependency rule for this PD:**

- The core MVP adds **no package**.
- Two capabilities have no flutter.dev package, so we use our own stack instead:
  - **PDF export**: the API already ships `pdfkit` (used by certificates).
  - **PNG download** in the browser: `package:web`, already a dependency.
- **PDF import** is the one feature that needs a rasteriser. See §4.4.

---

## 4. MVP

### 4.1 Built-in tools (what the board itself does)

| Tool | MVP behaviour |
|---|---|
| Pen | Pressure-sensitive where the device reports it. 8 colours plus a custom picker, 4 thicknesses. Smoothing on. |
| Highlighter | Translucent (opacity 35%), drawn under the ink layer so text stays readable. Includes a **Tajweed palette**: four named swatches (madd, ghunnah, ikhfa', izhar) in the academy's colours, so marking a verse by hand is one tap per rule. |
| Eraser | Stroke eraser (removes whole strokes) and area eraser (splits strokes). |
| Text | Arabic and English, direction from the first strong character. Two fonts: IBM Plex Sans Arabic (UI style) and Amiri (Naskh, for teaching letters with harakat). Size and colour. |
| Shapes | Rectangle, ellipse, triangle, line, arrow (single and double). Stroke and fill colours. Shift keeps proportions. |
| Select / move | Tap or lasso to select. Move, resize, rotate, delete, duplicate. Bring forward / send back. |
| Undo / redo | Per page, 100 steps. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z on a keyboard. |
| Zoom / pan | Pinch, trackpad, Ctrl+wheel. Hand tool and space-drag on a laptop. 25%–400%. Fit page. |
| Stamps | A small built-in set: star, check mark, heart, thumbs-up, and text stamps ("ممتاز", "أحسنت", "Excellent", "Well done"). Drawn from bundled Material icons and our fonts, never emoji (emoji render as boxes in the PD-28 browser build). |

### 4.2 Pages and backgrounds

- **Multiple pages**: up to 50 per board. Add, duplicate, reorder, delete. A thumbnail strip.
- **Page size**: one fixed 16:9 page (1920 × 1080 logical units). Zoom and export are
  predictable, and a shared board (Phase 2) looks the same on every screen. An "infinite
  canvas" is not in the MVP.
- **Layouts**:
  - plain;
  - ruled;
  - narrow-ruled;
  - grid;
  - **Arabic handwriting lines**: a baseline plus an upper guide, spaced for children's
    letter practice.
- **Background colours**: white, cream, light grey, blackboard green, dark.
- Isometric, graph, nine-line and four-line (Latin handwriting) are Phase 3, if maths or
  English is ever taught.

### 4.3 Quran verses (the owner's item 7)

The rule: **verse text is never typed, OCR'd, generated or edited by anyone at Jawwid.**

- **What exists today.**
  - PD-29 Materials has the 114 surahs' **metadata only**: number, Arabic and English names,
    ayah counts, juz' (`apps/api/src/materials/quran-surahs.ts` = `chat.quran_surah`).
  - PD-29's "Practice" refers to ayah *ranges* by number.
  - There is **no verse text anywhere in the system**, and no authorised source for it.
  - PD-29 also left its recitation source open for the owner.
- **Proposed source: the Tanzil Project's Uthmani (Hafs) text** (owner question 2).
  - Licence: Creative Commons Attribution 3.0, under these terms: "Permission is granted to
    copy and distribute verbatim copies of this text, but CHANGING IT IS NOT ALLOWED", with
    the source credited and a link to tanzil.net.
  - The alternative is the King Fahd Complex (KFGQPC) Hafs text and font. Its terms need
    to be read and confirmed before we could use it.
- **One shared dataset, built by PD-29, consumed here.**
  - PD-29's materials-quality plan (#170, item P0-2) needs the same verified text,
    plus per-ayah audio and reviewed Tajweed marks.
  - So there is **one** dataset and **one** module (`apps/api/src/quran/`). PD-29 P0-2
    builds it, on its own migration slot. PD-39 only reads it, and its own migration does
    not create Quran tables.
  - PD-29 and PD-39 agreed the contract on 2026-10-27. The full text is
    [`quran-dataset-contract.md`](quran-dataset-contract.md). It is built by PD-29 as
    PR #176, **merged to main**, with dataset `tanzil-uthmani-1.1` and module
    `apps/api/src/quran`, which exports `QuranTextService`. This section only summarises it.
  - The pinned source file lives at repo root, `data/quran/`. That way PD-29's lessons
    engine bundles the same file, and CI checks its hash and counts.
- **How it is stored (the shared contract).**
  - `chat.quran_dataset (id, sha256, attribution, source_url, loaded_at)`: one row per
    pinned source file, for example `tanzil-uthmani-1.1`. The config key `quran.dataset`
    names the current one.
  - `chat.quran_ayah` holds all 6,236 ayat, **verbatim** from the file.
    - Each ayah is also split into `{basmala, verse}`.
    - `verse_sha256` is the SHA-256 of the verse's UTF-8 bytes.
    - `text_search` is a diacritic-free copy, derived in the database from the verse, for
      search (Phase 2). It is never shown.
  - **The Basmala** (settled on #176, 2026-10-27).
    - Tanzil writes it in front of ayah 1 of 112 surahs, every surah except Al-Fatihah and
      At-Tawbah. The API serves it apart: `basmala` is a string for those 112 ayat, otherwise
      null, and `text` is the verse without it.
    - In Al-Fatihah, 1:1 *is* the Basmala and stays the verse. At-Tawbah has none. A Basmala
      inside an ayah (27:30) is part of the verse.
    - A served Basmala is always one of two accepted spellings, whose hashes are fixed in
      code (`BASMALA_SHA256`). The load refuses anything else.
    - **Everything is defined against the verse** (`text`): the per-ayah `sha256`,
      `rangeSha256`, Tajweed offsets and audio. The Basmala is never part of a hash or a
      reference.
  - The loader checks:
    - the file's SHA-256 against a pinned constant;
    - 6,236 rows and 114 surahs;
    - each surah's count against `chat.quran_surah.ayah_count`;
    - all in one transaction.
  - No role can write to the tables (a trigger refuses UPDATE and DELETE), and request roles
    get no grants. It is organisation-independent reference data.
  - Tajweed marks use Unicode code-point offsets into the verse (`text`). A mark is served only
    when two things hold:
    - the mark itself is approved;
    - an academy Quran teacher has signed off its surah for the same source version.
  - The Tajweed marks belong to PD-29, and PD-39 Phase 2 colours letters from them.
  - So does the per-ayah audio. The 30-ayah sheet below reviews the *text rendering* only;
    Tajweed needs that full per-surah review.
- **How it is inserted.**
  - The verse tool lets the teacher pick a surah (by Arabic or English name, or number),
    then an ayah range of up to 20 ayat.
  - The board stores a **reference** — `{surah, fromAyah, toAyah, datasetId, rangeSha256}` —
    never the text. `rangeSha256` is the SHA-256 of the ayat's verse `sha256` values joined
    with "\n", in ayah order. It never covers a Basmala.
  - The text is fetched from `GET /quran/ayahs?surah=&from=&to=`.
    - It allows at most 50 ayat; a bad range answers 422 `COMM.QURAN_INVALID`.
    - It returns the dataset (id, SHA-256, attribution, source URL), the server's own
      `rangeSha256` (the same formula), and, for each ayah:
      - `basmala` (string or null);
      - `text` (the verse);
      - `sha256` (of the verse only).
    - Any failed verification answers 503 `COMM.QURAN_UNAVAILABLE`. The board then shows
      "Quran text unavailable" in the verse's place, **never a fallback text**.
  - The text is drawn with **Amiri Quran** (OFL 1.1), with ayah-end markers (۝ plus the
    number) and line breaking that never splits a word.
  - When the range starts at an ayah 1 whose `basmala` is not null, the Basmala is drawn as
    **its own centred line above the verse**. It is never run into the verse and carries no
    ayah number.
  - Tajweed marks and the teacher's letter selection (Phase 2) apply to the verse only, never
    to the Basmala line.
  - The teacher can move it, resize it, change its colour and alignment, and mark it with
    the highlighter or Tajweed palette. The letters cannot be edited or cut. A "Duplicate as
    text" action does not exist.
  - If the stored hash ever differs from the served text, the element shows "Verse text
    updated, re-insert". It is never silently redrawn.
- **Attribution.** The verse picker and every PDF export that contains a verse carry
  "Quran text: Tanzil Project — tanzil.net".
- **Review before release.**
  - A Quran teacher at the academy signs off a printed review sheet of about 30 ayat chosen
    for difficult marks. That means: small high letters, madd signs, sajdah, the
    iqlab/ikhfa' marks, pause signs, and surahs with muqatta'at.
  - The sheet is printed from the real renderer on the web build and on an iPad.
  - The font is the only variable. If Amiri Quran draws any mark wrongly, we change the
    font, never the text.
- **Not in MVP:** automatic Tajweed colouring and search by words. Both are Phase 2 (§5).

### 4.4 Importing images and PDF pages

- **Images**: PNG, JPEG or WebP, up to 10 MB and 8,000 px on the long edge. Placed on the
  page and scaled to fit. **SVG is refused** (it can carry script). A GIF imports as a still
  first frame.
- **PDF pages (MVP-b, head's call).**
  - Flutter has no first-party PDF rasteriser, and the API image has none either.
  - The candidate is `pdfrx` 2.10.1: MIT (© espresso3389, verified publisher), built on
    PDFium, with web support.
  - Before approval, review three things:
    - its lockfile delta (`pdfrx_engine`, `pdfium_flutter`, and theirs);
    - **where the PDFium binaries come from** at build time (native) and at runtime (the
      web's `.wasm`). It must be self-hosted under `/teacher/`, never fetched from a CDN,
      because the PD-28 CSP names no third-party host;
    - whether CanvasKit's `'wasm-unsafe-eval'` already covers PDFium's wasm.
  - Server-side rasterising is rejected. MuPDF is AGPL, and poppler or PDFium would add
    native binaries to the API image.
  - **Fallback if not approved:** the teacher exports the page as an image and imports that.
    The board ships without PDF import.
- Each imported page becomes one locked background image on a new board page, so the
  teacher writes over it.

### 4.5 Saving to the teacher's account

- **Autosave.**
  - A board saves 2 s after the last change, and on page switch and on leaving.
  - Each page saves separately, with optimistic concurrency: `PUT .../pages/:pageId` with
    `If-Match: <revision>`.
  - A conflict (the same board edited in two tabs) answers 409. The client offers "Reload"
    or "Save as a copy" and never merges silently.
- **Offline.**
  - Editing continues while offline, and saves are retried with backoff.
  - The unsaved page is kept as a local draft (sqflite on mobile; on the web, the browser's
    storage for the open board only, size-capped). A banner says "Not saved yet".
- **Document format.**
  - JSON per page: `{v, layout, background, elements: [...]}`.
  - Each element has `{id, kind, z, transform, style, payload}`.
  - Stroke points are quantised to 0.1 units and delta-encoded, with pressure as one byte.
  - A page is capped at 1 MB, checked by the database.
  - The format is versioned (`v`) so Phase 2 operations reuse the same element schema.
- **Assets** (images, PDF pages, exports) go in object storage, following the existing
  patterns. See §6.3.

### 4.6 Export

- **PNG**: the current page or all pages. Rendered on the device (`PictureRecorder`, 2×).
  On the web it downloads directly (`package:web`). On a tablet it goes through the server
  and opens the signed URL.
- **PDF**: the client renders each page to PNG and uploads them under an **export grant**
  bound to the board and to the page count. The API composes the PDF with **`pdfkit`**,
  which it already uses for certificates. The verse attribution goes in the footer when a
  verse is present. The result is a board asset with a 10-minute signed URL, and is purged
  after 24 h. Vector PDF is not planned: a second renderer would drift from the first.

### 4.7 What "built-in" versus "teacher-made" means

The owner asked to keep these apart. The board ships **tools**. Teachers make
**activities** with them:

| Activity a teacher makes | Built from these MVP tools |
|---|---|
| Tajweed lesson on a verse | Verse tool + Tajweed highlighter palette + pen |
| Letter-shape practice | Arabic handwriting lines + pen + Amiri text for the model letter |
| Letter matching / sorting (shown, the teacher drags) | Text elements + select/move + shapes |
| Vocabulary page with pictures | Image import + text + arrows |
| Reward and feedback | Stamps |
| Worksheet over an existing PDF | PDF page import (MVP-b) + pen |
| Reusable lesson template | Duplicate board / duplicate page |

**Interactive** activities, where the *child* plays (games, drag-and-drop by the student,
quizzes), are not board tools. They are PD-29 Materials (existing HTML5 packages and lesson
links). Phase 3 can add "open a material from the board".

---

## 5. Phase 2: during the lesson, and more tools

### 5.1 Live board view for students, without touching call code

**Constraint.** The W7/W8 call code is frozen. The LiveKit grant publishes `microphone` only
(`apps/api/src/communication/calls/media-token.ts`), so screen-sharing the board into the
call would reopen W1/W7. The board is therefore shared **beside** the call, over the
existing chat realtime channel.

**Starting a share.**

- The teacher presses **Share with the class**. The request is
  `POST /whiteboards/:id/shares {conversationId}`.
- It is allowed when all of these hold:
  - the teacher owns the board;
  - the teacher is a live member of that conversation and may send in it (the same
    `canSend` the message path runs);
  - the conversation is a student group, a trial group, or the teacher's direct
    conversation with a family;
  - the conversation is in the board's organisation.
- One active share per board. A share expires after 3 h or when the teacher ends it.

**The card.**

- The share posts a **system card** in that conversation: "The teacher is sharing a board ·
  Open". It goes through the existing message and outbox pipeline (the same mechanism as
  lesson cards).
- So the families who see the card are exactly those who can already read the conversation
  (PD-8, PD-14), and push follows PD-34.

**Viewing.**

- `GET /whiteboard-shares/:id` returns a snapshot: the current page, page documents, and
  board-scoped signed asset URLs with a short TTL.
- The snapshot is allowed only to a **live member who can read the conversation**, while the
  share is active.
- The viewer is read-only. It follows the teacher's page and viewport ("Follow teacher",
  which the viewer can turn off).

**Live updates.**

- Element operations (`board.op`, the same element schema as §4.5) and an ephemeral laser
  pointer (throttled to 20 Hz) travel on the existing Socket.IO connection.
- **Delivery is authorised per recipient at delivery time**, exactly as RT-009
  (`deliverToConversationLocally`, `withDeliveryLocks`): live membership, the
  session-precise identity, `canRead`, *and* "share still active".
- The room `wbshare:<id>` is only an index of whom to ask, never the authorisation.
- Ending the share, removing a member or suspending a subscription (PD-30) stops delivery at
  once, even on a node that missed an eviction.

**Sending operations.**

- The teacher's socket sends operations with a sequence number.
- The server checks every operation:
  - it is the share's owner;
  - the share is active;
  - the operation is at most 64 KB;
  - the rate is at most 60 operations per second.
- It also writes the board through, so a late joiner's snapshot is current.

**Scope limit.** **No student drawing** in Phase 2. Student interaction is Phase 3, behind
its own decision: who may draw, moderation, and saving children's input.

**To verify before building.** Can a student keep the call running while the call route is
off screen? `CallPresenter` pushes `/call` app-wide, and there is no `PopScope` on
`ActiveCallScreen`, so back probably pops it and leaves the call running.

- If returning to the call needs a new affordance, that is a **W7 exception the head must
  grant**. It is not part of this PD.
- On a laptop, the student's browser tab beside the call has no such issue. But students
  are not on the web today: PD-28 is teachers only.

### 5.2 Other Phase 2 tools

| Feature | Why Phase 2, not MVP |
|---|---|
| **Laser pointer** | Only useful when someone else is watching (5.1). |
| **Timer** | A countdown shown on the shared board. Useful for recitation turns and quizzes, and it needs 5.1 to reach the student. |
| **Tajweed letter colouring** | Colour a letter range of an inserted verse by rule. Arabic joining survives colour runs in SkParagraph, but the UI (selecting letters inside an unbreakable verse) and the rule colours need a Quran teacher's input. Automatic Tajweed from an annotated source is a separate licensing question. |
| **Verse search by words** | Uses `text_search` (diacritic-free) with Arabic normalisation (`lib/shared/utils/search_text.dart` already exists for chat). |
| **Ruler and auto-shapes** | A straight-edge overlay, and shape recognition (a rough circle becomes a circle). |
| **Board replay** | Replays the operation log of a lesson. It is privacy-safe because it contains no voice, and is cheaper than recording. |
| **Board file export/import** | Our own JSON format, for moving boards between teachers. |
| **Sticker library** | A curated, licensed set beyond the MVP stamps. Each pack needs its licence recorded. |

---

## 6. Data model and authorisation

### 6.1 Tables (migration `20261028120000_chat_pd039_whiteboards`)

```
chat.whiteboard
  id uuid pk
  organization_id uuid      not null, = the teacher's organisation (trigger-checked)
  teacher_id uuid           not null, the owning teacher; immutable (trigger)
  lesson_id uuid null       set when opened from a lesson; same organisation and teacher
  title text                1..120
  revision int              bumped on every page save
  bytes_total bigint        documents + assets, maintained for the quota
  state text                'active' | 'trashed' | 'retained'   (§10, safeguards 4 and 5)
  trashed_at, purge_after   set together when the teacher deletes; purge_after = +30 days
  retained_until            set when the teacher leaves: their deactivation + 12 months
  retention_notified_at     the expiry notice was sent (once)
  created_at, updated_at

chat.whiteboard_page
  id uuid pk, board_id fk, position smallint (0..49), unique (board_id, position) deferrable
  layout text check in ('plain','ruled','narrow_ruled','grid','arabic_lines')
  background text           a palette key, not free CSS
  document jsonb            octet_length <= 512 KB (§6.4)
  revision int, updated_at

chat.whiteboard_asset
  id uuid pk, board_id fk
  kind text check in ('image','pdf_page','export_page','export_pdf')
  object_key text unique    whiteboards/<org>/<board>/<asset> — a NAME, never a capability
  content_type, byte_size, sha256, width, height
  state text check in ('pending','ready')
  created_at, expires_at (exports only)

chat.whiteboard_access_log   append-only by trigger; no request-role grants (§10, safeguard 1)
  id bigint pk, organization_id, board_id, teacher_id
  viewer_id, viewer_kind    who acted
  basis text                'owner' | 'supervisor' | 'backup' | 'teachers_manager' | 'super_admin'
  action text               'open' | 'export' | 'trash' | 'restore' | 'copy' | 'purge' | 'retain'
  at timestamptz            now(), set by the database

-- Not here: chat.quran_dataset / chat.quran_ayah / chat.quran_tajweed_mark are PD-29
-- P0-2's migration (the shared dataset, §4.3). PD-39 reads them through QuranTextService.

-- Phase 2 (its own slot later):
chat.whiteboard_share
  id, board_id, conversation_id, started_by, started_at, ended_at, expires_at
```

Request roles get no table grants. Every read and write goes through the API's
services, as with every other `chat.*` table since the blanket-RLS trap.

### 6.2 Who sees and does what

| Who | Read a board | Write a board |
|---|---|---|
| The owning teacher (active account) | yes | yes |
| A **deactivated** teacher (left) | no | no. The boards are retained for 12 months (§10, safeguard 4). |
| The teacher's **assigned supervisor**, their **active backup**, the **Teachers Manager**: exactly `chat.staff_supervised_teacher_ids(staff, now())` | **read-only**, every access logged | no |
| Super admin of the organisation | read-only, every access logged | no |
| Other Teachers department members (not assigned to this teacher), **even while the PD-35 strict switch is OFF** | no | no |
| A PD-21 support session opened on the teacher's account | read-only | **no**: it is staff acting, not the teacher |
| Operations supervisors, Sales and other staff | no | no |
| Other teachers | no | no |
| Students and families | no (MVP). Phase 2: only the pages of an **active share** in a conversation they can read | never |
| Anyone in another organisation | no: answered **404**, not 403, as PD-35 does outside scope | no |

- **Organisation.** The organisation always comes from the actor, never from the request.
  A board id from another organisation is "not found".
- **Super admin cannot write.** Unlike PD-8's conversations, a board is the teacher's own
  work, and a staff edit would put words in the teacher's mouth (the same reason no one
  else writes a lesson report).
- **Every access is logged** in `chat.whiteboard_access_log`: the viewer, the time, the
  board and the basis. The row is written in the same transaction as the read. If the row
  cannot be written, the read fails.
- **Why not `TeacherScopeService.covers`.** While the PD-35 strict switch is OFF (the
  default), it returns the *whole* Teachers department, which is wider than the owner's
  list. `chat.staff_supervised_teacher_ids` is exactly the owner's four roles whatever the
  switch says (§11).

### 6.3 Object storage: the signing call is the access decision

The same invariant as attachments (PR #22) and PD-29 uploads: **knowing an `objectKey` is
never enough to read an object.**

- **Upload.**
  - `POST /whiteboards/:id/assets/grant {kind, contentType, byteSize}` checks write access
    to the board and the quota. It returns a PUT URL signed with `content-type` and
    `content-length` (`signableHeaders`), for a key the server chose.
  - The client never sends a key.
- **Confirm.**
  - `POST /whiteboards/:id/assets/:assetId/confirm` copies the upload to a key no grant can
    name (PD-29's pattern), then checks the copy's **real bytes**:
    - magic number;
    - decoded dimensions;
    - size.
  - Only then does the asset become `ready`. Bytes put under the grant later are never
    served.
- **Read.**
  - `WhiteboardAssetService.signUrlsForBoard(boardId)` is the **only** call that signs
    board assets.
  - It runs the board read check first, and takes the board id from the persisted
    `asset → board` row, never from the request.
  - The key namespace test is structural (exactly four segments), not `startsWith`.
- **References.** A page document may name only `ready` asset ids of **the same board**.
  The page save refuses others (403, not 500).

### 6.4 Limits (configuration, with these defaults)

| Limit | Default |
|---|---|
| Boards per teacher | 200 active (boards in trash do not count) |
| Pages per board | 50 |
| Page document | 512 KB (JSON, checked by the database). A full page says "This page is full — add a page". |
| Documents per teacher (Postgres) | 25 MB |
| Image / PDF page asset | 10 MB, 8,000 px long edge |
| Assets per board | 60 |
| Assets per teacher (object storage) | 300 MB. Boards in trash count until they are purged. |
| Organisation budgets (alert at 80%), sized for 200 teachers | documents 2.5 GiB (alert at 2 GiB), assets 60 GiB (alert at 48 GiB) (§11.2) |
| Exports | 24 h, then purged; at most 5 in flight per teacher |
| Writes | page save ≤ 2/s per board; grants ≤ 20/min per teacher |

Over a limit, the API answers `COMM.WHITEBOARD_LIMIT` with which limit was hit, and the
client says it plainly. These replace the first draft's 1 MB pages and 500 MB per teacher,
which did not fit the database (§11).

---

## 7. Phase 3 and out of scope

Jawwid teaches **Quran, Arabic and Islamic studies** to children. The owner's analysis
describes a general K-12 board.

| Owner's item | Decision | Why |
|---|---|---|
| Games: Feed the Little Tree, Memory Cards, 3D balloons, 3D tic-tac-toe | **Out of scope as board features** | These are games, not board tools. PD-29 already plays the academy's existing HTML5 activities and links, sandboxed. Phase 3 can add "Open a material" from the board, which reuses PD-29's `open` decision. |
| Arabic letter matching (interactive, the student plays) | **Phase 3** (needs student input on the board), or a PD-29 material today | The teacher-led version is possible in the MVP (§4.7). |
| 3D science (solar system, anatomy, Earth's interior, plant cell, water cycle), periodic table | **Out of scope** | Not subjects the academy teaches. Large licensed 3D assets. |
| Scientific calculator | **Out of scope** | No maths curriculum. Any device has one. |
| Compass, protractor, isometric/graph paper | **Phase 3**, only if maths is added | Not used in Quran or Arabic teaching. The grid layout covers simple tables. |
| Interactive maps | **Out of scope**. A map image can be imported. | |
| Website and YouTube embeds | **Out of scope** | An embed inside a canvas breaks export, needs `frame-src` widening in the PD-28 CSP, and duplicates PD-29 links (which already decide framing per origin). Teachers open such links through Materials. |
| Camera | **Out of scope** | Calls are audio-only by decision (W1). A camera in a children's lesson needs its own privacy decision. |
| Lesson recording (audio/screen) | **Out of scope for now** | Recording children's voices needs consent and retention rules (an owner decision of its own). Board replay (Phase 2) covers "review what was written". |
| Turbo mode for Zoom/Meet, "modern mode", fonts library | **Not applicable / out** | Jawwid lessons run on our own calls. Two fonts are enough for Arabic teaching. |
| Tables | **Phase 2** (a simple table element) | |
| Stamps | **MVP** (small built-in set). The library is Phase 2. | |
| EN language | **Already there**: the app is bilingual. | |

---

## 8. Delivery plan (after approval)

Each step is one PR, reviewed by the head, behind no feature flag except the tab's
visibility.

1. **API: boards, pages, assets, quotas, authz** (slot `20261028120000`).
   - Tests for §6.2 (every row of the table), §6.3 (key-is-not-a-capability, foreign asset
     in a page, the grant/confirm swap) and cross-organisation 404s.
   - Unit tests run with `--maxWorkers=2`. Integration runs in CI (G-19), or with a spec
     slot from the head.
2. **Flutter: the canvas core.** Tools, pages, layouts, undo/redo, zoom, stamps, the Boards
   tab, autosave and offline draft.
   - Widget and golden tests for Arabic text and strokes, run with `--concurrency=2`.
   - Manual QA in Chrome at `/teacher/` and on a tablet, when the QA session has a device.
3. **Quran verses.**
   - Builds on PD-29 P0-2: the shared dataset, loader and `GET /quran/ayahs`. These are in
     PR #176, **merged to main**, so nothing blocks this step.
   - This step adds the verse picker, the verse element and the Amiri Quran rendering.
   - The review sheet goes to the academy's Quran teacher **before** the tab is shown to
     teachers.
4. **Export**: PNG on the device; PDF through `pdfkit`; export purge in the worker.
5. **MVP-b, PDF page import**: only if `pdfrx` passes the dependency review (§4.4).

**Release gate.** The Boards tab is shown to teachers in an environment only once object
storage versioning is enabled there (§11.3, hard precondition) and the Quran review sheet is
signed (step 3).

Phase 2 (live view and tools) gets its own design note and slot once the MVP is in
teachers' hands.

---

## 9. Open questions for the owner

1. **May the teacher's supervisors look at the teacher's boards?**
   *Recommended: yes, read-only and audited.* That means the teacher's PD-35 supervisor
   (and active backup), the Teachers Manager and the super admin, never anyone else. Boards
   are lesson material, which supervisors already review through reports. No one but the
   teacher ever edits a board.
   **DECIDED 2026-10-28 (owner):** approved, with the safeguards in §10.
2. **Which Quran text do we use?**
   *Recommended: the Tanzil Project's Uthmani (Hafs) text.* Its terms are CC BY 3.0,
   verbatim only, credited "Tanzil Project — tanzil.net". It is drawn with the Amiri Quran
   font and released only after an academy Quran teacher signs off a 30-ayah review sheet.
   If the academy prefers the King Fahd Complex (Madinah Mushaf) text, we check its terms
   first.
   **ANSWERED 2026-10-27 (owner, via the department head):** approved. The owner chose one
   shared, verified Quran source: a single source of truth, its fingerprint checked on every
   load, and Tajweed shown only once approved. PD-29 builds it (P0-2) to
   [`quran-dataset-contract.md`](quran-dataset-contract.md). The verse step (§8 step 3)
   consumes it unchanged.
3. **Do teachers draw on phones too?**
   *Recommended: no. Drawing on a laptop (`/teacher/`) and tablets; phones open boards
   read-only.* A phone screen is too small for a toolbar and a page. The board is built
   once, so this is a switch we can change later.
   **DECIDED 2026-10-28 (owner):** approved, with the safeguards in §10.
4. **In Phase 2, what do students do with a shared board?**
   *Recommended: watch only*, in a "board view" opened from a card in the lesson's group
   chat, beside the call (the call itself is not changed). Students drawing on the board is
   a later decision: it brings moderation and saving children's input.
   **DECIDED 2026-10-28 (owner):** approved, with the safeguards in §10.
5. **What happens to a teacher's boards when the teacher leaves?**
   *Recommended: they are kept.* They stay readable by the Teachers department (as in
   question 1) for 12 months, then deleted. A department manager can give a copy of a board
   to another teacher before that. While the teacher is active, a board the teacher deletes
   is recoverable for 30 days, then purged.
   **DECIDED 2026-10-28 (owner):** approved, with the safeguards in §10.

---

## 10. The owner's decision (2026-10-28) and its safeguards

The owner approved all four remaining recommendations (questions 1, 3, 4 and 5), with
these safeguards. Quoted verbatim, as relayed by the department head:

> 1. Keep board editing restricted to the teacher. The teacher's assigned supervisor, active
>    backup supervisor, Teachers Manager, and Super Admin may view boards in read-only mode
>    only. Log every access with the viewer, timestamp, and board identifier. Ensure
>    read-only access cannot modify, delete, or overwrite board content.
> 2. Support teacher drawing on laptops and tablets, and read-only viewing on phones, but
>    verify actual device and browser compatibility before enforcing device restrictions.
>    Show a clear message when a device does not support editing.
> 3. In Phase 2, students may view a shared board through a clearly identified card in the
>    lesson's group chat. Student editing and collaborative drawing remain out of scope for
>    this phase.
> 4. When a teacher leaves, retain their boards for the Teachers department for 12 months,
>    with access limited to authorized staff and an auditable access history. Notify the
>    responsible administrator before the retention period expires where feasible. When a
>    teacher deletes a board, move it to recoverable trash for 30 days before permanent
>    deletion.
> 5. Make board deletion, recovery, and retention behavior explicit in the UI. Prevent
>    accidental permanent deletion, and ensure recovery restores the board correctly.
> 6. Confirm that these rules fit the existing permissions model, storage capacity, and
>    backup strategy before implementation.
>
> Do not modify any Jawwid Core production code or database. Implement these changes only in
> the intended system and follow the existing project safeguards.

**Jawwid Core.** PD-39 lives entirely in this repository: the Chat API, its Postgres
schema, and the Flutter app. Nothing in Jawwid Core is read, written or changed.

### 10.1 Each safeguard: its mechanism and its test

Every test below goes in the PR that builds the mechanism (§8). Integration specs prove
their claims against the real database (in CI, G-19).

| # | Safeguard | Mechanism | Test that proves it |
|---|---|---|---|
| 1a | Only the teacher edits | **Route layer.** Every board write route is `@NotForStaff()`, so PD-40's PermissionGuard refuses a staff caller before the service runs. **Service.** `WhiteboardService.assertOwner` requires a teacher actor, an active account, `actorId = board.teacher_id`, and a session that is not a PD-21 support session. **Database.** A trigger refuses any change to `teacher_id` and `organization_id`. | An integration matrix: every write route (page save, rename, reorder, asset grant/confirm, trash, restore, export) × every non-owner role (super admin, Teachers Manager, assigned supervisor, active backup, another teacher, a parent, a support session). Each answers 403/404, and afterwards the board's `revision`, every page's document SHA-256, `state` and asset rows are **unchanged**. |
| 1b | Read-only viewers are exactly the four roles | Staff read routes are `@Requires('whiteboards.view')` (a key is necessary, never sufficient). The service then requires the teacher to be in `chat.staff_supervised_teacher_ids(staff, now())`: the assigned supervisor, the active backup, the Teachers Manager, the super admin. **This holds whatever the PD-35 switch says.** Outside that: 404. | A matrix with the switch both ON and OFF. The four roles can read. A Teachers department member not assigned to this teacher, an expired or dormant backup, an Operations supervisor, Sales, and another organisation's staff all get 404. The response has no write affordances (`canEdit: false`). |
| 1c | Every access logged | `chat.whiteboard_access_log` (§6.1) records the viewer, basis, board, action and `at = now()`. It is written in **the same transaction** as the read or action, so there is no read without a row. It is append-only by trigger, and request roles get no grants. The Teachers Manager and super admin read it with `GET /whiteboards/:id/access-log` (`whiteboards.retention`). | Each read path (open, asset signing, export) writes exactly one row with the right basis. A forced failure of the log insert fails the read: nothing is served. UPDATE and DELETE on the log are refused by the database. |
| 1d | Read-only cannot modify, delete or overwrite | Read routes are GET-only and run in read-only transactions (`SET TRANSACTION READ ONLY`, apart from the log insert done first in its own statement). The staff viewer in the app opens the board with no tools, no autosave and no trash. | 1a's matrix covers the server. A widget test confirms the read-only viewer builds no toolbar and never calls a write repository method. |
| 2a | Drawing on laptops and tablets, read-only on phones | The client gate is a **capability check, not user-agent sniffing**. Editing is offered when the shortest side is at least `editMinShortestSideDp` (default 600) **and** the renderer is available (CanvasKit loaded; on the web, WebGL and WebAssembly). Otherwise the board opens read-only. The threshold comes from the server's client config, so it can be loosened without an app release. **It is a UX gate, not a security control.** The server accepts the owner's writes from any device, as PD-28's portal gate does. | Widget tests at 375×812, 768×1024 and 1280×800, with mouse, touch and stylus pointers, and with the renderer check forced off. |
| 2b | Verify real devices before enforcing | **Before the gate ships switched on**, the QA session runs a compatibility matrix:<br>• current Chrome, Edge, Safari and Firefox on macOS and Windows (`/teacher/`);<br>• the iPad app with Apple Pencil and with touch;<br>• an Android tablet with a stylus;<br>• an iPhone and an Android phone (read-only).<br>Results go to `docs/mobile/evidence/pd39/compatibility.md`. Until the matrix passes, the gate ships in **report-only** mode: it logs what it would have decided and blocks nothing. | The matrix file, signed off by the head, is the release condition for turning the gate on. |
| 2c | A clear message when editing isn't supported | A banner over the read-only board, in Arabic and English: "Editing boards needs a laptop or tablet. You can view this board here." If the renderer is missing: "This browser can't edit boards. Try the latest Chrome, Edge, Safari or Firefox." | Golden tests of both banners in both languages, RTL and LTR. |
| 3 | Phase 2: view through a clearly identified card; no student editing | A dedicated message card kind, `whiteboard_share`, distinct from text and lesson cards. It shows a board icon, the board's title, the teacher's name, "View only", and "Live" or "Ended". The student viewer has no tools. The server accepts board operations **only from the owner's socket** on an active share, and delivery is authorised per recipient at delivery time (RT-009). | (Phase 2 PR) Golden tests of the card. An operation sent from a student's or a parent's socket is refused and delivered to nobody. Ending the share stops delivery with every push disabled. |
| 4a | A leaver's boards kept 12 months for the Teachers department | When the teacher's account is deactivated (offboarding, not a temporary suspension), the same transaction moves every board that is not in trash to `state = 'retained'`, with `retained_until` = deactivation + 12 months, and logs `retain`. **Readers** are the 1b roles, plus the Teachers Manager and super admin even when the assignment has ended. **Copy to another teacher** (`POST /whiteboards/:id/copy {teacherId}`, `whiteboards.retention`): a new board owned by the new teacher, with assets copied server-side to new keys, logged `copy`. If the teacher is reactivated within the 12 months, the boards return to `active`. | Deactivate → every board is `retained` and the old teacher's session is refused. The manager and super admin can read; an unassigned supervisor gets 404. Copy creates an independent board whose assets sign under the new board, and the original is unchanged. Reactivate → the boards are `active` again. |
| 4b | An auditable access history | The same log (1c), kept for as long as the board exists. When a board is purged, its log rows are kept, with the board id and teacher id still recorded, so the history outlives the board. | Purging leaves the log rows. `GET .../access-log` lists them in time order. |
| 4c | Notify before retention expires, where feasible | A daily worker job takes boards whose `retained_until` is within 30 days and whose `retention_notified_at` is null. It sends one notification per teacher (not per board) to the Teachers Manager and the super admin, through the PD-34 notification pipeline: "N boards of {teacher} will be deleted on {date}. Copy any you want to keep." It then sets `retention_notified_at`. **Where feasible:** if PD-34 cannot reach a staff recipient (no device, no inbox), the same list appears on Admin Web's Teachers page as "Boards to be deleted soon". | Jobs run with a fake clock at day 334 (notified once), day 335 (not notified again) and day 365 (purged: rows and objects gone, log kept). |
| 4d | Trash for 30 days, then permanent deletion | A teacher's delete sets `state = 'trashed'`, `trashed_at` and `purge_after = +30 days`, and logs `trash`. Nothing is removed. A daily purge job hard-deletes boards past `purge_after`: page rows, asset rows and their storage objects, and logs `purge`. **No API route deletes permanently**; only the purge job does. | Trash → the board is hidden from the list and shown under "Deleted boards". The purge job at day 29 leaves it; at day 30 it removes the rows and objects, and the log keeps `trash` and `purge`. No route reaches `purge`. |
| 5a | Deletion, recovery and retention explicit in the UI | **Delete dialog:** "Move «{title}» to Deleted boards? You can restore it until {date}. After that it is deleted for good." **Deleted boards list:** each board shows "Deleted on {date} · Restorable until {date}". **A retained board** shows "Kept until {date}" to the staff who may see it. Every date is in the viewer's own time zone (PD-22). | Golden tests of the dialog, list and badges, in Arabic and English. |
| 5b | Prevent accidental permanent deletion | There is **no "delete forever" action** in the MVP. Permanent deletion happens only through the 30-day purge (4d). Emptying the trash would be a separate owner decision. | The route table has no permanent-delete route, and a test asserts it. |
| 5c | Recovery restores the board correctly | `POST /whiteboards/:id/restore` (owner only, while `trashed`) sets `state = 'active'` and clears `trashed_at` and `purge_after`. Nothing was removed while it was in trash, so pages, assets and revision come back as they were. If restoring would exceed the 200-board limit, it is refused with a plain message rather than partly restored. | Round trip: create a board with 3 pages, an image and a verse; trash it; restore it. Then page count, every page's document SHA-256, every asset's SHA-256, revision and title are identical, and every asset signs again. Restoring after purge answers 404. |
| 6 | Fits permissions, storage and backups | §11. | — |

---

## 11. Safeguard 6: does it fit what exists? (checked 2026-10-28 against main `a547b0e2`)

### 11.1 The permissions model (PD-40, merged)

- **How PD-40 works.**
  - `apps/api/src/platform/permissions/catalogue.ts` is the **staff** permission system.
    Every route declares `@Requires(...)`, `@SelfService()` or `@NotForStaff()`
    (`route-access.ts`).
  - Teachers and parents pass that layer, and the service decides for them.
  - A key is "necessary, never sufficient": the service still decides scope.
- **Teacher routes.** All of them are `@NotForStaff()`. That is the first wall of
  safeguard 1a.
- **Two new catalogue keys, proposed.** Both are `risk: 'pii'` (a board can carry a child's
  name or work), `delegable: false` (PD-40 H5/H8: only the super admin grants them), and
  `introducedBy: 'PD-39'`.

  | Key | Label (en / ar) | Legacy bundles |
  |---|---|---|
  | `whiteboards.view` | View teachers' boards (read-only) / عرض سبورات المعلمين (للقراءة فقط) | `manager:teachers`, `supervisor:teachers` (the super admin holds every key) |
  | `whiteboards.retention` | Manage departed teachers' boards and read board access history / إدارة سبورات المعلمين المغادرين والاطلاع على سجل الوصول | `manager:teachers` |

  `supervisor:teachers` gets `whiteboards.view` because the assigned supervisor and the
  backup are Teachers department supervisors. The key only opens the door; 1b's
  `staff_supervised_teacher_ids` then narrows it to the teacher's own supervisor.
- **One correction to the first draft.**
  - §6.2 first used `TeacherScopeService.covers`. Its `scopeOf` returns `ALL_TEACHERS` for
    every Teachers department member while the PD-35 strict switch is OFF, which is the
    default in production. That is wider than the owner's list.
  - `chat.staff_supervised_teacher_ids` (migration `20261026160006`) returns exactly these,
    in both switch states:
    - for the super admin and the Teachers Manager, every teacher;
    - for a Teachers department supervisor, their assigned teachers;
    - for an active backup, the assigned teachers of the supervisor they back up.
  - PD-39 uses it.
  - **Consequence:** a teacher with no assigned supervisor is readable only by the Teachers
    Manager and the super admin. That is correct under the owner's rule.

### 11.2 Storage capacity

**DECIDED 2026-10-28 (owner):** "50–200" active teachers will use boards in the next year.
Everything below is sized for **200**. The per-teacher caps are kept.

- **Postgres.** The DigitalOcean cluster already in the project is 1 GB RAM / 10 GiB disk,
  and every feature shares it.
  - The first draft's limits did not fit. 1 MB pages × 50 pages × 200 boards is up to
    10 GB **for one teacher**.
  - The new limits (§6.4) are 512 KB per page and 25 MB per teacher.
  - Estimate: an active teacher with 40 boards × 6 pages × ~40 KB (delta-encoded strokes,
    before Postgres compression) holds about 10 MB. **200 teachers hold about 2 GB**, about
    20% of the 10 GiB disk.
  - The 25 MB cap bounds the worst case at 5 GB for 200 teachers.
  - **Organisation alert:** a documents budget of 2.5 GiB, alerting at 80% (2 GiB, the
    expected size at 200 teachers). When it fires, it is time to grow the disk, not an
    emergency.
  - If teachers fill their caps rather than the estimate, the 10 GiB cluster becomes the
    limit. The production cluster's disk should be sized with that in mind when it is
    provisioned.
- **Object storage.** One S3-compatible bucket (`STORAGE_BUCKET`) is shared with chat
  attachments, Materials and certificates. The code has no bucket-wide quota.
  - Board images are capped at 300 MB per teacher. 200 teachers × 300 MB = 60 GB worst case.
    A more typical ~50 MB per teacher is about 10 GB.
  - Exports expire after 24 h, and trash and retention purges free space.
  - **Organisation alert:** an assets budget of 60 GiB, computed from `bytes_total`, alerting
    at 80% (48 GiB).
- **Monitoring.** The API exposes the organisation's board document and asset totals
  beside its existing health metrics. The 80% alerts go to the same place as the other
  operational alerts.

### 11.3 The backup strategy (`docs/infrastructure/backup-recovery.md`)

| Board data | Where it lives | Backed up today? |
|---|---|---|
| Boards, pages (the drawing itself), access log, retention state | Postgres | **Yes.** Encrypted `pg_dump` before every deploy and nightly, kept 30 days ("implemented and drilled"). Provider PITR is "not provisioned". |
| Imported images, PDF pages, exports | Object storage | **No.** Object storage versioning and lifecycle rules are "not provisioned". This is the same gap chat attachments already have. |

- **What this means.** Today, a lost bucket would lose a board's *images* but not its
  drawing, text or verses. Those are in Postgres, and verses are only references to the
  shared Quran dataset. The board would show "Image unavailable" placeholders.
- **DECIDED 2026-10-28 (owner): "Yes, enable it first."** Object storage versioning is
  enabled first. The infrastructure change is the DigitalOcean session's, not PD-39 code;
  it covers boards and chat attachments together.
- **HARD PRECONDITION:** boards do **not** go live for teachers until object storage
  versioning, with 30-day retention as the backup doc plans, is enabled in that
  environment and recorded in `docs/infrastructure/backup-recovery.md` §1 as provisioned.
  - The Boards tab stays hidden for teachers until then. Its visibility switch (§8) is
    turned on only after the head confirms the precondition for that environment.
  - Code can be built and merged before then; only showing it to teachers waits.
- **Trash and backups.** Trash is the per-board recovery: a backup restores the whole
  database, never one board. That is why the 30-day trash exists.
- **Permanent deletion and backups.** A purged board leaves the live system on day 30.
  - Its drawing can survive in `pg_dump` archives for up to 30 more days, until they age
    out. With versioning on, its images survive as non-current object versions for the same
    30 days. So everything is gone by about day 60.
  - The same applies to a leaver's boards after their 12 months.
  - **DECIDED wording:** text shown to teachers about permanent deletion says **"deleted
    within 60 days"**, for example in the trash list's footer: "Boards in Deleted boards are
    restorable for 30 days, then deleted for good within 60 days." The delete dialog (§10,
    5a) keeps the exact restore-until date.
- **Restore drill.** Add a board count, and one board's page SHA-256, to the restore
  checklist (backup doc §5). This proves a restore brings boards back intact.

### 11.4 Verdict

**The safeguards fit**, with three changes now made in this design:

1. Staff reads use `chat.staff_supervised_teacher_ids`, not the department-wide scope
   (11.1).
2. Lower storage limits: 512 KB per page, 25 MB of documents and 300 MB of images per
   teacher (11.2).
3. Two new PD-40 keys, `whiteboards.view` and `whiteboards.retention` (11.1).

And two owner answers, recorded as DECIDED:

4. Sized for 200 teachers, with the organisation alerts set to match (11.2).
5. Object storage versioning is enabled first. It is a **hard precondition** for showing
   boards to teachers (11.3).
