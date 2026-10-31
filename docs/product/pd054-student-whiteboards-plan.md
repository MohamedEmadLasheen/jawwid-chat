# PD-54 · A dedicated whiteboard for every student — technical and implementation plan

Status: **PLAN, for the owner's review.** No code until the owner answers §10 and the
department head gives GO. Claimed in `pd-registry/PD-54.md`. **No migration slot is
claimed here**: the department head assigns slots when the build starts, after the
owner approves (§9). Read against main `cd60ec5d` (2026-10-31).

**Revised 2026-10-31 at the department head's direction.** A student board's page documents
and history are stored in **object storage from day one**, not in Postgres. Postgres keeps
only the metadata: SHA-256 hashes, revisions and history rows. This reuses PD-39's storage
adapter, signing and `assetsOn()` gating (§2.4, §5.4). Planning assumption: **about 300
active learners in year one, growing to 1,000.**

The owner's request (2026-10-31): each student has their own dedicated whiteboard. It is
linked to the parent's account and the parent can view it. The student's assigned teacher
can open and manage it. Everything is saved automatically, and earlier drawings and the
lesson history are kept. Access and privacy rules must be clear. A student with more than
one teacher must not end up with more than one board. "Prepare the full technical and
implementation plan for review before starting development."

PD-54 builds on PD-39 (`pd039-whiteboard-design.md`): the teacher whiteboard, its pages,
autosave, images, PDF export and the read-only staff viewer. It reuses the canvas, the page
format, the asset pipeline and the access log. It does not change how a teacher's own boards
work.

---

## 0. Summary

| | Recommendation |
|---|---|
| **What a student board is** | A new **kind** of the existing `chat.whiteboard`: `kind = 'student'`, with `learner_id` set and no owning teacher. A unique index allows **one board per learner**, so a duplicate cannot exist even if two teachers open it at the same moment. Pages, assets, images, verses and export are PD-39's, unchanged. |
| **Who may edit** | Whoever teaches the learner **now**. That is derived on every request from `chat.learner.teacher_id`, never stored on the board. A transfer moves edit access in the same transaction that moves the learner. |
| **More than one teacher** | **Today a learner has exactly one teacher.** The database enforces it (§1.1). PD-54 therefore needs no co-teacher table. All editor checks go through one SQL function, `chat.student_board_editor_ids(learner)`. If co-teachers ever exist, that one function changes, and the board stays single. |
| **Created** | **On first use**, when the assigned teacher first opens "Student board". It is not created on enrolment (§2.1). |
| **Parents** | **Read only.** Every active contact of the child's family sees the current pages and the lesson history in the Flutter app. Children have no login of their own. |
| **History** | Autosave as in PD-39. On a student board, nothing a teacher drew is ever destroyed: a deleted page goes to the board's history. A **lesson snapshot** freezes the pages drawn during each lesson and links them to `chat.lesson`. |
| **Where it is stored** | **Object storage, from day one.** Each page document is a content-addressed, gzipped JSON object under `whiteboard-docs/<org>/<board>/<sha256>`, written by the API and read through short-lived signed URLs after the read check. **Postgres holds only metadata** (hashes, revisions, snapshot rows), so a year of 1,000 learners adds tens of MB to the database, not GB (§5.4). PD-39's own teacher boards are unchanged. |
| **Concurrency** | **Per-page optimistic revisions**, with the existing 409 and "Reload / Keep mine as a new page". There are no page locks. |
| **Staff** | PD-39's readers, scoped through the learner's current teacher: the assigned supervisor, the active backup, the Teachers Manager and the super admin. They are read-only and logged. Operations, Sales and everyone else get nothing. |
| **Retention** | **Never purged automatically.** A permanently stopped learner's board is **archived**: read-only for everyone, still visible to the family. |
| **Delivery** | Eight small PRs (§9) behind one switch, `student_boards.enabled`, default off and effective only while PD-39's `assetsOn()` is true. Rollback is the switch; every migration only adds. |

---

## 1. What exists today (checked on main)

### 1.1 How many teachers can a learner have? Exactly one.

| Fact | Where |
|---|---|
| `chat.learner.teacher_id` is one nullable column. It is written only through the assignment gate (`chat.syncing_assignment`, trigger `guard_learner_assignment_change`). | `apps/api/prisma/schema.prisma` `Learner`; migration `20260923130000` |
| Every lesson is taught by the learner's assigned teacher: *"a lesson is taught by the learner's assigned teacher"*. A lesson's teacher may change only **to** the learner's assigned teacher. A trial (`kind = 'trial'`) has no learner. | `chat.guard_lesson`, `20261026110000_chat_pd031_scheduling.sql` |
| Every weekly slot (`learner_schedule_slot.teacher_id`) must also be the learner's teacher. | `20261018140000_chat_pd011_scheduling.sql` |
| A learner has **one** course: `chat.learner_enrollment` is keyed by `learner_id`, with a single `course_id`. | `LearnerEnrollment` |
| `transfer_learner` (PD-11 T3 / PD-31) is the only way to change the teacher. It rewrites `learner.teacher_id`, swaps the teacher in the student group and the family groups, ends the weekly slots and moves the future lessons. It appends a `chat.learner_transfer` row (from, to, reason, handover note) and an audit row. | `chat.transfer_learner` |
| **"Substitute teacher" is only a ruling label** on a `makeup_followup` (PD-11/PD-12). No table records a second teacher on a lesson. | `vocab.ts SUBSTITUTE_TEACHER`, `lesson-card.ts` |
| **PD-33 covers and backups are staff, not teachers.** A cover activates a *supervisor's* backup link. | `chat.supervisor_backup`, `chat.supervisor_cover` |

**Consequence.** "A student with more than one teacher" happens in two ways today:

- **over time**: the learner is transferred, so the old and new teachers are different
  people; and
- **in principle**: a substitute who takes a lesson. The schema does not allow that today.

There is no case where two teachers hold the same learner at the same time. PD-54 needs
**no new teacher-to-learner relation**. It needs one seam that a co-teacher model could plug
into later (§3.2).

### 1.2 PD-39 as built (`supabase/migrations/20261030020000_chat_pd039_whiteboards.sql`, `apps/api/src/whiteboards/`)

