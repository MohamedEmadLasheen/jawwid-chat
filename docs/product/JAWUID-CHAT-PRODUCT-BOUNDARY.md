# Jawwid Chat — Product Boundary

Status: **CANONICAL** · Locked in Phase 0 (2026-09-07)
Authority order: this document → `jawwid-chat-prd-v0.2.md` (the PD-6 amendment: §4 BR-1 and
the §9 Teacher ↔ Parent calling row) → `jawwid-chat-prd-v0.1.md` (product requirements,
in force everywhere v0.2 does not amend) → everything else.
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
| **Stories / Status** | Deferred (not in the PRD) | not built |
| **Audit** — append-only event log and audit log, reasons mandatory for sensitive actions | MVP | `chat.event_log`, `chat.audit_log` |
| **Access control** — one server-side `AuthorizationService`, BR-1 enforced in the API and in the database | MVP | `apps/api/src/platform/authorization.service.ts`, `093000`/`093300`/`094000` |
| **Supervisor ownership** — every family has exactly one current supervisor; reassignment by a manager with a reason; history | MVP | `SUPERVISOR-OWNERSHIP.md` |
| **CRM integration boundary** — Jawwid Core is the source of truth for students, parents, teachers, schedules and payments; Chat mirrors what it needs through an API/webhook boundary, never SQL | MVP boundary; ingestion to be re-implemented on the canonical schema | `chat.core_event`, `chat.sync_state`, `core-integration-contract.md` (reference) |

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

## 4. Product decisions PD-1 to PD-6 — CLOSED

PD-1 to PD-5 were closed by the product owner on **2026-09-07**, at the Phase 0
exit gate, before `main` was baselined. **PD-6 was closed by the product owner
on 2026-09-23** and re-versions a rule the PRD calls constitutional; it follows
the same six-field form. This section is the canonical record. Any document that
contradicts it is superseded on that point, whatever its own status banner says.

| ID | Subject | Status |
|---|---|---|
| PD-1 | Coverage admin membership of Student Groups | **CLOSED** — window-only |
| PD-2 | Who may initiate a Student Group call | **CLOSED** — not the parent |
| PD-3 | Coverage model | **CLOSED** — explicit temporary assignment |
| PD-4 | Representation of system-generated events | **CLOSED** — system messages |
| PD-5 | Role model | **CLOSED** — `super_admin` exists from day one |
| **PD-6** | **Direct Parent ↔ Teacher communication** | **CLOSED** — allowed for an authorized relationship; re-versions BR-1 |

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

### PD-6 · Direct Parent ↔ Teacher communication

**Closed by the product owner on 2026-09-23.** This decision re-versions **BR-1**,
which PRD §4 calls a rule of "the constitution of the product". PRD §4 requires
that such a rule change only by being "explicitly changed and re-versioned
here"; that is what this decision does. The PRD moves to **v0.2** and preserves
the v0.1 wording in its Appendix A.

**Final decision.** Authorized Parent ↔ Teacher **direct 1:1 messaging and
direct 1:1 voice calling are ALLOWED**, in both directions. An unauthorized
pairing stays forbidden. This is not a general parent↔teacher permission: the
relationship is the whole of the authorization.

**Canonical rule.**

```
authorized(contact C, teacher T) :=
  ∃ learner L :  L.family_id  = C.family_id
              ∧  L.teacher_id = T.id
              ∧  C.is_active ∧ C.can_message
              ∧  T.is_active ∧ T.left_at IS NULL
              ∧  C.organization_id = T.organization_id

parent  + authorized teacher + direct chat/call = ALLOW
teacher + authorized parent  + direct chat/call = ALLOW
parent  + any other teacher  + direct chat/call = DENY (COMM.TEACHER_PARENT_NOT_AUTHORIZED)
teacher + any other parent   + direct chat/call = DENY (COMM.TEACHER_PARENT_NOT_AUTHORIZED)
```

Every term is read from server-owned data synchronized from Jawwid Core. A
client-supplied `parent_id`, `teacher_id` or `conversation_id` is a lookup key
and **never** evidence of a relationship.

**Reason.** Teachers and parents need to reach each other about the child's
learning without an admin having to relay. The v0.1 rule achieved supervision by
removing the channel entirely, which put the academy's operational cost and the
parent's experience on the wrong side of the trade. PD-6 keeps the control that
mattered — the academy decides who may speak to whom, from its own records — and
drops the blanket prohibition. Supervision moves from "no channel exists" to
"every channel is authorized, audited and retained".

**Implementation phase.** Immediately, as a policy migration executed before any
calling feature work, in this order: documents → predicate → database backstop →
application authorization → tests and gate → verification.

**Consequences.**
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

**Deprecated or conflicting behaviour.** PRD v0.1 BR-1 and its matrix rows are
superseded and preserved in PRD Appendix A. `docs/qa/authoritative-scope.md`
§3's BR-1 paragraph is superseded on this point. `docs/design/screens/call.md`
§1/§4 and `docs/design/screens/student-group.md` §1, which required the
affordance to be absent unconditionally, are superseded: the affordance is now
conditional on backend authorization. Red-team findings **RT-024 and RT-025 are
not retracted** — they are valid findings about the rule as it stood, and the
controls they produced remain in force.

---

### Decisions still open after PD-1 to PD-6

None. PD-6 is closed. Any new product question is recorded here with a new
`PD-n` and the same six fields: decision, canonical rule, implementation phase,
consequences, deprecated behaviour, and the date it was closed.

---

## 5. Phase map

| Phase | Delivers | Explicitly excluded |
|---|---|---|
| **0 — Reconciliation** (this) | one integration line, one architecture, one contract, deprecations, security containment | any new feature |
| **1 — Identity, Authentication & Authorization** | accounts, credentials, sessions, devices, teacher identity, role/permission model, supervisor assignment, RLS engagement | messaging features |
| 2 — Console & clients on the canonical contract | Admin Web rework, Flutter realtime client, notification dispatch, storage serving, coverage-window group membership (PD-1), system-event generation as system messages (PD-4) | broadcast, labels |
| 3 — Communication features | broadcast, labels, class groups, search across chats | AI, video |
| Later | AI suggestions, video, stories/status, multi-tenant SaaS | — |

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
