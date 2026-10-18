# Jawwid Chat — Product Boundary

Status: **CANONICAL** · Locked in Phase 0 (2026-09-07)
Authority order: this document → `jawwid-chat-prd-v0.2.md` (the PD-6 amendment: §4 BR-1 and
the §9 Teacher ↔ Parent calling row — **superseded on that point by PD-7, §4 below**) →
`jawwid-chat-prd-v0.1.md` (product requirements, in force everywhere v0.2 does not amend) →
everything else.
Supersedes as product direction: `docs/JAWWID_CHAT_BRIEF.{pdf,txt}` (Customer Success brief — **HISTORICAL**),
`docs/architecture/decisions.md` ADR-001 ("build the brief" — **SUPERSEDED**),
`docs/admin/backend-contract-required.md` (brief-derived — **HISTORICAL**).

This document exists because the repository was built by parallel agents against
two product directions at once: a *Customer Success operating system* (the PDF
brief: threads, cases, tasks, renewals, workload scoring) and a *communication
platform* (the PRD: parents, teachers, supervisors, conversations, groups,
approvals, calls). Phase 0 locks the second. No future agent may reintroduce the
first without an explicit product decision recorded here.

---

## 1. What Jawwid Chat is

> Jawwid Chat lets **parents, teachers, supervisors (admins) and managers
> communicate safely around families and learners**, while the platform
> enforces ownership, permissions, moderation, privacy, realtime delivery,
> notifications and auditability.

It is a communication platform first. Operations tooling exists only to make
communication safe and answerable, never as a general workflow system.

### 1.1 Jawwid Chat IS

| Capability | Scope today | Where it lives |
|---|---|---|
| **Family communication** — one persistent direct conversation per family with Jawwid, routed to the family's assigned supervisor | MVP | `chat.conversation` type `direct`, `family_id` |
| **Conversations** — typed, multi-party, explicit participant set: `direct`, `student_group`, `class_group`, `official` | MVP (class groups Phase 2, type present from day one) | `chat.conversation`, `chat.conversation_member` |
| **Messaging** — text, media, voice notes, replies, reactions, receipts, typing, delete-for-me / delete-for-everyone, per-user archive/mute/pin | MVP | `apps/api/src/communication/messages` |
| **Teacher ↔ Admin communication** — one persistent direct conversation per (teacher, admin) pair; never family-scoped | MVP (decision C-2) | `direct` with `family_id = null` |
| **Supervisor communication and coverage** — the assigned supervisor answers; a covering admin may act with the same permissions for the duration of an explicit temporary assignment | MVP; coverage is an explicit manager-created assignment (**PD-3**, §4) | `AuthorizationService`, `SUPERVISOR-OWNERSHIP.md` |
| **Realtime** — delivery, receipts, typing, presence, approvals and call signalling over Socket.IO with Redis fan-out | MVP | `RealtimeGateway`, outbox worker |
| **Notifications** — push with priority, quiet hours, templates, dedupe, delivery/open tracking, automated reminders | MVP (dispatch pipeline to be completed) | `apps/api/src/communication/notifications` |
| **Moderation** — group messages from teachers and parents are held for the supervisor's approval; approve / reject with reason; audit | MVP | `chat.message_approval` |
| **Calls** — 1:1 voice and Student-Group voice calls, LiveKit media grants minted server-side, BR-1 applied to calls | MVP | `apps/api/src/communication/calls` |
| **Attachments** — signed upload/download URLs, validated MIME/size, object storage | MVP | `apps/api/src/communication/attachments` |
| **Labels** | Phase 2 | not built |
| **Broadcast** — official messages from Jawwid to many families | Phase 2 | `official` type present; sending not built |
| **Stories / Status** — short-lived publications to a server-resolved audience, 24h expiry, view tracking, media retention | Built 2026-09-28 (was Deferred / not in the PRD; built on explicit instruction) | `apps/api/src/communication/stories`, `20260928120000`, `apps/admin-web/src/features/stories`, `STORIES.md`. Mobile feed still a seam |
| **Audit** — append-only event log and audit log, reasons mandatory for sensitive actions | MVP | `chat.event_log`, `chat.audit_log` |
| **Access control** — one server-side `AuthorizationService`, BR-1 enforced in the API and in the database | MVP | `apps/api/src/platform/authorization.service.ts`, `093000`/`093300`/`094000` |
| **Supervisor ownership** — every family has exactly one current supervisor; reassignment by a manager with a reason; history | MVP | `SUPERVISOR-OWNERSHIP.md` |
| **CRM integration boundary** — Jawwid Core is the source of truth for students, parents, teachers, enrolments and payments, and for lessons and schedules of teachers not yet cut over to Chat (**PD-9**); Chat mirrors what it needs through an API/webhook boundary, never SQL | MVP boundary; ingestion to be re-implemented on the canonical schema | `chat.core_event`, `chat.sync_state`, `core-integration-contract.md` (reference) |

### 1.2 Jawwid Chat IS NOT

| Not this | Why | What happens to the existing code |
|---|---|---|
| A generic CRM | The PRD centres the product on families and conversations, not accounts and pipelines | CRM-shaped machinery is **deprecated and frozen** (§3) |
| A customer-success operating system | The brief that described one is superseded (`docs/qa/authoritative-scope.md`) | `attention`/`workload` engines and the "team now / this week" dashboard are deprecated |
| A case-management system | Product decision C-3 (2026-09-06): there is **no Case entity** | `chat.support_case` removed by OD-01; Admin Web `CaseCards` deprecated |
| A generic task-management system | Tasks routed to departments are CRM tooling. **PD-4** settles the last open use for them: system events are system messages, so no Task is needed and none is revived | `chat.task` frozen; Admin Web `features/tasks` deprecated |
| A renewal / subscription management platform | Renewals live in Jawwid Core | `chat.subscription` mirror and renewal config deprecated |
| A workload / coverage CRM | Coverage exists only so a family is never unanswered, and is an explicit temporary assignment (**PD-3**) | coverage *engine* frozen and scheduled for removal; it keeps routing `canSend` only until Phase 1's assignment model replaces it; shift/absence UI deprecated |
| A WhatsApp Business layer or a WhatsApp clone | PRD §1 | — |
| An AI product | AI intent classification is Phase 2 and suggestion-only; no AI in Phase 0/1 | — |