- `chat.whiteboard`:
  - `teacher_id` is **NOT NULL and immutable** (`guard_whiteboard_identity`);
  - `lesson_id` must be the owner's own lesson (`guard_whiteboard_owner`);
  - `state` is `active | trashed | retained`;
  - `revision` is a **board-level** revision. **Every** page save runs `bump()`, which needs
    the board's current revision, so two editors on two different pages conflict.
- `chat.whiteboard_page`:
  - `position` 0..49, at most **50 pages**;
  - `document` jsonb, at most 512 KB (the `document_bytes` trigger);
  - **there is no per-page revision column.**
- `chat.whiteboard_asset`:
  - its key is `whiteboards/<org>/<board>/<asset>` (a name, never a capability);
  - grant, then confirm, then sign; the signing call is the access decision.
- `chat.whiteboard_access_log`:
  - append-only, never truncated, and it outlives the board;
  - `teacher_id NOT NULL`;
  - `viewer_kind in (teacher, staff, support_session, system)`;
  - `basis in (owner, supervisor, backup, teachers_manager, super_admin, support_session, system)`.
- The trigger `teacher_leaving_retains_whiteboards` retains a leaving teacher's boards,
  matched by `w.teacher_id = new.id`.
- Routes:
  - the teacher's routes are all `@NotForStaff()`, and the service checks `teacher_id = actor`;
  - staff routes are `@Requires('whiteboards.view' | 'whiteboards.retention')`, narrowed by
    `chat.staff_supervised_teacher_ids(staff, now())`;
  - `copyToTeacher` takes an `Idempotency-Key`.
- Assets are gated by `assetsOn()`: `whiteboards.assets_enabled` **and**
  `whiteboards.assets_lifecycle_verified`.
- Verses go through `GET /quran/ayahs` (`@SelfService()`, so any signed-in actor may call it).
  A verse is a reference checked by `rangeSha256`, never stored text.
- Flutter `lib/features/whiteboards/`:
  - the editor already has a read-only mode (`readOnly: !editable`, used for phones and
    support sessions);
  - a Boards tab, for teachers only.
