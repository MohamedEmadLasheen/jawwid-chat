# Jawwid Chat — Canonical Domain Vocabulary

**Status:** canonical · **Date:** 2026-09-07 · **Branch:** `integration/recovery`
**Authority:** `docs/product/jawwid-chat-prd-v0.1.md` (§3 roles, §6 entities, §13 phasing) and the
product-owner decisions C-1…C-4 in `docs/release/od-01-conversation-model.md` §14.
**Supersedes for vocabulary purposes:** `docs/product-operations/domain-language.md` §3 (internal
glossary) and the concept column of `docs/design/terminology.md`. Both remain valid as audit
history; where they disagree with this file, this file wins and §4 below records the difference.

This document exists so that no future agent invents a second vocabulary. Every layer — SQL,
Prisma, API/wire, Flutter, Admin Web, docs — is expected to use the names in §2 or an alias
explicitly listed in §4 with a scheduled removal.

---

## 1. Rules

1. **One term per concept.** A concept has exactly one canonical prose term and, per layer, exactly
   one code identifier (listed in §2). Synonyms are aliases (§4), never peers.
2. **Code identifiers follow the layer's casing, not a new word.** `learner` (SQL) · `Learner`
   (Prisma) · `learner_id` (wire) · `LearnerRef` (Flutter) · `Learner` (Admin Web) are one term.
   `student`, `child`, `kid`, `pupil` are not.
