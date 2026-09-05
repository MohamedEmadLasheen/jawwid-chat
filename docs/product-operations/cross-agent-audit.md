# Jawwid Chat — Cross-Agent Conflict Register

**Owner:** AI #8 · **Date:** 2026-09-05

Only real contradictions are listed: two agents holding incompatible positions on the same
question, each with evidence in the repository. Divergences already recorded by AI #5
(`docs/qa/defects.md` JC-001/002/003) are referenced, not restated.

Severity: **P0** blocks MVP or corrupts operations · **P1** major rework if unresolved ·
**P2** important · **P3** cosmetic.

---

| # | Area | Agents | Expected | Actual | Conflict | Sev | Resolution |
|---|---|---|---|---|---|---|---|
| **X-01** | Database of record | AI #1 vs AI #2 | One schema, one migration path | AI #1: `chat` schema **inside Jawwid Core's Supabase database** (`20260905090000` header). AI #2: standalone Postgres via Prisma `DATABASE_URL`, default schema | Both stacks define `staff`, `family`, `contact`, `config`, `event_log`, `audit_log` — with different columns, defaults and vocabularies | **P0** | Product+architecture decision OD-02. Then **one** stack owns each table and the other consumes it. Prisma must at minimum target the `chat` schema if A wins |
| **X-02** | `contact.can_message` default | AI #1 vs AI #2 | One default | SQL `default false`; Prisma `@default(true)` | A migrated contact may message or may not, depending on which stack created the row. This is a permission default, not a cosmetic one | **P1** | Default **false**; capability is granted, never assumed |
| **X-03** | Config keys and failure mode | AI #1 vs AI #2 | One namespace, fail loud | `timers.no_reply_reminder_hours` / `reopen.window_hours` / `automation.batch_ack_seconds` (SQL) vs `automation.no_reply_reminder_hours` / `automation.reopen_window_hours` / `automation.ack_batch_seconds` (Node). SQL raises on a missing key; Node substitutes a hardcoded literal | A manager edits a threshold in the settings UI and one of the two engines never sees it. Node's fallback breaks the brief's own non-negotiable *"all constants read from config"* | **P1** | Single namespace (adopt the SQL keys, they are seeded); Node accessor raises; literals become seed data only |
| **X-04** | What "resolved" means | AI #2 vs AI #6 (and the brief) | Resolution lives on the **case**; the conversation is permanent | AI #6 `terminology.md` §2: a conversation *"is never opened, closed or resolved."* AI #2 ships `ThreadDto.state = 'RESOLVED'`, `thread.resolvedAt`, `setResolved()` | Two competing resolution concepts. A thread can read RESOLVED while an `owner_locked` renewal case is open — the exact way a customer gets forgotten | **P1** | Resolution is a case-level concept. Keep a thread-level *needs-reply / waiting* projection; drop `RESOLVED` from the thread, or rename it and bind it to "no open cases" |
| **X-05** | Conversation state semantics | AI #2 vs operations | State reflects **who owes the next action** | `conversationState()` = `WAITING_ON_CUSTOMER` whenever staff spoke last | *"We'll get back to you"* files the family under the customer's court | **P1** | State set by the replying admin (reply+snooze / reply+resolve / waiting-on-us), not inferred |
| **X-06** | Student Group cardinality | AI #2 vs AI #3 (and reality) | One official group **per student** | `Thread @@unique([familyId, kind])` → one `STUDENT_GROUP` thread per **family**; `StudentGroup @@unique([learnerId])` → one per **learner**. `lib/shared/models/conversation.dart` groups conversation rows *under each child* | A two-child family cannot have two Student Groups | **P0** | Group threads keyed on the group; `(familyId, kind)` uniqueness applies to the FAMILY thread only |
| **X-07** | Parent↔Admin channel identity | AI #2 vs AI #3 | One place a parent talks to Jawwid | AI #2: the single `Thread(kind=FAMILY)`. AI #3: `ConversationKind.jawwidSupport` **and** `ConversationKind.adminDirect`, both available to a parent | Two channels to the same team for the same family: split history, split attention, split ownership | **P1** | OD-05. Recommended: `jawwidSupport` **is** the family thread; `adminDirect` exists only for teachers |
| **X-08** | Teacher identity | AI #2/#1 vs AI #3 | Teacher is an authenticated actor | `FAMILY_FACING_ROLES` excludes `ACADEMIC`; `ActorKind` has no teacher; `chat.staff.role` CHECK has no teacher; `chat.learner.teacher_id` has no FK. Flutter authenticates as `UserRole.teacher` | Teacher app cannot log in | **P0** | AI #5 JC-003 |
| **X-09** | Authorization surface | AI #2 vs AI #4 | Server decides; UI mirrors | AI #4 `capabilities.ts` correctly declares itself *"UX affordances only"* and defers per-family decisions to server-supplied `FamilyDetail.capabilities`. **The server-side producer of that object does not exist** | The one control AI #4 relies on is unimplemented; today the UI is the only gate | **P1** | Implement `FamilyCapabilities` server-side as a projection of the same `AuthorizationService` used for writes — never a second matrix (release-gate G-04) |
| **X-10** | Role vocabulary | role assignments vs AI #4/#6 | One role set | This agent's own brief names **Super Admin** and a **CRITICAL** workload level. `domain.ts` states *"There is no `super_admin` role"* and *"`workload_level` has no CRITICAL"*; `terminology.md` lists *super admin* among forbidden words | Two role/severity vocabularies in circulation | **P2** | OD-06. Recommended: keep AI #4/#6's set (LOW/MEDIUM/HIGH, no super admin) — a fourth workload level without a distinct manager action is a vanity level |
| **X-11** | Attention vocabulary | role assignments vs brief/AI #4/#6 | One bucket set | Role brief: *Needs Attention Now / Soon / Normal* (3). Implemented everywhere: **NOW / TODAY / WAITING ON FAMILY / QUIET** (4) | Renaming mid-build would touch every surface | **P2** | Keep the 4 implemented buckets; treat the 3-state phrasing as an informal summary |
| **X-12** | Message immutability | AI #1 vs AI #2 | One answer | `chat.forbid_mutation()` exists to block UPDATE/DELETE on `message`; Prisma performs `message.update` for soft delete and redaction | If both stacks converge, delete-for-everyone raises `restrict_violation` | **P2** | Append-only redaction record instead of an in-place update |
| **X-13** | Identity space for `userId` | AI #2 internal | One id space | `Message.authorId` = "Staff.id or **Contact.id**"; `ThreadParticipantState.userId` = "Staff.id or **Contact.appUserId**". Receipts, reactions, `DeviceToken.userId`, `Notification.recipientId` all use the untyped `userId` | Read cursors and receipts can key on different ids for the same human | **P1** | One canonical actor id, documented once; `IdentityService` is the only translator |
| **X-14** | Delivery audience | AI #2 vs the operating model | The responsible staff member is notified | `familyThreadAudience()` = contacts + `family.owner` | Coverage is never notified; workload/receipts/unread are wrong under coverage | **P0** | Audience derives from `currentHandler()`, not from ownership |
| **X-15** | Deployment target | AI #1 vs AI #7 | One runtime story | AI #1 assumes Supabase (RLS, `auth.uid()`, Supabase migrations); AI #7 ships `docker-compose.yml` with Postgres + Redis for the Nest API | Authorization is written twice, once as RLS and once as `AuthorizationService` | **P1** | Follows from OD-02. If Nest is the only writer, RLS is defence in depth, not the primary control — say so explicitly |

---

## Pattern

Eleven of the fifteen conflicts have one cause: **agents specialised before the product
contract was settled, and each resolved the ambiguity in the direction of their own layer.**
AI #2 read "brief §12 non-negotiable" as binding and marked half the PRD design-only;
AI #3 read the role assignment as binding and built for the PRD; AI #4 built for the brief;
AI #5 escalated correctly; AI #6 wrote a vocabulary for the brief's world.

**None of them was careless.** The missing artifact is the PRD itself
(`authoritative-scope.md` §6: *"PRD v0.1 is not in the repository"*). Until it is on disk,
every agent is working from a second-hand summary, and this register will keep growing.
That is the single highest-leverage fix available today, and it costs one file.