- Admin Web `features/teacher-boards/` is the staff viewer (#327), with its own canvas
  renderer (`render.ts`).

### 1.3 How a parent reaches a child

- **The parent's actor** is `chat.contact`. A learner is reached only through the caller's
  own family: `contact.family_id = learner.family_id`
  (`communication/profile/parent-profile.service.ts`). Another family's learner is "not
  found".
- **Children have no account.** The actor kinds are `contact`, `staff` and `teacher`. The
  child sees whatever the parent's device shows.
- **The parent's surfaces:**
  - Chats (the family group and the learner's `student_group`);
  - Calls;
  - Settings, with My profile listing the children (`ChildTile`, PD-17).
- **The student profile `/students/:id` is teacher-only** (PD-17).

---

## 2. Data model and lifecycle

### 2.1 Options considered

| Option | Verdict |
|---|---|
| **A. A new kind of `chat.whiteboard`** (`kind`, `learner_id`, nullable `teacher_id`) | **Recommended.** Pages, assets, export, verse references and the asset key shape all key on `board_id`, so they work unchanged. Only where a student page's document lives is different: object storage instead of the `document` column (§2.4). Every teacher query already filters `teacher_id = <me>`. A NULL never matches, so a teacher's own lists, quotas and the leaver's retention trigger cannot pick up a student board: it **fails closed** without anyone remembering to exclude it. |
| B. Separate `chat.student_board*` tables | No. It would duplicate pages, assets, size triggers, grants, export and purge: about 1,500 lines of reviewed authz and storage code. |
| C. One board per learner per **teacher** | No. That is exactly the duplicate the owner forbids, and history would split at every transfer. |
| D. One board per learner per **course** | Not now. A learner has one course (§1.1). The model allows it later (§10 a). |

### 2.2 Schema changes (migration A; the department head assigns the slot)

```
chat.whiteboard
  + kind        text not null default 'teacher' check (kind in ('teacher', 'student'))
  + learner_id  uuid null references chat.learner (id)
  ~ teacher_id  becomes NULLABLE
  + constraint whiteboard_kind_owner check (
      (kind = 'teacher' and teacher_id is not null and learner_id is null) or
      (kind = 'student' and learner_id is not null and teacher_id is null))
  + unique index whiteboard_one_per_learner on (learner_id) where kind = 'student'
  ~ state       adds 'archived' (student boards only; check (state <> 'archived' or kind = 'student'))
  ~ the trash and retention states stay teacher-only:
      check (kind = 'teacher' or state in ('active', 'archived'))
  + archived_at timestamptz   (set together with state = 'archived')

chat.whiteboard_page
  + revision         integer not null default 1   (per-page optimistic concurrency, §4)
  + document_sha256  text null                    (student boards: the page's document in
                                                   object storage, §2.4; FK to the blob below)
    -- a trigger keeps the two kinds apart: on a student board document_sha256 is NOT NULL
    -- and `document` stays the empty default; on a teacher board document_sha256 is NULL.
    -- document_bytes is then the blob's size, so PD-39's 512 KB page limit still holds.
  + updated_by       uuid null                    (the teacher who saved last; student boards)
  + lesson_id        uuid null references chat.lesson (id) on delete set null
                     (the lesson this page was last drawn in, §5.2)
  (position and its deferrable unique constraint are unchanged: reorder needs them.
   A "deleted" page on a student board leaves the live pages as a history record, §5.1.)

chat.whiteboard_document_blob         (migration A, PR-2: metadata of one object, §2.4)
  board_id uuid fk, sha256 text, primary key (board_id, sha256)
  object_key text unique   whiteboard-docs/<org>/<board>/<sha256> (structural check, as PD-39's assets)
  byte_size integer        the canonical JSON's bytes (<= 524288); stored_bytes = the gzip size
  state text check in ('pending', 'ready'), created_at
  -- No document column: the document is ONLY in object storage.
  -- Page rows and snapshot pages reference it by (board_id, sha256) with ON DELETE RESTRICT,
  -- so a blob that anything still names can never be deleted. Only the GC sweep (§2.4)
  -- deletes, and only blobs nothing names.

chat.whiteboard_snapshot              (migration B, PR-5: the snapshot tables)
  id uuid pk, board_id fk, organization_id
  reason text check (reason in ('lesson', 'manual', 'page_archived'))
  lesson_id uuid null unique          (one snapshot per lesson; set only when reason = 'lesson')
  teacher_id uuid not null            (who taught / saved it; kept even after a transfer)
  title text, taken_at timestamptz, page_count smallint, bytes integer
chat.whiteboard_snapshot_page
  snapshot_id fk, position smallint, source_page_id uuid,
  layout, background, (board_id, document_sha256) -> chat.whiteboard_document_blob
  -- snapshots and snapshot pages are insert-only (trigger), like the access log.
  -- Content-addressed: a page unchanged between two lessons is one object.

chat.whiteboard_access_log
  ~ teacher_id    becomes NULLABLE;  + learner_id uuid null
  + check (teacher_id is not null or learner_id is not null)
  ~ viewer_kind   adds 'contact'
  ~ basis         adds 'assigned_teacher', 'lesson_teacher', 'parent'
  ~ action        adds 'create', 'snapshot', 'page_archive', 'page_restore', 'archive', 'unarchive'
```

**Triggers:**

- **`guard_whiteboard_identity`** also fixes `kind` and `learner_id`. A board never changes
  learner or kind.
- **`guard_whiteboard_owner`** gains a student branch: the learner is in the board's
  organisation, and a board-level `lesson_id` is NULL (lesson links live on pages and
  snapshots).
- **The page revision** is bumped by the save statement itself (`revision = revision + 1
  where revision = $expected`). No trigger is needed.
- **`teacher_leaving_retains_whiteboards` is untouched.** It matches `teacher_id`, which is
  NULL on a student board, so a teacher leaving never touches a student's board. A test
  asserts this.

**Prisma.** The SQL owns the DDL. Two parts of PD-39's service rely on the old shape:

- the TypeScript `BoardRow` type, which assumes `teacher_id: string`;
- `chat.staff_supervised_teacher_ids(...)` membership tests.

Both are audited in PR-1 (§9). A NULL `teacher_id` must give 404 on every teacher and staff
route of PD-39, and an integration test proves it route by route.

**Backfill: none.** No board is created for existing learners. Existing teacher boards stay
teacher boards. A teacher who wants a page from their own board on a student's board copies
it (§6.2, PR-8). Boards are never converted, because conversion would change who can read
them: a parent would suddenly see a board its teacher drew as private preparation.

### 2.3 Lifecycle

| Event | What happens to the student board |
|---|---|
| **First open** by the learner's current teacher ("Student board") | `INSERT … ON CONFLICT (learner_id) WHERE kind = 'student' DO NOTHING`, then read. Two teachers or two tabs opening at once get **the same** board. The board starts with one blank `arabic_lines` page and the title "{child's name}". Logged `create`. |
| Before that | Parents see nothing: there is no entry until the board has a page with content. |
| **Transfer** (`transfer_learner`) | Nothing is written to the board. Edit access follows `learner.teacher_id` in the same transaction. `chat.learner_transfer` already records from, to and when. Pages keep `updated_by`, and snapshots keep `teacher_id`, so the history still says who drew what. |
| **Temporary suspension** (`learner_suspension.kind = 'temporary'`) | No change. The teacher can still prepare, and the parent can still view. |
| **Permanent stop** (`kind = 'permanent'`, `status = 'active'`) | The board moves to **`archived`** (logged `archive`). No one edits it. The family and the staff readers can still read it. The move is made by the worker sweep that already handles suspensions, never by a trigger on the suspension table. Ending the stop returns the board to `active` (logged `unarchive`). |
| **The learner's teacher leaves** (deactivated) | Nothing happens to the board. Until a new teacher is assigned, nobody may edit it, and the readers are the parent, the Teachers Manager and the super admin. |
| **The family is deleted / an erasure request** | Out of scope. There is no deletion route. Any future erasure process (an owner decision) would delete the board, its snapshots and its objects together, and the access log keeps its rows. |

**Retention.** A student board is **never purged automatically**: there is no trash and no
12-month clock. The owner asked for "previous drawings and lesson history preserved".
Sizing is in §5.4.

### 2.4 Where the documents live: object storage

A student page's document is **never stored in Postgres**. It is one object per distinct
document, written and read through PD-39's storage adapter
(`communication/attachments/object-storage.ts`).

- **The key** is `whiteboard-docs/<org>/<board>/<sha256>`: exactly four segments, checked
  structurally like PD-39's asset keys. The SHA-256 is over the canonical (compact) JSON. It
  is a **name, never a capability**: an object is readable only through a URL the API signs
  after the read check.
- **The prefix is separate on purpose.**
  - PD-39's asset signer accepts only `whiteboards/…` keys, and the document signer only
    `whiteboard-docs/…` keys, so neither can be made to sign the other's objects.
  - The bucket lifecycle rule that expires `whiteboard-uploads/` after a day never touches
    `whiteboard-docs/`.
  - Nothing expires documents by lifecycle; only the GC sweep below deletes.
- **The stored object** is the JSON gzipped, with `Content-Type: application/json` and
  `Content-Encoding: gzip`. Browsers and Dart's HTTP client decompress it transparently.
  The client hashes the decoded bytes and refuses a document whose SHA-256 differs from the
  one the API named (it shows "This page couldn't be loaded" and retries).

**Writing a page** (the API writes; the client never uploads a document):

1. The API validates the body exactly as PD-39 does: schema, the 512 KB size limit, and
   asset references to ready assets of this board only.
2. It computes the SHA-256. If `(board, sha256)` is not yet known, it inserts the blob row
   as `pending` in its own statement.
3. It writes the object. This is a **server-side `put`**. The adapter has none today (PD-39
   PR-4a returns the PDF instead of storing it for that reason). PR-1 adds an optional
   `put?(key, bytes, contentType, contentEncoding)` beside the existing optional `copy?`,
   with the same structural key check. **This change touches the shared attachments storage
   seam and is flagged for the security reviewer.**
4. One transaction marks the blob `ready` and runs the per-page `If-Match` update (§4). As
   in PD-39, **no storage call runs inside a transaction.**
5. A 409, or any failure after step 3, leaves at most an unreferenced blob. The GC sweeps it.

**Reading.** The page list and every snapshot answer with, for each page, `documentSha256`
and a **signed GET URL with a 10-minute TTL**, issued after the read check and the
access-log row. The client fetches the documents directly, so the API never streams them.
Admin Web's viewer does the same.

**GC.** A worker sweep, beside PD-39's purge:

- It takes blobs that no live page and no snapshot page names, that are older than 24 h,
  and that are not held (`FOR UPDATE SKIP LOCKED`).
- It deletes the object, then the row.
- The `ON DELETE RESTRICT` foreign keys make deleting a referenced blob impossible, even
  by mistake.

**When storage is down:**

- A save fails, and the client keeps PD-39's offline draft and retries with backoff ("Not
  saved yet").
- A read fails, and the viewer says "Board unavailable, try again".
- Nothing is ever served from a stale copy.

**Gating.** Student boards depend on object storage for **everything**, not only images.
So `student_boards.enabled` takes effect only while PD-39's `assetsOn()` is true: both
`whiteboards.assets_enabled` and the operator's `whiteboards.assets_lifecycle_verified`.
Otherwise every student-board route answers 404, and the app shows no entry point.

**PD-39's teacher boards are unchanged**: their documents stay in the `document` column.
Moving them too would be a separate decision.

---

## 3. Access

### 3.1 The matrix

| Who | Read | Write | Basis logged |
|---|---|---|---|
| The learner's **current assigned teacher** (`learner.teacher_id`; active account; signed in as themself) | yes | yes, while the board is `active` | `assigned_teacher` |
| The teacher of a lesson of this learner that is **live now** (§3.2; today always the same person) | yes | yes | `lesson_teacher` |
| A **PD-21 support session** on that teacher | yes | **no** | `support_session` |
| A **previous** teacher, after a transfer | **no** (recommended; §10 c) | no | — |
| Any other teacher | no: **404** | no | — |
| **Parent**: every active contact of the learner's family (`contact.family_id = learner.family_id`, active account) | yes: current pages and history (§10 d) | **never** | `parent` |
| A contact of **another** family | no: **404** | no | — |
| **Teachers department**: `@Requires('student_boards.view')`, then `learner.teacher_id ∈ chat.staff_supervised_teacher_ids(staff, now())`. That covers the teacher's assigned supervisor, the active backup, the Teachers Manager and the super admin, **whatever the PD-35 switch says**. | read only | no | `supervisor` / `backup` / `teachers_manager` / `super_admin` |
| A learner with **no teacher** | Teachers Manager and super admin only (`staff_supervised_teacher_ids` returns every teacher only to them, and here there is no teacher) | no | as above |
| **Operations supervisors** (PD-8 `learner_supervision`, `staff_reaches_family`) | **no** (recommended; §10 f) | no | — |
| **Sales**, other staff | no. No bundle carries the key. | no | — |
| Another organisation | **404** | no | — |

**Rules carried over from PD-39 unchanged:**

- The organisation always comes from the actor, never from the request.
- **No staff member ever writes a student board**, not even the super admin. A staff edit
  would put words in the teacher's mouth.
- Read routes run in read-only transactions, after the log insert.
- **Every read writes its access-log row in the same transaction.** No row means nothing
  is served.

**Why the board stores no editor.** Who teaches a child is the academy's fact. Chat mirrors
it in `learner.teacher_id`, behind the assignment gate, and must not author a second copy
of it. A stored editor list would drift at the first transfer. Deriving it means a transfer
revokes the old teacher **to the second**, with no job and no trigger.

### 3.2 The single editor seam

```sql
-- PD-54: the teachers who may edit a learner's board at p_at. Today this is
-- the assigned teacher, plus the teacher of a lesson of this learner that is
-- live then, which the PD-31 lesson guard makes the same person. A future
-- co-teacher or substitute model changes THIS function only.
create function chat.student_board_editor_ids(p_learner uuid, p_at timestamptz default now())
returns setof uuid
language sql stable
as $$
  select l.teacher_id from chat.learner l
    join chat.teacher t on t.id = l.teacher_id and t.is_active and t.left_at is null
   where l.id = p_learner
  union
  select ls.teacher_id from chat.lesson ls
    join chat.teacher t on t.id = ls.teacher_id and t.is_active and t.left_at is null
   where ls.learner_id = p_learner and ls.outcome is distinct from 'rescheduled'
     and p_at >= ls.starts_at - interval '30 minutes' and p_at < ls.ends_at + interval '2 hours'
$$;
-- PUBLIC revoked; owner-only; listed in the definer-function audit if it becomes SECURITY DEFINER.
```

**Why the second branch exists.** Today it adds no one. It is there so that if a
substitute model ever lets another teacher take one lesson, that teacher can draw on the
child's one board during that lesson, and only then, with no second board and no stored
grant. Turning on any real co-teacher model is a scheduling decision (it changes PD-31's
lesson guard). That would be its own PD, not this one.

### 3.3 PD-40 keys (catalogue rows generated by the PD-40 seed spec, as PD-39 did)

| Key | Label (en / ar) | Risk / delegable | Legacy bundles |
|---|---|---|---|
| `student_boards.view` | View students' boards (read-only) / عرض سبورات الطلاب (للقراءة فقط) | `pii`, not delegable | `manager:teachers`, `supervisor:teachers` |

- **The access history** reuses `whiteboards.retention` (Teachers Manager, super admin). It
  is the same log table and the same page in Admin Web.
- **Teacher and parent routes** are `@NotForStaff()`. The service decides, as for every
  teacher and parent route.
- **Why a new key** rather than reusing `whiteboards.view`: a student board is the *child's*
  record, not the teacher's work. The super admin should be able to grant one without the
  other.

### 3.4 The audit trail

- **Every open** writes one access-log row: by the teacher, the parent, staff or a support
  session.
- So do **image signing**, **export**, **create**, **snapshot**, **page archive/restore** and
  **archive/unarchive**, each with `learner_id` and the basis.
- **Page saves are not logged one by one** (an autosave every ~2 s). Instead:
  - `whiteboard_page.updated_by` and `revision` record the last writer;
  - every snapshot records the teacher;
  - the board's history is what proves who drew what.
- **Volume:** parents opening boards adds rows. The table is indexed by `(board_id, at)`,
  and at one row per open it is small next to the message tables.
- **Admin Web "Access history"** (`whiteboards.retention`) lists who opened the child's
  board, when and on what basis, including the parents.

---

## 4. Concurrency: two teachers, or two tabs, on one student board

**Today** two teachers never hold the same learner. The real cases are:

- the same teacher in two tabs or devices (as PD-39 already has);
- the transfer moment, when the old teacher's tab is still open;
- later, a substitute (§3.2).

**Recommendation: per-page optimistic revisions, no locks.**

- **Page writes** carry `If-Match: <page revision>`:

  ```
  UPDATE … SET document_sha256 = $sha, revision = revision + 1, updated_by = $teacher
   WHERE id = $page AND board_id = $board AND revision = $expected
  ```

  (The object for `$sha` is already written, §2.4. A refused update changes no row.)

  A mismatch gives **409 `WHITEBOARD_CONFLICT`** with the current page revision and its
  `updated_by` name. Two people on **different** pages never conflict. That fixes the
  board-level `bump()`, under which any page save conflicts with every other.
- **Structural writes** still bump the board revision: add, duplicate, reorder,
  archive/restore a page, and rename. They are rare and done by hand.
- **On a 409** the client offers:
  - **"Reload"**;
  - or **"Keep mine as a new page"**: the local draft is saved as a new page right after the
    conflicting one.

  It never merges silently and never overwrites. PD-39 offers "Save as a copy" for the
  board; a student board must stay single, so the copy is a page, not a board.
- **Presence (advisory only).** Opening a page sends a heartbeat (`POST
  …/pages/:id/presence`, Redis TTL 30 s). The editor shows "Ustadh X is also on this page".
  It is a hint, not a lock. It is optional in PR-6 and can be dropped without losing safety.

**Why not page locks.** A lock needs leases, takeover and expiry. A teacher's laptop that
sleeps mid-lesson would hold the child's page. Offline drafts (PD-39 §4.5) would have to
wait for a lock they cannot ask for. Locks also add a server state that a transfer would
have to clean up. Optimistic revisions already give PD-39's guarantee (no lost write, ever)
at no cost when there is no conflict, and conflicts are rare by construction.

**After a transfer**, the old teacher's next save answers **404**. The board is no longer
reachable to them, by the same rule as any other teacher's. The app says "You no longer teach
{child}. Your unsaved changes on this board can't be saved," and **deletes the local draft**.
It does not offer "save to my own boards": that would copy a child's work out of the
family's reach (§7).

---

## 5. Autosave and history

### 5.1 Autosave: PD-39, unchanged in feel

- **When:** on page switch, on leaving, and after a pause in drawing. On a student board
  the pause is **5 s** (PD-39 uses 2 s), configurable as `student_boards.autosave_debounce_ms`,
  and the client skips a save whose document hash has not changed. Every save writes an
  object (§2.4), so this halves the churn in storage (§5.4) and costs nothing a teacher
  would notice. The offline draft and its "Not saved yet" banner are the same as PD-39's.
- **Deleting a page on a student board archives it.** In one transaction the page is
  frozen as a one-page snapshot (`reason = 'page_archived'`, §5.2) and its live row is
  removed, so the 50-page positions and their deferrable unique constraint stay exactly as
  PD-39 built them. It is listed under "Earlier pages" (logged `page_archive`). Restoring it
  adds a new live page from the frozen document (`page_restore`).
- **Until PR-5 builds snapshots, a student board offers no page delete at all**: the route
  refuses it, and the editor hides the action.
- **Nothing a teacher drew on a student board is ever hard-deleted.** There is no board
  trash, and no student-board route deletes anything.
  - **Kept:** every page's last saved state, every snapshot and every archived page.
  - **Not kept:** the in-between autosave states of a live page. Their objects are removed
    by the GC (§2.4) once nothing names them. They are not history, in the same way PD-39
    keeps no per-keystroke versions.
- **Limits:**
  - 50 **live** pages, as PD-39;
  - archived pages are history records, so they don't count against the 50, but they do
    count against the learner's document quota (§5.4).

### 5.2 Lesson snapshots: "previous drawings and lesson history"

- **The link to the lesson.** A page saved while one of the learner's lessons is live (the
  §3.2 window) gets that `lesson_id`. The editor shows a "Lesson of {date}" chip, so the
  teacher knows the page will be filed under it.
