# PD-41 · The Certificates page: student and teacher appreciation certificates — review and design

Status: **DESIGN, awaiting approval.** No feature code is written until the department head
and the owner approve this document and answer §13.
Claim: `docs/product/pd-registry/PD-41.md`. Migration slot: `20261027130000` (`chat_pd041_certificates`).
Base: `main` @ `6e809f12`.

The owner's request, in short:
- **Student certificates.** The Operations supervisor requests an appreciation certificate.
  The request carries the student, the teacher, the kind of recognition, the Juz' completed,
  notes, and "publish as a Story?".
  - The Designer designs it and uploads it.
  - It is then sent to the student's group, and optionally published as a Story.
- **Teacher certificates.** Teacher Supervision requests one, for example "Best Teacher of the
  Month". The request carries the teacher, the award, the period, notes, and "Teacher Story?".
  - The Designer designs it and uploads it.
  - It is sent to the teachers' group, and optionally published as a teacher Story.
- **One page.** Student and teacher categories, a request form, Pending / In progress /
  Completed / Sent lists, upload, send, Story, a status per request, and a history.
- **Permissions.** Ops supervisors request student certificates and Teacher Supervision requests
  teacher certificates. The Designer sees the page and designs, and nothing else. Managers and
  the super admin oversee.
- **Rules.** The certificate goes to the correct group. A Story is optional, never automatic.
  There are no duplicate requests and no double sends. Every request keeps its history. New
  types and categories can be added without rework.

PD-40 owns the generic permission system, the `specialist` tier and the Designer account.
PD-41 owns the certificates workflow, its pages and its `certificates.*` permission names (§6).

---

## 1. Summary of the review

| | Finding | Consequence for PD-41 |
|---|---|---|
| R1 | **PD-12 already has the record.** `chat.learner_certificate` (`20261019090000_chat_pd012_s1.sql:299-344`) is requested by the learner's teacher. A trigger keeps the request write-once and allows one decision (`:351-439`). It is never deleted (`:444-455`) and has three states: `requested`, `issued`, `declined`. | **Extend it, do not build beside it.** The boundary doc calls PD-12 "the only certificate model" (`JAWUID-CHAT-PRODUCT-BOUNDARY.md:1362-1364`). §4 widens it in place. |
| R2 | **Requests come from teachers today.** `POST /learner-certificates` is a teacher's ticket (`certificate.controller.ts:21-25`, `pd012-policy.ts:61-71`), and the Flutter app calls it (`lib/core/data/http/http_supervision_repository.dart:36`). The owner now wants **staff** to request. | The teacher's ticket stays, unchanged for the app. It becomes a *suggestion* that the learner's Ops supervisor accepts or declines (§13 Q5). |
| R3 | **The issuer is the Teachers department.** `requireSupervisor` uses `canSupervise` (`certificate.service.ts:329-335`; `pd012-policy.ts:35-50`). Upload and issue are one actor's act (`:174-264`). | The workflow splits into design (Designer), then send (requester). §6 maps today's issuers onto the new permissions, so nothing regresses before PD-40 lands. |
| R4 | **Where it is delivered is already solved for students.** `deliveryGroupFor` chooses the learner's live `student_group`, or else a live `family_group` about the learner that the learner's teacher is in (`certificate.service.ts:301-327`). The DB re-checks it (`20261019090000:415-427`). A student group holds the family's contacts, the PD-8 supervisor and the teacher. The student is not a member (`conversation.service.ts:645-697`). | Reused as it is (§5). |
| R5 | **There is no teachers' group.** The conversation types are direct, student_group, class_group, official, family_group, teacher_supervision, trial_group and department_room (`20261027100000_chat_pd035_department_rooms.sql:54-56`). PD-35's department rooms are **staff only** (`:1-25`, guard `:101-120`). No conversation holds every teacher. | A teacher certificate goes to the teacher's own **supervision conversation**, which holds the teacher and the Teachers department. The teacher Story is the public part. A real all-teachers room is a separate decision (§13 Q3). |
| R6 | **A Story audience for teachers exists.** It is `all_teachers`, `teacher`, or `segment{who:teachers}` (`20261017120000_chat_stories_v2.sql:214-236`; `story-audience.resolver.ts:238-298`). Stories v2 stories **do not expire** (`v2:7-13`). Publishers are staff in admin, coverage, manager or super_admin (`chat.current_can_publish_story`, `v2:173-181`; `authorization.service.ts:1086-1097`). | A teacher Story uses `all_teachers`. A student Story's audience is §13 Q4. The requesters can publish today; a `specialist` Designer cannot, which fits §13 Q1. |
| R7 | **Story media is not namespace-checked (security, outside PD-41).** `StoryService.create` stores `input.mediaObjectKey` as given (`story.service.ts:327, 389`). There is no prefix check, no `readHead`, and no DB check (`20260928120000_chat_stories.sql:142-207`). `authorizeMediaRead` then signs that key for every recipient (`story.service.ts:1341-1358`). A publisher could name a `conversations/<id>/…` key and broadcast another conversation's file. | **Reported as a follow-up**, not fixed here (§12). PD-41 never passes a client key to Stories. It copies the file server-side into `stories/` (§7). |
| R8 | **Cards are a lookup table, not a CHECK.** `chat.message_card_kind` (`20261019090000:265-284`). A kind is added with one INSERT (latest: `20261027100000:278-279`). `CardPoster.post(tx, conv, recorder\|null, card, attachment)` posts with author null when the recorder is not a member (`card-poster.ts:52-105`). | One new kind for the teacher category (§5). Student delivery keeps `certificate_issued`. |
| R9 | **PD-29 shows how to pin a file.** The upload key goes into a staging record, then a server-side `copy` moves it to a key no grant can name, which is checked with `readHead` (`materials-admin.service.ts:159-169, 493-523`). `ObjectStorage.copy?` exists for local and S3 (`object-storage.ts:106`; `s3-object-storage.ts:178`). Forwarding copies into another conversation's prefix (`attachment.service.ts:312-313`). | The design file is pinned **outside** any conversation. It is copied into the group's namespace only when it is sent (§7). Today PD-12 mints the key in the group's namespace at upload time. That no longer works once upload and send are separate acts. |
| R10 | **PD-34 can notify staff.** `NotificationPipeline.emit` / `NotificationService.schedule` with a `dedupeKey` (`notification-pipeline.service.ts:98`; for example `supervisor-cover.service.ts:755-768`). Templates are rows in a migration, and catalogue entries live in `notification-catalog.ts:51-80`. | Four events (§9), each deduplicated per certificate and revision. |
| R11 | **The page sits inside Teachers.** It lives at `/teachers/certificates` (`AppRoutes.tsx:108`, gated by `lessonManager`, `capabilities.ts:170-182`) and `/admin/teachers/certificates` (`:173-174`). It has one table, Issue and Decline (`CertificatesPage.tsx:22-138`). | A new top-level `/certificates` page (§10). The two old routes redirect to it. |
| R12 | **The name "teacher certificate" is taken.** It means a teacher's *qualification* document (Teacher Profile V2, the `teacher-certificates` media kind, `TEACHER_CERTIFICATE_*` errors: `errors.ts:357-361`). The boundary doc says the two "must never share a table, a screen or an API" (`:1221-1224`). | The new concept is an **appreciation certificate** (شهادة تقدير). Code and copy never say "teacher certificate" for it. The UI says "Teacher appreciation" / "تقدير المعلمين". |
| R13 | **Only one place outside the module reads the table.** Apart from `certificate.service.ts`, that is `stats.service.ts:177-182` (the learner's issued certificates for the parent's progress page). It is also covered by two integration specs (`pd012-s1.spec.ts`, `pd012-http.spec.ts`) and the Admin Web supervision api/test. | Renaming the table is cheap and safe (§4.1). |