3. **The database CHECK constraint is the authority for enumerations**
   (`apps/api/src/communication/contracts/vocab.ts` header: *"The database check constraints are
   authoritative; these constants mirror them"*). A value that exists in code but not in the CHECK
   is a defect, and vice versa. §3 lists every divergence known today.
4. **The UI never shows an internal word or a raw enum.** UI labels live in i18n (§6), not here.
5. **Phases used in this file.**
   - **MVP** — shipped or in scope now (PRD §13 "MVP" column).
   - **Phase 1** — the domain-conformance work in
     `docs/integration/02-domain-conformance-plan.md` (D-1 roles, D-5 case removal, D-6
     organization, plus teacher identity and session/device from
     `docs/integration/auth-current-state.md`). Renames scheduled here change code, not product
     semantics.
   - **Phase 2** — PRD §13 "Phase 2" column (labels, broadcast, class groups, …).
   - **Deferred** — PRD §13 "Later" column.
6. **How to propose a new term.** Open a change to this file first, in the same PR as the first
   code that uses the term. The PR must: (a) show the concept is not already in §2 under another
   name; (b) give the term for every layer that will carry it; (c) add the CHECK-constraint values
   to §3 if it is an enumeration; (d) add any word it replaces to §4 with a removal phase. A term
   that appears in code before it appears here is an alias to be removed, not a canonical term.
7. **Deprecated terms are still terms.** They are defined here so an agent reading old code knows
   what it meant, and marked so nobody extends it.

---

## 2. Canonical terms

Column key: **DB object** = table in schema `chat` (`supabase/migrations/*`) · **Prisma** = model in
`apps/api/prisma/schema.prisma` · **API/wire** = JSON field / vocab constant in
`apps/api/src/communication/contracts/vocab.ts` and controllers · **Flutter** =
`lib/shared/models/*.dart`, `lib/core/data/wire/wire_vocab.dart` · **Admin Web** =
`apps/admin-web/src/shared/types/domain.ts` unless another file is named. "—" = the layer has no
representation and needs none; "(none yet)" = the layer should have one and does not.

### 2.1 Tenancy, family and people

| Term | Definition | DB object | Prisma | API/wire | Flutter | Admin Web | Status |
|---|---|---|---|---|---|---|---|
| **Organization** | The tenant. One row today (`jawwid`, id `…0001`); every root entity carries `organization_id` so SaaS is a migration, not a rewrite (PRD §2.3). | `chat.organization` (`20260906120000_chat_organization.sql`) | `Organization` | `organization_id` (never chosen by a client) | — | — | canonical |
| **Family** | The unit of ownership, of the inbox row and of context. Owns Contacts and Learners. **Never a conversation** — a family has several conversations (OD-01 §3–4). | `chat.family` | `Family` | `family_id` | — (implicit: the signed-in parent's family) | `FamilyDetail.family`, `InboxRow.family_id` | canonical |
| **Learner** | A student: a child profile under a Family, no login in MVP (PRD §3 "student"). `learner` is the canonical code/DB term; **"Student"** is the UI term (`terminology.md` §1). | `chat.learner` | `Learner` | `learner_id`, `learner` | `LearnerRef` (`conversation.dart`) | `Learner` | canonical |
| **Contact** | A parent/guardian belonging to a Family, with six capability flags and a display preset. The UI term is **"Parent"** when the contact is acting in a conversation. | `chat.contact` | `Contact` | actor kind `contact`; member role `parent` | `UserRole.parent`, `ParticipantRole.parent` | `Contact` (`ContactPreset`, flags) | canonical |
| **Teacher** | A classroom teacher — its own identity and population, never a Staff role and never a Contact. Today synthesised from `chat.learner.teacher_id` (`20260905090300_chat_family_domain.sql:113`); **Phase 1 creates `chat.teacher`** (`docs/integration/auth-current-state.md` §5, AD-2). | (none yet) → `chat.teacher` (Phase 1) | (none yet) | actor kind `teacher`; member role `teacher` | `UserRole.teacher`, `ParticipantRole.teacher` | — (Admin Web never authenticates as a teacher; shows `Learner.teacher_name`) | canonical (identity table Phase 1) |
| **Staff** | A Jawwid internal employee. Roles: `admin` · `coverage_admin` · `manager` · `super_admin` (PRD §3). `admin` is the **supervisor** in product language. `finance` / `technical` / `academic` are **not roles** — Phase 1 moves them to `chat.staff.department`. `system` is an actor kind, not a role. | `chat.staff` | `Staff` | actor kind `staff`; `StaffRole` | — (mobile cannot authenticate as staff; `ParticipantRole.admin` for display) | `Staff`, `StaffRole` | canonical (role values change in Phase 1, §3.2) |
| **Department** | The back-office unit a staff member belongs to for task routing (finance, technical, academic). Orthogonal to role. | (none yet) → `chat.staff.department` (Phase 1) | (none yet) | `department` | — | (none yet) | phase-1 |
| **Supervisor Assignment** | Family → its current supervisor (`family.owner_id`). Replaces the brief's "ownership" / "Primary Owner" language. Changing it is a **Supervisor reassignment**, done only through `chat.transfer_ownership()` (`20260905090700_chat_ownership_invariants.sql`), with a reason, and it never creates a second conversation. | `chat.family.owner_id` | `Family.ownerId` (relation `FamilyOwner`) | `owner_id` | — | `InboxRow.owner_id`, `FamilyDetail.owner`, `FamilyCapabilities.can_transfer_ownership` | canonical (column and function names are aliases, §4) |
| **Coverage** | A temporary duty window in which a staff member other than the assigned supervisor handles a family (shift end, absence, Friday rule). Configured by `shift`, `coverage_rule`, `absence`; resolved by `chat.on_duty()`. The machinery is **deprecated pending product decision** (PD-1, `02-domain-conformance-plan.md` D-2) but the term stays. | `chat.shift`, `chat.coverage_rule`, `chat.absence` (`20260905090200_…`) | — (not in Prisma; SQL-owned) | on-behalf mode `coverage` | — | `CoverageRule`, `Shift`, `Absence`, `CoverageGap`, `CoverageWindow` | canonical term; machinery deprecated-pending |

### 2.2 Communication

| Term | Definition | DB object | Prisma | API/wire | Flutter | Admin Web | Status |
|---|---|---|---|---|---|---|---|
| **Conversation** | The **only container of messages** (OD-01 migration §1). Types `direct` · `student_group` · `class_group` · `official` (C-1; exactly four). A `direct` conversation is family-scoped (Contact ↔ Jawwid, one persistent per family) or staff-scoped (Teacher ↔ Admin, one per pair, `family_id` null — C-2). | `chat.conversation` (`20260905093000_chat_communication.sql:41`) | `Conversation` | `conversation_id`, `type` (`ConversationType`) | `Conversation`, `ConversationKind` (see alias) | `Thread` component (alias) | canonical |
| **Conversation Summary** | The list-row projection of a conversation: title, last message preview, unread count, per-viewer flags. Not a separate entity. | — (query) | — | `ConversationSummary` (name to use for the list DTO) | `Conversation` (list model) | `InboxRow` (alias) | canonical |
| **Conversation State** | Communication lifecycle of one conversation: `open` · `waiting_on_customer` · `waiting_on_jawwid` · `resolved` (PRD §7.5). A conversation is never deleted; `resolved` reopens on the next customer message (`touch_conversation_from_message()`). | `chat.conversation.state` | `Conversation.state` | `state` (`ConversationState`) | — | (none yet) | canonical |
| **Participant** | A member row of a conversation: `actor_kind` + `actor_id` + `member_role` (`parent` · `teacher` · `admin` · `observer`) + `is_silent`. BR-1 is enforced against this set. **Wire/DB name is `member`; canonical prose is "participant".** | `chat.conversation_member` | `ConversationMember` | `members[]`, `member_role` (`MemberRole`), `MemberSpec` (`conversation.service.ts:23`) | `ParticipantRole` (display only) | (none yet) | canonical |
| **Participant State** | Per-participant, never-shared preferences on a conversation: read cursor, archived, muted, pinned (PRD §7.2 "archive/mute/pin"). | `chat.conversation_participant_state` | `ConversationParticipantState` | `last_read_seq`, `archived_at`, `muted_until`, `pinned_at` | `Conversation.isPinned/isMuted/isArchived`, `unreadCount` | — | canonical |
| **Message** | One item in a conversation. `type` text/image/video/voice/file/system · `visibility` customer/internal · `moderation` published/pending/rejected · `origin` user/automation/broadcast · `on_behalf_mode` (server-derived) · `seq` (server-assigned order) · `client_message_id` (idempotency, ADR-009). | `chat.message` | `Message` | `Message`, `MessageType`, `Visibility`, `Moderation`, `Origin` | `Message`, `MessageKind`, `DeliveryState`, `ApprovalState` | `Message`, `MessageVisibility`, `MessageAuthorType` | canonical |
| **Internal note** | A Message with `visibility = internal`. Staff-only; never counted as a reply to the family. | `chat.message.visibility` | `Message.visibility` | `visibility: "internal"` | `Wire.visibilityInternal` (never rendered) | `MessageVisibility` | canonical |
| **Attachment** | A media/file item on a Message: `kind` image/video/voice/file, storage ref, size, duration, thumbnail. URLs issued short-lived. | `chat.message_attachment` | `MessageAttachment` | `attachments[]` | `Attachment` | `Attachment` | canonical |
| **Reaction** | An emoji reaction by an actor on a Message. | `chat.message_reaction` | `MessageReaction` | `reactions[]` | `Reaction` | — | canonical |
| **Receipt** | Per-recipient delivery state of a Message: `sent` → `delivered` → `read` (monotonic, `RECEIPT_RANK`). Only the server asserts `delivered`/`read`. | `chat.message_receipt` | `MessageReceipt` | `ReceiptState` | `DeliveryState` (adds local `queued`/`sending`/`failed`) | — | canonical |
| **Approval** | The moderation decision on a held group Message: `pending` · `approved` · `rejected` + reason + approver (PRD §7.4 simple policy). | `chat.message_approval` | `MessageApproval` | `ApprovalDecision` | `ApprovalState` (adds `notRequired`) | (none yet; §6 of terminology has labels) | canonical |
| **Hidden-for** | "Delete for me": a Message hidden for one actor. | `chat.message_hidden_for` | `MessageHiddenFor` | `hidden` | `Message.isDeleted` (local view) | — | canonical |
| **Handoff** | The summary card a receiving handler sees when a conversation changes hands (shift end, absence, assist, escalation, sticky expiry). Not a reassignment. | `chat.handoff` (rehomed to `conversation_id` by `20260905094000`) | — (SQL-owned) | `handoff` (`apps/api/src/communication/handoff`) | — | `Handoff`, `HandoffReason` | canonical |
| **Task** | A dated work item on a Family (optionally a Learner and a Conversation): `follow_up` · `renewal` · `payment` · `complaint` · `onboarding` · `custom` (PRD §7.6; `20260905094000` §2). Has an **assignee**, not an owner. | `chat.task` | — (SQL-owned) | `task` | — | `Task` (still carries old `TaskType`, §4) | canonical |
| **Follow-up** | A Task of type `follow_up` with a `due_at`. Not a separate entity. | `chat.task` | — | `type: "follow_up"` | — | `Task` | canonical |
| **Family note** | A staff-authored, pinnable note on a Family (not on a conversation). | `chat.family_note` | — | `family_note` | — | `FamilyNote` | canonical |

### 2.3 Calls

| Term | Definition | DB object | Prisma | API/wire | Flutter | Admin Web | Status |
|---|---|---|---|---|---|---|---|
| **Call** | A voice call inside a Conversation: `type` direct/group · `status` ringing/active/ended · `outcome` answered/missed/declined. Video is deferred (PRD §13 row 6–7). | `chat.call` | `Call` | `Call`, `CallType`, `CallStatus`, `CallOutcome` | `Wire.callAnswered/…` | — | canonical |
| **Call Participant** | An actor in a Call (`actor_kind` + `actor_id`, join/leave times). BR-1 is enforced here too (`20260905093000:679`). | `chat.call_participant` | `CallParticipant` | `participants[]` | — | — | canonical |
| **Media Grant** | A short-lived LiveKit token for one identity in one room (`MediaGrant`, `apps/api/src/communication/calls/media-token.ts:21`). Never persisted. | — | — | `MediaGrant` → `{ token, url, expiresAt }` | — | — | canonical |

### 2.4 Notifications and devices

| Term | Definition | DB object | Prisma | API/wire | Flutter | Admin Web | Status |
|---|---|---|---|---|---|---|---|
| **Notification** | One scheduled/sent push or in-app notice to one recipient, with dedupe key and status timeline `scheduled`…`cancelled`. | `chat.notification` | `Notification` | `NotificationStatus` | — | — | canonical |
| **Notification Rule** | Event type → offsets, template, channel, priority (PRD §8). | `chat.notification_rule` | `NotificationRule` | `notification_rule` | — | — | canonical |
| **Notification Template** | Localised (`ar`/`en`) body for a rule. | `chat.notification_template` | `NotificationTemplate` | `notification_template` | — | — | canonical |
| **Device** | A push-capable installation of the mobile app for one actor (platform, token, locale). Today the table is `device_token`; **Phase 1 adds Session/Device identity records** (`docs/integration/authentication-decision-gate.md`). | `chat.device_token` (→ `chat.device`, Phase 1) | `DeviceToken` | `device_token` | — (registers token) | — | canonical (rename Phase 1) |
| **Quiet Hours** | Per-actor window in which non-critical notifications are suppressed. | `chat.quiet_hours` | `QuietHours` | `quiet_hours` | — | — | canonical |

### 2.5 Handling terms (who is answering)

| Term | Definition | DB object | Prisma | API/wire | Flutter | Admin Web | Status |
|---|---|---|---|---|---|---|---|
| **Handler** | The staff member currently answering a conversation — the result of `chat.on_duty(family, now)` plus stickiness. The PRD's "current handler"; distinct from the assigned supervisor. | `chat.on_duty()` (function) | — | `handled_by` (label), `on_duty_id` | `Conversation.handledByLabel` (verbatim from server) | `InboxRow.on_duty_id`, `FamilyDetail.on_duty` | canonical |
| **On-behalf mode** | The authority under which a staff message was sent: `owner` · `coverage` · `assist` · `escalation`. **Server-derived; a client never chooses it.** | `chat.message.on_behalf_mode` | `Message.onBehalfMode` | `OnBehalfMode` | — | `OnBehalfMode`; `HandlingMode` adds `sticky`/`none` (display) | canonical |
| **Stickiness** | A handler keeping a conversation past their duty window ("I'll keep this"), until `sticky_until`. | `chat.conversation.sticky_handler_id`, `sticky_until` | `Conversation.stickyHandlerId/stickyUntil` | `sticky_handler_id` | — | `TeamNowRow.sticky_threads` (alias) | canonical |
| **Unattended** | `on_duty()` returned no one (ADR-008). Manager-only concept. | — (function result) | — | `on_duty_id: null` | — | `HandlingMode = 'none'` | canonical |

### 2.6 Identity terms

| Term | Definition | DB object | Prisma | API/wire | Flutter | Admin Web | Status |
|---|---|---|---|---|---|---|---|
| **Account** | The login identity: opaque `subject` from the identity provider, `kind` staff/family (Phase 1 widens per AD-2 for teachers). Holds **no** phone, email or handle. | `chat.account` (`20260905090050_chat_identity.sql`) | (none; SQL-owned) | — (never on the wire) | `AuthUser.id` (opaque) | — | canonical |
| **Actor** | The resolved principal of a request: `kind` (`contact` · `staff` · `teacher` · `system`) + `id`. Every conversation/message/call column that names a person is an actor reference (ADR-004). | `actor_kind` + `actor_id` columns; `author_type` + `author_id` on `message` | `actorKind/actorId`, `authorType/authorId` | `ActorKind`; `@Actor()` (`apps/api/src/communication/api/actor.decorator.ts`) | `Wire.actorContact/…`; `Message.authorId` | `MessageAuthorType` (missing `teacher`, §3) | canonical |
| **Session** | A signed-in period for an Account on a Device (access + refresh token). Phase 1 adds the record. | (none yet) → `chat.session` (Phase 1) | (none yet) | access/refresh token | `AuthSession` (`auth.dart`) | — | phase-1 |
| **Device** | See §2.4. | | | | | | |

### 2.7 Operations and logs

| Term | Definition | DB object | Prisma | API/wire | Flutter | Admin Web | Status |
|---|---|---|---|---|---|---|---|
| **Audit** | Immutable record of who changed what (RBAC-relevant writes). | `chat.audit_log` | `AuditLog` | `audit_log` | — | — | canonical |
| **Event** | Domain event log entry (`chat.log_event()`, `event_log.type` CHECK in `20260905091100_chat_authorization.sql:10`). Drives attention and the outbox. | `chat.event_log` | `EventLog` | `event_log` | — | — | canonical |
| **Outbox Event** | Transactional outbox row for realtime/push fan-out: `pending` · `published` · `failed`. | `chat.outbox_event` | `OutboxEvent` | (internal) | — | — | canonical |
| **Attention** | Server-computed urgency of a family: bucket `now` · `today` · `waiting_on_family` · `quiet` + a `top_reason` sentence. Never a client-visible score. Rule-based in MVP (PRD §5.4). | `chat.family_state_cache.bucket` (`20260905090500:130`), `chat.attention_signals()` | — | `bucket`, `top_reason` | — | `AttentionBucket`, `InboxRow.bucket/top_reason` | canonical |
| **Workload** | Server-computed pressure on a staff member: `low` · `medium` · `high` (no CRITICAL, PRD §5.3). | `chat.family_state_cache` / functions in `20260905090800` | — | `workload_level` | — | `WorkloadLevel`, `TeamNowRow` | canonical |
| **Subscription** | Read-only mirror of Jawwid Core billing state for a Family. | `chat.subscription` | — | `subscription` | — | `Subscription` | canonical |
| **Idempotency-Key** | HTTP header carrying the client-generated key for a non-idempotent write (`apps/api/src/infra/http/bootstrap.ts:90`). | — | — | `Idempotency-Key` | `X-Idempotency-Key` (alias) | `Idempotency-Key` (`client.ts:41`) | canonical |

### 2.8 Phase 2 and deferred

| Term | Definition | Planned home | Status |
|---|---|---|---|
| **Label** | Manual or system tag on a Family, auto-updating (PRD §13). | `chat.family_label` (not designed) | phase-2 |
| **Broadcast** | One-to-many official message with per-recipient delivery, templates, scheduling, approval and reply linkage (PRD §13). `Origin = broadcast` already reserves the message origin. | (not designed) | phase-2 |
| **Class Group** | Conversation type `class_group` — reserved in the CHECK and vocab; no creation path in MVP (PRD §13 row 2). | `chat.conversation.type = 'class_group'` | phase-2 |
| **Story / Status** | Ephemeral status posts (PRD §13 row 1 "Later": *Status, disappearing messages*). Not modelled. | — | deferred |
| **Video call** | PRD §13 rows 6–7 "Later". | `chat.call` leaves room | deferred |

---

## 3. Enumerations

Values are verbatim from `apps/api/src/communication/contracts/vocab.ts` and the CHECK
constraints in `supabase/migrations`. **Bold** marks a divergence between layers; the "Canonical"
column states the value that wins and the phase in which the other layers change.

### 3.1 ActorKind

| Layer | Values | Source |
|---|---|---|
| vocab.ts `ActorKind` | `contact`, `staff`, `teacher`, `system` | `vocab.ts:9-14` |
| `conversation_member.actor_kind` | `contact`, `staff`, `teacher` (no `system` — the system is never a member) | `20260905093000:124` |
| `message.author_type` | `contact`, `staff`, `teacher`, `system` | `20260905093000:277` |
| `call_participant.actor_kind` | `contact`, `staff`, `teacher` | `20260905093000:684` |
| `event_log.actor_type` | **`contact`, `staff`, `system`** (no `teacher`) | `20260905090500:15` |
| Flutter `Wire.actor*` | `contact`, `staff`, `teacher`, `system` | `wire_vocab.dart` |
| Admin Web `MessageAuthorType` | **`contact`, `staff`, `system`** (no `teacher`) | `domain.ts:200` |

**Canonical:** `contact` · `staff` · `teacher` · `system`. `event_log.actor_type` and Admin Web
`MessageAuthorType` add `teacher` in **Phase 1** (they cannot currently log or render a teacher's
message correctly).

### 3.2 StaffRole

| Layer | Values | Source |
|---|---|---|
| vocab.ts `StaffRole` | `admin`, **`coverage`**, `manager`, **`finance`**, **`technical`**, **`academic`** | `vocab.ts:17-24` |
| `chat.staff.role` CHECK | same six | `20260905090200:19-20` |
| RLS predicates | `('admin','coverage','manager')` | `20260905091200_chat_rls.sql` (≈10 sites) |
| Admin Web `StaffRole` | same six **plus `system`** | `domain.ts:15-22` |
| Flutter `ParticipantRole.parse` | folds `admin`/`coverage`/`manager` → `admin` | `user_role.dart:33` |
| PRD §3 | `parent`, `student`, `teacher`, `admin`, **`coverage_admin`**, `manager`, **`super_admin`** | PRD §3 |

**Canonical (staff roles):** `admin` · `coverage_admin` · `manager` · `super_admin`.
- `coverage` → **`coverage_admin`** in **Phase 1** (D-1: additive widen, data migration, RLS
  rewritten in the same transaction, behaviour-neutral).
- `super_admin` **added** in Phase 1; `apps/admin-web/src/core/permissions/capabilities.test.ts:19-20`
  currently asserts its absence and must be inverted.
- `finance` / `technical` / `academic` are **not roles**: Phase 1 adds `chat.staff.department`
  and stops issuing them as roles (keep accepting until consumers are gone, per D-1 §6).
- `system` is an **ActorKind**, never a StaffRole; Admin Web removes it from `StaffRole` in Phase 1.
- `parent`, `student`, `teacher` are PRD roles for *non-staff* populations: they map to Contact,
  Learner and Teacher respectively, not to `chat.staff.role`.
- `FAMILY_FACING_STAFF_ROLES` (`vocab.ts:31-35`) becomes `admin · coverage_admin · manager · super_admin`.

### 3.3 ConversationType

| Layer | Values | Source |
|---|---|---|
| vocab.ts `ConversationType` | `direct`, `student_group`, `class_group`, `official` | `vocab.ts:38-43` |
| `chat.conversation.type` CHECK | same four | `20260905093000:45` |
| Flutter `Wire.conversation*` | same four | `wire_vocab.dart` |
| Flutter `ConversationKind` | **`jawwidSupport`, `studentGroup`, `adminDirect`** (parses `jawwid_support`/`admin_direct`, which are not wire values) | `conversation.dart:6-25` |
| Flutter mapper | **`official` → `jawwidSupport`; `class_group` → `studentGroup`; everything else → `adminDirect`** | `wire_mappers.dart:30-37` |
| PRD §6 | `direct`, `student_group`, `class_group`, `official` | PRD §6 |

**Canonical:** exactly the four wire values (C-1). The family's support conversation is a
**family-scoped `direct`** conversation (C-1: *"customer replies route into the persistent `direct`
Jawwid conversation"*); `official` is Jawwid-originated one-way communication. The Flutter mapper
therefore mislabels both today — fix in **Phase 1** (§4).

### 3.4 ConversationState

| Layer | Values | Source |
|---|---|---|
| vocab.ts `ConversationState` | `open`, `waiting_on_customer`, `waiting_on_jawwid`, `resolved` | `vocab.ts:46-51` |
| `chat.conversation.state` CHECK | same | `20260905093000:66` |
| Admin Web `CaseStatus` (removed concept) | `open`, `waiting_customer`, `waiting_internal`, `scheduled`, `resolved`, `closed` | `domain.ts:139-145` |

**Canonical:** the four vocab values. `CaseStatus` is removed with Case (§4).

### 3.5 MemberRole

`parent` · `teacher` · `admin` · `observer` — identical in `vocab.ts:54-59`,
`20260905093000:129`, `wire_vocab.dart`. Flutter `ParticipantRole` adds display-only `system` and
`unknown` (`user_role.dart:26-31`) — acceptable, they never go on the wire.

### 3.6 Message enumerations

| Enum | Values | Sources | Divergence |
|---|---|---|---|
| `MessageType` | `text`, `image`, `video`, `voice`, `file`, `system` | `vocab.ts:62-69`; `20260905093000:253`; Flutter `MessageKind` | none |
| `Visibility` | `customer`, `internal` | `vocab.ts:71`; `20260905090400:139`; Admin Web `MessageVisibility` | none |
| `Moderation` | `published`, `pending`, `rejected` | `vocab.ts:74-78`; `20260905093000:257` | PRD §6 calls this "visibility (published/pending/rejected)"; the code term `moderation` is canonical because `visibility` is already taken |
| `Origin` | `user`, `automation`, `broadcast` | `vocab.ts:81`; `20260905093000:260` | none |
| `OnBehalfMode` | `owner`, `coverage`, `assist`, `escalation` | `vocab.ts:84-89`; `20260905090400:135`; Admin Web `OnBehalfMode` | Admin Web `HandlingMode` adds `sticky`, `none` as display states — allowed, not wire values. **`owner` stays `owner`** even after the supervisor-assignment rename: it is the mode name, not the role |
| `ReceiptState` | `sent`, `delivered`, `read` | `vocab.ts:92`; `20260905093000:445` | Flutter `DeliveryState` adds local-only `queued`, `sending`, `failed` |
| `ApprovalDecision` | `pending`, `approved`, `rejected` | `vocab.ts:101-105`; `20260905093000:496` | Flutter `ApprovalState` adds `notRequired` (local) |
| `message_attachment.kind` | `image`, `video`, `voice`, `file` | `20260905093000:415` | none |

### 3.7 Call enumerations

`CallType` `direct` · `group`; `CallStatus` `ringing` · `active` · `ended`; `CallOutcome`
`answered` · `missed` · `declined` — `vocab.ts:108-118`, `20260905093000:656-661`. No divergence.

### 3.8 Notification and device enumerations

| Enum | Values | Source |
|---|---|---|
| `NotificationStatus` | `scheduled`, `sent`, `delivered`, `opened`, `failed`, `suppressed`, `cancelled` | `vocab.ts:121-129`; `20260905093000:617` |
| priority | `critical`, `high`, `normal`, `low` | `20260905093000:585,608` (not in vocab.ts — add in Phase 1) |
| channel | `push`, `in_app` | `20260905093000:583,606` (not in vocab.ts — add in Phase 1) |
| `device_token.platform` | `android`, `ios`, `web` | `20260905093000:547` |
| `Locale` | `ar`, `en` | `vocab.ts:132`; every `locale`/`language` CHECK |

### 3.9 Family, staff and operations enumerations (SQL-owned)

| Column | Values | Source |
|---|---|---|
| `family.tier` | `standard`, `priority` | `20260905090300:21` |
| `family.state` | `onboarding`, `active`, `at_risk`, `renewal_due`, `paused`, `churned` | `20260905090300:25` — **CRM terms; deprecated, see §4** |
| `family.manual_flag` | `urgent` | `20260905090300:32` |
| `contact.role_preset` | `primary_guardian`, `billing_authorized`, `authorized_contact`, `secondary_read_only` | `20260905090300:68` |
| `account.kind` | `staff`, `family` (Phase 1: per AD-2, add `teacher` or distinguish via `chat.teacher`) | `20260905090050:17` |
| `staff.presence` | `online`, `away`, `offline` | `20260905090200:22` |
| `coverage_rule.window_mode` | `outside_owner_shift`, `all_day`, `custom` | `20260905090200:81` |
| `absence.type` | `planned`, `sick`, `auto_detected` | `20260905090200:120` |
| `task.type` | `follow_up`, `renewal`, `payment`, `complaint`, `onboarding`, `custom` | `20260905094000:162` — Admin Web `TaskType` still has `finance/technical/academic/other` (§4) |
| `task.status` | `open`, `in_progress`, `done`, `cancelled` | `20260905090400:240` |
| `handoff.reason` | `shift_end`, `absence`, `friday`, `assist`, `escalation`, `sticky_expired` | `20260905090400:271`; Admin Web `HandoffReason` |
| `family_state_cache.bucket` | `now`, `today`, `waiting_on_family`, `quiet` | `20260905090500:130`; Admin Web `AttentionBucket` uses **`waiting_family`** (§4) |
| `outbox_event.status` | `pending`, `published`, `failed` | `20260905093000:524` |

---

## 4. Alias table

Alias → canonical term. "Where used" cites the files that carry the alias today. Action names the
phase in which the alias is renamed or removed; "keep" means the alias is a deliberate layer name
that stays but must never leak into prose or new code.

| Alias | Where used | Canonical term | Action |
|---|---|---|---|
| **Thread** / `thread_id` / `chat.thread` | Old DB (`20260905090400_chat_conversation_domain.sql:11`, dropped by `20260905094000:636`); Admin Web `features/family/Thread.tsx`, `Thread.test.tsx`, `FamilyWorkspace.tsx`; `20260906120000_chat_organization.sql` root list (skipped at runtime); `docs/design/terminology.md` §2 row `thread` | **Conversation** | Rename Admin Web component/props in **Phase 1**; migration references are history, leave |
| **Case** / `support_case` / `case_id` / `Case`, `CaseType`, `CaseStatus`, `CaseSeverity` | Old DB (dropped by `20260905094000:633`); Admin Web `domain.ts:125-166`, `FamilyDetail.recent_cases`, `InboxRow.open_case_count`; `terminology.md` §3 | **REMOVED** (C-3). No alias — its role is Conversation + Task + Attention + Conversation State | Delete from Admin Web in **Phase 1** (D-5) |
| **Topic** (customer-facing word for Case) | `terminology.md` §3; view `chat.my_topics` (dropped) | REMOVED with Case | Remove from i18n |
| **`InboxRow`** | `domain.ts:69-84`; Admin Web inbox feature | **Conversation Summary** (`ConversationSummary`). Note the inbox row is family-keyed today; after Phase 1 it is conversation-keyed (PRD §7.5) | Rename in **Phase 1** |
| **`jawwidSupport`** / `jawwid_support` / "Jawwid support conversation" | Flutter `conversation.dart:10`, `wire_mappers.dart:31`, `fake_backend.dart`, `home_screen.dart`, `chat_screen.dart`, `conversation_list.dart` | **Family-scoped `direct` conversation** between a family Contact and Jawwid (one per family). Today mapped from `official`, which is wrong | Re-map in **Phase 1**: `direct` with `family_id` → the family conversation; `official` → its own kind; drop the non-wire parse values `jawwid_support`/`admin_direct` |
| **`adminDirect`** / `admin_direct` | Flutter `conversation.dart:16`, `wire_mappers.dart:36` | **Direct Teacher ↔ Admin conversation** (`direct`, `family_id` null, C-2) | Re-map in **Phase 1** (see above) |
| **Student Group** | UI (`terminology.md` §2), Flutter `studentGroup`, PRD | `student_group` conversation type | keep (UI/prose form of the same term) |
| **Class Group** | PRD §13 | `class_group` | keep |
| **Official** | PRD, UI | `official` | keep |
| **Student** | UI, PRD §3 "student" role, `terminology.md` §1 | **Learner** | keep as the UI label only; code/DB always `learner` |
| **Parent** / `PARENT_USER` | UI, PRD §3/§6, `UserRole.parent`, `MemberRole.PARENT` | **Contact** with member role `parent` | keep as UI label and member role; the person record is always `contact` |
| **Supervisor** | PRD §3 ("Supervisor / primary owner"), product language | **Staff** with role `admin` | keep in prose; code uses `admin` |
| **Coverage supervisor** / `coverage` (role) | PRD §3; `vocab.ts:19`; `20260905090200:20`; RLS; Admin Web (11 files); Flutter `user_role.dart:33` | **`coverage_admin`** | Rename in **Phase 1** (D-1). The on-behalf mode `coverage` is unaffected |
| **Owner** / **Primary Owner** / `owner_id` / `FamilyOwner` | `chat.family.owner_id`; Prisma `Family.ownerId`; Admin Web `InboxRow.owner_id`, `FamilyDetail.owner`; `terminology.md` §1; `domain-language.md` §3 | **Assigned supervisor** (Supervisor Assignment) | Prose: use "assigned supervisor" now. Column/field rename to `supervisor_id` is **Phase 2** (touches ownership invariants, RLS and `transfer_ownership()`); until then `owner_id` is the code identifier |
| **Ownership transfer** / `transfer_ownership()` / `can_transfer_ownership` / "Change owner" | `20260905090700_chat_ownership_invariants.sql`; `domain.ts:245`; `terminology.md` §5 | **Supervisor reassignment** | Prose now; function/flag rename together with `owner_id` in **Phase 2** |
| **Current Handler** / **On duty** | `terminology.md` §1, `domain-language.md` §3, `on_duty_id` | **Handler** | keep `on_duty()` as the function name; prose says "handler" |
| **Handover** (UI) | `terminology.md` §2, §5 | **Handoff** (`chat.handoff`) | keep as the UI word; code is `handoff` |
| `sticky_threads` | Admin Web `core/api/endpoints.ts:26`, `TeamNowRow` | **Conversation stickiness** (`sticky_conversations` count) | Rename in **Phase 1** with the Thread rename |
| `retained_by` (proposed) | `domain-language.md` §1 row "handler" | `sticky_handler_id` | Not adopted — the column shipped as `sticky_handler_id`; do not introduce |
| `assignee_id` (proposed for task) | `domain-language.md` §1, §4 | Task **assignee** — the column is still `task.owner_id` (`20260905090400`) | Rename to `assignee_id` in **Phase 1** (was accepted, never executed) |
| `userId` / `userIds` (realtime) | `apps/api/src/communication/realtime/realtime.publisher.ts:15,35`, `presence.service.ts`, `typing.service.ts`; `domain-language.md` §1 row "userId" | **`actorId`** (with `actorKind` where ambiguous) | Rename in **Phase 1** |
| `X-Idempotency-Key` | Flutter `lib/core/network/api_client.dart:49` | **`Idempotency-Key`** (`bootstrap.ts:90`, Admin Web `client.ts:41`) | Change Flutter constant in **Phase 1** (the API does not read the `X-` form) |
| `client_id` (ADR-009) | `docs/architecture/decisions.md` ADR-009 | `client_message_id` (`chat.message.client_message_id`, Flutter `clientMessageId`) | keep the column; prose uses "client message id" |
| `author_type` / `author_id` | `chat.message`, Prisma `Message.authorType/authorId`, Admin Web `Message.author_type` | **Actor** (`actor_kind` / `actor_id`) on a message | keep — it is the message-specific actor reference; never introduce a third spelling |
| `member` / `conversation_member` / `MemberSpec` / `member_role` | DB, Prisma, `conversation.service.ts:23`, wire | **Participant** | keep as the wire/DB name; prose says "participant" |
| `AttentionBucket = 'waiting_family'` | `domain.ts:44` | `waiting_on_family` (`20260905090500:130`) | Fix Admin Web in **Phase 1** |
| `TaskType = finance/technical/academic/other` | `domain.ts:220` | `task.type` (`follow_up/renewal/payment/complaint/onboarding/custom`, `20260905094000:162`) | Fix Admin Web in **Phase 1** (D-5) |
| `StaffRole = 'system'` | `domain.ts:22` | ActorKind `system` | Remove from `StaffRole` in **Phase 1** |
| `MessageAuthorType` without `teacher` | `domain.ts:200` | ActorKind | Add `teacher` in **Phase 1** |
| **Task** (brief sense: department work item) | `terminology.md` §3 row `task`; old `task.type` | **Task** (PRD §7.6 sense, family-scoped follow-up) | Same word, changed meaning — see §3.9 `task.type` |
| **Escalation** (`case.escalation_level`, `escalated_to_id`) | `domain.ts:160-161` | REMOVED with Case; on-behalf mode `escalation` and handoff reason `escalation` remain | Delete with Case in **Phase 1** |
| **DEPRECATED CRM terms:** `at_risk`, `renewal_due` (family state); `renewal` (case type); **workload** score; **attention bucket** as a *family* property | `chat.family.state` (`20260905090300:25`); Admin Web `FamilyState`, `TeamNowRow.workload_score`; `InboxRow.bucket` | Definitions: *at-risk* = family likely to churn; *renewal due* = subscription renewal approaching; *workload* = computed pressure on a staff member; *attention bucket* = computed urgency section. **Workload and Attention stay canonical (PRD §5.3/§5.4) but re-key onto the conversation; `family.state` values `at_risk`/`renewal_due` are CRM leftovers from the superseded brief.** | Mark deprecated now; `family.state` review is a **product decision** (D-3 in `02-domain-conformance-plan.md`); do not extend |

---

## 5. Forbidden terms

A forbidden term may appear only in this file, in migration history, and in a §4 alias row that
schedules its removal. Retained from `docs/design/terminology.md` §1 where still valid, plus the
additions below.

| Term | Reason |
|---|---|
| **thread** | Names the dropped `chat.thread`; implies one-conversation-per-family, which the PRD forbids (§7.5). Use *conversation*. |
| **case**, **support case**, **topic** | Entity removed by C-3. Use *conversation state* / *task* / *attention* as applicable. |
| **ticket**, **issue** | Support-desk model the PRD rejects (§7.5: the unit is the family relationship, not a ticket). |
| **queue**, **routing**, **assignment** (of conversations) | There is no queue or routing table by design (`20260905090200` header). Handling is derived by `on_duty()`; supervisor assignment is the only assignment. |
| **agent** (for a person) | Support-desk word; conflicts with "AI agent" in this repo's own process docs. Use *staff*, *admin*, *handler*. |
| **customer**, **client**, **account** (for a family) | Use *family*. `account` is reserved for the login identity (§2.6). |
| **user** (as a record) | Ambiguous across contact/staff/teacher. Use *actor* (resolved principal) or the specific population. |
| **kid**, **pupil**, **child** (in code) | Use *learner*. |
| **owner**, **primary owner** (in new prose) | Use *assigned supervisor*; the code identifier `owner_id` is an alias until Phase 2. |
| **transfer**, **reassign** (ownership), **assigned to** | Use *supervisor reassignment*; "assigned to" implies the supervisor moved when only coverage did. |
| **backup owner**, **temporary owner** | Use *coverage* / *handler*. |
| **super admin** (as two words), **superadmin** | The role is `super_admin` (PRD §3); one spelling. The earlier "there is no super_admin" rule in `domain.ts` and `terminology.md` is **withdrawn** (D-1). |
| **coverage** as a *role* value | Renamed `coverage_admin`. `coverage` survives only as an on-behalf mode and a duty-window concept. |
| **finance / technical / academic** as *roles* | Departments, not roles (§2.1). |
| **system** as a *role* | It is an actor kind. |
| **SLA** | Forbidden in UI (`terminology.md` §1); in code use *response target*. The `config` scope named `sla` is an alias to rename in Phase 2. |
| **priority**, **P1/P2/P3**, **score** (attention) | Attention is a bucket plus a sentence; no client-visible number (PRD §5.4, `domain.ts` header). `notification.priority` is a different, allowed concept. |
| **CRITICAL** (workload) | Does not exist; levels are low/medium/high (PRD §5.3). |
| **CRM-isms:** *lead, pipeline, deal, account manager, churn score, at-risk flag, renewal funnel* (MVP) | Superseded-brief vocabulary; the MVP models communication, not sales. Renewal/broadcast funnels are Phase 2 dashboard metrics (PRD §13 row 14), not domain terms. |
| **DM**, **chat room**, **channel** (as entity names) | Use *conversation* (`direct` for a 1:1). "Channel" is allowed only for notification channel `push`/`in_app`. |
| **phone number**, **email** (as identifiers or columns) | Never a UI concept and never a column in `chat` (`20260905090050` header; BR: phone privacy). |
| **status** (for a message's moderation state) | Use *moderation*; `status` is reserved for notifications, calls, tasks and outbox events. |

---

## 6. Bilingual UI labels

English and Arabic display strings are **not** part of this document. They live in the i18n
catalogues of each client (Flutter `lib/l10n/`, Admin Web `src/i18n/`) and are governed by
`docs/design/terminology.md` §1–§8 (writing rules, gender, numerals, plurals). That file maps a
*canonical term from §2 here* to a label; it must not introduce a concept that §2 lacks. When this
file and `terminology.md` name the same concept differently, the concept name here is canonical and
the label there is the display string — e.g. concept **Learner**, label "Student" / "الطالب".