- **The automatic snapshot** is taken by a worker sweep (every 5 min, in
  `apps/api/src/worker.ts`, beside the PD-39 purge). For each lesson of a learner with a
  board where:
  - the lesson ended more than 2 h ago;
  - its outcome is set and is not `rescheduled`;
  - it has no snapshot yet;

  the sweep freezes the pages whose `lesson_id` is that lesson into one
  `whiteboard_snapshot`, with `teacher_id = lesson.teacher_id` and the title "Lesson ·
  {date}". If no page was drawn in the lesson, there is no snapshot.
- **The manual snapshot.** "Save to history" in the editor freezes the chosen pages now. It
  is for work done outside a lesson (preparation, homework set).
- **Idempotent and safe:**
  - `unique (lesson_id)`;
  - the sweep claims lessons `FOR UPDATE SKIP LOCKED`;
  - a retry never duplicates;
  - **no change to lesson code**: the sweep only *reads* `chat.lesson`;
  - lessons are never deleted (`born open, closed once, never deleted`), so the link is
    stable.
- **Storage.** A snapshot page is a row pointing at the live page's existing object,
  `(board_id, sha256)`. **Taking a snapshot writes no object**: it only pins one that already
  exists, so the GC can never remove it. A page that did not change between two lessons is
  one object.
