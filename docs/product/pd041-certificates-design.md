# PD-41 · The Certificates page: student and teacher appreciation certificates — review and design

Status: **DECIDED** (owner, 2026-10-28). All six recommendations in §13 are approved, with seven
safeguards (§0). §14 maps each safeguard to its state, mechanism and test. Code starts only on
the department head's GO, because of the machine-load cap.
Claim: `docs/product/pd-registry/PD-41.md`. Migration slot: `20261028130000` (`chat_pd041_certificates`),
assigned by the department head (earlier claims: `20261027130000`, `20261028110000`).
Base: `main` @ `a547b0e2`, with PD-40 merged (#164, #167, #172, #174).

## 0. The owner's decision (2026-10-28, verbatim, relayed by the department head)

> Approve all 6 recommendations, with the following safeguards:
> 1. Only the authorized requester may send a certificate to a group after the certificate has been reviewed and approved. The Designer's role is limited to designing, uploading, and returning certificates for corrections.
> 2. Every return-for-changes action must include a clear message, and the request must retain its history.
> 3. Teacher certificate Stories must remain optional and must never be published automatically.
> 4. Student certificate sharing requires explicit, documented family consent. Issuing a certificate must be separate from publishing it. If consent is missing or unclear, do not publish the certificate to Stories.
> 5. The learner's assigned Operations supervisor makes the final decision on teacher-submitted certificate suggestions. Record the decision and notify the requester.
> 6. The Super Admin manages certificate types, including enabling and disabling them. Disabling or retiring a type must not delete historical certificate records.
> 7. Enforce permissions on the backend, and maintain an audit trail for requests, approvals, revisions, sharing consent, publication, and final sending.
> Do not modify any Jawwid Core production code or database. Implement these changes only in the intended system and follow the existing project safeguards.

**What the decision changes in this design** (each item is already worked into the sections
below):
- **An explicit approval state, `approved`** (§3). The requester of record reviews the uploaded
  design and approves that exact revision. **Send and Story are impossible before approval.**
  The approver cannot be the person who uploaded the revision.
- **Consent is a recorded fact** (§4.3): who agreed, how, and when, kept in an append-only
  table. A student Story is refused unless the latest consent record is a grant. A withdrawal
  removes a Story that was already published.
- **Teacher suggestions** are decided only by the learner's assigned Operations supervisor, or
  their active PD-33 cover. The teacher is told the outcome (§6.2, §9).
- **Types** are managed by the super admin through a new key, `certificates.types`. They are
  disabled, never deleted (§4.2, §11).
- **Jawwid Core is untouched.** Everything here is in this repository (Chat), as `jawwid-chat-is-not-core` requires.

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
   │                  uploaded  (Completed · awaiting review) ──redesign(message)──▶ in_design
   │                      │ approve (the requester of record reviews THIS revision; approver ≠ uploader)
   │                      ▼
   │                  approved  (Completed · approved) ──withdraw approval + redesign(message)──▶ in_design
   │                      │ send (server picks the group)
   │                      ▼
   │                    sent    (Sent)                                        (terminal for delivery)
   │
   └── cancel(reason): from proposed*, requested, in_design, changes_requested, uploaded, approved ──▶ cancelled (terminal)

   Orthogonal, once: story_published_at. It is allowed only from `approved` or `sent`, only when
   the request opted in (publish_story = true), and, for a STUDENT certificate, only while the
   latest consent record is a grant (§4.3). It never changes `state`, and no transition
   publishes one.
```

**Notes on the rules**
- Pending, In progress, Completed and Sent are the owner's four labels.
  - `changes_requested` is shown as *In progress · needs requester*.
  - `proposed` is shown as *Suggested by teacher*.
  - `uploaded` and `approved` are both *Completed*. Their chips read *awaiting your review* and
    *approved · ready to send*.
  - `cancelled` and `declined` appear under *Closed*.
- **Who moves what:**
  - **The requester of record** edits, resubmits, reviews and **approves**, asks for a redesign,
    sends, records consent, publishes the Story, and cancels. An overseer may cancel, reassign
    the Designer and read everything. It does **not** approve or send for someone else's request
    (safeguard 1, "only the authorized requester").
  - **The learner's assigned Operations supervisor**, or their active PD-33 cover, accepts or
    declines a teacher's suggestion. Nobody else does, managers included (safeguard 5).
  - **The Designer** starts, uploads, replaces the file while still in `in_design`, and returns
    for changes with a message. **The Designer never approves, cancels, sends, declines or
    publishes** (safeguard 1; §13 Q1, Q2).
- **Approval is bound to a revision.** `approve` stores `approved_file_id = current_file_id`.
  - Any later upload needs `in_design`, so it clears the approval. Send and Story check
    `current_file_id = approved_file_id`.
  - A requester who changes their mind after approving withdraws the approval with a
    redesign message. That is one event, back to `in_design`.
- **Four eyes.** The approver must not be the `uploaded_by` of the approved revision. This
  matters while the transition rule lets the Teachers department design (§6.2), and for the
  super admin, who holds every key.
- **Request fields are editable only in `requested` and `changes_requested`.** Every edit is a
  history event with before and after. Once a design has started, the fields freeze until the
  Designer returns the request. The Designer always designs from a stable text.
- **`sent` is terminal for delivery.** A wrong certificate after sending is corrected with a new
  request. The old row stays `sent` and the mistake stays visible in the history. Un-sending
  would mean deleting a message from a family's chat, and the message-deletion rules (PD-37)
  already govern that.
- **Issuing and publishing are separate acts** (safeguard 4). Send never creates a Story, and
  Story never sends. A requester may publish the Story before sending, or never send (for
  example a teacher award announced only as a Story). Both need `approved` or `sent`.
- **Legacy mapping (in the migration):**
  - PD-12 `issued` → `sent`, with `approved_by = decided_by` (the issuer approved it by issuing).
    Legacy rows have no consent record, so **no legacy certificate can become a student Story**.
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
       file_uploaded, file_replaced, approved, approval_withdrawn, redesign_requested, sent,
       consent_granted, consent_withdrawn, story_published, story_withdrawn, cancelled, reassigned
check: kind in (returned, redesign_requested, approval_withdrawn, declined, cancelled,
                consent_withdrawn) ⇒ note is not null and length(btrim(note)) >= 10
```

- **No transition can skip its event.** Every write to the certificate sets `changed_by_staff`
  or `changed_by_teacher`. An AFTER trigger writes the event row from `old`/`new`, and refuses a
  state change with neither actor column set.
- `before`/`after` hold request fields and file metadata only, never object keys or
  conversation ids.
- **A return must say what to change** (safeguard 2). `return`, `redesign` and
  `approval_withdrawn` need a message of at least 10 characters after trimming. Both the API
  and the event CHECK above enforce it. The certificate also keeps the latest message as
  `return_message`, so the requester sees it without opening the history.
- Type changes (create, relabel, enable, disable) are not certificate events. They write
  `chat.audit_log` as `certificate_type.*` (§4.2).
- Each act also writes `chat.audit_log` (the existing `learner_certificate.*` actions, renamed
  `appreciation_certificate.*`), so PD-35 B7's action log shows it with no change.

---

## 4. Data model

### 4.1 Extend in place: one migration at slot `20261028130000`

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
| `state` | check widened to `proposed, requested, in_design, changes_requested, uploaded, approved, sent, cancelled, declined` | §3 |
| `approved_file_id`, `approved_by`, `approved_at` | **new**. Set together on `approve`, cleared together on `approval_withdrawn` or a new upload. The trigger requires `approved_by` to be a live requester and not `uploaded_by` of that file | safeguard 1 |
| `return_message` | **new**, ≥10 characters when set: the latest return or redesign message | safeguard 2 |
| `suggestion_decided_by`, `suggestion_decided_at` | **new**. The supervisor's accept or decline of a teacher's suggestion (the trigger checks they are the learner's assigned supervisor or their active cover) | safeguard 5 |
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
  - `uploaded`, `approved` or `sent` ⇒ `current_file_id` is set.
  - `approved` or `sent` ⇒ `approved_file_id = current_file_id`, and `approved_by` is set.
  - `story_id` is set ⇒ `publish_story`, and the state is `approved` or `sent`. For a student
    certificate, the AFTER trigger re-checks that the latest consent row is a grant.

### 4.2 New tables

```sql
chat.certificate_category (            -- seeded; adding a category = a row + its Layer-2 rule (§6.3)
  key text primary key,                -- 'student' | 'teacher'
  recipient_kind text not null check (recipient_kind in ('learner','teacher')),
  delivery_rule  text not null check (delivery_rule in ('learner_group','teacher_supervision')),
  story_audience text not null,        -- a StoryAudienceKind: 'all_families' | 'all_teachers' (§13 Q4)
  label_en text not null, label_ar text not null, sort smallint not null)

chat.certificate_type (                -- per organization; the super admin edits it (§13 Q6, safeguard 6)
  id uuid pk, organization_id uuid not null, category text not null references certificate_category,
  key text not null, label_en text not null, label_ar text not null,
  needs_juz boolean not null default false,
  needs_period text check (needs_period in ('month','term','year')),   -- null = no period
  is_active boolean not null default true, sort smallint not null default 0,
  disabled_at timestamptz, disabled_by uuid references chat.staff,
  unique (organization_id, category, key))
  -- never deleted: a BEFORE DELETE trigger refuses, and certificates reference it with
  -- ON DELETE RESTRICT. Disabling hides a type from the request form only; history keeps
  -- its label. `key` and `category` are immutable once a certificate uses the type.

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

### 4.3 Family consent for a student Story (safeguard 4)

```sql
chat.certificate_story_consent (       -- append-only (chat.forbid_change), one row per act
  id uuid pk, certificate_id uuid not null references chat.appreciation_certificate,
  kind text not null check (kind in ('granted','withdrawn')),
  given_by_contact_id uuid references chat.contact,  -- WHICH parent agreed (a contact of the learner's family)
  method text check (method in ('in_chat','phone','in_person','written')),
  evidence_message_id uuid references chat.message,  -- optional: the parent's "yes" in the family's chat
  note text,                                         -- required when method is phone or in_person
  recorded_by uuid not null references chat.staff, recorded_at timestamptz not null default clock_timestamp(),
  constraint consent_grant_is_documented check (kind <> 'granted' or (given_by_contact_id is not null and method is not null
                and (method in ('in_chat','written') or length(btrim(note)) >= 10))),
  constraint consent_withdrawal_has_reason check (kind <> 'withdrawn' or length(btrim(note)) >= 10))
```

- **Recording consent is a separate act from publishing it.** It has its own route (§11). The
  publish dialog never ticks it by default. The requester picks the parent from the family's
  contacts and the method.
  - "In chat" may link the parent's message, chosen from the student group or the direct
    conversation the requester is a member of. The trigger checks that the message belongs to
    a conversation about this learner, and that its author is `given_by_contact_id`.
  - Phone and in-person need a note.
- **Missing or unclear means no Story.** The Story route refuses with **409
  `CERTIFICATE_STORY_CONSENT_MISSING`** unless the **latest** row for the certificate is
  `granted`.
  - The AFTER trigger on `appreciation_certificate.story_id` re-checks the same rule, so no
    code path can skip it.
  - "Unclear" is never something the system can record: a grant without a named parent and a
    method fails the CHECK.
- **A withdrawal after publication** deletes the certificate's Story in the same transaction,
  through StoryService's existing delete (`story.controller.ts:209`). It writes
  `story_withdrawn` and, because a Story is published once, the certificate cannot be
  republished.
- **Teacher certificates need no family consent.** The teacher Story stays opt-in at request
  time and is published only by the explicit Story action (safeguard 3).
- The consent table is server-only, like the rest. The Designer never sees it.

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
2. `POST /certificates/:id/send { conversationId }` needs state `approved`, with
   `current_file_id = approved_file_id`, and must echo that id. If the server's choice
   changed in between (a group archived or recreated), the call returns **409
   `CERTIFICATE_TARGET_CHANGED`** instead of sending somewhere else.
3. With no live group, the call returns 409 with PD-12's "open their Student Group first"
   message (`certificate.service.ts:432-438`).

---

## 6. Permissions

### 6.1 Names (agreed with PD-40, 2026-10-27)

**Checked against the merged catalogue** (`main` @ `a547b0e2`, PD-40 #164/#167/#172/#174):
- **Already in place.** `apps/api/src/platform/permissions/catalogue.ts:104-108` and the seed
  `20261027190000_chat_pd040_access_roles.sql:165-167` hold `certificates.view`, `.design` and
  `.deliver`, all `delegable=false`. `certificates.decline` does not exist.
- **Today's routes.** `certificate.controller.ts` on main declares `GET /learner-certificates` →
  view, `/:id/upload` → design, and `/:id/issue` and `/:id/decline` → deliver.
- **Legacy bundles.** Only the Teachers department holds certificate keys, manager and members
  alike: view, design and deliver (`legacy-bundles.ts:99-106`; seed rows `:227-229`, `:332-334`).
  That is today's `canSupervise`. **Operations holds none yet.**
- **The Designer** is a role the super admin defines as data (`chat.define_access_role`,
  `:634`; tier `specialist`). It is not seeded. Its template is `view` + `design`, and it never
  sends (§13 Q1).
- **Helpers PD-41 reads:** `chat.staff_has_permission(staff, key)` (`:541`),
  `chat.staff_access_profile(staff)` (`:473`), and `PermissionService.profileOf(actor)` in
  TypeScript.

**What PD-41 PR-1 adds** (one catalogue row and one seed row per key, as PD-40 §3.2 requires):
- **New keys:** `certificates.request.student`, `.request.teacher`, `.story`, `.oversee` and
  `.types`. All are `delegable=false` until `decideCertificateAccess` (§6.3) verifies their
  bundles in `pd040-legacy-bundles.spec.ts`.
- **New legacy-bundle rows:**
  - Operations: view, request.student, deliver and story for supervisors, plus oversee for
    managers.
  - Teachers: request.teacher and story for supervisors, plus oversee for managers.
  - The super admin already holds `*`.
- **A relabel:** `certificates.deliver` becomes "Send certificates to their group" / "إرسال
  الشهادات إلى مجموعتها", because a teacher certificate does not go to a family. This is one
  `update chat.permission` row, done inside `chat.pd040_access_change`.
- **Wiring:** `@Requires` on every new route; regenerate `docs/security/pd040-route-permissions.md`
  with `PD040_WRITE_ROUTE_TABLE=1`. `bash scripts/qa/guards.sh pd040-routes` must pass.
- **The Designer route list** (§11 ✱) is sent to PD-40 for its exact-route spec.

| Permission | Allows | Layer 2: which rows (PD-41's service decides) | Risk |
|---|---|---|---|
| `certificates.view` | open the page; list and read | the union of the rows the bases below reach | pii |
| `certificates.request.student` | create, edit, resubmit, cancel, **review and approve** or ask for a redesign of a student request; accept or decline a teacher's suggestion | create: learners the caller acts for (PD-8 `learner_supervision` + `chat.staff_acts_for`, `conversation.service.ts:912-924`). Every later act: **the requester of record, or their active PD-33 cover** (not the manager). Suggestions: **the learner's assigned supervisor or their active cover only** (safeguard 5) | pii |
| `certificates.request.teacher` | the same for teacher requests | create: teachers in the caller's PD-35 scope (`teacher-scope.ts:96-110`). Later acts: the requester of record | pii |
| `certificates.design` | start, upload or replace the file (only in `in_design`), return for changes **with a message** | every request of the organization in `requested`, `in_design` or `changes_requested`, plus its own `uploaded`, `approved` and `sent` (read-only). **The design projection only (§6.4)** | pii (printed name) |
| `certificates.deliver` | read the delivery target; send an **approved** certificate | the requester of record, or their active cover (safeguard 1) | family_contact |
| `certificates.story` | record or withdraw family consent; publish the Story of an approved certificate | the requester of record, or their active cover, **and** `chat.current_can_publish_story()` | family_contact |
| `certificates.oversee` | the full DTO of every request in the category, cancel or reassign the Designer, the full history. **Never approve, send or publish** for another's request | the Operations manager for `student`, the Teachers manager for `teacher`, and the super admin for both | pii |
| `certificates.types` | create, relabel, enable or disable certificate types | the super admin only (bundle `*`); it is in no other bundle (safeguard 6) | admin |

There is no `certificates.decline`: the requester **cancels**, and the Designer **returns**.
`certificates.deliver` means *send* only; upload is `certificates.design`.

**The super admin** holds every key, so it may request, approve and send its own requests. The
four-eyes rule (§3) still stops it from approving a revision it uploaded itself.

### 6.2 Who holds what

| | view | request.student | request.teacher | design | deliver | story | oversee | types |
|---|---|---|---|---|---|---|---|---|
| Ops supervisor (`supervisor@operations`) | ✔ | ✔ | | | ✔ | ✔ | | |
| Ops manager (`manager@operations`) | ✔ | ✔ | | | ✔ | ✔ | student | |
| Teacher Supervision member (`supervisor@teachers`) | ✔ | | ✔ | (✔ transition) | ✔ | ✔ | | |
| Teachers manager (`manager@teachers`) | ✔ | | ✔ | (✔ transition) | ✔ | ✔ | teacher | |
| **Designer** (`specialist` + the super admin's `designer` role) | ✔ | | | ✔ | | | | |
| Super admin | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| teacher (not staff) | — | — | — | — | — | — | — | — |

- A teacher keeps `POST /learner-certificates` (the suggestion) and `GET /learner-certificates`
  (own suggestions). Both are `@NotForStaff`.
- **The transition rule.** PD-40 is merged and its guard runs in **shadow** mode. The
  Teachers department keeps `certificates.design` (it is in the merged bundle), so PD-12's
  issuers can still design until the organization has an active Designer.
  - The four-eyes rule (§3) means a member who designed a revision cannot approve it.
  - §12 PR-3 removes `design` from the Teachers bundle once a Designer exists. That is a bundle
    edit and a spec change, and it is the department head's call to schedule.

### 6.3 Where it is decided

`apps/api/src/platform/pd041-policy.ts` holds a DB-free
`decideCertificateAccess(actor, { opsRole, teachersRole, permissions? })`. It returns, per
category, `{ request, deliver, story, oversee }`, plus `design` and `projection: 'full' | 'design'`.
- It reads `Actor.permissions` when PD-40's PR-2 exists, and the legacy department roles
  otherwise. The PD-40 bundle ⇔ policy spec pins the two to each other.
- Row scope is applied in `CertificateService`.
- The DB trigger re-checks the actor of each transition with PD-40's `chat.staff_has_permission`:
  - `requested_by_staff` is live staff of the organization who reaches the recipient;
  - `start`, `upload` and `return` need `certificates.design`;
  - `approve` needs the requester of record (or their active cover), and an actor who is not
    the revision's `uploaded_by`;
  - `send` and `story` need `certificates.deliver` / `.story`, and the requester of record or
    their cover. **A Designer-only account can never be the actor of approve, send or Story**,
    even by a direct SQL write;
  - `accept` / `decline` of a suggestion need the learner's `learner_supervision.supervisor_id`,
    or an active PD-33 cover for them.

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
| A double send, or two senders at once | `SELECT … FOR UPDATE` on the row. The state must be `approved`, with `current_file_id = approved_file_id`, and the trigger allows `approved → sent` once. A repeat with the **same** `conversationId` after success returns **200 with the existing delivery** (idempotent); a different id returns 409. `sent_message_id` is unique. One send per certificate means one group per certificate in v1. |
| A double Story | The row lock, plus `story_id` is unique and written once (trigger). A repeat returns the existing story. |
| A double upload confirm | `certificate_upload.consumed_at` is set once. A second confirm of the same `uploadId` returns the existing revision. |
| A double approve, or an approve of a stale revision | `approve` carries the `fileId` the reviewer looked at. It must equal `current_file_id`; otherwise 409 `CERTIFICATE_REVISION_CHANGED`. A repeat on an approved row returns 200. |
| Consent recorded twice | Each act is its own append-only row; only the **latest** counts. A repeat grant is harmless and visible in the history. |
| Designers racing to claim | `start` locks the row; the second gets 409 "already started by …". An overseer may **reassign** (an event). |

---

## 9. Notifications (PD-34)

> **Superseded by PD-47 PR-6b (owner 2026-10-29, "Yes, replace them").** The four `task` notifications below are no longer sent. Each step that waits on a person is that person's task instead (`docs/product/pd047-tasks-plan.md` §3.6), announced once with `task_assigned`. The teacher's answer to a suggestion is PD-12's card alone. The state machine is unchanged.

All are category `task`, with a `dedupeKey` per certificate and revision. They are emitted with
`NotificationPipeline.emit` in the same transaction as the transition. Each has a template row,
a `notification-catalog.ts` entry and an Arabic-first copy.

| Event | To | dedupeKey | Deep link |
|---|---|---|---|
| `certificate.requested` (also on accept and resubmit) | every live staff member holding `certificates.design` in the organization (the transition-rule holders before a Designer exists) | `cert:<id>:requested:<n>` | `/certificates/<id>` |
| `certificate.returned` | the requester of record | `cert:<id>:returned:<n>` | the same |
| `certificate.uploaded` (and `file_replaced`) | the requester of record | `cert:<id>:uploaded:<revision>` | the same |
| `certificate.cancelled` | the assigned Designer, if any | `cert:<id>:cancelled` | the same |
| `certificate.approved` | the assigned Designer (so the job is closed for them) | `cert:<id>:approved:<revision>` | the same |
| `certificate.suggestion_decided` (safeguard 5) | **the teacher who suggested it**, as a PD-34 notification **and** PD-12's card in their supervision conversation: `certificate_accepted` (a new kind) or the existing `certificate_declined` with the reason | `cert:<id>:suggestion` | the teacher app's supervision chat |

- Sending notifies no staff member; the group card is the family's or the teacher's notice,
  through the existing chat push. A Story is announced only by the Stories feed itself.
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
  Review  : the uploaded revision, full size · [Approve this design] · [Ask for a redesign…]  ← requester
  Deliver : (only once approved) "Will be sent to: «Student group · Amina» (4 members)" [Send to group]
  Story   : (only if opted in, only once approved) consent status (student: "Family consent: not recorded"
            → [Record consent…]: which parent, how, link to their message or a note)
            · [Publish as Story] (disabled until consent is granted; audience named)  ← requester
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
*Suggested by teacher* chip.
- Accept / Decline buttons are shown **only** to the learner's assigned Operations supervisor
  or their active cover. Everyone else sees "awaiting «supervisor»".
- Decline needs a reason, and the teacher is told the outcome either way.

**Certificate types** (the super admin only, `certificates.types`): a *Types* tab with
per-category lists, Arabic and English labels, "needs Juz' / needs a month", and an
**Enabled** switch.
- There is no Delete button. A disabled type is greyed out in filters and still labels its old
  certificates.

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
| POST | `/certificates/:id/accept` · `/decline` | `request.student` | teacher suggestions; the learner's assigned supervisor or their active cover only; decline needs a reason |
| POST | `/certificates/:id/approve` | `request.*` | body `{ fileId }`; the requester of record (or their cover), not the uploader |
| POST | `/certificates/:id/withdraw-approval` | `request.*` | message ≥10 characters; → `in_design` |
| POST | `/certificates/:id/cancel` | `request.*` \| `oversee` | reason required |
| POST | `/certificates/:id/reassign` | `oversee` | designer change |
| POST | `/certificates/:id/start` ✱ · `/return` ✱ | `design` | |
| POST | `/certificates/:id/files/upload` ✱ · `/files` ✱ | `design` | §7 |
| GET | `/certificates/:id/files/:fileId` ✱ | `view` | a short signed redirect |
| GET | `/certificates/:id/delivery` | `deliver` | §5 |
| POST | `/certificates/:id/send` | `deliver` | `approved` only; echo of `conversationId` |
| POST | `/certificates/:id/consent` | `story` | student only; `{ kind: granted, contactId, method, evidenceMessageId?, note? }` or `{ kind: withdrawn, note }` |
| POST | `/certificates/:id/story` | `story` | `approved` or `sent`; opted in; student: the latest consent is a grant; once |
| GET | `/certificates/types/admin` · POST `/certificates/types` · POST `/certificates/types/:id` | `types` | the super admin; create, relabel, enable/disable; never delete |
| POST | `/learner-certificates` | `@NotForStaff` | **kept for the teacher app**; now creates `proposed` |
| GET | `/learner-certificates` | `@NotForStaff` | **kept**: a teacher's own suggestions. The staff branch is removed |
| POST | `/learner-certificates/:id/upload` · `/issue` · `/decline` | — | **removed** in PR-2, when the Admin Web switches. Only the Admin Web called them (Flutter calls only the POST, `http_supervision_repository.dart:36`) |

**New error codes:** `CERTIFICATE_DUPLICATE`, `CERTIFICATE_DUPLICATE_SUSPECTED`,
`CERTIFICATE_TARGET_CHANGED`, `CERTIFICATE_STORY_NOT_OPTED_IN`, `CERTIFICATE_NOT_APPROVED`,
`CERTIFICATE_REVISION_CHANGED`, `CERTIFICATE_SELF_APPROVAL`, `CERTIFICATE_STORY_CONSENT_MISSING`
and `CERTIFICATE_TYPE_DISABLED`. The existing
`CERTIFICATE_NOT_FOUND`, `CERTIFICATE_DENIED` and `CERTIFICATE_STATE` are reused
(`errors.ts:247-252`).

---

## 12. QA, PR breakdown and follow-ups

### 12.1 PRs (stacked, each merged by the department head after green checks)

| PR | Scope | Behaviour change | Depends on |
|---|---|---|---|
| **PR-0** (this) | the claim, the slot and this design | none | — |
| **PR-1** API + migration | migration `20261028130000`: rename, columns, the category, type, file, upload, event and **consent** tables, triggers (approval, four eyes, consent, suggestion decider, type never deleted), legacy mapping, the `certificate_awarded` and `certificate_accepted` kinds, templates, and the five new catalogue keys plus their bundle rows. `pd041-policy.ts` plus its matrix spec. `CertificateService` rewritten around the state machine. The new controller. The `/learner-certificates` teacher routes kept. The projection spec. Integration specs (rewritten `pd012-*`, new `pd041-*`: duplicates, races, send-once, Story-once, target-changed, redaction, trigger refusals attempted directly). `docs/contracts/API-CONTRACT.md`. | additive; legacy issue/decline still work until PR-2 | — |
| **PR-2** Admin Web | the `/certificates` page, form, drawer and history, the redirects, tests. Removes the three legacy staff routes. | the Teachers-tab page moves to `/certificates` | PR-1 |
| **PR-3** Designer cut-over | the ✱ list into PD-40's exact Designer route spec; `design` removed from the Teachers bundle (the transition rule ends) once a Designer account exists | only the Designer designs | PR-1, plus a Designer created on the stack. PD-40 is **merged**, so PR-1 already reads `PermissionService.profileOf` and `chat.staff_has_permission` |
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
  4. Send is refused before approval. The Designer cannot approve, and neither can the person
     who uploaded the revision. The requester approves the revision.
  5. The requester sends it: the card is in the student group, and the parent sees the file.
  6. Story is refused without consent. The requester records consent (parent plus method) and
     publishes the Story: it reaches the audience, and a second press returns the same story.
     A withdrawal removes the Story.
  7. The same for a teacher: the card lands in the supervision conversation, and the Story goes
     to all teachers.
  8. Negative checks: the Designer gets 403 on `/conversations`, `/stories` and `/families`; a
     double send makes one card; a duplicate request returns 409.

### 12.3 Follow-ups found during the review (not PD-41's scope)
1. **R7, Stories media key (security).** `StoryService.create` must accept only keys under
   `stories/` that its own upload grant minted (a staging record, or at least a prefix check plus
   `readHead`), plus a DB check `media_object_key ~ '^stories/'`. Until that is fixed, a story
   publisher can re-broadcast any conversation's file.
2. The legacy `dtos()` runs `deliveryGroupFor` per open row, which is N+1 at `take: 500`
   (`certificate.service.ts:375-380`). PR-1 replaces it anyway.

---

## 13. Questions for the owner — DECIDED 2026-10-28

**All six recommendations are approved** (§0), with the safeguards mapped in §14. The questions
are kept as asked.

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

---

## 14. The owner's safeguards → state, mechanism, test

Each safeguard is enforced **three times**:
- Layer 1, PD-40's `PermissionGuard` with the route's `@Requires`;
- Layer 2, `decideCertificateAccess` plus the row rules in `CertificateService`;
- the database trigger, so a direct SQL write is refused too.

Each one is proven by a DB-free unit test, an integration spec that also attempts the refused
write **directly in SQL**, and an Admin Web test where it shows on screen.

| # | Safeguard | State machine | Mechanism | Tests |
|---|---|---|---|---|
| 1 | Only the authorized requester sends, after review and approval; the Designer designs, uploads and returns, nothing else | `uploaded` → **`approved`** → `sent`. `approve`, `send` and `story` exist only from `approved` (Story also from `sent`). A new upload needs `in_design`, so it clears the approval | **The review is the requester's approval.** `POST /approve {fileId}` binds `approved_file_id` to the revision the requester looked at. The approver is the requester of record or their active cover, never the revision's uploader (four eyes). `send` needs `approved` and `current_file_id = approved_file_id`, plus the requester of record or their cover. The Designer role holds only `view` + `design`, and the trigger refuses a Designer-only actor on approve, send and Story | unit: the policy matrix (the Designer has no approve/deliver/story; the overseer cannot approve or send). integration: send before approval returns 409 `CERTIFICATE_NOT_APPROVED`; approve by the uploader returns 409 `CERTIFICATE_SELF_APPROVAL`; approve of a stale `fileId` returns 409 `CERTIFICATE_REVISION_CHANGED`; an upload after approval needs a redesign first; the SQL `update … set state='sent'` on an `uploaded` row is refused; a Designer's `send` returns 403 at the guard. Admin Web: no Send button before approval; the Designer sees no Approve, Send or Story |
| 2 | Every return-for-changes has a clear message; the history is kept | `in_design` → `changes_requested` (Designer); `uploaded`/`approved` → `in_design` (requester's redesign, approval withdrawal) | The API refuses a message under 10 trimmed characters. `appreciation_certificate_event` CHECKs `note` for `returned`, `redesign_requested`, `approval_withdrawn`, `declined` and `cancelled`. The event table is append-only (`chat.forbid_change`), and an AFTER trigger writes every transition, so none is skipped. `return_message` shows the latest message | unit: message validation. integration: an empty or short return returns 400; the SQL insert of a `returned` event without a note is refused; the SQL update or delete of an event is refused; every transition in a scripted walk leaves exactly one event. Admin Web: Return/Redesign dialogs cannot submit empty |
| 3 | Teacher Stories stay optional, never automatic | The Story is orthogonal to `state`, and no transition publishes one | `publish_story` is the request's opt-in only. A Story is created **only** by `POST /certificates/:id/story`, an explicit action by a holder of `certificates.story`. There is no listener, job or trigger that creates one | integration: a full teacher walk to `sent` with `publish_story = true` leaves `story_id` null and creates no `chat.story` row; Story without opt-in returns 409 `CERTIFICATE_STORY_NOT_OPTED_IN`; a second press returns the same story. unit: `send()` never calls StoryService (a spy) |
| 4 | Student Stories need explicit, documented family consent; issuing is separate from publishing; missing or unclear consent means no Story | Consent is its own append-only record (§4.3). Story is allowed only from `approved`/`sent` **and** when the latest consent row is a grant | `POST /consent` records a named parent (a contact of the learner's family), a method, and a message link or a note. A CHECK refuses a grant without them. `POST /story` and the `story_id` trigger both require the latest row to be `granted`. A withdrawal deletes the published Story and blocks republishing. `send` and `story` are separate routes and separate transactions | integration: Story with no consent row returns 409 `CERTIFICATE_STORY_CONSENT_MISSING`; Story after a withdrawal returns 409; a SQL insert of a grant with no contact or method is refused; a SQL write of `story_id` without a grant is refused; an evidence message from another family's conversation is refused; withdrawal after publish leaves the story `deleted`; `send` leaves no Story and `story` sends no card. Legacy `issued` rows cannot be published. Admin Web: Publish stays disabled until consent shows *granted* |
| 5 | The learner's assigned Ops supervisor decides teacher suggestions; the decision is recorded and the requester is told | `proposed` → `requested` (accept) or `declined` (decline, with a reason) | Only `learner_supervision.supervisor_id`, or their active PD-33 cover through `chat.staff_acts_for`, may accept or decline; managers, overseers and the Teachers department may not. The trigger re-checks this. The decision writes `suggestion_decided_by/at`, an event and `audit_log`. The teacher gets a PD-34 notification **and** a `certificate_accepted` / `certificate_declined` card in their supervision chat | unit: the decider matrix (assigned supervisor ✔, cover ✔, manager ✘, other supervisor ✘, Teachers member ✘). integration: each ✘ returns 404/403 and is refused by SQL; accept writes the event and posts the card plus the notification (dedupe: a second accept is a no-op); decline without a reason returns 400 |
| 6 | The super admin manages types and enables or disables them; retiring never deletes history | — (types are not certificates) | `certificates.types` is in no bundle except `*`. Types are disabled (`is_active`, `disabled_at/by`), never deleted: a BEFORE DELETE trigger plus `ON DELETE RESTRICT`. `key` and `category` are immutable once used. Creating a request with a disabled type returns 409 `CERTIFICATE_TYPE_DISABLED`. Old certificates keep their type label. Every change writes `audit_log` as `certificate_type.*` | integration: a non-super-admin (Ops manager, Teachers manager, Designer) gets 403; a SQL `delete from chat.certificate_type` is refused; disabling a used type keeps its certificates listable with the label; a new request with it is refused; the audit rows exist. Admin Web: no Delete control; the Types tab is visible only to the super admin |
| 7 | Backend enforcement; an audit trail for requests, approvals, revisions, consent, publication and final sending | Every transition | Three layers (above), with deny by default on the guard. **Two trails:** `appreciation_certificate_event`, which is per certificate, append-only and trigger-written, with the actor, before/after and note; and `chat.audit_log` (`appreciation_certificate.requested / accepted / declined / started / returned / file_uploaded / approved / approval_withdrawn / consent_granted / consent_withdrawn / story_published / story_withdrawn / sent / cancelled`), which PD-35 B7's action log already shows | `pd040-route-permissions.spec.ts` (every new route declared, and the exact Designer route set); `bash scripts/qa/guards.sh pd040-routes`; integration: a scripted walk asserts one event plus one audit row per act, and none carries an object key or a conversation id |

**Not changed:** nothing in Jawwid Core, its code or its database. This repository has no Core
code (`jawwid-chat-is-not-core`), and PD-41 adds no Core call.

---

## 15. PR-1 as built (2026-10-29): where the code differs from this design

The API and migration are in `20261029110000_chat_pd041_certificates.sql`, `apps/api/src/certificates/*`
and `apps/api/src/platform/pd041-policy.ts`. The contract is `docs/contracts/API-CONTRACT.md` §3.10c.

The code differs from the sections above in seven places:
1. **PD-12's open tickets become `proposed`**, not `requested` (§3, legacy mapping). Owner
   safeguard 5 gives a teacher's suggestion to the learner's Operations supervisor to decide, so
   an undecided PD-12 ticket waits for that supervisor. `issued` becomes `sent`, and the
   issuer is recorded as approver and sender. `declined` stays.
2. **There is no separate `story_image` revision** (§4.2, §7). A Story is published from the
   approved certificate file itself, which must be an image
   (`COMM.CERTIFICATE_STORY_NEEDS_IMAGE` for a PDF). A second file can come later if the owner
   wants PDF certificates with Stories.
3. **There is no `reassign`; it is replaced by `release`** (§11). The working Designer, or an
   overseer, puts an in-design request back to Pending, and any Designer takes it from there.
4. **`certificates.deliver` keeps PD-40's label** ("Send certificates to the family"). PD-40's
   generated seed block is frozen, and a relabel needs its own reviewed change.
5. **Every write is one act.** `action_seq` goes up by one, and `last_action`, `last_note` and
   the actor travel with each write. The trigger refuses any other write and records each act
   in `appreciation_certificate_event`. This makes safeguards 2 and 7 hold even against direct
   SQL.
6. **A live Story pins the approval.** While the Story is up, the approval cannot be withdrawn
   and the request cannot be cancelled; withdrawing consent takes the Story down first.
7. **The Designer's history hides consent and Story acts**, and shows notes only for returns
   and redesigns.

**Merge order:** PR-1 removes the PD-12 staff routes (`/learner-certificates/:id/upload|issue|decline`).
The current Admin Web Certificates tab calls them, so that tab stops working until PR-2 (the
`/certificates` page) lands. Merge PR-1 and PR-2 together, or one right after the other.

### 15.1 The department head's review of #216 (2026-10-29)

**P1s, fixed:**
- **A PD-33 backup can withdraw consent.** The withdrawal and the Story's removal now commit in
  one transaction, through `StoryService.retireForCertificate` (audited `story.deleted`, without
  the author rule). They commit together or not at all.
- **Stories accepts only its own media.** `chat.story_media_grant` records every key
  `POST /stories/media` issues, and the certificate copies. `StoryService.create` accepts only a
  `stories/` key granted to the same publisher, and claims it once inside the transaction
  (`COMM.STORY_MEDIA_NOT_GRANTED`). The retention sweep deletes bytes only under `stories/`. A
  legacy row naming another key is unlinked and its bytes are left alone. This closes design R7.

**P2s, changed:**
- **Listing is scoped in the query:** the categories overseen, the learners reached, the
  teachers in PD-35 scope, suggestions for overseers, and designers past suggestion. It is
  keyset-paged on `(requestedAt, id)`.
- **Who answers for a certificate is decided now, not by the record.** That is
  `chat.certificate_responsible`:
  - for a student, whoever acts for the learner's CURRENT supervisor, so a PD-24 transfer moves
    approve, send, consent and Story with the child; the requester of record only when nobody
    supervises the learner;
  - for a teacher, the requester of record while they still hold `certificates.request.teacher`.
- **The insert guard checks reach:** a student request must come from staff who act for the
  learner's supervisor, or an overseer. PD-35's teacher scope is a runtime switch, so the API
  applies it.
- **Consent is tied to its act.** `certificate_consent_granted` counts only a consent row whose
  history event of the same seq and kind exists.
- **Written consent needs a note** saying where the signed document is kept.
- **A Story is published in two phases.** It is created hidden (a draft), linked under the
  certificate's lock where consent is decided again, then published. A crash leaves at worst a
  linked draft, which a retry publishes.
- **Every file is checked whole.** Images must end where their format ends. A PDF must end with
  `%%EOF` and carry no `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/XFA`,
  `/SubmitForm`, `/ImportData` or `/GoToR`. **Launch requirement:** names inside compressed
  object streams are not seen, so a malware scan of every upload is required before production.
- **Orphaned suggestions are handled.**
  - An overseer (the Operations or Teachers manager, or the super admin) may cancel an undecided
    suggestion.
  - When nobody supervises the learner, the Operations manager decides.

**Nits, done:**
- `search_path` is pinned on the three helpers.
- The type's labels are copied onto the certificate when it is sent.
- `GET :id/delivery` writes nothing; the send opens a missing teacher supervision conversation.
- The slot note is corrected.
- The spec title is fixed, and a test now shows the DB refusing a Designer as sender.


### 15.2 PR-2 as built: the Admin Web page

- **Page:** `/certificates` (`features/certificates`), under People. The nav offers it when
  `GET /certificates/access` opens it. A `specialist` (the Designer) lands on it and has nothing
  else.
- **Old routes:** `/teachers/certificates` and `/admin/teachers/certificates` redirect to it.
  The PD-12 Teachers tab, its page, its dialogs and its client calls are removed.
- **Buttons** come only from each row's `actions`.
  - Approve sends the revision on screen.
  - Send shows the group the server named, and echoes it.
  - Story names its audience.
  - Consent picks the parent from the family's contacts. `GET /certificates/:id` adds
    `consentContacts` only for whoever may record consent.
- **The request form** makes one `requestKey` when it opens, and leaves the Story box unticked.
- **Types:** a tab for the super admin, with enable and disable but no delete.

### 15.3 "Their manager": who approves a design its requester uploaded (owner, 2026-10-29)

**The case.** The requester of record also holds `certificates.design`, takes the design and
uploads it. Nobody else answers for the certificate: the requester has no active PD-33 cover,
and for a student the learner has no other supervisor. Four eyes stops the uploader from
approving, so nobody could approve. Only a redesign or a cancel was left.

**The decision.** The owner picked "The overseer (Operations Manager for students, Teachers
Manager for teachers) approves". The overseer is the category's manager, not the requester's
PD-8 line manager. With neither manager, the super admin approves, since it holds every key.

**The rule (migration `20261030010000`):**

- **What `chat.certificate_overseer_approves(cert)` checks.** It is true when all of these hold:
  - the requester of record uploaded the current revision;
  - the requester still answers for the certificate (`chat.certificate_responsible`);
  - nobody else who answers for it could approve it.
- **Who counts as "somebody else".** Either the learner's supervisor, when that is not the
  requester, or an active PD-33 cover of whoever answers (`chat.backup_is_active`). Either one
  counts only while they are live and hold the category's request key. The trigger checks all
  of this when the approval is made.
- **Who may approve in that case.** Holding `certificates.oversee` together with the
  category's request key now satisfies the guard's approval condition. That condition used to
  be `chat.certificate_responsible` alone.
- **What is unchanged:**
  - The four-eyes refusal is untouched: the uploader is refused even when they are an
    overseer.
  - Every other act (edit, redesign, withdraw, send, Story) stays with whoever answers for the
    certificate.
- **The service and the page.** `CertificateService` asks the same SQL helper.
  `pd041-policy.allowedActs` then offers Approve to the overseer only, so the page and the
  database cannot disagree.
- **Tasks (PD-47).** `chat.work_task_certificate_assignee` gives the review step to the
  overseer. If the overseer uploaded the design themself, it goes to the super admin. The sweep
  reroutes review steps that are already open, both ways: to the overseer, and back to a cover
  once one is activated.
- **The copies.** Both replaced functions are their earlier bodies word for word, apart from
  that one branch. `test/unit/migrations/pd041-overseer-approval-guard.spec.ts` proves it.
- **The specs.**
  - Requester uploaded, no cover: the Operations Manager or the Teachers Manager approves.
  - With an active cover: the cover approves, and the overseer is refused by the service and
    by the database.
  - A Designer's upload is still the requester's to approve.
  - The uploader is never the approver.
  - The other category's manager is refused.

  They are in `test/integration/pd041-certificates.spec.ts` ("Their manager") and
  `test/unit/pd041/pd041-policy.spec.ts`.