---

## 2. Domain layering

```
┌─────────────────────────────────────────────────────────────────────┐
│ CORE CHAT DOMAIN                                                    │
│  Family · Learner · Contact · Teacher · Staff · Organization        │
│  Conversation · Participant · Message · Attachment · Reaction       │
│  Receipt · Approval · Call · Supervisor Assignment                  │
├─────────────────────────────────────────────────────────────────────┤
│ SUPPORTING PLATFORM SERVICES                                        │
│  Identity & Sessions · Authorization · Realtime · Notifications     │
│  Storage · Audit / Event log · Outbox & Workers · Config            │
│  Supervisor assignment, incl. explicit temporary cover (PD-3)       │
├─────────────────────────────────────────────────────────────────────┤
│ EXTERNAL INTEGRATIONS                                               │
│  Jawwid Core (identity provisioning, learners, enrolments,          │
│  schedules, payments) · Push providers (FCM/APNs) · LiveKit ·       │
│  Object storage                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Rules:

* Core Chat Domain objects are the only ones a client may name. A client that
  needs a supporting-service concept (e.g. a session) gets it through an API
  resource, never by reaching into the service.
* Supporting services never make product decisions; they execute decisions
  the domain layer already took (e.g. the outbox delivers what a service
  committed).
* External integrations are **boundaries**: data crosses them through a
  contract with `external_id` + `synced_at`, and conflicts resolve in favour of
  the external system for the facts it owns (PRD §12.4).

---

## 3. Deprecated machinery (frozen, not deleted)

The following exists in the schema and, partly, in Admin Web. It is **frozen**:
no new code may depend on it; it is removed by a later, numbered migration once
the product owner confirms; it is never edited in place.

| Machinery | Objects | Status |
|---|---|---|
| Cases | `chat.support_case` (dropped by OD-01), Admin Web `CaseCards`, `/cases/*` endpoints | removed in DB · deprecated in Admin Web |
| Tasks | `chat.task`, Admin Web `features/tasks`, `/tasks` | **frozen, not to be revived** (PD-4) |
| Shifts / absences / coverage rules | `chat.shift`, `chat.coverage_rule`, `chat.absence`, `chat.handoff`, Admin Web `features/coverage` | **frozen, scheduled for removal** (PD-3); `chat.on_duty()` routes `canSend` only until Phase 1 |
| Workload scoring | `workload_*` functions, `WorkloadBadge`, team-now table | frozen |
| Attention scoring | `attention_*` functions, `family_state_cache`, attention buckets | frozen; the *idea* (needs-reply queue) returns as a conversation section in the console |
| Renewals / at-risk | `chat.subscription` mirror, renewal config keys, dashboard "this week" | frozen |

Full object-level classification: `docs/recovery/PHASE-0-DATABASE-RECONCILIATION.md`;
Admin Web: `docs/recovery/PHASE-0-ADMIN-WEB-RECONCILIATION.md`.

---

## 4. Product decisions PD-1 to PD-11 — CLOSED

PD-1 to PD-5 were closed by the product owner on **2026-09-07**, at the Phase 0
exit gate, before `main` was baselined. **PD-6 was closed by the product owner
on 2026-09-23** and re-versions a rule the PRD calls constitutional; it follows
the same six-field form. This section is the canonical record. Any document that
contradicts it is superseded on that point, whatever its own status banner says.
**PD-7 was closed by the product owner on 2026-10-14** and supersedes PD-6.
**PD-9 and PD-10 were closed by the product owner on 2026-10-18.**
**PD-11 was closed by the product owner on 2026-10-18.**

| ID | Subject | Status |
|---|---|---|
| PD-1 | Coverage admin membership of Student Groups | **CLOSED** — window-only |
| PD-2 | Who may initiate a Student Group call | **CLOSED** — not the parent |
| PD-3 | Coverage model | **CLOSED** — explicit temporary assignment |
| PD-4 | Representation of system-generated events | **CLOSED** — system messages |
| PD-5 | Role model | **CLOSED** — `super_admin` exists from day one |
| PD-6 | Direct Parent ↔ Teacher communication | **SUPERSEDED by PD-7** (2026-10-14) — was: allowed for an authorized relationship |
| **PD-7** | **Direct Parent ↔ Teacher communication, restored prohibition** | **CLOSED** — forbidden; BR-1 restored; Student Group only |
| **PD-8** | **Organization structure and conversation scope** (2026-10-15) | **CLOSED** — departments + per-child supervision + activated backups; staff read only on a PD-8 basis; super admin full read/write; supersedes BR-4 for scope. Record: `../architecture/ORG-SCOPE-PD8.md` |
| **PD-9** | **Lessons move from Core into Chat** (2026-10-18) | **CLOSED** — Chat owns lessons per cut-over teacher; one outcome per lesson; the report is the message; money stays in Core |
| **PD-10** | **Teacher File (admin only); parent Billing and child pages** (2026-10-18) | **CLOSED** — tiered admin access, finance super_admin only; Billing and payroll read-only from Core; teacher sees own schedule + workload |
| **PD-11** | **Lesson operations: tickets, apologies, make-ups, suspensions, transfers, trials** (2026-10-18) | **CLOSED** — every ticket is a form that changes one record and posts one card; rulings go to a supervision queue; money stays in Core |

---

### PD-1 · Coverage admin membership of Student Groups

**Final decision.** Coverage admins are members of a Student Group **only during
an active coverage window**. They are **not** permanent silent members of every
Student Group.

**Canonical rule.**

```
coverage_admin + student_group + inside an active coverage window  = MEMBER
coverage_admin + student_group + outside that window               = NOT A MEMBER
```

**Implementation phase.** Phase 2. Phase 0 and Phase 1 do not change the
membership system. Today's Student Group membership stays exactly as built:
family contacts with `can_message`, the family's assigned supervisor, and the
learner's teacher.

**Consequences.**
- Supervisor-scoped privacy is preserved. A coverage admin never gains standing visibility of every family's group.
- The C-4 live-admin presence rule (BR-1) must be satisfiable inside the window. A coverage admin joining for the window counts as the required admin only while they are a live member with `member_role = 'admin'`.
- Group notification and realtime audiences change when a window opens and closes, so the window transition is an event the fan-out must handle.
- `is_silent` already exists in the schema and is honoured by `canSend`, participant selection and the media grant. It is retained for silent membership generally; it is not used to make coverage admins permanent members.
- `syncStudentGroup` removes any member outside its desired set. Phase 2 must teach it about window-scoped members before any coverage admin is added, or the next sync will remove them.

**Deprecated or conflicting behaviour.** PRD §7.3 offers both shapes as
"configurable"; the configurable alternative is not built. The permanent silent
member option is rejected and must not be implemented.

---

### PD-2 · Who may initiate a Student Group call

**Final decision.** Parents **may join** Student Group calls. Parents **may not
initiate** them. A Student Group call is initiated by a teacher or by
admin / authorized staff.

**Canonical rule.**

```
parent + student_group_call + initiate = DENY   (COMM.PARENT_CANNOT_START_GROUP_CALL)
parent + student_group_call + join     = ALLOW, subject to normal membership
                                         and authorization rules
```

**Implementation phase.** The authorization rule is implemented **now**, in
Phase 0, because the pre-existing behaviour permitted parent initiation. No
broader calling work is done. The client surfaces follow in Phase 2.

**Consequences.**
- `AuthorizationService.canCall` takes a `CallIntent` (`initiate` | `join`). The default is `initiate`, the stricter value, so a caller that does not state its intent is denied rather than allowed.
- `CallService.start` passes `initiate`; `CallService.token`, which mints the media grant for joining, passes `join`.
- The rule is scoped to `student_group` and `class_group`. The parent's 1:1 call to their handler (PRD §9) is untouched.
- Ordering is fixed: BR-1 and C-4 are evaluated first, so a constitutional violation always reports its own code and never this policy code.
- New stable error code `COMM.PARENT_CANNOT_START_GROUP_CALL`, HTTP 403.
- Protected by `apps/api/test/unit/authorization/pd002-group-call-initiation.spec.ts`.

**Deprecated or conflicting behaviour.** The behaviour before this decision
allowed a parent member of a compliant group to start a group call, and no test
covered either direction. PRD §7.3's "if policy allows, start one" is now
resolved: the policy does not allow it.

---

### PD-3 · Coverage model

**Final decision.** Coverage is based on **explicit temporary assignments
created by a manager**. The shift, schedule and coverage-rule engine is **not**
the core authorization mechanism.

**Canonical rule.**

```
authorization scope reads from   chat.family_assignment
temporary assignment created by  an authorized manager, explicitly
schedule engine                  deprecated; may later become only a WRITER
                                 into the assignment model, never a reader
                                 the authorization path consults
```

**Implementation phase.** Phase 1 establishes the identity, role and assignment
foundation, including `chat.family_assignment`. No new product behaviour is
built around `chat.on_duty()`.

**Consequences.**
- The shift, coverage rule, absence and handoff machinery is deprecated and frozen. It moves from "frozen pending a decision" to "frozen and scheduled for removal" once the assignment model carries the routing decision.
- `chat.on_duty()` keeps its current role as the routing input to `canSend` only until Phase 1 replaces it. It must not be extended, and nothing new may depend on it.
- The coverage engine is not expanded, and the deprecated Admin Web coverage feature is not revived.
- `visible_families(actor)` is defined against assignments, not against a schedule.
- A future scheduling feature, if the product asks for one, writes `temporary` rows into `chat.family_assignment`. The authorization path still reads only assignments.

**Deprecated or conflicting behaviour.** The schedule-driven option in
`SUPERVISOR-OWNERSHIP.md` §4 is rejected as an authorization mechanism.
`docs/JAWWID_CHAT_BRIEF.txt`'s `on_duty()` as "the sole assignment function" is
superseded.

---

### PD-4 · Representation of system-generated events

**Final decision.** System-generated events are represented as **system
messages inside the family's existing direct conversation**. The removed `Task`
entity is **not** resurrected. **No** new conversation type is created for
system events.

**Canonical rule.**

```
system event  ->  the family's existing direct conversation
                  + a message of type `system`
                  + event metadata / type carried on the message where needed
```

Applies to onboarding, renewal, payment, schedule change and follow-up.

**Implementation phase.** Phase 2 builds automatic event generation and the
notification pipeline. Phase 0 records the decision only.

**Consequences.**
- The four conversation types stay exactly four: `direct`, `student_group`, `class_group`, `official`. No fifth type, and no per-event-class `official` conversation.
- `chat.task` stays deprecated and frozen. It is not revived to carry event types, and PRD §7.6's task types are not reintroduced as a domain entity in this model.
- PRD §7.5's phrase "with their type shown" refers to metadata carried on the system message, not to a conversation type and not to a Task type.
- The family's history stays in one conversation, which preserves PRD §7.5's "the full timeline across all of the family's conversations" without fragmenting it per event.
- The notification and reminder pipeline in `../architecture/JAWUID-CHAT-ARCHITECTURE.md` §2.7 terminates on this representation.
- The event metadata carrier on `chat.message` is a Phase 2 design item; nothing is added to the schema now.

**Deprecated or conflicting behaviour.** Both options offered in
`docs/release/od-01-migration-impact.md` §17 are superseded: option 1 because it
requires a Task, option 2 because it creates `official` conversations per event
class. The STOP condition recorded there is now cleared.

---

### PD-5 · Role model

**Final decision.** `super_admin` **exists from day one**. Departments are
**not** roles.

**Canonical rule.**

```
roles        super_admin | manager | admin | coverage_admin
departments  finance | technical | academic        (an attribute, never a role)

role != department
```

`super_admin` is the organization owner and holds the capabilities defined in
`../architecture/AUTHORIZATION-MODEL.md`, including user management.

**Implementation phase.** Phase 1 foundation item. The role vocabulary is
normalized in Phase 1: `coverage` is renamed to `coverage_admin`, `super_admin`
is added, and `finance` / `technical` / `academic` move to a department
attribute.

**Consequences.**
- One migration changes `chat.staff.role`'s CHECK constraint, renames `coverage`, adds `super_admin`, and moves the three department values to `chat.staff.department`.
- `apps/api/src/communication/contracts/vocab.ts` `StaffRole` and `FAMILY_FACING_STAFF_ROLES` are normalized in the same phase.
- Admin Web's `domain.ts` comment "There is no `super_admin` role" and the assertion `expect(ROLES).not.toContain('super_admin')` in `capabilities.test.ts` are **known wrong** and are replaced in Phase 1. They are not edited before then, so the change is visible as one reviewed commit.
- Compatibility is preserved only where technically necessary, for example existing rows during the migration. Conflicting legacy role semantics are not kept silently.

**Deprecated or conflicting behaviour.** The historical role model
`coverage | finance | technical | academic` must not be restored.
`docs/product-operations/open-decisions.md` OD-06, which recommended keeping
`super_admin` out, is overruled. `docs/qa/rbac-matrix.md`'s role vocabulary is
superseded. `docs/design/terminology.md` governs display labels only; it does
not govern whether the role exists.

---

---

### PD-6 · Teacher–Parent direct communication

> **SUPERSEDED by PD-7 (2026-10-14).** Kept as the historical record of the
> PD-6 window. Direct Teacher–Parent communication is forbidden again; see PD-7.

**Closed 2026-09-23.**

**Final decision.** An active teacher **may** directly message and directly call
a parent contact **while the Teacher–Parent relationship is authorized**. This is
an **additional** capability. It does not replace the Student Group, which
remains the official shared channel, and it does not weaken it.

Direct communication between a teacher and a parent who are **not** in an
authorized relationship remains **forbidden**, exactly as before.

**Canonical rule.** A Teacher–Parent relationship is authorized when, and only
when, **all** of the following hold at the moment of the action:

```
authorized(teacher, contact) =
      teacher is assigned to >= 1 learner in the contact's family   (A)
  AND teacher.is_active                                             (B)
  AND teacher.left_at IS NULL                                       (C)
  AND contact.is_active                                             (D)
  AND contact.can_message = true                                    (E)
  AND teacher, learner and contact share one organization_id        (F)

ONE qualifying learner is sufficient.                               (G)
Anything else = DENY.
```

The authorization is **relationship-derived**. It is not conferred by two
accounts existing, by shared organization membership, by family membership
alone, by `role_preset`, by an existing conversation, by past communication, by
a previous authorization, or by group membership. Any missing, invalid,
inactive, ambiguous or cross-organization condition **fails closed**.

**One qualifying learner is sufficient.** If family F has learner A taught by
teacher X and learner B taught by teacher Y, then X may communicate directly
with F's parent contacts *because of A*, and Y may communicate directly with the
same contacts *because of B*. Neither teacher's authorization depends on the
other's learner.

**Communication authorization is not data authorization.** Being authorized to
*communicate* with a parent grants **no** access to any learner's data. If X is
authorized because X teaches learner A, that does not authorize X to read
learner B's grades, attendance, package or balance, lessons, complaints, or any
other learner-specific record. Learner-data access continues to be governed by
its own authorization rules, unchanged by this decision.

**Revocation is immediate.** Authorization is evaluated **at the time of each
protected action**, never cached and never granted ahead of time. It ends the
moment the qualifying relationship ends — when the learner is reassigned to
another teacher, when the teacher's `left_at` is set, when the teacher is
deactivated, when the contact is deactivated, or when `can_message` is withdrawn.

**Revocation is not deletion.** Ending authorization ends *new* protected
actions only. Existing conversation history is retained; messages are never
deleted because an authorization lapsed. The teacher simply cannot send a new
direct message or start a new direct call while unauthorized.

**One relationship definition, two capabilities.** Direct 1:1 messaging and
direct 1:1 calling share the **same** relationship definition. There are not two
definitions. The relationship decides *whether*; the action decides *what*.

**Admin oversight.** An admin is **not** required to be a participant in a direct
Teacher–Parent conversation or call. This decision introduces no admin-presence
requirement of its own. Existing moderation, audit and administrative
capabilities are unchanged and continue to be governed by their own rules. The
C-4 live-admin presence rule continues to govern the **Student Group**, which
PD-6 does not touch.

**No grant table.** This policy introduces **no** Teacher–Parent authorization or
grant table, no permanent grants, no time-bounded grants, and no manual
per-parent teacher authorization records. Authorization is derived from the live
Teacher ↔ Learner ↔ Family relationship. Introducing any of those mechanisms
would require a new product decision.

**Implementation phase.** The policy was closed on 2026-09-23 and staged in
four steps, each of which required that no BR-1 structural backstop and no BR-1
security test be weakened before it:

1. the relationship predicate, at the application and database layers, proven on its own;
2. the authorization switch (`canOpenDirect`, and the calling path that shares it);
3. re-versioned authorization tests;
4. the database backstop migration, which must permit the authorized case without weakening the unauthorized one.

**All four have landed** (2026-09-24). The permitted case was **added**; the
prohibited case is enforced exactly as strongly as before, and release gate
**G-01** records the proof. What is *not* done is the calling product — see
milestone **M4** in §5.1 and gate **G-06**. Policy and implementation now agree;
neither asserts that a call carries audio.

**Consequences.**
- `AuthorizationService.canOpenDirect` gains an authorized Teacher↔Parent pair as a permitted direct pair. Unauthorized pairs keep returning `COMM.BR1_TEACHER_PARENT_DIRECT`.
- The same predicate governs the direct calling path; PRD §9's 1:1 matrix row changes with it (PRD v0.2).
- `chat.enforce_direct_conversation_rules()` and `chat.assert_conversation_br1()` must learn the authorized case. Today they make a teacher+contact `direct` conversation unrepresentable, which is what closes RT-024/RT-025; that strength must survive for unauthorized pairs.
- Revocation being evaluated per action means no authorization may be cached in a session, a socket, or a conversation row.
- Student Group membership, C-4 admin presence, PD-1 and PD-2 are unaffected.

- A new `RelationshipService` resolves the predicate from Prisma. `AuthorizationService` receives the **resolved fact** and gains no database access, so its database-free unit-test architecture is preserved.
- `canOpenDirect` becomes asynchronous at its call sites, taking the resolved pairing.
- The three decision sites change: `canOpenDirect`, `canSend` (teacher branch), `canCall`. Nothing else in the matrix moves.
- A new database function `chat.teacher_parent_authorized(uuid, uuid)` enforces the same rule independently. The four BR-1 assertion functions are redirected onto it; the deferred constraint triggers and the `type`-immutability triggers are retained exactly as they are.
- New stable error code `COMM.TEACHER_PARENT_NOT_AUTHORIZED`, HTTP 403. `COMM.BR1_TEACHER_PARENT_DIRECT` is **deprecated** — retained as a constant and still treated as terminal by clients, but no longer emitted by the server.
- Release gate **G-01** is re-versioned; it is not retired.
- Messages on the new direct channel **publish immediately**. No per-message admin approval is introduced. Audit logging, administrative visibility under existing permissions, moderation/reporting and the ability of an authorized admin to intervene are all unchanged.
- The database backstop now joins real `chat.contact` / `chat.learner` / `chat.teacher` rows, so `db/tests/br1_invariants.sql` needs real relationship fixtures where it previously used synthetic actor ids.

**Migration impact.** No historical migration is edited; one new forward
migration carries the change. No data migration is required — the predicate
reads relationships that already exist. Existing Student Groups, existing direct
conversations and existing call history are untouched. The change is
behaviour-widening for authorized pairs and behaviour-preserving for every other
pairing, so no row becomes invalid under the new rule.

**Explicitly NOT changed by this decision.**
- **PD-2** stands: a parent may join a Student Group call but may never initiate one. The direct channel and the group channel are separate authorization models and must not be merged.
- **C-4** stands: a Student Group pairing a teacher and a parent still requires a live Jawwid admin member.
- RT-024 type-immutability, the two-participant ceiling on direct conversations and calls, tenant isolation, BR-2 (no phone numbers), BR-5 (history belongs to Jawwid), and every unrelated matrix denial — `contact+contact`, `teacher+teacher`, `staff+staff`, `ROLE_CANNOT_MESSAGE_FAMILY`.

**Deprecated or conflicting behaviour.** PRD v0.1 §4 BR-1 ("No direct
Teacher ↔ Parent communication") and its §9 calling-matrix row
("Teacher ↔ Parent — Rejected server-side") are **re-versioned by PRD v0.2** and
no longer state the whole rule. `decision-log.md` **DEC-03** is superseded in
part — its prohibition of *authorized* direct communication no longer holds; its
prohibition of *unauthorized* direct communication is retained and is now the
whole of DEC-03's surviving force. Nothing here permits a teacher to reach a
parent they do not teach.

---

### PD-7 · Teacher–Parent direct communication is forbidden again (supersedes PD-6)

**Closed 2026-10-14** by the product owner.

**Final decision.** Direct Teacher ↔ Parent one-to-one **conversations** and direct
Teacher ↔ Parent **calls** are **forbidden**, whatever the relationship between the
two. Teacher–Parent communication happens **only** inside the official Student
Group (or another group conversation) with the assigned Jawwid admin present —
BR-1 as the PRD originally wrote it, and C-4 (live admin presence) unchanged.

**Canonical rule.** A direct conversation or a direct call may never pair an
actor of kind `teacher` with an actor of kind `contact`. The decision is made
from the participant **kinds** alone. The PD-6 relationship predicate
(`chat.teacher_parent_authorized`, `RelationshipService`) still exists and still
answers "is this teacher this family's teacher", but it no longer opens any
channel and nothing may reintroduce it as an input to that decision.

**Enforcement (server and database, never only the client).**
`AuthorizationService.canOpenDirect` refuses the pair; `canSend` and `canCall`
refuse any direct conversation whose participant set pairs them (both sides);
the database refuses, with the application bypassed, any insert or revival of
such a membership, any such direct call participant set, and any teacher- or
parent-authored message into such a conversation
(`20261014120000_chat_pd007_restore_br1_direct.sql`). Error code
`COMM.BR1_TEACHER_PARENT_DIRECT` (no longer deprecated);
`COMM.TEACHER_PARENT_NOT_AUTHORIZED` is no longer emitted.

**Existing rows.** Direct Teacher–Parent conversations and calls created during
the PD-6 window (2026-09-23 → 2026-10-14) are kept, not deleted: they remain
readable to their members as history and accept nothing new. Their lifecycle
writes (a call ending, a member leaving) still succeed.

**Unchanged.** PD-2 (a parent may not start a group call), C-4, RT-024 type
immutability, the two-participant ceiling, tenant isolation, BR-2.

**Deprecated behaviour.** Everything PD-6 enabled: opening, messaging in, or
calling on a direct Teacher–Parent channel; the client's "message the teacher"
affordance (the server's `canOpenDirect` advisory now answers `false` for that
pair, so a client following it hides the entry point without a client change).

---

### PD-9 · Lessons move from Jawwid Core into Jawwid Chat

**Closed 2026-10-18** by the product owner.

**Final decision.** Jawwid Chat becomes the **source of truth for
lessons**: the scheduled occurrence, its outcome and its report. Jawwid Core stops
managing lessons for every teacher who has been cut over. **Billing, subscriptions
and payroll stay in Core** (PD-10); Chat tells Core what happened to each lesson.

Why: customers should not switch between two systems, and parents never open
Core, so a teacher today writes a report in Core and then re-sends it in Chat.

**Canonical rule.**

```
lesson   = (learner, teacher, starts_at, ends_at, kind: regular | trial)
           -- one row per occurrence; Chat owns it

every lesson whose end has passed closes with EXACTLY ONE outcome:
  held               -- requires a lesson report
  student_apology    -- the family excused the learner in advance
  teacher_apology    -- the teacher excused themselves in advance
  admin_cancelled    -- Jawwid cancelled it (reason mandatory)
  student_no_show
  teacher_no_show

the report IS the message:
  submitting a report posts it, once, as a structured card into the
  learner's student_group (never a direct conversation -- PD-7)
  the parent's child page and every admin statistic read that same row

statistics are queries over lesson rows, never stored counters
```

* **The cause is mandatory.** Core's October data showed 31 cancellations with
  0 student and 0 teacher apologies: a cancellation without a cause cannot be
  attributed to anyone. Every non-`held` outcome names its cause by its type.
* **Escalate, never block.** A lesson still unclosed a configurable time after
  its end is escalated to the Teachers-department supervisors (PD-8 §1). The
  teacher is reminded and is never locked out of anything else.
* **Availability is new, not revived.** A teacher's weekly availability
  template (working hours and regular day off) and dated extra days off,
  recorded by Teachers-department supervisors, are new records. The frozen
  `chat.shift` / `chat.absence` machinery (§3, PD-3) is not reused.
* **Trial conversion is Core's fact.** A trial is a lesson with `kind = trial`;
  whether it led to a subscription is decided in Core and arrives through
  `chat.core_event`, linked to the trial lesson.
* **Cut over per teacher.** A teacher is entirely on Chat or entirely on Core,
  never both, so no lesson has two owners.
* **Chat → Core.** `lesson.closed` (with its outcome) is emitted to Core through
  the outbox, so Core can keep billing, credits and payroll correct.

**What it enables** (each is a read over the same rows): the teacher's own
schedule and workload (PD-10); the parent's per-child page — lessons attended,
lessons apologised for, reports, certificates; the admin Teacher File's schedule
and workload analytics:

| Metric | Definition |
|---|---|
| Monthly scheduled hours | sum of lesson durations in the month, all outcomes |
| Actual teaching hours | sum of durations of `held` lessons that have a report |
| Cancellation / apology hours | sum of durations of non-`held` lessons, split by outcome |
| Available scheduled hours | availability-template hours in the month, minus extra days off, minus scheduled lesson hours (fixed-shift teachers only) |
| Trial lessons | `kind = trial` and `held`, split into converted / not converted |

**Implementation phase.** Not yet scheduled against a milestone. Order: **L1** lesson + outcome +
report-as-message; **L2** teacher schedule and the parent's per-child page;
**L3** admin workload analytics; **L4** Core cut-over, cohort by cohort.

**Consequences.**
- §1.1's CRM-boundary row changes: Core stays the source of truth for students,
  parents, teachers, enrolments and payments, but **not** for lessons or
  schedules of cut-over teachers.
- The Teacher Account freeze is reopened for exactly two surfaces, schedule and
  workload (PD-10). Nothing else in the teacher app reopens.
- `chat.learner.next_class_at` becomes derived from the next lesson.
- The `class_attended` / `class_missed` event-log vocabulary is kept and is
  emitted from lesson outcomes.
- A report card is a new structured message kind. The event-metadata carrier
  on `chat.message` that PD-4 left as a Phase 2 design item is designed here.

**Deprecated behaviour.** The Core-mirror design on
`claude/admiring-feynman-v3l4xh` (`816a99e`, `chat.class_session` /
`chat.class_attendance`) is not merged. It was a projection of Core-owned data,
and its semantics are reversed once Chat owns lessons; it is reference only.

**Defaults adopted at closing** (the owner may override any of them without
reopening PD-9):
1. A report card **bypasses** Student Group moderation for its structured
   fields; the student group's supervisor may hide it afterwards, with a reason.
2. Lessons are created and moved by **Teachers-department supervisors**; a
   teacher closes their own lessons and writes reports, and does not reschedule.
3. The escalation delay is a configuration value, not a constant.

**Open implementation items** (settled before L1 starts; they do not block
this decision):
1. The report template: which fields, and which are required.
2. Certificates: who issues one, on what criterion, and as a file or a record.
3. The escalation delay's initial value.

**Closed.** 2026-10-18.

---

### PD-10 · Teacher File (administration only) and the parent's Billing and child pages

**Closed 2026-10-18** by the product owner.

Owner answers given 2026-10-18: money stays in Core and is shown read-only;
Teacher File access is tiered; a teacher sees only their own schedule and
workload.

**Final decision.**

1. **Billing (parent).** Core stays the source of truth for invoices. The
   parent's *Settings › Billing* shows them **read-only**, fetched from a Core
   API at request time and **not stored** in Chat (the frozen `chat.subscription`
   mirror is not revived). One list with a derived status: **Upcoming**,
   **Due**, **Overdue**, **Paid**. An instalment is an invoice with a due date,
   not a separate category. Paying happens in Core, through a link out.
2. **Parent child page.** Each child gets one page — lessons attended, lessons
   apologised for, lesson reports, certificates — reading PD-9's rows. This
   replaces both the requested "Students table" (a parent has a few children,
   not a table) and a separate "parent dashboard".
3. **Teacher File.** A record of a `chat.teacher` in **Admin Web only**. It is
   not the teacher app and not a staff profile (`chat.teacher` is not
   `chat.staff`). Sections: personal information, employment, schedule,
   workload analytics, supervision timeline, financial summary, leave and days
   off, assigned students.
4. **Payroll.** Salary type, monthly salary, bonuses, deductions and the
   financial summary stay in Core / HR and are shown **read-only**, fetched at
   request time and not stored in Chat.
5. **Teacher self-view.** A teacher sees their own schedule and workload in the
   teacher app, and nothing else from the Teacher File.

**Canonical rule — who sees what.**

| Section | Teachers-dept supervisors and manager | Super admin | The teacher | Anyone else, parents included |
|---|---|---|---|---|
| Personal info, employment (non-financial), assigned students | read | read | — | **never** |
| Schedule, workload analytics | read | read | **own only** | **never** |
| Supervision timeline (complaints, monthly comment, extra days off), weekly day off | read + write | read + write | — | **never** |
| Salary, bonuses, deductions, financial summary | — | read | — | **never** |

* Enforced server-side and in the database, never only in the client: no
  parent-facing or teacher-facing DTO carries any Teacher File field beyond
  schedule and workload.
* **Teacher phone and email** live in an admin-only record (or come from Core).
  They are never reachable by the communication engine, so the `Actor`
  guarantee ("no code path in this engine can obtain one") still holds.
* **The supervision timeline is one append-only log per teacher**, with typed
  entries: `complaint` (optionally linked to the conversation or message it came
  from, closed with a resolution), `monthly_comment` (one per teacher per month;
  a correction adds a new version), `day_off`. It is a record, not a task
  workflow: PD-4 keeps tasks frozen.
* **Assigned students** come from `chat.learner.teacher_id`, which already
  exists and is trigger-guarded.

**Implementation phase.** Assigned students, personal information and the
supervision timeline depend on nothing new and can ship first. Schedule, workload
and the parent's child page follow PD-9 L2/L3. Billing and payroll need Core to
publish read APIs for invoices and pay, which do not exist today.

**Consequences.**
- A new permission set: `teacher_file.read`, `teacher_file.supervise`,
  `teacher_file.finance`. Finance is `super_admin` only.
- §1.2's "renewal / subscription management" row is unchanged: Chat displays
  Core's invoices, it does not manage them.
- The Teacher Account freeze reopens only through PD-9's two surfaces.

**Deprecated behaviour.** None removed. Explicitly **not** built: a parent
"Students table"; any stored copy of invoices or pay; any write path for money
in Chat.

**Defaults adopted at closing** (the owner may override without reopening
PD-10):
1. **Operations supervisors do not see Teacher Files.** Access is exactly the
   table above; widening it is a new decision.

**Open implementation items** (they do not block this decision):
1. Teaching market and specializations: whether Core holds them or Chat does.
2. Core's invoice and payroll read APIs, and their authentication. Billing and
   payroll do not start until these exist.

**Closed.** 2026-10-18.

---

### PD-11 · Lesson operations: tickets, apologies, make-ups, suspensions, transfers and trials

**Closed 2026-10-18** by the product owner.

The owner's requirements of 2026-10-18 extend PD-9 to the whole life of a
learner's lessons. Four questions were answered on the same day: a "grant" is a
**teacher bonus**; the lesson-package balance **stays in Core**; a parent books a
**make-up instantly** but a **regular-time change needs approval**; a trial
conversion is a **Sales ticket confirmed against Core**.

**Final decision.**

```
ticket   = a form in a conversation's "+" menu, offered only in the right
           conversation type to the right role, that
             - changes exactly ONE domain record (lesson, enrollment, trial ...)
             - posts exactly ONE card into that conversation
           there is no ticket table, no assignee and no ticket status:
           PD-4 keeps tasks frozen

ruling   = a ticket that needs a decision opens a ruling on its record;
           open rulings form the Teacher Supervision "Needs decision" queue;
           every decided ruling is appended to the teacher's supervision
           timeline (PD-10)
```

**Lesson reports and absences (PD-9 refined).**

| Situation | Who acts | Outcome |
|---|---|---|
| Learner attended | teacher: **Lesson report** ticket | `held` + report card |
| Learner excused **before** the start | parent: **Apology** ticket (its timestamp is the notice) | `student_apology`; no report |
| Learner absent, no apology, start has passed | teacher: **Absence** ticket | `student_no_show`; credited to the teacher |
| Parent apologises **after** the start (emergency) | parent: **Late apology** ticket | opens a ruling; the lesson stays credited to the teacher until a supervisor rules `student_apology` (excused) or confirms `student_no_show` |
| Teacher cannot teach, before the start | teacher: **Teacher apology** ticket | `teacher_apology`; a make-up is owed |

The teacher is never the judge of a late apology, and a teacher's credit is
never held while a ruling is open. A card is posted into the learner's student
group, or — where the family is served through a PD-8 family group instead —
into the live family group that is about the learner and has the lesson's
teacher in it. Both belong to one family, so a card never reaches another.

**Make-ups and schedule changes.** A make-up is owed after `teacher_apology`
(and after an excused `student_apology` when the academy's notice rule says so).
The parent's **Make-up** ticket lists the teacher's real free slots — the PD-9
availability template minus extra days off minus booked lessons — and books one
**instantly**; the database refuses two lessons that overlap for one teacher. A
**Regular-time change** ticket lists the same slots but only **requests** the
change; a Teachers-department supervisor approves it. If no make-up is booked
within a configured number of days, a ruling opens; the supervisor's action
(substitute teacher, credit to the family in Core, package extension in Core) is
recorded on the teacher's supervision timeline. This **overrides PD-9 default 2**
for make-ups only.

**Suspensions.** Chat records the state of a learner's study: `active`,
`paused` (with an agreed return date) or `left` (with a reason from a fixed
list, plus free text). A pause creates no lessons in its window and tells Core,
which **holds the package** (Core owns the balance). Two days before the return
date, the family's group and the responsible team are notified; on the date,
lessons resume unless a supervisor extends the pause. The "used up their
package" list reads the balance from a Core API at request time (PD-10 rule).

**Transfers.** A **Transfer** ticket names the new teacher, a reason from a fixed
list and a handover note. A Teachers-department supervisor executes it, in one
transaction: `chat.learner.teacher_id` changes through a guarded writer, the old
teacher leaves the student group (losing access to it), the new teacher joins
and reads the whole history, future lessons move, past lessons stay with the
teacher who taught them, and Core is told. Chat therefore **writes** the
teacher assignment for cut-over teachers.

**Trials.** Each teacher has one staff-only **trial group** (the Sales
supervisor, the teacher, Teachers-department supervisors when needed). A trial
lesson is about a **prospect** named by display name only — no phone or e-mail
(BR-2). Two independent facts, each recorded by whoever knows it:
**attendance** (teacher: trial report or no-show) and **conversion**
(Sales: subscribed, or not subscribed with a reason). A conversion becomes
**confirmed** when Core's subscription event arrives for it; only a confirmed
conversion credits the teacher.

**New students.** A confirmed subscription puts the learner on the Operations
**New Students** page, which is a single setup: teacher, weekly times, student
group, welcome message.

**Teacher Supervision chat and bonuses.** Each teacher has one staff-only
supervision conversation with the Teachers department. Its **Bonus** ticket
records the reason on the supervision timeline; the amount is payroll and stays
in Core/HR (PD-10).

**Implementation phase.** In order: **T1** lessons, report / absence / apology
/ late-apology tickets, rulings and the needs-action list; **T2** availability,
make-up booking, regular-time requests, teacher-apology follow-up; **T3**
transfers, suspensions and the supervision chat; **T4** trials, trial groups and
New Students (needs Core's subscription events); **T5** statistics.

**Consequences.**
- A message gains one new type, `card`, written only by the server; a client
  can never author one.
- Two staff-only conversation purposes (trial group, teacher supervision) are
  new in T3/T4 and are recorded when they are built.
- `chat.learner.teacher_id` gains a second writer (the transfer) beside Core
  ingestion.
- New Chat → Core events: `lesson.closed`, `enrollment.paused`,
  `enrollment.resumed`, `enrollment.left`, `learner.transferred`.

**T2 as built (2026-10-18).** Migration `20261018140000_chat_pd011_scheduling.sql`.
- Weekly availability and dated days off are recorded by the Teachers department,
  in the teacher's IANA time zone. Every conversion to an instant is done by
  Postgres `at time zone`, so daylight saving is the database's job.
- A learner's regular times are `chat.learner_schedule_slot` rows, ended and
  never edited. Lessons are **materialized** from them 4 weeks ahead by the
  worker (`chat.materialize_lessons`, idempotent).
- A changed schedule turns the old slots' future open lessons into the new
  outcome **`rescheduled`**, which statistics do not count.
- A family books a make-up **only** for a `teacher_apology` / `teacher_no_show`
  lesson, only into `chat.teacher_free_slots`, and the database keeps one live
  make-up per missed lesson. A make-up after an excused student apology waits
  for the academy's notice rule and is not offered yet.
- An unreplaced teacher-cancelled lesson reaches the needs-action list after
  `lesson.makeup_window_days` (7). The supervisor's action (`substitute_teacher`,
  `family_credit`, `package_extension`, `waived`) is a `makeup_followup` ruling,
  and `lesson.makeup_resolved` tells Core.
- Reminders are data rules on event `lesson_scheduled`: the family 24 h and
  30 min before, the teacher 15 min before. Templates name nobody (push privacy,
  2026-10-14). A reminder whose moment has passed is skipped, never sent late,
  and closing a lesson early cancels its reminders in the same transaction.
- The teacher app gains its **Schedule** tab (Chats · Schedule · Calls ·
  Settings); a parent's tabs are unchanged.

**Deprecated behaviour.** None removed. Explicitly **not** built: a generic ticket
or task entity; any stored package balance; parents changing their regular
lesson times without approval.

**Defaults adopted at closing** (the owner may override without reopening
PD-11):
1. Report template: **what was covered** (required), homework, a 1–5 rating and
   a note (optional). This settles PD-9 open item 1 until the academic team
   replaces it.
2. A late apology may be filed up to **48 hours** after the lesson starts.
3. The return-date notice is sent **2 days** before the date.
4. A lesson still open **24 hours** after its end is overdue and escalated
   (`lesson.escalation_after_minutes`); this settles PD-9 open item 3.

**Closed.** 2026-10-18.

---

### Decisions still open after PD-1 to PD-11

None at the decision level. PD-8 is recorded in `../architecture/ORG-SCOPE-PD8.md`.
The implementation items left open inside PD-9, PD-10 and PD-11 are settled when their
phase starts and do not reopen either decision. Any new product question is
recorded here with a new `PD-n` and the same six fields: decision, canonical
rule, implementation phase, consequences, deprecated behaviour, and the date it
was closed.

---

## 5. Phase map

| Phase | Delivers | Explicitly excluded |
|---|---|---|
| **0 — Reconciliation** (this) | one integration line, one architecture, one contract, deprecations, security containment | any new feature |
| **1 — Identity, Authentication & Authorization** | accounts, credentials, sessions, devices, teacher identity, role/permission model, supervisor assignment, RLS engagement | messaging features |
| 2 — Console & clients on the canonical contract | Admin Web rework, Flutter realtime client, notification dispatch, storage serving, coverage-window group membership (PD-1), system-event generation as system messages (PD-4) | broadcast, labels |
| 3 — Communication features | broadcast, labels, class groups, search across chats | AI, video |
| Later | AI suggestions, video, multi-tenant SaaS | stories/status built early, out of band — see `STORIES.md` §2 |

### 5.1 Phases and milestones are two different axes

The table above is the **phase map**: what each phase is allowed to change, and
what it may not touch. It is a scope boundary, not a work plan, and it is the
only phase numbering this repository recognises. **There is no phase beyond 3.**
A numbered "phase" that does not appear in the table above is a working plan
somebody held in their head or in a conversation — useful while it is being
worked, and not a repository artifact. Do not record one here or anywhere else.

The **delivery sequence** is a separate axis and lives in `jawwid-chat-prd-v0.1.md`
§13.1 as milestones **M0–M5**, ordered by dependency and risk. Work is scheduled
against a milestone; scope is bounded by a phase.

**The next calling work is M4 — Calling, 1:1 and group voice.** Its deliverables
are fixed by §13.1 and are, in order:

1. CallKit / ConnectionService
2. VoIP push
3. Call history
4. Call notifications

M4 has not started. What exists today is the server-side policy, the call
lifecycle and the media-token layer, together with verified LiveKit Cloud
**control-plane** connectivity. No audio has been carried. `docs/qa/release-gate.md`
G-06 is the gate that governs voice calling and is the place that records how far
that has been proven — not this table.

**Known dependencies of M4**, recorded so they are not rediscovered late. These
are not additional deliverables — the four above are the deliverables — they are
things M4 will run into:

* **Media presence is not observed.** `call.participant_joined` means a
  participant reached the media plane, and nothing in the system observes that.
  An HTTP accept is not a media join and must never be made to emit that event
  (`contracts/API-CONTRACT.md`, `POST /calls/:id/accept`). Observing it needs a
  LiveKit webhook, which is not built.
* **`GET /calls/history/:conversationId` is marked RECONCILE**, not EXISTS, in
  `contracts/API-CONTRACT.md` — its response shape is not settled. Call history
  is M4 deliverable 3 and starts there.
* **The Flutter client has no calling of any kind** — no LiveKit SDK, no CallKit,
  no ConnectionService, and `callRepositoryProvider` throws `UnimplementedError`
  outside test wiring. The phase map puts the Flutter realtime client in Phase 2;
  M4's client work sits on top of it.
* **`RT-029` and `RT-030`** (`red-team/findings.md`) are open tenancy defects,
  both contained and failing closed today. Neither blocks M4 and neither is
  closed by it; they are tracked separately so M4 does not quietly absorb them.