- **Images in snapshots.** An image asset that any snapshot page or live page names is
  **never deleted**. Only export assets expire (24 h, as PD-39). The PD-39 purge never runs
  on student boards: no trash, no retention clock.

### 5.3 How the parent browses history

- The child's board opens on **Now**: the live pages, read-only.
- A **History** list runs newest first: "Lesson · Tue 3 Nov · 3 pages · Ustadh X", and
  "Saved by Ustadh X · {date}". Dates are in the viewer's own time zone (PD-22).
- Tapping an item opens that snapshot's pages, read-only, with the same renderer.
- **Archived pages** ("Earlier pages") are shown to the teacher and to staff readers. Parents
  see them only if the owner chooses full history (§10 d). By default parents see the live
  pages and the lesson snapshots. A page the teacher archived on purpose, such as a mistake,
  is not pushed to the family.

### 5.4 Sizing

**The planning assumption** (the department head, 2026-10-31): about **300 active learners in
year one, growing to 1,000.**

**Per learner, if the teacher uses the board in every lesson:**

- 8 lessons a month × ~3 pages × ~40 KB of JSON is about **1 MB a month**, so **~12 MB a
  year** before compression;
- stored gzipped and deduplicated, a fair estimate is **~6 MB a year**. Stroke JSON of
  delta-encoded numbers compresses about two to one, and unchanged pages are stored once.