---

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **appreciation certificate** | One request and its life: `chat.appreciation_certificate`, formerly `learner_certificate`. |
| **category** | Who it is for: `student` (a learner) or `teacher`. It is data (`chat.certificate_category`), so a third category such as `staff` is one row plus its rules. |
| **type** | The kind of recognition inside a category, for example "Juz' completed" or "Best Teacher of the Month". It is data (`chat.certificate_type`), per organization. |
| **requester** | The staff member who files it (an Ops supervisor, or a Teachers-department member), or a teacher's suggestion that a supervisor accepted. |
| **Designer** | A staff account holding `certificates.design` (PD-40's `designer` role). |
| **design file** | The uploaded artwork. It is pinned outside every conversation. There may be several revisions; one is current. |
| **delivery** | The send: one card with the file, in one group. |
| **Story** | An optional Stories v2 story made from the certificate image, at most once. |

---

## 3. The state machine

```
                 teacher's PD-12 ticket
                          │
                          ▼
                      proposed ──decline(reason)──▶ declined            (terminal)
                          │ accept (Ops supervisor)
  staff request ──────────┤
                          ▼
   ┌──────────────── requested  (Pending) ◀──────────────┐
   │                      │ start (Designer claims)      │ resubmit (requester edits)
   │                      ▼                              │
   │                  in_design (In progress) ──return(message)──▶ changes_requested
   │                      │ upload final file                       (In progress, "needs you")
   │                      ▼
   │                  uploaded  (Completed) ──redesign(message)──▶ in_design
   │                      │ send (server picks the group)
   │                      ▼
   │                    sent    (Sent)                                        (terminal for delivery)
   │
   └── cancel(reason): from proposed*, requested, in_design, changes_requested, uploaded ──▶ cancelled (terminal)

   Orthogonal, once: story_published_at — allowed from uploaded or sent, only when the request
   opted in (publish_story = true). It never changes `state`.
```

**Notes on the rules**
- Pending, In progress, Completed and Sent are the owner's four labels. `changes_requested` is
  shown as *In progress · needs requester*, and `proposed` as *Suggested by teacher*.
  `cancelled` and `declined` appear under *Closed*.
- **Who moves what:**
  - The requester (or an overseer) accepts or declines a suggestion, edits, resubmits,
    redesigns, sends, publishes the Story, and cancels.
  - The Designer starts, uploads, replaces the file while still in `in_design`, and returns for
    changes. **The Designer never cancels, sends or declines** (§13 Q1, Q2).
- **Request fields are editable only in `requested` and `changes_requested`.** Every edit is a
  history event with before and after. Once a design has started, the fields freeze until the
  Designer returns the request. The Designer always designs from a stable text.
- **`sent` is terminal for delivery.** A wrong certificate after sending is corrected with a new
  request. The old row stays `sent` and the mistake stays visible in the history. Un-sending
  would mean deleting a message from a family's chat, and the message-deletion rules (PD-37)
  already govern that.
- **Story and send are independent.** A requester may publish the Story before sending, or never
  send (for example a teacher award announced only as a Story). Both need a current file.
- **Legacy mapping (in the migration):**
  - PD-12 `issued` → `sent`.
  - `requested` (a teacher's open ticket, today awaiting the Teachers department) → `requested`.
    It is already accepted, so the open queue is not bounced back.
  - `declined` → `declined`.

### 3.1 History

`chat.appreciation_certificate_event` is append-only. Its shape copies PD-35's
`supervision_case_event` (`20261026160007:207-223`):

```
id, certificate_id, kind, from_state, to_state,
actor_staff_id | actor_teacher_id (exactly one),
before jsonb, after jsonb, note text, at timestamptz default clock_timestamp()
kind ∈ proposed, accepted, declined, requested, edited, started, returned, resubmitted,
       file_uploaded, file_replaced, redesign_requested, sent, story_published, cancelled, reassigned
```

- **No transition can skip its event.** Every write to the certificate sets `changed_by_staff`
  or `changed_by_teacher`. An AFTER trigger writes the event row from `old`/`new`, and refuses a
  state change with neither actor column set.
- `before`/`after` hold request fields and file metadata only, never object keys or
  conversation ids.
- Each act also writes `chat.audit_log` (the existing `learner_certificate.*` actions, renamed
  `appreciation_certificate.*`), so PD-35 B7's action log shows it with no change.

---

## 4. Data model

### 4.1 Extend in place: one migration at slot `20261027130000`

`alter table chat.learner_certificate rename to appreciation_certificate`. In Prisma, the model
becomes `AppreciationCertificate` with `@@map("appreciation_certificate")`. The readers to update
are `certificate.service.ts`, `stats.service.ts:177`, and the two PD-12 integration specs (R13).

**New and changed columns**

| Column | Change | Why |
|---|---|---|
| `category` | **new**, `text not null default 'student'` FK → `certificate_category` | student / teacher, as data |
| `type_id` | **new**, FK → `certificate_type`, null only on legacy rows | the kind of recognition |
| `learner_id` | becomes **nullable** | a teacher certificate has no learner |
| `recipient_teacher_id` | **new**, FK → `chat.teacher` | the awarded teacher |
| `requested_by` → `suggested_by_teacher` | **renamed** and nullable | the PD-12 ticket's teacher |
| `requested_by_staff` | **new**, FK → `chat.staff` | the requester of record (set on accept for a suggestion) |
| `signatory_teacher_id` | **new**, FK → `chat.teacher`: the learner's assigned teacher (`learner.teacher_id`) at request time | the student certificate's "teacher's name" line. A snapshot, so a later reassignment does not rewrite the certificate |
| `juz` | **new**, `smallint check (juz between 1 and 30)` | "the Juz' completed" |
| `period_start`, `period_end` | **new**, `date`, with `period_end >= period_start` | "award period", for example a month |
| `title`, `achievement`, `achieved_on`, `grade`, `printed_name` | **kept**. `achieved_on` becomes nullable for teacher awards that have a period instead | what the certificate says |
| `note` → `internal_note` | **renamed** | the requester's private context. **Never shown to the Designer** |
| `designer_note` | **new**, ≤1000 | "additional details" written *for* the Designer (colours, wording, Arabic or English) |
| `publish_story` | **new**, `boolean not null default false` | the request's opt-in. Never acted on by itself |
| `request_key` | **new**, `uuid not null`, `unique (organization_id, request_key)` | idempotent create (§8) |
| `state` | check widened to `proposed, requested, in_design, changes_requested, uploaded, sent, cancelled, declined` | §3 |
| `assigned_designer_id`, `design_started_at` | **new** | who claimed it |
| `current_file_id` | **new**, FK → `appreciation_certificate_file` | the file that will be sent |
| `sent_at`, `sent_by` | **new**; together with the existing `conversation_id` and `issued_message_id` → `sent_message_id` | the delivery |
| `story_id` | **new**, `unique` FK → `chat.story`, plus `story_published_at`, `story_published_by` | Story once |
| `cancelled_by`, `cancelled_at`, `cancel_reason` | **new**; the legacy `decided_by`/`decided_at`/`decline_reason` stay for `declined` | closing |
| `changed_by_staff`, `changed_by_teacher` | **new**, set on every write | the history trigger's actor (§3.1) |
| `object_key`, `mime_type`, `byte_size`, `file_name` | **move** to the file table. Legacy rows are copied as revision 1 with `delivered_object_key` = today's key | revisions |

**Row checks**
- **Recipient by category:** `(category = 'student') = (learner_id is not null)` and
  `(category = 'teacher') = (recipient_teacher_id is not null)`. The category row's
  `recipient_kind` is the source; one function per table (`plpgsql-shared-trigger` lesson).
- **Exactly one requester shape:** `proposed` ⇒ `suggested_by_teacher` is set and
  `requested_by_staff` is null. Any other state except a `declined` suggestion ⇒
  `requested_by_staff` is set.
- **State coherence:**
  - `sent` ⇔ `sent_at`, `sent_by`, `conversation_id` and `sent_message_id` are all set.
  - `uploaded` or `sent` ⇒ `current_file_id` is set.
  - `story_id` is set ⇒ `publish_story`, and the state is `uploaded` or `sent`.

### 4.2 New tables

```sql
chat.certificate_category (            -- seeded; adding a category = a row + its Layer-2 rule (§6.3)
  key text primary key,                -- 'student' | 'teacher'
  recipient_kind text not null check (recipient_kind in ('learner','teacher')),
  delivery_rule  text not null check (delivery_rule in ('learner_group','teacher_supervision')),
  story_audience text not null,        -- a StoryAudienceKind: 'all_families' | 'all_teachers' (§13 Q4)
  label_en text not null, label_ar text not null, sort smallint not null)

chat.certificate_type (                -- per organization; super admin edits (§13 Q6)
  id uuid pk, organization_id uuid not null, category text not null references certificate_category,
  key text not null, label_en text not null, label_ar text not null,
  needs_juz boolean not null default false,
  needs_period text check (needs_period in ('month','term','year')),   -- null = no period
  is_active boolean not null default true, sort smallint not null default 0,
  unique (organization_id, category, key))

chat.appreciation_certificate_file (   -- the design revisions; append-only
  id uuid pk, certificate_id uuid not null, revision int not null,
  purpose text not null check (purpose in ('certificate','story_image')),
  object_key text not null unique check (object_key ~ '^certificates/[0-9a-f-]{36}/[0-9a-f-]{36}/v/[0-9a-f-]{36}$'),
  mime_type, byte_size, file_name,            -- the PD-12 bounds: PDF/JPEG/PNG/WebP ≤ 20 MiB
  uploaded_by uuid not null references chat.staff, uploaded_at timestamptz not null,
  delivered_object_key text unique,           -- the copy in the group's namespace, once sent
  unique (certificate_id, purpose, revision))

chat.certificate_upload (              -- staging, as PD-29's material_upload: a key a grant named
  id uuid pk, certificate_id uuid not null, purpose text not null, object_key text not null unique,
  mime_type, byte_size, issued_to uuid not null references chat.staff, expires_at timestamptz not null,
  consumed_at timestamptz)

chat.appreciation_certificate_event    -- §3.1
```

**Seed types** (the academic team's list replaces these; §13 Q6):
- `student`: `juz_completed` (needs_juz), `surah_memorised`, `excellence`, `perfect_attendance`,
  `good_conduct`.
- `teacher`: `teacher_of_month` (needs_period month), `excellence`, `years_of_service`.

**Grants:** RLS is enabled, with no `chat_app` grants, as on PD-12's table. The tables are
server-only.

**Card kinds:** one INSERT, `certificate_awarded`, the teacher category's delivery card. Students
keep `certificate_issued`, so the Flutter card renderer and `stats.service` keep working.

**Notification templates:** four rows (§9).

---

## 5. Where a certificate goes

| Category | Group (the server picks it; the client never names it) | Who sees it | Why |
|---|---|---|---|
| **student** | The learner's live **student group**. Otherwise, a live **family group** about the learner that the learner's teacher is in. This is PD-12's `deliveryGroupFor` unchanged (`certificate.service.ts:301-327`), and the DB re-checks it (`20261019090000:415-427`). | The family's contacts, the PD-8 supervisor, the teacher | **Recommended.** It is where the lesson cards already land, it reaches parent and teacher at once, and the parent's progress page (`stats.service.ts:177`) lists the same record. A family group is only the fallback, so a sibling's parents never get another child's certificate unless they share that family group. |
| **teacher** | The teacher's **supervision conversation** (`teacher_supervision`: the teacher plus the Teachers department, `pd012-s1.md:12-16`), via `SupervisionConversationService.ensureInTx` | The teacher, Teacher Supervision | There is **no teachers' group** (R5). This is the only existing conversation that reaches the teacher and is the Teachers department's own. The **teacher Story** (`all_teachers`) is the public celebration. An all-teachers room would be a new conversation type with its own membership sync (like PD-35 B6), and is §13 Q3. |

**Send in two calls, so nobody sends to the wrong place blind**
1. `GET /certificates/:id/delivery` returns the group the server would choose now: its title,
   type and member count. Members' names are shown only to holders of `certificates.deliver`;
   the Designer never calls it.
2. `POST /certificates/:id/send { conversationId }` must echo that id. If the server's choice
   changed in between (a group archived or recreated), the call returns **409
   `CERTIFICATE_TARGET_CHANGED`** instead of sending somewhere else.
3. With no live group, the call returns 409 with PD-12's "open their Student Group first"
   message (`certificate.service.ts:432-438`).

---

## 6. Permissions

### 6.1 Names (proposed to PD-40, awaiting its confirmation)

| Permission | Allows | Layer 2: which rows (PD-41's service decides) | Risk |
|---|---|---|---|
| `certificates.view` | open the page; list and read | the union of the rows the bases below reach | pii |
| `certificates.request.student` | create, edit, resubmit, redesign or cancel student requests; accept or decline a teacher's suggestion | learners the caller acts for (PD-8 `learner_supervision` + `chat.staff_acts_for`: self, backup or manager; `conversation.service.ts:912-924`) | pii |
| `certificates.request.teacher` | the same for teacher requests | teachers in the caller's PD-35 scope (`teacher-scope.ts:96-110`) | pii |
| `certificates.design` | start, upload or replace the file, return for changes | every request of the organization in `requested`, `in_design` or `changes_requested`, plus its own `uploaded` and `sent` (read-only). **The design projection only (§6.4)** | pii (printed name) |
| `certificates.deliver` | read the delivery target, send | rows the caller may request (same basis) | family_contact |
| `certificates.story` | publish the Story | rows the caller may request, **and** `chat.current_can_publish_story()` | family_contact |
| `certificates.oversee` | the full DTO of every request in the category, cancel or reassign any, the full history | the Operations manager for `student`, the Teachers manager for `teacher`, and the super admin for both | pii |

PD-40's `certificates.decline` is dropped. The requester **cancels**, and the Designer
**returns**. Its `certificates.deliver` keeps the name but means *send* only. Upload is
`certificates.design`.

### 6.2 Who holds what

| | view | request.student | request.teacher | design | deliver | story | oversee |
|---|---|---|---|---|---|---|---|
| Ops supervisor (`supervisor@operations`) | ✔ | ✔ | | | ✔ | ✔ | |
| Ops manager (`manager@operations`) | ✔ | ✔ | | | ✔ | ✔ | student |
| Teacher Supervision member (`supervisor@teachers`) | ✔ | | ✔ | | ✔ | ✔ | |
| Teachers manager (`manager@teachers`) | ✔ | | ✔ | | ✔ | ✔ | teacher |
| **Designer** (`specialist` + role `designer`) | ✔ | | | ✔ | | | |
| Super admin | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| teacher (not staff) | — | — | — | — | — | — | — |

- A teacher keeps `POST /learner-certificates` (the suggestion) and `GET /learner-certificates`
  (own suggestions). Both are `@NotForStaff`.
- **Before PD-40 lands**, these rows are what Layer 2 derives from today's tiers and departments,
  so PD-41 can ship first. The **transition rule** is that `design` is also held by the Teachers
  department (`canSupervise`), today's issuers, until the organization has an active Designer.
  This keeps PD-12's "Teachers-department supervisors issue" (`BOUNDARY.md:1345`) working, and
  can be removed later. §11 PR-3 removes it once PD-40's Designer exists.

### 6.3 Where it is decided

`apps/api/src/platform/pd041-policy.ts` holds a DB-free
`decideCertificateAccess(actor, { opsRole, teachersRole, permissions? })`. It returns, per
category, `{ request, deliver, story, oversee }`, plus `design` and `projection: 'full' | 'design'`.
- It reads `Actor.permissions` when PD-40's PR-2 exists, and the legacy department roles
  otherwise. The PD-40 bundle ⇔ policy spec pins the two to each other.
- Row scope is applied in `CertificateService`.
- The DB trigger re-checks the actor of each transition:
  - `requested_by_staff` is live staff of the organization who reaches the recipient;
  - the Designer acts through `chat.staff_has_permission(id, 'certificates.design')` (PD-40
    PR-4's helper), or through the transition rule;
  - the sender is not the Designer.

### 6.4 Designer redaction: the design projection

| Field | Designer | Requester / overseer |
|---|---|---|
| `id`, `category`, `type` (label), `state`, `requestedAt`, `assignedDesigner`, `designStartedAt` | ✔ | ✔ |
| `printedName`, `title`, `achievement`, `achievedOn`, `grade`, `juz`, `period` | ✔ | ✔ |
| signatory teacher **name** (student category), awarded teacher **printed name** (teacher category) | ✔ | ✔ |
| `designerNote`, the requester's display name (who to expect answers from), `returnMessage` | ✔ | ✔ |
| the files (signed, short-lived) | ✔ | ✔ |
| `learner.id`, `teacher.id`, any family or contact data, `internalNote` | ✘ | ✔ |
| `publishStory`, `storyPublishedAt`, the delivery group, `sentAt`, `sentMessageId` | ✘ (the Designer sees only "Sent ✓") | ✔ |
| history | its own acts plus state changes, with no before/after of `internal_note` | ✔ full |

The projection is a separate serializer, `toDesignDto`, built from an allow-list. A unit spec
asserts that no other key ever appears. The `dtos()` loop does not compute `deliveryGroupFor`
for a Designer (today it runs per open row: `certificate.service.ts:379`).

---

## 7. Files and storage (an objectKey is a name, not a capability)

1. **Upload.** `POST /certificates/:id/files/upload { purpose, mimeType, byteSize }`
   (`certificates.design`).
   - The server mints a key under `certificate-uploads/<orgId>/<certId>/<uuid>` and records it
     in `certificate_upload` (issued to this Designer, expiring in 15 min).
   - It returns the signed PUT.
2. **Confirm.** `POST /certificates/:id/files { uploadId, fileName }`.
   - The server reads the head and checks the type by its magic bytes
     (`sniffCertificateFile`, as `certificate.service.ts:199-204`), and checks the size.
   - It **copies** to the pinned key `certificates/<orgId>/<certId>/v/<uuid>`, which no grant can
     name, and deletes the staging object. If the copy fails, both are deleted (PD-29
     `materials-admin.service.ts:493-523`).
   - It writes the revision and sets `current_file_id`. If `purpose = 'certificate'`, the state
     becomes `uploaded`.
3. **Read.** `GET /certificates/:id/files/:fileId` (`certificates.view`, plus Layer 2 row access)
   redirects to a 5-minute signed GET. Families never use this route. They read the delivered
   copy through the existing conversation media route.
4. **Send.** Inside the send transaction:
   - `storage.copy(pinned → conversations/<groupId>/<uuid>)`. The copy is made **before** the
     transaction; an orphan is deleted if the transaction aborts.
   - Then `CardPoster.post(tx, group, null, card, { kind, objectKey: delivered, … })`, as forward
     does (`attachment.service.ts:312-313`).
5. **Story.**
   - It needs an image: the certificate file, if it is PNG, JPEG or WebP; otherwise a
     `story_image` revision the Designer uploads.
   - The server copies it to `stories/<uuid>` and calls a new internal
     `StoryService.publishFromCertificate(tx, …)`. That method takes a **server-minted** key only,
     and never a client string (R7).

---

## 8. Idempotency and duplicates

| Risk | Defence |
|---|---|
| A double click on *Submit* | The form mints a `requestKey` (uuid) when it opens. With `unique (organization_id, request_key)`, a second POST with the same key returns **200 with the existing row** instead of a second request. |
| The same certificate requested twice by two people | A **hard** partial unique index on `(organization_id, category, coalesce(learner_id, recipient_teacher_id), type_id, coalesce(juz, 0), coalesce(period_start, '-infinity'))` `where state not in ('cancelled','declined')`, for types with `needs_juz` or `needs_period`. "Juz' 12 for Amina" or "Teacher of the Month, October" can exist once. The answer is **409 `CERTIFICATE_DUPLICATE`**, with the existing id and its state, shown as "already requested by …". |
| A near-duplicate (same recipient and type within 30 days, with no juz or period) | A **soft** check: 409 `CERTIFICATE_DUPLICATE_SUSPECTED` with the existing one. Resubmitting with `confirmDuplicate: true` files it, and the history records `confirmedDuplicate`. |
| A double send, or two senders at once | `SELECT … FOR UPDATE` on the row. The state must be `uploaded`, and the trigger allows `uploaded → sent` once. A repeat with the **same** `conversationId` after success returns **200 with the existing delivery** (idempotent); a different id returns 409. `sent_message_id` is unique. One send per certificate means one group per certificate in v1. |
| A double Story | The row lock, plus `story_id` is unique and written once (trigger). A repeat returns the existing story. |
| A double upload confirm | `certificate_upload.consumed_at` is set once. A second confirm of the same `uploadId` returns the existing revision. |
| Designers racing to claim | `start` locks the row; the second gets 409 "already started by …". An overseer may **reassign** (an event). |

---

## 9. Notifications (PD-34)

All are category `task`, with a `dedupeKey` per certificate and revision. They are emitted with
`NotificationPipeline.emit` in the same transaction as the transition. Each has a template row,
a `notification-catalog.ts` entry and an Arabic-first copy.

| Event | To | dedupeKey | Deep link |
|---|---|---|---|
| `certificate.requested` (also on accept and resubmit) | every live staff member holding `certificates.design` in the organization (the transition-rule holders before a Designer exists) | `cert:<id>:requested:<n>` | `/certificates/<id>` |
| `certificate.returned` | the requester of record | `cert:<id>:returned:<n>` | the same |
| `certificate.uploaded` (and `file_replaced`) | the requester of record | `cert:<id>:uploaded:<revision>` | the same |
| `certificate.cancelled` | the assigned Designer, if any | `cert:<id>:cancelled` | the same |

- Sending notifies no staff member; the group card is the family's or the teacher's notice,
  through the existing chat push.
- Notification bodies carry the type and the printed name only, never family data.

---

## 10. Admin Web: the Certificates page

A **new top-level route, `/certificates`.** It is a nav item visible when `GET /certificates/access`
says the caller holds anything. After PD-40 PR-5, it becomes a page-registry entry on
`certificates.view`.
- `/teachers/certificates` and `/admin/teachers/certificates` redirect to
  `/certificates?category=student`.
- The Teachers tab entry (`features/teachers/area.tsx:36`) is removed.
- The Designer's `homePath` is `/certificates`.

```
┌ Certificates ───────────────────────────────────────────── [ + New request ▾ ] ┐
│ [ Students ] [ Teachers ]                          ← only the categories you reach │
│ ( Pending 4 ) ( In progress 2 · 1 needs you ) ( Completed 3 ) ( Sent ) ( Closed ) │
│ search: name / type         filter: type ▾  requester ▾  designer ▾  month ▾      │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Printed name     Type             Juz'/period  Requested by  Age   Status   Story │
│ ...                                                                         ★ opt │
└─────────────────────────────────────────────────────────────────────────────────┘
row → side drawer:
  header  : printed name · type · status chip · Story chip (Opted in / Published ✓)
  Request : the fields (editable in Pending/Needs-changes for the requester) · notes for the designer
            · internal note (requester/overseer only)
  Design  : [Start] · upload (drag & drop, PDF/PNG/JPEG/WebP ≤20 MB) · revisions list with preview
            · [Return for changes…]                                   ← Designer
  Deliver : "Will be sent to: «Student group · Amina» (4 members)" [Send to group]
            · [Publish as Story] (only if opted in; audience named)  ← requester / overseer
            · [Ask for a redesign…] · [Cancel request…]
  History : the event timeline (who, what, when; before→after for edits)
```

**The request form** (a dialog, per category):
- **Student:**
  - the student, searched among the learners the caller acts for; it shows the student group
    the certificate would go to;
  - the teacher, pre-filled from the learner's assignment and read-only;
  - the type;
  - the Juz' (1–30), required when the type needs it;
  - the achievement date;
  - the printed name (pre-filled, editable);
  - an optional grade;
  - notes for the designer;
  - an internal note;
  - "Publish as a Story when it is ready" (a checkbox; it never publishes by itself).
- **Teacher:** the teacher (in the caller's scope), the type, the period (a month picker when
  the type needs a month), the printed name, notes for the designer, an internal note, and "Teacher
  Story when ready".

**Teacher suggestions** (PD-12 tickets) appear in Pending under the Students category with a
*Suggested by teacher* chip, and Accept / Decline buttons for the learner's supervisor.

**The Designer's view** is the same page, filtered by the design projection:
- no "New request" button, no Deliver section, no internal notes;
- the columns are printed name, type, juz/period, requester and age;
- the default tab is Pending, sorted oldest first.

**State is server-confirmed.** Buttons come from a per-row `actions: string[]` in the DTO,
computed by the policy, so the page never re-derives authorization.

**Tests:**
- vitest per role (Ops supervisor, Teachers member, Designer, super admin) on what is visible;
- a Designer snapshot with no family field;
- the double-click submit sends one `requestKey`;
- `TARGET_CHANGED` shows a "the group changed, check and send again" message.

---

## 11. Routes

All are under `@Controller('certificates')` with `CommErrorFilter`.
- **Before PD-40**, each handler names its permission in a comment, and Layer 2 enforces it.
- **After PD-40 PR-1**, each carries the `@Requires` shown, and PD-40's exact Designer route
  spec lists the ✱ rows.

| Method | Route | Permission | Notes |
|---|---|---|---|
| GET | `/certificates/access` ✱ | `@Requires.any(certificates.*)` | per-category capabilities, for the nav and the form |
| GET | `/certificates/types?category=` ✱ | `view` | active types |
| GET | `/certificates?category&status&q&cursor` ✱ | `view` | paged, at 100 per page (today it is capped at 500 with no paging); projection per §6.4 |
| GET | `/certificates/:id` ✱ | `view` | DTO, history and `actions[]` |
| GET | `/certificates/recipients?category&q` | `request.student` \| `request.teacher` | learners or teachers in Layer-2 reach; name and the signatory teacher only |
| POST | `/certificates` | `request.*` (by category) | body includes `requestKey`, optional `confirmDuplicate` |
| POST | `/certificates/:id/edit` · `/resubmit` · `/redesign` | `request.*` | |
| POST | `/certificates/:id/accept` · `/decline` | `request.student` | teacher suggestions |
| POST | `/certificates/:id/cancel` | `request.*` \| `oversee` | reason required |
| POST | `/certificates/:id/reassign` | `oversee` | designer change |
| POST | `/certificates/:id/start` ✱ · `/return` ✱ | `design` | |
| POST | `/certificates/:id/files/upload` ✱ · `/files` ✱ | `design` | §7 |
| GET | `/certificates/:id/files/:fileId` ✱ | `view` | a short signed redirect |
| GET | `/certificates/:id/delivery` | `deliver` | §5 |
| POST | `/certificates/:id/send` | `deliver` | echo of `conversationId` |
| POST | `/certificates/:id/story` | `story` | once |
| POST | `/learner-certificates` | `@NotForStaff` | **kept for the teacher app**; now creates `proposed` |
| GET | `/learner-certificates` | `@NotForStaff` | **kept**: a teacher's own suggestions. The staff branch is removed |
| POST | `/learner-certificates/:id/upload` · `/issue` · `/decline` | — | **removed** in PR-2, when the Admin Web switches. Only the Admin Web called them (Flutter calls only the POST, `http_supervision_repository.dart:36`) |

**New error codes:** `CERTIFICATE_DUPLICATE`, `CERTIFICATE_DUPLICATE_SUSPECTED`,
`CERTIFICATE_TARGET_CHANGED`, and `CERTIFICATE_STORY_NOT_OPTED_IN`. The existing
`CERTIFICATE_NOT_FOUND`, `CERTIFICATE_DENIED` and `CERTIFICATE_STATE` are reused
(`errors.ts:247-252`).

---

## 12. QA, PR breakdown and follow-ups

### 12.1 PRs (stacked, each merged by the department head after green checks)

| PR | Scope | Behaviour change | Depends on |
|---|---|---|---|
| **PR-0** (this) | the claim, the slot and this design | none | — |
| **PR-1** API + migration | migration `20261027130000`: rename, columns, category/type/file/upload/event tables, triggers, legacy mapping, the `certificate_awarded` kind, templates. `pd041-policy.ts` plus its matrix spec. `CertificateService` rewritten around the state machine. The new controller. The `/learner-certificates` teacher routes kept. The projection spec. Integration specs (rewritten `pd012-*`, new `pd041-*`: duplicates, races, send-once, Story-once, target-changed, redaction, trigger refusals attempted directly). `docs/contracts/API-CONTRACT.md`. | additive; legacy issue/decline still work until PR-2 | — |
| **PR-2** Admin Web | the `/certificates` page, form, drawer and history, the redirects, tests. Removes the three legacy staff routes. | the Teachers-tab page moves to `/certificates` | PR-1 |
| **PR-3** PD-40 wiring | the policy reads `Actor.permissions`; `@Requires` on all routes; the ✱ list goes into PD-40's exact Designer spec; the DB check calls `chat.staff_has_permission`; the transition rule (§6.2) ends | the Designer can work | PD-40 PR-1, PR-2, PR-4 |
| **PR-4** Flutter (small) | renders `certificate_awarded` in the supervision conversation (the file plus the type and period); the teacher's suggestion sheet copy says "suggest". | copy only | PR-1 |

### 12.2 Verification
- **Before each commit:** `bash scripts/qa/guards.sh` (G-20, pd-registry, …), API `tsc`, unit
  tests with `--maxWorkers=2`, Admin Web `tsc` and vitest. Checks run on the committed tree.
- **Integration specs** run in CI's G-19 job, or on an own, isolated database. There are no local
  integration containers in this session.
- **End-to-end walk on the system-test stack**, after the merge, with synthetic QA accounts only
  and no simulators:
  1. The Ops supervisor requests a student certificate.
  2. The Designer (or, before PD-40, a Teachers-department member) starts it, uploads it, and
     returns it for changes once.
  3. The requester resubmits, and the Designer uploads again.
  4. The requester sends it: the card is in the student group, and the parent sees the file.
  5. The requester publishes the Story: it reaches the audience, and a second press returns the
     same story.
  6. The same for a teacher: the card lands in the supervision conversation, and the Story goes
     to all teachers.
  7. Negative checks: the Designer gets 403 on `/conversations`, `/stories` and `/families`; a
     double send makes one card; a duplicate request returns 409.

### 12.3 Follow-ups found during the review (not PD-41's scope)
1. **R7, Stories media key (security).** `StoryService.create` must accept only keys under
   `stories/` that its own upload grant minted (a staging record, or at least a prefix check plus
   `readHead`), plus a DB check `media_object_key ~ '^stories/'`. Until that is fixed, a story
   publisher can re-broadcast any conversation's file.
2. The legacy `dtos()` runs `deliveryGroupFor` per open row, which is N+1 at `take: 500`
   (`certificate.service.ts:375-380`). PR-1 replaces it anyway.

---

## 13. Questions for the owner (each with a recommendation)

1. **Who presses "Send to group", the Designer or the requester?**
   - **Recommended: the requester** (the Ops supervisor, or Teacher Supervision), or an overseer.
     The Designer only designs and uploads.
   - The requester knows the family and the group, and sees where it will land before sending
     (§5). It also keeps the Designer an account with **no family-contact power at all**, as the
     owner asked ("does nothing else"). Every upload notifies the requester, so nothing waits
     unseen.
   - *This changes PD-40's §12 Q1 recommendation ("the Designer issues"), and PD-40 is told.*
   - Alternative: the Designer sends. That adds `certificates.deliver` to the Designer role and
     the delivery-target route to its route list.
2. **May the Designer decline, or ask for changes?**
   - **Recommended: ask for changes only.** "Return for changes" carries a message, the request
     goes back to the requester, who edits and resubmits, or cancels.
   - The Designer never declines. Whether a child or teacher deserves recognition is the
     department's decision, not the design team's.
3. **Teachers' group.** No conversation contains all the teachers today. Where does a teacher
   certificate go?
   - **Recommended for now:** into the teacher's own **supervision conversation** (the teacher
     plus Teacher Supervision), with the optional **teacher Story to all teachers** as the public
     celebration.
   - Alternative: a new **all-teachers announcement room** (staff post, teachers read), synced like
     PD-35's department rooms. That is a separate PD, because it creates a new channel to every
     teacher.
4. **Who sees a student's certificate Story?** It shows the child's printed name to everyone in
   the audience.
   - **Recommended: all families of the organization, only when the request opted in.** The
     requester also ticks "the family agreed to share" when publishing, and the history records
     that confirmation.
   - Alternative: the families of the child's teacher's other students (a `segment`), or no
     student Stories at all.
5. **What happens to the teacher's own Certificate ticket (PD-12)?**
   - **Recommended: keep it as a suggestion.** It lands as *Suggested by teacher* for the
     learner's Ops supervisor, who accepts it (it then goes to the Designer as a normal request)
     or declines it with a reason. The teacher sees the outcome in the supervision chat, as
     today.
   - The Teachers department stops being the issuer. Its PD-12 default 3 (`BOUNDARY.md:1345`)
     is superseded, and the Designer issues instead.
6. **Who maintains the list of certificate types?**
   - **Recommended: the super admin, as data.** That means an "active types" list per category
     (Arabic and English label, needs Juz' / needs a month), seeded from the academic team's
     list (PD-12 open item 2).
   - Requesters pick from the list and cannot type a free type. A new type needs no code; a new
     *category* (for example staff) is one row plus its permission and its group rule.

**Decided by this design** (the owner can overturn any of them):
- One send per certificate, to one group.
- A sent certificate is corrected by a new request, not edited.
- Request fields freeze while the Designer works.
- The Designer sees no family data, no internal note, and not where the certificate went.
- Every act is in the history and in the audit log.