**Postgres (the 1 GB RAM / 10 GiB managed cluster PD-39 §11.2 sized) holds only metadata:**

| Rows | Size |
|---|---|
| a page row (hash, revision, attribution) | ~200 B |
| a blob row | ~150 B |
| a snapshot page row | ~150 B |
| **a year at 1,000 learners** (≈100 snapshots × 3 pages each, plus their blob rows) | **≈ 60–100 MB** |

That is about 1% of the disk, against **~12 GB a year** had the documents been kept in
Postgres. This is why the head moved them out.

**Object storage (Spaces):**

| What | Year one (300 learners) | At 1,000 learners |
|---|---|---|
| History and live documents (gzipped, deduplicated) | ~2–4 GB | ~6–12 GB a year, cumulative (never purged) |
| **Autosave churn**: superseded documents the GC deletes, kept by bucket versioning as non-current versions for its 30 days | ~5 GB at any time | ~15 GB at any time |
| Images | PD-39's caps (300 MB per teacher), unchanged | unchanged |

How the churn estimate is made:

- about one save per 10 s of active drawing, given the 5 s pause (§5.1);
- that is ~100 saves a lesson × ~20 KB gzipped, so ~2 MB a lesson;
- × 2,400 lessons a month (300 learners) or 8,000 (1,000 learners);
- held for the 30 days of versioning.

It is bounded: it does not grow over the years.

**Controls:**

- **A per-learner quota**, configurable, default **50 MB**. It counts the distinct objects
  the board names (live and archived pages and snapshots), not the churn the GC removes.
  At ~6 MB a year, that is about eight years of every-lesson use.
  - At 80% the teacher is told "This board's history is large".
  - At 100%, new snapshots stop (live editing continues), and the Teachers Manager is
    notified through PD-34.
  - **Nothing is deleted** to make room.
- **Dedupe**: content-addressed per board (§2.4).
- **An organisation budget** for student-board objects, computed from the blob rows'
  `stored_bytes` and alerting at 80%. It sits beside PD-39's budgets in the health metrics.
- **If churn ever matters**, the lever is the autosave pause (configuration) or a lifecycle
  rule on non-current versions under `whiteboard-docs/`. Whether Spaces supports such a rule
  is to be checked by whoever provisions versioning; it is not assumed here.

**Backups. The consequence of the move, stated plainly:**

- **Drawings and history now live in object storage, not in the nightly `pg_dump`.** They
  are protected by **bucket versioning** (PD-39 §11.3's hard precondition, 30 days): an
  overwrite or deletion can be undone within 30 days.
- **Losing the whole bucket would lose the drawings**, not only the images, as it would for
  chat attachments. Whether to add a cross-bucket copy is the backup doc's and the
  infrastructure owner's call. It is not researched here.
- Postgres keeps the metadata, so a database restore brings back which pages and snapshots
  exist and their hashes. The objects must still be there.
- **Restore drill:** restore the database, then check that every `ready` blob row of one
  student board resolves to an object whose SHA-256 matches. Add this to the backup doc §5
  checklist.
- **Hard precondition, unchanged:** student boards are not shown to anyone in an environment
  until object storage versioning is provisioned there and `assetsOn()` is on.

---

## 6. The user interfaces

### 6.1 Parent (Flutter, read-only)

- **Where it appears.**
  1. **The child's student group conversation**: a "Board" action in the conversation's
     header and info sheet. That is where the family already follows the child's lessons.
  2. **Settings › My profile › the child (`ChildTile`)**: a "Whiteboard" row.

  Neither appears until the board has content. No new tab: the parent's app stays Chats ·
  Calls · Settings.
- **The viewer:**
  - PD-39's `BoardCanvas` / painter in its existing `readOnly` mode, with no toolbar, no
    autosave and no draft storage;
  - pinch-zoom and page swipe;
  - the "Now / History" switch from §5.3;
  - works at phone width, in RTL and LTR.
- **Quran verses** come only through `GET /quran/ayahs` (PD-29's verified Tanzil dataset,
  with `rangeSha256` checked). They are drawn with Amiri Quran, with "Quran text: Tanzil
  Project — tanzil.net".
  - Any verification failure shows "Quran text unavailable", never a fallback.
  - A hash mismatch shows "Verse text updated", never a silent redraw.
  - The route is already `@SelfService()`, so a contact can call it. PR-7 adds a spec
    proving it for a contact token.
- **Documents and images** are fetched through URLs signed by the board read routes
  (`GET /learners/:learnerId/board`, `…/board/assets`, `…/board/history/:snapshotId`). Each
  route runs the parent read check and writes the log row first. The client checks each
  document's SHA-256 (§2.4). Everything is **only live under `assetsOn()`**, because the
  board itself lives in object storage.
- **Export for parents:** **none in the MVP**. A parent can take a screenshot like anything
  else on a phone. A "Download as PDF" for parents is a later, separate choice.
- **Children's own use:** the child looks at the parent's device. There is no student login
  (§10 e).

### 6.2 Teacher (Flutter; reopens the frozen Teacher Account. Flagged.)

The **Teacher Account scope is frozen** as a communication app. PD-39 reopened it for
Boards by the owner's decision. PD-54 adds **only entry points and a mode** of the same
editor, and no new tab.

| Entry | Change |
|---|---|
| **Student profile** `/students/:id` (PD-17, teacher-only) | A "Student board" button. |
| **A lesson in Schedule** | "Open student board" beside PD-39's "Open board". It opens the child's single board, and pages saved during the lesson get the lesson chip. |
| **The student group chat** | The same "Board" header action that parents get, which opens the editor for the teacher. |
| **The Boards tab** | A second segment, **"Students"**, lists the teacher's current students who have a board. There is no create button: a board is created by opening it from the student. |

- **The editor in student mode** is the same PD-39 editor plus:
  - per-page `If-Match` saves;
  - 409 → "Reload / Keep mine as a new page";
  - "Earlier pages" (archive and restore) instead of trash;
  - "Save to history";
  - the lesson chip;
  - a banner, "{child}'s family can see this board", so a teacher never mistakes it for a
    private board.
- **Insert pages from my boards** (PR-8): the teacher picks pages from one of their own
  boards. They are **copied** onto the student board, with images copied server-side to new
  keys (PD-39's copy machinery, with an `Idempotency-Key`). The source is never linked. A
  notice says "Copied pages become visible to {child}'s family."
- **Phones:** the PD-39 device gate is unchanged. Below 600 dp the board opens read-only.

### 6.3 Admin Web (staff, read-only)

- **Student profile › "Whiteboard"** (Admin Web `features/profiles`) opens a read-only viewer
  with Now, History and Earlier pages. It **reuses** `features/teacher-boards`' `BoardCanvas`
  and `render.ts`.
- It is shown only with `student_boards.view`. The server still answers 404 outside the
  learner's teacher's scope.
- **"Access history"** sits beside it, shown only with `whiteboards.retention`.
- No write affordance exists anywhere in Admin Web for student boards.

---

## 7. Privacy

- **What a parent sees.** Only boards of learners in **their own family**, through the PD-17
  predicate (`contact.family_id`). Siblings' boards are visible to all of the family's
  contacts, as the profile already is. No list or endpoint ever names another family's
  child, and a foreign learner id is "not found".
- **What a teacher sees.** Only the boards of learners they teach **now** (§3.1), plus
  during a live lesson (§3.2).
  - **After a transfer:** no access (recommended; §10 c). The old teacher's open tab gets
    404 on its next read or save, and the local draft is deleted (§4).
  - The board's history still shows the earlier teacher's name on their snapshots, to the
    family and to staff. That is the record of who taught the child.
- **Content a teacher might bring in.** A page copied from a teacher's own board can carry
  another child's name or work. The copy dialog warns about this (§6.2). The server cannot
  detect it. PR-8's acceptance test includes the warning in both languages.
- **The access log** records every open: by parents, teachers, staff and support sessions.
  Staff with `whiteboards.retention` can read it, and it outlives the board. Parents do
  **not** see staff opens (the same as PD-39, where teachers do not see the log). That is
  something the owner may choose to change.
- **Push and notifications.** None in the MVP: a new snapshot does not notify the family. A
  "new board page" notice would be a PD-34 rule of its own, the owner's choice later.
- **Subscription lock (PD-30).** Recommended: the board stays **viewable** while a child's
  lessons are locked. It is the child's past work, not a lesson (§10 g).
- **Arabic and English.** Every new string is in both, with RTL and LTR goldens. Snapshot
  titles are formatted on the client in the viewer's locale and zone. The server stores
  dates, not sentences.

---

## 8. How PD-54 fits PD-39's phases

| PD-39 phase | With student boards |
|---|---|
| **MVP** (built) | Reused unchanged: canvas, tools, page format, verses, images, export (the teacher's export of a student board works as PD-39's, logged). |
| **Phase 2: live share** (designed, not built) | A share of a **student** board goes to that learner's `student_group` conversation only. The share's card and delivery follow PD-39 §5.1 exactly: RT-009 per-recipient checks, owner-only operations. The share writes through to the same board, so the lesson snapshot (§5.2) also captures what was shown live. PD-54 adds nothing to Phase 2 and blocks nothing in it. |
| **Phase 3: student drawing** | **Not in PD-54.** Parents and children are view-only. When Phase 3 is decided, the student board is its natural home. Each element would carry an `author` (`teacher` or `learner`) so that a child's strokes can be shown, moderated or cleared apart from the teacher's, and the child would draw through the parent's device during a live share. That needs the owner's own decision on moderation and on keeping children's input (§10 e). |

---

## 9. Delivery: PRs in order

**Everything is behind one `chat.config` switch, `student_boards.enabled` (default off).**
Off means:

- every student-board route answers 404;
- the app shows no entry point.

It takes effect only while PD-39's `assetsOn()` is true (§2.4). It is turned on per
environment only after:

- object storage versioning is provisioned there (PD-39 §11.3);
- the parent viewer has passed QA.

**Migration slots:** PD-54 needs **two** (A in PR-2, B in PR-5). The head assigns them when
the build starts, after the owner approves. PR-1 has no migration.

| # | PR | Content | Tests | Risk / rollback |
|---|---|---|---|---|
| 1 | **API: split PD-39's service, and a server-side `put`** | Extract the storage primitives (page write, asset grant/confirm/sign, export compose, document checks) from `WhiteboardService` into a `BoardStore` with **no authz**. `WhiteboardService` keeps every teacher and staff decision and calls the store. Audit every `teacher_id` assumption (§2.2). Add an optional `put?` to the `ObjectStorage` adapter (S3/Spaces and the test fake), beside `copy?`, accepting only server-chosen keys (§2.4). | The whole PD-39 unit and integration suite, unchanged and green. A structural test that `BoardStore` is not exported from the module. `put` against MinIO in integration: content type and encoding kept; a malformed or foreign-prefix key refused before any network call. | **Regression in PD-39**, and **the shared storage seam** (also used by attachments). Mitigated by a pure move plus the unchanged suite; `put` is additive and reviewed by the security reviewer. Rollback: revert the PR. |
| 2 | **API + migration A: the student board** | §2.2 schema (without the snapshot tables) **including `whiteboard_document_blob`**. Documents in object storage (§2.4): the write order, signed document URLs, the GC sweep. `student_board_editor_ids` (§3.2). `GET/POST /learners/:learnerId/board` (get-or-create), page saves with per-page `If-Match`, structural writes (add, duplicate, reorder, rename; **no page delete** yet). The `student_boards.view` key. Access-log extension. The `student_boards.enabled` switch, gated on `assetsOn()`. | **Uniqueness:** 20 concurrent opens make one board. **The PD-39 fence:** every PD-39 teacher and staff route given a student board id answers 404 (a matrix). Leaver trigger: a teacher leaving leaves student boards untouched. **Transfer:** the old teacher gets 404 at once, the new teacher can write, nothing is written to the board. **Concurrency:** two pages save in parallel without conflict; the same page gives 409 and the document is unchanged. **Storage:** no student page row ever has a non-empty `document`; a save writes the object before the row; a 409 leaves an orphan the GC removes at 24 h; a blob named by a page cannot be deleted (RESTRICT); the document signer refuses `whiteboards/` keys and the asset signer refuses `whiteboard-docs/` keys; with `assetsOn()` false every route answers 404; storage down gives a failed save and an unchanged row. No route deletes anything (route-table assertion). Org-crossing gives 404. | Constraint changes on `chat.whiteboard` and on the append-only log. **Only additive changes and relaxed checks.** Rollback: switch off (data kept). |
| 3 | **API: parents and staff read** | Parent read routes (`@NotForStaff`, the family predicate), staff read routes (`@Requires('student_boards.view')` + `staff_supervised_teacher_ids` on the learner's teacher), image signing per reader (under `assetsOn()`), support-session read-only. | **The full matrix §3.1 × {read, sign images, every write}:** after every refused write, the board's revision, every page's document SHA-256 and the asset rows are **unchanged**. PD-35 switch ON and OFF. One log row per read, with the right basis; a forced log failure serves nothing. A contact of family B gets 404 on family A's child. Sales and Operations supervisors get 404. | **A wrong predicate leaks a child's work.** Mitigated by the matrix plus a review of the predicate by the security reviewer. Rollback: switch off. |
| 4 | **API: lifecycle** | Archive and unarchive on a permanent stop (worker sweep), and the read-only `archived` state. | Fake-clock sweep: stop → archived, writes refused, parent still reads; end the stop → active. A teacher leaving gives no editor, and the Teachers Manager can still read. | Low. |
| 5 | **API + migration B: history** | Snapshots and snapshot pages (insert-only; they pin existing objects and write none), the lesson-snapshot sweep, "Save to history", page archive/restore (§5.1), per-learner quota and org budget alert, history read routes for every reader. | Idempotent sweep (run twice gives one snapshot); a lesson with no pages gives no snapshot; a `rescheduled` lesson gives none. Dedupe: an unchanged page gives one object. Insert-only: UPDATE and DELETE are refused. The GC never deletes a blob a snapshot names. Quota at 100%: snapshot refused, live save still works. The images named by a snapshot survive every sweep. | **Object storage growth** (§5.4). Mitigated by quota, dedupe and an alert; Postgres grows by metadata only. Rollback: the sweep has its own config switch. |
| 6 | **Flutter teacher** | Entry points (§6.2), student mode in the editor, the 409 dialog, Earlier pages, Save to history, the lesson chip, the "family can see this" banner, the post-transfer draft deletion. | Widget tests for each entry point, the 409 "Keep mine as a new page" path, the banner (AR/EN goldens), and that the draft is deleted on 404. `flutter test --concurrency=2`, the full suite before reporting. | **Teacher Account freeze:** owner-approved scope only. Rollback: switch off hides it. |
| 7 | **Flutter parent** | The two entry points (§6.1), the read-only viewer, Now/History, verse rendering, image placeholders. | Goldens at 375×812 in AR/EN, RTL/LTR. The viewer never builds a toolbar and never calls a write method. Verse failure gives "Quran text unavailable". An API spec proves `/quran/ayahs` for a contact token. Device QA by release-qa. | Rollback: switch off. |
| 8 | **Admin Web + "Insert pages from my boards"** | Student profile › Whiteboard, Access history. Teacher-side page copy with an Idempotency-Key and server-side image copy. | Admin Web unit tests: key-gated visibility and no write controls. Copy: a replay with the same key makes one copy; the source is unchanged; the copied images sign under the student board only. | Low. Can ship last or be cut. |

**Order and parallelism:**

- PR-1 → PR-2 → PR-3 are strictly in order.
- After PR-3, PR-4, PR-5 and PR-6 can each be built in parallel (different files), within
  the head's builder cap.
- PR-7 needs PR-5 for History; it can ship Now-only earlier.
- PR-8 last.

**Machine load:**

- unit tests with `--maxWorkers=2`;
- Flutter with `--concurrency=2`;
- integration in CI (G-19), or with a spec slot from the head.

---

## 10. Questions for the owner, each with a recommendation

**(a) One board per student, or one per student per subject or course?**

- *Recommended: **one per student.***
- Today a learner has exactly one course (`learner_enrollment`) and one teacher, so
  per-subject boards would have nothing to separate.
- If the academy later teaches one child two subjects, the board gains **sections** (a
  `course_id` on pages and snapshots), not a second board. The owner's "no duplicate
  boards" holds either way.

**(b) Created automatically for every student, or when the teacher first uses it?**

- *Recommended: **on first use by the assigned teacher.***
- Creating boards on enrolment would make thousands of empty boards and touch Operations'
  enrolment code (PD-16/PD-42).
- An empty board would show the parent an entry with nothing behind it.
- First use is still automatic from the teacher's side: they press "Student board" and it
  exists. There is no form.

**(c) After a transfer, does the previous teacher keep any access?**

- *Recommended: **no.***
- The move already removes them from the child's group chat (PD-31). A teacher who no longer
  teaches a child should not keep reading the child's work.
- Their drawings stay on the board, with their name, for the family and the new teacher.
- Alternative, if the owner wants a handover period: read-only for 14 days after the
  transfer, logged with the basis `former_teacher`.

**(d) Do parents see the full history, or only the current pages?**

- *Recommended: **current pages plus the lesson history (snapshots)**, not the "Earlier
  pages" a teacher archived.*
- The lesson history is what the owner asked to preserve, and it is what shows a child's
  progress.
- Archived pages are often a teacher's corrections or false starts.
- Alternative: everything, including archived pages.

**(e) Can the child draw on their board (PD-39 Phase 3), now or later?**

- *Recommended: **later, as its own decision.***
- PD-54 is view-only for families.
- Children drawing needs:
  - moderation (who clears what a child drew);
  - keeping children's input (retention and consent);
  - a live channel (PD-39 Phase 2) to be useful during a lesson;
  - a way for the child to draw, which today means the parent's phone.
- The data model leaves room for it (§8).

**(f) Should Operations supervisors (the family's PD-8 supervisor) see the child's board?**

- *Recommended: **no**, the same as PD-39.*
- The Teachers department reviews teaching. Operations sees lesson reports and outcomes,
  which already summarise each lesson.

**(g) Does the board stay viewable to the parent while the child's lessons are locked for
payment (PD-30)?**

- *Recommended: **yes.***
- It is the child's past work, and hiding it would read as holding the work hostage.
- The lock governs lessons, not records.

**For the head (not the owner):**

- **Two migration slots** (A for PR-2, B for PR-5), at build start.
- **Answered 2026-10-31:** about 300 active learners in year one, growing to 1,000 (§5.4),
  and documents in object storage from day one (§2.4).
