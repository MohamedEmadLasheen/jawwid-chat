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
| **Moderation** — every message publishes on send (**PD-14**); whoever is in charge of the conversation may edit or delete a teacher's or parent's message afterwards; every edit keeps the replaced wording; audit | MVP | `chat.message_revision`, `AuthorizationService.moderatableAuthorKinds` (`chat.message_approval` holds pre-PD-14 messages only) |
| **Calls** — 1:1 voice and Student-Group voice calls, LiveKit media grants minted server-side, BR-1 applied to calls | MVP | `apps/api/src/communication/calls` |
| **Attachments** — signed upload/download URLs, validated MIME/size, object storage | MVP | `apps/api/src/communication/attachments` |
| **Labels** | Phase 2 | not built |
| **Broadcast** — official messages from Jawwid to many families | Phase 2 | `official` type present; sending not built |
| **Stories / Status** — short-lived publications to a server-resolved audience, 24h expiry, view tracking, media retention | Built 2026-09-28 (was Deferred / not in the PRD; built on explicit instruction) | `apps/api/src/communication/stories`, `20260928120000`, `apps/admin-web/src/features/stories`, `STORIES.md`. Mobile feed still a seam |
| **Audit** — append-only event log and audit log, reasons mandatory for sensitive actions | MVP | `chat.event_log`, `chat.audit_log` |
| **Access control** — one server-side `AuthorizationService`, BR-1 enforced in the API and in the database | MVP | `apps/api/src/platform/authorization.service.ts`, `093000`/`093300`/`094000` |
| **Supervisor ownership** — every family has exactly one current supervisor; reassignment by a manager with a reason; history | MVP | `SUPERVISOR-OWNERSHIP.md` |
| **CRM integration boundary** — Jawwid Core is the source of truth for teachers (and payroll), for students, parents and enrolments other than those Chat enrolled from a subscription form (**PD-16**), and for lessons and schedules of teachers not yet cut over to Chat (**PD-9**); Chat mirrors what it needs through an API/webhook boundary, never SQL. **Family payments and instalment plans are Chat's own records since PD-17**; nothing about them is read from Core | MVP boundary; ingestion to be re-implemented on the canonical schema | `chat.core_event`, `chat.sync_state`, `core-integration-contract.md` (reference) |

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

## 4. Product decisions PD-1 to PD-21 — CLOSED

PD-1 to PD-5 were closed by the product owner on **2026-09-07**, at the Phase 0
exit gate, before `main` was baselined. **PD-6 was closed by the product owner
on 2026-09-23** and re-versions a rule the PRD calls constitutional; it follows
the same six-field form. This section is the canonical record. Any document that
contradicts it is superseded on that point, whatever its own status banner says.
**PD-7 was closed by the product owner on 2026-10-14** and supersedes PD-6.
**PD-9 and PD-10 were closed by the product owner on 2026-10-18.**
**PD-11 was closed by the product owner on 2026-10-18.**
**PD-12 was closed by the product owner on 2026-10-18** and depends on PD-11.
**PD-13 was closed by the product owner on 2026-10-19** (the Calls page).
**PD-14 was closed by the product owner on 2026-10-20** (no pre-approval of messages).
**PD-15 was closed by the product owner on 2026-10-21** (the student's journey after enrolment).
**PD-16 was closed by the product owner on 2026-10-21** (Chat enrols new students and parents sign up).
**PD-17 was closed by the product owner on 2026-10-21** (Parent and Student Profiles; payments recorded in Chat). It supersedes PD-10 §1 and PD-12's "Core invoices, read-only" for family money.
**PD-18 was closed by the product owner on 2026-10-21** (teacher payroll lives in Chat) and supersedes PD-10 item 4.
**PD-19 was closed by the product owner on 2026-10-21** (a member may start a call in their own chat; supersedes PD-2), amended 2026-10-21 (the super admin's group calls) and 2026-10-22 (calls in the trial group and the supervision conversation).
**PD-20 was closed by the product owner on 2026-10-22** (the Sales team uses the app: chats, calls and payments). It amends PD-15's "staff work in Admin Web; the app is for parents and teachers".
**PD-21 was closed by the product owner on 2026-10-22** (account administration: password reset, inactive accounts, impersonation).

| ID | Subject | Status |
|---|---|---|
| PD-1 | Coverage admin membership of Student Groups | **CLOSED** — window-only |
| PD-2 | Who may initiate a Student Group call | **SUPERSEDED by PD-19** (2026-10-21) — was: not the parent |
| PD-3 | Coverage model | **CLOSED** — explicit temporary assignment |
| PD-4 | Representation of system-generated events | **CLOSED** — system messages |
| PD-5 | Role model | **CLOSED** — `super_admin` exists from day one |
| PD-6 | Direct Parent ↔ Teacher communication | **SUPERSEDED by PD-7** (2026-10-14) — was: allowed for an authorized relationship |
| **PD-7** | **Direct Parent ↔ Teacher communication, restored prohibition** | **CLOSED** — forbidden; BR-1 restored; Student Group only |
| **PD-8** | **Organization structure and conversation scope** (2026-10-15) | **CLOSED** — departments + per-child supervision + activated backups; staff read only on a PD-8 basis; super admin full read/write; supersedes BR-4 for scope. Record: `../architecture/ORG-SCOPE-PD8.md` |
| **PD-9** | **Lessons move from Core into Chat** (2026-10-18) | **CLOSED** — Chat owns lessons per cut-over teacher; one outcome per lesson; the report is the message; money stays in Core |
| **PD-10** | **Teacher File (admin only); parent Billing and child pages** (2026-10-18) | **CLOSED** — tiered admin access, finance super_admin only; Billing and payroll read-only from Core; teacher sees own schedule + workload |
| **PD-11** | **Lesson operations: tickets, apologies, make-ups, suspensions, transfers, trials** (2026-10-18) | **CLOSED** — every ticket is a form that changes one record and posts one card; rulings go to a supervision queue; money stays in Core |
| **PD-12** | **Admin operations: instalments, student certificates, teacher discipline and leave** (2026-10-18) | **CLOSED** — Core invoices read-only with a billing supervisor; certificates delivered as one student-group card; one monthly ladder, suggested then confirmed; leave balance computed, never stored |
| **PD-13** | **The Calls page: scheduled calls and call links** (2026-10-19) | **CLOSED** — one Calls page for every role; a scheduled call belongs to ONE conversation and announces itself with a card; a call link is members-only; nothing grants a call that `POST /calls` would refuse |
| **PD-14** | **Messages publish immediately; admins moderate after sending** (2026-10-20) | **CLOSED** — no message is held for approval, for any role or conversation type; whoever is in charge of a conversation may edit or delete a teacher's or parent's message at any time afterwards; a manager or the super admin also a staff member's |
| **PD-15** | **The student's journey after enrolment** (2026-10-21) | **CLOSED** — supervisors record student and teacher excuses from the group; one quick "Lesson report" entry; make-ups after any apology; outcomes corrected and reports edited / deleted / resent only through recorded changes; each child's age, course and package; monthly statistics in the academy's terms |
| **PD-16** | **Enrolling a new student in Chat; the parent's own sign-up** (2026-10-21) | **CLOSED** — Assign on New Students creates the family, parent and children in Chat from Sales' form; an assigned entry is the supervisor's (and their manager's); the supervisor opens the family group; the parent signs up with their e-mail and a one-time code relayed by the supervisor until WhatsApp sending is connected |
| **PD-17** | **Parent Profile and Student Profile; family payments recorded in Chat** (2026-10-21) | **CLOSED** — a Parent Profile (contact details, internal note, children, subscription, payment method, payment timeline) for the administration only, by the Instalment Payments rule plus Sales; Operations and Sales record payments; the parent sees their own payments in the app; a Student Profile for the administration and the child's own teacher; instalments and payments are Chat's own append-only records, nothing is read from Core; teachers reach neither a parent nor money by any route |
| **PD-18** | **Teacher payroll in Chat** (2026-10-21) | **CLOSED** — salary terms, a sealed payout account and the amounts of bonuses and deductions are recorded in Chat, for the super admin only; the month's financial summary is computed, never stored; supersedes PD-10 item 4 |
| **PD-19** | **Who may start a call: every member of their own chat** (2026-10-21) | **CLOSED** — teachers, parents and supervisors may start a call in any chat they may write in; parents may now start their family / Student Group calls; chats a person is not a member of, BR-1 / PD-7, C-4 and the no-phantom-call rule are unchanged; amended the same day so the super admin may start a group call in any chat they may write in, with a seat on the call; amended 2026-10-22 so trial-group and supervision calls are group calls (they were refused by the database) |
| **PD-20** | **The Sales team in the app** (2026-10-22) | **CLOSED** — Sales-department staff sign in to the app and get Chats, Calls, Payments and Settings; they view and record payments (record once, void with a reason); instalment plans, the contact record and every other staff role stay in Admin Web; the app never holds a parent's phone or e-mail |
| **PD-21** | **Account administration: password reset, inactive accounts, impersonation** (2026-10-22) | **CLOSED** — every staff role, org-wide, for parent and teacher accounts; staff accounts by the super admin only; never the super admin's or one's own; a reset is a one-time code the person completes with their own password; inactive = suspended, signed out everywhere, reactivation revives no session; impersonation of parents and teachers only, labelled messages, fully audited |

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

> **SUPERSEDED by PD-19 on 2026-10-21.** Parents may now start group calls in
> their own chats. Kept as history.

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

1. **Billing (parent).** *(Superseded by PD-17, 2026-10-21: family payments and instalment plans are Chat's own records; nothing is read from Core.)* Core stays the source of truth for invoices. The
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
   request time and not stored in Chat. **Superseded by PD-18 (2026-10-21):
   payroll is recorded in Chat.**
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

**T3 as built (2026-10-18).** Migration `20261018160000_chat_pd011_transfers_suspensions.sql`.
- **Transfers** go through `chat.transfer_learner`, the second writer of
  `chat.learner.teacher_id`. It checks the actor is in the Teachers department
  (`chat.is_lesson_manager`) and opens the assignment gate for its own statement
  only. Only a server-side caller can run it (`chat.trusted_staff_actor`).
- **One transaction:** in the student group the old teacher leaves and the new
  one joins; family groups gain the new teacher, and the PD-8 trigger prunes the
  old one; future lessons follow the learner where the new teacher is free and
  become `rescheduled` otherwise; the regular times end.
- **Around the function:** the service keeps the same weekly times when the new
  teacher is free at them. The family's card names the new teacher, never the
  reason. The handover note reaches the new teacher as a card in their
  supervision chat. The old teacher's sockets are evicted (RT-009), and
  `learner.transferred` tells Core.
- **Suspensions** (`chat.learner_suspension`, one active per learner): the
  lessons in the window become the new outcome **`suspended`**, which counts
  against nobody, and the materializer skips paused dates. A permanent stop also
  ends the regular times.
- **Return:** the worker posts a return-date card
  `lesson.return_notice_days` (2) before the day, the team sees it in
  needs-action as `returningSoon`, and on the day the pause ends by itself and
  the lessons come back. Both lists are `GET /suspensions`. `packageBalance` is
  null until Core publishes it (PD-10).
- **"One lesson per weekly slot and start time"** now holds for live lessons
  only, so a pause that ends early gets its lessons back.
- **Teacher Supervision** is a query over records that already exist: the new
  append-only `chat.teacher_supervision_entry` (bonus, complaint, monthly
  comment, note), decided rulings, lessons the teacher did not give, transfers in
  and out, and days off. It is read by the Teachers department and the super
  admin only.
- **The bonus ticket** posts a card into the teacher's supervision chat (their
  direct conversation with the recorder) and tells Core/HR through
  `teacher.bonus_recorded`. No amount passes through Chat.

**T5 as built (2026-10-19).** Migration `20261019100000_chat_pd011_statistics.sql`.
- **One definition per number.** SQL functions compute everything:
  - `chat.lesson_category` and `chat.teacher_lesson_stats`: lessons by outcome, kind and length;
  - `chat.teacher_report_timeliness`: reports submitted within `stats.report_grace_hours` (24) of the end;
  - `chat.teacher_reply_times`: a family's published messages answered by the teacher within `stats.reply_within_hours` (24);
  - `chat.teacher_available_minutes`: weekly windows over the month, minus days off.

  Months are calendar months in `stats.zone` (Africa/Cairo). `rescheduled` and
  `suspended` lessons are shown, and counted for or against nobody. Trials have
  their own block since T4 (below).
- **Who reads what (PD-10).**
  - `GET /stats/teachers` and `GET /stats/teachers/:id`: the Teachers department and the super admin.
  - `GET /stats/me`: a teacher, their own month, without student movements.
  - `GET /learners/:id/progress`: the family, and others who can read the child's schedule. It shows this month's attended, apologised and absent lessons, the streak, make-ups owed, the next lesson and the last report. Certificates are empty until the certificate flow lands.
  - `GET /lessons/access`: tells the Admin Web whether to offer the page.
- **Admin Web.**
  - Operators get **Teacher statistics** at `/teachers`, the first tab of the **Teachers** area. The area is offered only when `/lessons/access` confirms the Teachers department; its tabs are registered in `features/teachers/area.tsx`, and PD-12 appends teacher files, certificates and leave there.
  - The super admin gets the **Reports & analytics** section.
  - The page has a month picker, a list of every teacher, and per-teacher category cards broken down by lesson length (the Core dashboard's layout), plus rates, reports on time, replies to families, workload and student movements.
- **App.** The child's progress appears on the group profile, and the teacher's month heads the Schedule tab.

**Supervisors' screens as built (2026-10-19).** Three more tabs in the Admin Web
Teachers area, behind the same `/lessons/access` gate. There is one new
endpoint, `GET /lessons/roster`; everything else uses the T1–T3 API.
- **Needs action** (`/teachers/needs-action`) is the daily queue. Its sections:
  - lessons still without an outcome, each with student absent / teacher absent / cancel;
  - late apologies, to excuse or count as an absence;
  - teacher-cancelled lessons with no make-up, with the decision recorded;
  - regular-time requests, to approve or reject;
  - pauses ending soon, with "move return date".
- **Schedules** (`/teachers/schedules`): a teacher's weekly hours and days off;
  each student's regular times, a one-off lesson, a transfer (with a handover
  note) and pause / stop.
- **Students** (`/teachers/students`): the paused and stopped lists, with
  extend and end. "Package left" reads "kept in Core" until Core publishes it.
- **One dialog for every action.** Required fields are refused before anything
  is sent, and the server's refusal is shown in its own words.
- **Not here:** the supervision timeline and the bonus screen. Those belong to
  the PD-12 Teacher File (#48).

**T4 part 1 as built (2026-10-19).** Migration `20261019120000_chat_pd011_trials.sql`.
Owner decisions at the start of T4: build now and wait for Core; **Sales**
records prospects and books trials (the Teachers department may book too); the
**whole Sales department** joins trial groups (part 2).
- **A trial is a lesson.** It is a `chat.lesson` row of kind `trial` for a
  `chat.trial_prospect` (display name, optional level and note; no phone or
  e-mail, BR-2) and never for a learner. The database enforces
  `kind = 'trial'` ⇔ `prospect_id` set ⇔ `learner_id` null. So the teacher's
  free times, the no-double-booking constraint, reminders and leave all count
  it. A trial is booked only by staff, only for an active teacher of the
  organization, and only into a time `GET /trials/slots` offers.
- **Two facts, kept apart.**
  - **Attendance** is the teacher's: `POST /trials/:id/attendance` with
    `attended: true` writes the outcome `held` and a report (what was covered,
    an optional 1–5 rating and a note). With `attended: false` it writes
    `student_no_show`. The Teachers department may record an absence but never
    the report. Sales records neither. Nothing is recorded before the start.
  - **Conversion** is Sales': `POST /trials/:id/outcome` takes `subscribed`, or
    `not_subscribed` with a fixed reason (price, schedule, not ready, chose
    another, no response, other). It is accepted only for an attended trial,
    and only once (`chat.trial_outcome`, its guard refuses rewrites). A teacher
    sees that a decision exists, never its reason.
- **Core confirms.** `chat.confirm_trial_conversion(lesson, core_ref, learner)`
  is server-side only (revoked from every request role) and idempotent. It
  stamps the confirmation and links the prospect to the learner Core created.
  The Core ingestion that calls it is **not built**, so every subscription
  reads **"awaiting Core"**, and only a confirmed one credits the teacher.
  *Chat side built 2026-10-19* (`docs/integration/core-subscription-confirmation.md`):
  Sales' "subscribed" queues `trial.converted` for Core; the signed webhook
  `POST /integration/core/events` takes `subscription.created` and confirms with
  `chat.confirm_trial_subscription`, linking the student now or when the learner
  arrives; New Students gains "Confirmed, student not in Chat yet". Core's ids
  became opaque text (`20261019200000`). Still Core's: sending the event.
- **New Students** (`GET /trials/new-students`; Operations, Sales, super
  admin): confirmed subscriptions whose learner has no live group yet ("ready
  to set up"), and subscriptions Core has not confirmed. A student leaves the
  first list when their group exists; there is no "done" button to forget.
- **Statistics.** Trials are never a student's lesson. They are left out of
  the categories, rates and the teachers list. Their own block counts lessons,
  attended, absent, upcoming, subscribed, confirmed and not subscribed. Their
  time joins the workload.
- **Leave and suspension (PD-12 S1, S2).** Approving leave, or deciding a
  temporary suspension, sees colliding trials too and cancels them as trials
  (through TrialService, which posts the trial group's card).
- **Fix to T2.** `chat.materialize_lessons` now skips the teacher's days off
  (`chat.teacher_day_off`), as free slots already did. Before this, a leave or
  day off recorded more than four weeks ahead was later filled with regular
  lessons.
- **Access.** `GET /lessons/access` adds `sales` and `operations`. Lesson routes
  (`/lessons/*`) never see a trial; `/trials/*` is the trials' only reader and
  writer.
- **Admin Web.** A **Trials & new students** area: **Trial lessons**
  (`/trials`; Sales and the Teachers department) and **New students**
  (`/trials/new-students`; Operations and Sales). It is offered when the server
  confirms any of the three departments, and each tab only to its readers.
  - Sales records prospects, books from the teacher's real free times and
    records the decision.
  - The Teachers department records an absence.
  - Either can open the teacher's trial group in Chat.

**T4 part 2 as built (2026-10-19).** Migration `20261019130000_chat_pd011_trial_group.sql`,
built on PD-12 S1 (`20261019090000`): it extends PD-12's type list, access
function and `chat.message_card_kind`, and rewrites none of them from an older
copy.
- **The trial group.** It is conversation type `trial_group`, one live group
  per teacher (`chat.conversation.trial_teacher_id`). It is shaped like PD-12's
  supervision conversation: never a family, a learner or a 1:1.
  - **Members:** the teacher, and the whole Sales department as admins, synced
    every time the group is ensured. A contact or a prospect is never a member;
    the row trigger refuses anyone else.
  - **Access:** Sales and the Teachers department are parties through one new
    branch of `chat.staff_conversation_access` (and the chat-list candidates).
    The Teachers department reads and writes without being a member, so it is
    not notified of every trial of every teacher. Operations has no access.
- **The report is the message.** Each change posts its card in the same
  transaction as the record:
  - `trial_booked`;
  - `trial_report` (what was covered and the rating);
  - `trial_no_show`;
  - `trial_cancelled`;
  - `trial_decision`, which carries the result **only**. The not-subscribed
    reason and Sales' note never reach the group, because the teacher reads it.

  The group is created on the teacher's first booking, or when Sales, the
  Teachers department (`POST /trials/teachers/:id/group`) or the teacher
  (`POST /trials/my-group`) opens it.
- **App.** The teacher's chat list shows the group as **Trial lessons**,
  never under the staff-side title. Its "+" offers a **Trial report** for each
  trial that has started and has no outcome
  (`GET /conversations/:id/trial-tickets`). The report is attended (what was
  covered, an optional 1–5 rating, a note) or did not attend. Trial cards are
  drawn in the bubble; a subscription reads "counts once Core confirms".
- **Admin Web.** The trial row has a **Trial group** button that opens the
  teacher's group in Chat. The group shows as "Trial group" in the
  conversation lists.

**Trial journey as built (2026-10-20).** Migration `20261021100000_chat_trial_journey.sql`.
Owner decisions in the session "student trial journey", which **supersede**
parts of T4 above. The superseded parts are the whole-Sales membership and
Core's confirmation.
- **Chat is the only source of truth** for a trial's outcome. Sales'
  "subscribed" is the conversion the moment it is recorded.
  - Nothing waits for, or is sent to, Jawwid Core: the `trial.converted` event
    is gone, and so are the "awaiting Core" states.
  - `chat.confirm_trial_conversion`, `chat.confirm_trial_subscription` and the
    learner-link trigger are dropped. The `confirmed_at` / `core_*` columns stay
    (migrations are append-only), and nothing reads them.
  - The signed webhook still verifies and records `subscription.created`, but it
    changes nothing.
- **The trial group's membership.** Still one permanent group per teacher.
  - **Permanent members:** the teacher and the Teachers department (the Teacher
    Supervisors), synced on every ensure.
  - **Sales supervisors join and leave by choice**, all with the same right:
    `POST /trials/groups/:conversationId/join | leave`. A sync never adds or
    removes one, except someone no longer in Sales.
  - Access is unchanged: both departments read and write without being members.
    So a supervisor who left still finds the group and rejoins. Membership only
    decides who is notified.
- **One outcome per trial**, from the Admin Web chat's **"+ → Trial"** card
  (`GET /trials/groups/:conversationId` lists the teacher's trials, those awaiting
  an outcome first, each by student and time) or from the Trials page:
  `POST /trials/:id/outcome`.
  - `no_show`: either supervisor (Sales or the Teachers department).
  - `subscribed`: Sales, with the subscription form.
  - `not_subscribed`: Sales, with a reason from the fixed list (details required
    for "other").
  - Options 2 and 3 mark the trial attended if the teacher has not.
  - A trial's attendance and its outcome must agree (database).
  - "A held lesson has a report" now also accepts a trial that Sales recorded as
    subscribed or not subscribed.
- **Privacy.** The group reads one sentence and which trial it is (student name
  and time): "The student has subscribed." / "The student did not subscribe." /
  "The student did not attend the trial lesson."
  - The form, prices, contact details and the reason never reach a message, a
    card, an outbox event or the audit log's payload. The reason code is audited.
  - The form is **confined** like the Teacher File: `chat.trial_subscription` has
    no request-role grant, and only `src/new-students` may name it
    (`new-students-confinement.spec.ts`).
  - The G-07 tripwire allows exactly its phone declaration. The e-mail is
    optional.
- **The subscription form:**
  - the parent's name, phone and e-mail;
  - for each child (1–10): name, age, course, assigned teacher, package price,
    price per lesson, and weekly days and times;
  - the payment: currency (ISO code) and bank transfer or invoice.

  Sales may edit it in place (`POST /trials/:id/subscription`); nothing is
  posted. Recording it does **not** create parent or child accounts.
- **New Students** (`GET /trials/new-students`; Operations, Sales, super admin)
  lists every live form, newest first, as recorded in Chat.
- **Corrections** (`POST /trials/:id/correction`, Sales or the super admin, with
  `why`).
  - The trial keeps its one `chat.trial_outcome` row, changed in place. A
    trigger writes the before and after into the append-only
    `chat.trial_outcome_revision`.
  - The attendance follows (`held` ⇄ `student_no_show`, allowed only inside a
    correction).
  - Moving away from "subscribed" withdraws the form from New Students; the form
    is kept. Moving back restores it with the new details.
  - The group reads "Outcome corrected: …" with the new sentence only (card kind
    `trial_correction`).
- **Statistics.** `chat.teacher_trial_stats` is the one definition. Trials are
  counted per teacher, by the month they start in, each **once** by its current
  outcome.
  - total = subscribed + not subscribed + did not attend + awaiting an outcome.
  - conducted = the trials the student attended.
  - conversion = subscribed ÷ (subscribed + not subscribed).
  - Upcoming and cancelled trials are shown outside the total.
  - The block is on the teacher's statistics; the teachers list gains Trials and
    Subscribed columns.
- **App.** Trial cards read the short sentences, and a correction card shows the
  new outcome. The "counts once Core confirms" line is gone.

**Trial booking with students (2026-10-21).** Migration `20261021130000_chat_trial_booking_students.sql`.
Owner decisions in the session "student trial journey".
- **One booking form.** "Record a prospect" is gone from the Admin Web.
  - "Book a trial" takes the students directly: name, optional level and note,
    and "Add another student" (up to 10).
  - Siblings or a small group share **one** trial, one teacher time, one card and
    **one outcome** (the owner chose one outcome per booking, not per student).
  - The students are `chat.trial_student`, written with the booking and never
    changed. Older bookings were backfilled as one student each.
  - The booking's label (`trial_prospect.display_name`) is the students' names
    joined.
  - When the outcome is "subscribed", the form starts with the booked students
    as the children.
  - `POST /trials` takes `students`; `prospectId` is still accepted.
- **Operations is part of the trial desk.** Operations supervisors work trials
  exactly like Sales: they book, record every outcome, fill and edit the
  subscription form, correct outcomes, and join or leave trial groups.
  - `chat.trial_desk_role` (Sales or Operations) replaces the Sales-only check
    in the trial group's member guard, `staff_conversation_access` and the chat
    list.
- **Editing a booked trial.** A trial that has not started can be moved to
  another time, length or teacher (`POST /trials/:id/reschedule`; the trial
  desk or the Teachers department).
  - As every PD-11 move, the old row becomes `rescheduled` and the trial
    continues as a new row for the same students, so reminders and free times
    stay right. Statistics and lists count it once.
  - The group reads a `trial_rescheduled` card (new and previous time). When
    the teacher changes, the old group reads "moved to another teacher" and the
    new teacher's group gets the booking.
- **Upcoming trials in "+ → Trial".** They are listed, greyed out: an outcome
  is accepted only once a trial has started.

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

### PD-12 · Admin operations: instalments, student certificates, teacher discipline and leave

**Closed 2026-10-18** by the product owner.

**Depends on PD-11** (lesson operations). PD-12 reuses three of its parts and
does not restate them: the **ticket** (a form that changes one domain record
and posts one card; there is no ticket table, and PD-4 keeps tasks frozen); the
staff-only **teacher supervision conversation**; and the **New Students** page
fed by a Sales trial ticket confirmed against Core. The owner's "New Students"
and "trials closed in Chat" requirements are therefore settled by PD-11, not
here.

The owner asked on 2026-10-18 for four Admin Portal pages: Instalment Payments,
New Students, Certificates and Teacher Supervision. These answers were given on
the same day:
- request cards instead of tickets: yes (the PD-11 ticket);
- the disciplinary count resets **monthly**;
- lateness and cancellations share **one** ladder;
- suspensions are approved by the **Teachers department**;
- the leave allowance is **typed in by an admin**;
- the teacher **sees their leave balance** in the teacher app;
- trials are closed **in Chat**;
- Operations supervisors **see invoice amounts** for their own families;
- Core invoices **per family**, and sometimes **per child** when a child takes
  more subjects.

**Final decision.**

```
instalments  = Core invoices, read at request time, never stored (PD-10)
               row = (responsible account, child or "family", amount, due date,
                      status, responsible supervisor)
               order: Overdue (oldest first) > Due today > Upcoming (soonest)

certificate  = a learner_certificate record:
                 requested -> issued | declined
               requested by the teacher's Certificate ticket in the teacher
               supervision conversation; issued by uploading the file;
               delivered as ONE card in the learner's student group

violation    = a lesson closed teacher_apology or teacher_no_show,
               or a held lesson recorded late, that is not excused
ladder step  = the number of violations in the teacher's calendar month:
                 1 warning, 2 first deduction, 3 second deduction,
                 4 temporary suspension, 5+ permanent suspension
               the system suggests the step; a Teachers-department member
               confirms it; it is appended to the supervision timeline

leave        = balance = allowance(year) - approved leave days(year)
               computed on every read, never a stored counter
```

**1. Instalment Payments (Operations).**
* The page reads Core's invoices at request time and stores nothing (PD-10's
  rule; the `chat.subscription` mirror stays frozen). An instalment is an invoice
  with a due date. Paid invoices are hidden by default.
* **Responsible account** is the invoice's payer, shown by the parent's display
  name in Chat.
* **Responsible supervisor:** if the invoice names a child, it is that child's
  PD-8 supervisor. If it is a family invoice, it is the family's **billing
  supervisor**, a new family-level field in the PD-8 assignment that the
  Operations Manager sets. While it is unset, the invoice appears under the
  manager's "No billing supervisor" filter. Nothing is guessed from the children.
* **Who sees it:** an Operations supervisor sees amounts, dates and status for
  the families in their PD-8 scope only; the Operations Manager and super_admin
  see all. This extends PD-10: parents already see their own invoices, and
  teachers and Teachers-department staff never see any.
* A row opens the family's direct conversation, where the follow-up happens.
  Paying stays in Core.

**2. Student certificates.**
* The name is **student certificate** (`learner_certificate`). "Certificate"
  already names a teacher's qualification document (Teacher Profile V2), and the
  two must never share a table, a screen or an API.
* The teacher files a **Certificate** ticket for one learner in their teacher
  supervision conversation, which is private and never the student group. The
  ticket carries the certificate type, the achievement, the date, an optional
  grade and the learner's name as it should be printed. This creates the record
  in `requested`.
* Open requests form the Admin **Certificates** page. A designated supervisor
  either uploads the finished file (PDF or image), which moves the record to
  `issued`, or declines it with a reason, which posts a card back into the
  supervision conversation.
* **Delivery is one card.** On `issued`, the certificate is posted as a card into
  the learner's student group. The teacher and the parent are both members, so
  it is in both accounts at once, with no new teacher-app surface. The parent's
  per-child page (PD-10) lists the same record.
* The file is a learner-scoped object. Reading it requires a signed URL, and
  issuing that URL is the access decision: only the learner's student-group
  members and staff in scope receive one.
* This settles PD-9 open item 2. The criterion for *when* to request one stays
  with the academic team, not with the system.

**3. Teacher discipline (Teachers department).**
* **What counts.** A lesson closed `teacher_apology` or `teacher_no_show`
  (PD-9), and a `held` lesson recorded as late. Lateness is new: a `held` lesson
  gains `late_minutes`, recorded by a Teachers-department member. A lesson counts
  as late only above a configured threshold.
* **Excused.** A Teachers-department member may excuse a violation with a
  reason, such as an outage or an emergency. It stays on the record but is not
  counted.
* **Not a violation:** a lesson cancelled because of approved leave (section 4)
  or by a suspension.
* **One shared ladder, reset monthly.** The step is the count of counted
  violations in the teacher's calendar month, which is also the payroll month.
  On the first of the month the count starts again at zero. The history is
  never reset, and a suspension already in force continues.
* **Suggest, then confirm.** Each new violation opens a ruling (PD-11) in the
  Teacher Supervision "Needs decision" queue. The ruling shows the suggested
  step and the teacher's history. Any Teachers-department supervisor or manager,
  or super_admin, confirms, excuses the violation, or chooses a different step
  with a reason. Nothing is applied automatically.
* **What each step does:**
  - *Warning:* a system message in the teacher supervision conversation.
  - *First and second deduction:* Chat records the decision and emits
    `teacher.deduction_applied` (step, month) to Core. **The amount is set in Core
    payroll** (PD-10). Teachers-department staff never see salary or amounts.
  - *Temporary suspension:* the approver sets an end date. No lessons are
    scheduled in that window. Lessons already in it are listed at confirmation
    and must be given a substitute or closed `admin_cancelled` (reason
    `teacher_suspended`; a make-up is owed under PD-11). The teacher keeps their
    account and conversations.
  - *Permanent suspension:* every learner is moved with PD-11's transfer, future
    lessons are moved or cancelled as above, the teacher's sessions are revoked
    and the account is disabled. Core is told (`teacher.suspended`, with kind and
    dates).
* Every violation, ruling and step is appended to the teacher's **supervision
  timeline** (PD-10), which can only grow. New entry types: `violation`,
  `warning`, `deduction`, `suspension`, `excused`.
* The page has three sections, **Lateness**, **Cancellations** and **Leave**.
  Each is a query over lesson rows and timeline entries; nothing is typed in
  twice.

**4. Teacher leave.**
* **Allowance:** a Teachers-department member types each teacher's leave
  allowance in days, per leave year, in the Teacher File. Changes are appended
  with who made them and when.
* **Request:** the teacher files a **Leave** ticket (dates and reason) in the
  teacher supervision conversation. A Teachers-department member approves it or
  declines it with a reason. Approval writes PD-11's `chat.teacher_day_off`
  rows (the one record of days off, which the scheduler and make-up booking
  read), linked to the request; cancelling removes the days that have not
  passed. There is no second leave table.
* **Balance** = allowance − approved leave days in that leave year. It is
  computed on every read and never decremented. Cancelling or shortening an
  approved leave therefore restores the balance with no correction step. A day
  on which the teacher's weekly availability has no working hours (their regular
  day off) does not consume balance.
* **Lessons inside an approved leave** are listed at approval and must be given a
  substitute or closed `admin_cancelled` (reason `teacher_leave`; a make-up is
  owed under PD-11). They never count as violations. This is the rule most
  likely to be missed: without it, approved leave turns into no-shows, and the
  no-shows turn into deductions.
* **The teacher sees their own balance** and the state of their own leave
  requests in the teacher app. This reopens the Teacher Account freeze for one
  more read-only surface, beside PD-9's schedule and workload.

**Permissions.** New keys: `billing.family_read` (Operations, in scope),
`certificate.issue`, `teacher_discipline.decide` and `teacher_leave.manage`
(Teachers department and super_admin). They are enforced in the API and in the
database, never only in the client.

**Implementation phase.** In order:
- **S1:** the teacher supervision conversation, pulled forward from PD-11 T3,
  plus student certificates and leave.
- **S2:** the discipline ladder. It needs PD-11 T1's lesson outcomes and rulings,
  plus `late_minutes`.
- **S3:** Instalment Payments, which needs Core's invoice read API (PD-10 open
  item 2) and the PD-8 billing supervisor.
  *Chat side built 2026-10-19* (`docs/admin/pd012-s3.md`): the billing
  supervisor, the page, and the Core contract Chat asks for. It shows "not
  connected" until Core publishes the API and `CORE_INVOICES_ENABLED` is set.

**Consequences.**
- PD-8's assignment gains a family-level billing supervisor.
- PD-10 is extended: Operations supervisors read invoice amounts for their own
  families.
- The Teacher Account freeze reopens for the leave balance and leave-request
  state, read-only.
- New Chat → Core events: `teacher.deduction_applied` and `teacher.suspended`.
- A lesson gains `late_minutes`. `admin_cancelled` gains the reasons
  `teacher_leave` and `teacher_suspended`.

**Deprecated behaviour.** None removed. Explicitly **not** built:
- a stored leave counter;
- any deduction amount in Chat;
- any stored copy of invoices;
- a ticket or task entity;
- an automatic disciplinary step.

**Defaults adopted at closing** (the owner may override any of them without reopening
PD-12):
1. The late threshold is **10 minutes** (`teacher.late_threshold_minutes`).
2. The leave year is the calendar year, and unused days do not carry over.
3. Student certificates are issued by **Teachers-department supervisors**.
4. A temporary suspension defaults to **7 days**; the approver may change it.

**Open implementation items** (they do not block this decision):
1. Whether lateness is also derived from the teacher's join time when a lesson
   runs on a Jawwid call.
2. The certificate types list, from the academic team.
3. Core's invoice read API and its per-child invoice field.

**Closed.** 2026-10-18.

---

**Reconciled 2026-10-19** (owner-approved plan, three parallel workstreams):
PD-11 is the one lessons system; `chat.teacher_day_off` is the one record of
days off; PD-11's `chat.teacher_supervision_entry` is the one timeline (PD-10
extends it); the supervision conversation is ONE per teacher with the whole
Teachers department (`teacher_supervision`), and PD-11's bonus and handover
cards are posted there; the PD-12 certificate flow is the only certificate
model. Implementation record: `docs/admin/pd012-s1.md`.

---

### PD-13 · The Calls page: scheduled calls and call links

**Closed by the product owner on 2026-10-19** (AskUserQuestion, all four
recommended options). Implementation record: `../communication/scheduled-calls.md`.

**Decision.** Admin, parent and teacher get one Calls page in the WhatsApp
layout: search, Upcoming, Favorites and Recent, with four actions. The actions
are Start call, New call link, Select a member (it replaces "Call a number") and
Schedule call. A **scheduled call belongs to exactly one conversation**, either a
1:1 or a group. Several people means picking their group; there is no fan-out
across separate chats and no ad-hoc call group. A **call link is members-only**.
It is a joinable scheduled call that starts now. No guest can use it, and nobody
is rung until someone taps Join.

**Canonical rule.** A scheduled call grants nothing.
- Scheduling one requires the right to *start* a call in that conversation at
  that moment, the same `decideInitiate` that `POST /calls` uses. So nobody
  schedules a teacher↔parent 1:1 (PD-7); since PD-19 a parent may schedule a
  call in their own group.
- Seeing one requires reading its conversation.
- Joining one runs `CallService.start` or `accept`, which decide again from
  scratch.
- Its card is an ordinary published `card` message in that conversation, so
  every member sees it and is notified by the normal message push.

**Settled by existing rules, not by this decision:**
- Search is by name only, never by phone number (G-07).
- Calls are voice only (G-32).
- Favorites are the pinned conversations, the existing per-actor preference.
- "Select a member" offers only conversations the user can already reach. There
  is no directory of strangers.
- Photos are initials, except for staff.

**Implementation phase.** Delivered 2026-10-19 on `claude/calls-page-pd13`, which is
built on PR #56's branch, the Admin Web call stack. It covers migration
`20261020090000_chat_scheduled_call.sql`, `apps/api/src/scheduled-calls/*`, the
Admin Web `/calls` page and the Flutter Calls tab. The Flutter Calls tab was
reopened by explicit authorization; record
`../release/REOPEN-W8W2-W7-CALLS-PAGE-2026-10-19.md`.

**Consequences.**
- A join window opens 10 minutes before the start and closes 2 hours after it.
- Joins are serialized per scheduled call, so two simultaneous Joins make one call.
- Only the creator cancels, and a cancellation posts its own card. Cards are
  written once.
- Not built yet: reminder pushes before the start, and editing or rescheduling
  (cancel and create a new one).

**Deprecated behaviour.**
- The Calls tab's "no new-call button" rule (W8-W2, `calls_screen.dart`) is
  retired for the Calls tab only. A call still starts only where the backend
  authorizes it.
- The Admin Web `calls` section placeholder is retired.

### PD-14 · Messages publish immediately; admins moderate after sending

**Closed by the product owner on 2026-10-20** (owner request: "admins are not
required to approve or reject messages before they are sent … admins must retain
the ability to edit or delete messages after they have been sent").

**Decision.** No message is held for approval. Every message, from every role
(parent, teacher, staff) and in every conversation type (Student Group, family
group, class group, 1:1), is published the moment it is sent. Moderation happens
**after** sending: an admin in charge of the conversation may edit or delete for
everyone a message someone else wrote.

**Canonical rule.** One function decides who moderates whom:
`AuthorizationService.moderatableAuthorKinds(actor, basis)`, where `basis` is the
PD-8 scope basis (`chat.staff_conversation_access`) for that conversation, now.
- Teachers' and parents' messages: any staff basis. That is the children's
  supervisor, their active backup or department manager, the super admin, or the
  staff party of a 1:1.
- Another staff member's messages: the department manager or the super admin
  only. A supervisor never rewrites a colleague.
- System messages and cards: never. They are records.
- A moderator has **no time window**. An author editing or deleting their own
  message keeps the author's window (15 minutes).
- An edit is still only of a published **text** message. A voice note, image or
  file is deleted, not edited.
- A moderator must still be able to write in the conversation: the same
  `canSend` decision a send takes.
- Every edit writes a `chat.message_revision` row naming **who** edited and
  keeping the replaced wording. The audit row says `edited by group admin
  (PD-14)`. An admin's edit is never passed off as the author's.

**Implementation phase.** Delivered 2026-10-20 on
`claude/messaging-remove-approval-8cb7e3`. It covers:
- migration `20261020400000_chat_pd014_no_preapproval.sql`;
- `AuthorizationService.canSend` (always publishes);
- `MessageService.send` (the hold branch is gone), `edit` and
  `deleteForEveryone`;
- `viewerModerates` on `GET /conversations/:id`;
- the Admin Web message menu.

**Consequences.**
- Every existing conversation's `teacher_requires_approval` /
  `parent_requires_approval` is set to false, and both default to false. The API
  no longer reads them. `viewerRequiresApproval` is always `false` and is kept
  only for older clients.
- Messages **already pending** at the migration are neither published nor
  deleted: nobody reviewed them. Nothing new joins the queue.
- **The Approve / Reject buttons are removed from Admin Web** (owner request,
  2026-10-20, after the system-test backlog was approved). Admin Web neither
  reads the queue nor listens for `approval.*` events. The `/approvals/*` API
  routes remain, unused by any client, so an operator can still decide a
  pre-PD-14 message that is left anywhere.
- A message approved before PD-14 may now be edited like any other (the
  database floor `chat.forbid_message_rewrite` no longer refuses it).
- Teachers and parents see an admin's edit as "Edited", exactly like an
  author's.

**Deprecated behaviour.**
- Group pre-approval (PRD moderation, `admin-contract.md` "Approval queue") is
  retired, including the per-group approval flags and the
  `approval.student_group_*_default` configuration.
- "An approver can never edit a message" (`admin-contract.md`,
  `20261020130000`) is superseded. Admins edit after sending, and every edit is
  recorded.
- PD-9 default 1 ("a report card bypasses Student Group moderation") is moot.
  Nothing is held.

### PD-15 · The student's journey after enrolment

**Closed 2026-10-21** by the product owner.

The owner's requirements of 2026-10-21 run from the New Students page to the
teacher's month: the Operations manager assigns the responsible supervisor;
the supervisor opens the family's permanent group with the parent and the
teacher; the teacher reports every lesson from the group's "+"; supervisors
record student and teacher excuses there; make-ups follow any apology; and
Teacher Statistics account for every scheduled lesson. Owner answers given the
same day: a child's age, course and package are **entered by the supervisor**
(Core sends none); the parent **sees the report card** (PD-9 unchanged) but
not the teacher's private note; outcome corrections belong to the **Teachers
department, the Operations department and the super admin**, with a mandatory
reason; a teacher edits their own report, supervisors (same three) edit any,
and **only supervisors delete** one, choosing at deletion to **resend a
corrected version or leave it unsent** — and a report left unsent removes its
lesson from **every** statistic; make-ups are scheduled **after either
apology**, once the family and the teacher agreed, and **Chat is the source of
truth** for all of it.

**Final decision.**

```
the lesson is still the unit (PD-9): one row, exactly one outcome, statistics
are queries over the rows -- nothing here is a second lesson record

student excuse   = outcome student_apology + apology_timing
                     before_start  the family (with its reason) or the child's
                                   supervisor (no reason) before the start
                     after_start   the supervisor after the start: excused AT
                                   ONCE (a late_apology ruling recorded decided);
                                   the reason is internal, never on the card
                                   (a family's own late apology still waits for
                                   a ruling, PD-11)
teacher excuse   = teacher_apology, by the teacher or a supervisor; the reason
                   is internal; the card says only that a make-up follows
make-up          = owed after a teacher's OR a student's apology; recorded once
                   the time is agreed (parent: from free times; teacher and
                   staff: any agreed time not on a day off); linked by
                   makeup_for; completed only when itself held
correction       = from, to, reason, who, when (chat.lesson_correction); the
                   database accepts an outcome change only with one written in
                   the same transaction
report change    = a revision (chat.lesson_report_revision) holding the previous
                   version; the card is rewritten in place (edit) or deleted and
                   reposted (resend); "leave unsent" voids the lesson
voided           = final; counted nowhere -- not scheduled, not pending
```

* **Who may do what.** Teacher: their own lesson's report and absence, their
  own apology, a make-up time they agreed, editing their own report. The
  child's supervisor (Operations — the PD-8 supervisor, their active backup,
  the Operations manager): student excuses before / after the start, teacher
  excuses, make-ups, corrections, editing and deleting reports, the child's
  enrolment details. The Teachers department and the super admin: the same,
  plus everything PD-11 gave them. A parent: their own apology, late apology
  and make-up booking, and nothing on the record. Staff work in Admin Web; the
  app is for parents and teachers.
* **Counting (monthly, `stats.zone`).** Total scheduled = every lesson that
  still stands (moved, paused and voided lessons excluded). Conducted =
  student attended = held, regular plus make-up (completed.total). Student did
  not attend = absent without an excuse. Student excuses split before / after
  the start. Teacher excuses are never conducted. Pending = no final outcome
  yet (to come, or awaiting a report). Every lesson is in exactly one line; a
  corrected one moves line, it is never counted twice.
* **The quick report.** Lesson number (suggested), what was covered (topic
  choices and/or a short line — one is required), the performance as one of
  five levels, what is needed next (choices and a short line), a private note
  for supervisors. The codes are `apps/api/src/lessons/report-vocab.ts`; the
  academic team may change the lists.
* **The group.** A family group is named "Teacher — Child · Child" by default.
  Its details page shows each child apart: age (from the date of birth), course
  (from the academy's course list, kept by the Operations manager), weekly
  lesson times (the PD-11 regular times) and package (total lessons).
* **The discipline ladder (PD-12).** A teacher excuse is a violation from the
  moment it is written, whoever records it. A correction away from it
  withdraws an undecided violation; a decision already taken stays on record.

**Implementation phase.** Built 2026-10-21 in one change: migration
`20261021120000_chat_pd015_student_journey.sql`, `LessonRecordService`,
`EnrollmentService`, `JourneyController`, Admin Web `features/journey`, the app's
`lesson_report_sheet.dart` and `group_children_section.dart`. It runs after the
trial journey's `20261021100000` and rebuilds `chat.guard_lesson` and
`chat.assert_held_lesson_has_report` on top of that migration's versions. The
supervisor is assigned on Organization → Children and the group is created in
Chat: the New Students page lists Sales' subscription forms (#83), whose
children are not Chat learners yet.

**Consequences.**
- PD-11's table gains the supervisor: `apology`, `teacher_apology`,
  `book_makeup`, plus `late_excuse`, `correct_outcome`, `edit_report`,
  `delete_report`, `manage_enrollment`. The PD-8 supervisor's lesson standing
  is no longer read-only.
- A written outcome now has two lawful changes: an excusing ruling (PD-11) and
  a recorded correction. A report is no longer write-once; it changes only
  through a revision.
- `lesson.closed` is emitted again, with `correction: true`, after every
  correction and every void, so Core's billing follows.
- PD-11 T2's "a make-up after a student apology waits for the notice rule" is
  superseded: a make-up is owed after any apology. The follow-up queue still
  escalates only the teacher's misses.
- A report card cannot be removed with "delete for everyone"; only the lesson
  record deletes it, so the chat and the statistics never disagree.

**Deprecated behaviour.** The teacher's reason no longer reaches the family's
card. The free-text-only report form is replaced by the quick report.

**Defaults adopted at closing** (the owner may override without reopening
PD-15):
1. A supervisor's excuse before the start needs no reason; after the start it
   needs one (internal).
2. A teacher excuse may be recorded before the start only; after the start a
   missed lesson stays the Teachers department's `teacher_no_show` (PD-11).
3. An excuse after the start is accepted for 48 hours (the late-apology
   window); later, the lesson is corrected instead.
4. A voided lesson is final; it cannot be corrected back.
5. The report's topic and next-lesson lists are a starting set for a Quran and
   Arabic academy.

**Closed.** 2026-10-21.

---

### PD-16 · Enrolling a new student in Chat; the parent's own sign-up

**Closed 2026-10-21** by the product owner.

The owner's request of 2026-10-21: an **Assign** action on the New Students
page lets the Operations Manager assign students to their supervisors; an
assigned student is visible only to the responsible supervisor; that
supervisor creates the group chat between the parent and the teacher. Owner
answers the same day: **Chat creates the family, the parent and the children**
from Sales' subscription form (Chat becomes the source of truth for the
enrolments it makes, as it already is for trials); the entry stays visible to
**the supervisor and their manager** (the Operations manager) and the super
admin; the parent **downloads the app and signs up with the e-mail they gave
the academy**, proving it with a **one-time code delivered on WhatsApp** — and,
until a WhatsApp sender is connected, **relayed by the supervisor** (the owner
rejected e-mail delivery: a full inbox would block it).

**Final decision.**

```
Assign (Operations manager | super admin)            one transaction
  family            owner = the supervisor (PD-8 grants nothing by owner)
  parent (contact)  + account: subject = the e-mail, kind family, NO password
  each child        chat.enrol_learner -- the teacher Sales chose (the third
                    writer of learner.teacher_id), learner_supervision, the
                    course (matched or added to the course list), stated age
  the form          frozen: never edited nor withdrawn afterwards
  weekly times      from the form, where the teacher is free (best effort)

visible           unassigned: Sales, the Operations manager, the super admin
                  assigned:   the children's supervisor (+ active backup), the
                              Operations manager, the super admin

Create group      the responsible supervisor: family group (parent, teacher(s),
                  supervisor), named "Teacher — Child · Child" (PD-15), and the
                  parent's direct chat with the supervisor

sign-up           e-mail -> 6-digit code (10 min, 5 tries, one live, hashed)
                  delivery 'relay': the supervisor reads it on New Students and
                  sends it on WhatsApp; -> the parent sets a password -> signs
                  in through POST /auth/login like anyone else
                  same answer for any e-mail; metered by the login limiter
```

* **The phone stays confined (G-07).** The form's phone is copied onto nothing
  Chat creates; a future WhatsApp sender reads it inside `src/new-students`.
* **No public registration.** Only an account Chat created at enrolment, with
  no password yet, can be claimed — never staff, teachers or strangers.

**Implementation phase.** Built 2026-10-21: migration
`20261021140000_chat_new_student_enrolment.sql`, `NewStudentEnrolmentService`
(`src/new-students`), `ParentSignupService` / `ParentSignupController`
(`/auth/signup/*`), Admin Web `trials/NewStudentSetup.tsx`, the app's
`parent_signup_screen.dart`.

**Consequences.**
- §1.1's CRM-boundary row changes: Core is no longer the source of truth for
  students, parents and enrolments Chat enrolled itself.
- PRD §7.1 ("no registration in the MVP") is narrowed: a parent may set the
  password of an account the academy created, with a relayed one-time code.
- The New Students page is filtered per viewer; an Operations supervisor sees
  only the students assigned to them.

**Deprecated behaviour.** None removed.

**Defaults adopted at closing** (the owner may override without reopening
PD-16):
1. The code lives 10 minutes and allows 5 tries; a parent may ask for 5 codes
   an hour.
2. A regular lesson lasts as long as the trial did (30 minutes when unknown).
3. A family is named after the parent; the account's e-mail is the one Sales
   recorded unless the Operations manager types another at Assign.

**Open implementation items.**
1. Connect a WhatsApp sender (Meta WhatsApp Cloud API or a provider such as
   Twilio Verify): business account, number and an approved authentication
   template. Delivery then switches from `relay` with no change to the flow.
2. A parent who forgets their password has no self-service reset yet.

**Closed.** 2026-10-21.

---

### PD-17 · Parent Profile and Student Profile; family payments recorded in Chat

**Closed 2026-10-21** by the product owner.

The owner's requirements of 2026-10-21: a **Parent Profile** visible to admins
only -- full name, phone, e-mail, number of children, a photo that can be
uploaded or changed, an editable name, a short description, country, emirate
or governorate; and, for admins only, a payment timeline, the current
subscription and the payment method (invoice or bank transfer). A **Student
Profile** visible to admins and the student's assigned teacher only -- photo,
name, age, class schedule, assigned teacher, enrolled course. Enforced in the
frontend AND the backend, so a teacher reaches no parent profile and no
payment information even by a direct API request. Owner answers given the
same day: "admins" are **the Instalment Payments rule**; **payments and
instalment plans are implemented in Jawwid Chat**, because nothing may be
retrieved or reused from Jawwid Core; the current subscription is **one
family plan**; the short description is **an internal note** the parent never
sees. Later the same day: **parents see their own payments in the app**, and
**the Operations and Sales teams record payments**.

**Final decision.**

```
who opens a Parent Profile    = who reads a family's money (billingAccessOf):
  (and its money)               the super admin and the Operations Manager every
                                family; an Operations supervisor / coverage the
                                families they reach (PD-8); the Sales department
                                every family. Nobody else -- never a teacher, the
                                Teachers department, or a parent.
who records money             = the same people: Operations (in scope), Sales,
                                the super admin.
who edits the contact record  = Operations (in scope) and the super admin; Sales
                                reads it only.
a parent's own payments       = GET /me/billing, the app's Settings > Payments: every
                                active parent of the family (owner, later the same
                                day: "both parents"). Plan, method, every
                                instalment that stands; never a voided row, a
                                reason, who recorded it, or the internal note.
who opens a Student Profile   = LESSON_ACTS.read_profile: the Teachers department,
                                the super admin, the child's supervisor (+ backup,
                                manager), and the child's OWN teacher. Not the
                                family (their children are on their own profile).

parent file      = chat.parent_file: phone, e-mail, emirate/governorate, internal
                   note. Admin-only and confined like the Teacher File (G-07).
                   Filled from Sales' form at Assign (PD-16), then edited by admins.
name, photo      = chat.contact.name / avatar_object_key -- the ones every chat shows
country, plan    = chat.family.country_code / subscription_plan_months (1/3/6/12),
                   the columns Stories targeting already reads
payment method   = chat.family_billing: invoice | bank_transfer (+ currency)
instalment       = chat.family_instalment: label, amount (minor units), currency,
                   due date, optional child, optional plan id. Paid ONCE (day,
                   method, reference). Voided, finally, with a reason. Never
                   edited, never deleted -- the database refuses it.
payment timeline = the family's instalments in date order, voided ones included
```

* **A teacher's view.** The Student Profile of their own students: photo,
  name, age, weekly lesson days and times, teacher, course. Never a date of
  birth, a parent, a package or an amount. Another teacher's student is the same
  404 as an id that does not exist. The app has no Parent Profile, and calls no
  `/parent-profiles`, `/families/*/billing` or `/instalments` route.
* **Photos on a profile** are served under a `profile` context that re-applies
  the profile's own rule on every request (AvatarService.registerProfileReader).
  An administrator may change a parent's photo; the bytes are judged exactly as
  when the parent sets it, and the audit row says an administrator did.
* **Audit.** A parent-file edit records which fields changed, never the phone
  or e-mail; money writes record the amount, currency and dates.

**Implementation phase.** Built 2026-10-21 in one change: migration
`20261021150000_chat_pd017_parent_student_profiles.sql` (after PD-16's
`20261021140000`), `src/parent-profile`, `BillingService` on Chat's own rows,
`EnrollmentService.profile`, Admin Web `features/profiles` (Parents, Parent
Profile, Student Profile), the app's teacher-only Student Profile. Workflow and
routes: `../admin/pd017-parent-student-profiles.md`.

**Consequences.**
- PD-10 §1 ("Core stays the source of truth for invoices ... not stored in
  Chat") and PD-12 S3's Core invoice read are superseded for family money:
  `CoreInvoiceSource` is removed and Instalment Payments lists Chat's rows. The
  frozen `chat.subscription` mirror stays frozen; it is not revived.
- Teacher payroll is unchanged: still Core's, read-only (PD-10 §4).
- G-07 has a third deliberate exception, `chat.parent_file.phone`, with its own
  confinement test.

**Deprecated behaviour.** Instalment Payments no longer says "Jawwid Core is
not connected"; `COMM.BILLING_CORE_UNAVAILABLE` is gone.

**Defaults adopted at closing** (the owner may override without reopening PD-17):
1. Sales reads and records money for every family, as Sales takes the
   payment at subscription time; it does not set billing supervisors.
2. A plan is up to 24 instalments, 1 to 12 months apart; a 31st falls on the
   month's last day.
3. A payment is recorded on or before today, never ahead of time.
4. The parent never sees the internal note. Their Payments screen shows only
   what stands (voided instalments are staff history), to every active parent
   of the family; reading is not managing, and payments are recorded by staff.

**Closed.** 2026-10-21.

---

### PD-18 · Teacher payroll in Chat

**Closed 2026-10-21** by the product owner. Supersedes PD-10 item 4.

The owner asked for an administration-only Teacher Profile that includes
salary type, payment method with account details, currency, teaching market,
monthly salary, a financial summary and the bonus and deduction histories.
Asked on the same day, the owner chose: **payroll lives in Chat**; **payout
account details are stored, protected**; **a teacher never sees their own
profile**.

**Final decision.**

1. **Salary terms** (salary type, currency, amount) are recorded in Chat, one
   version per effective month. A change is a new version; earlier months keep
   the terms they had.
2. **Payout account.** The method (e-wallet, InstaPay or bank transfer) and its
   account details are recorded. The details are **encrypted by the server**
   before they reach the database. The file shows the method and the last four
   characters. The details in clear are shown on request, with a reason, and
   every such request is audited.
3. **Amounts.** The super admin sets the amount of each bonus the Teachers
   department records (PD-11) and of each deduction decided on the ladder
   (PD-12), and may add a standalone bonus or deduction. A correction replaces
   an amount; zero cancels it.
4. **Financial summary**, per payroll month: salary + bonuses − deductions =
   net. It is computed on every read, never stored.
5. **Teaching market** is employment information, recorded in the Teacher File
   by the Teachers manager (closes PD-10 open item 1 for the market).
6. **Teacher self-view** is unchanged: never (PD-10).

**Canonical rule — who sees what.** PD-10's table stands, with its finance row
now meaning "recorded in Chat":

| Section | Teachers-dept supervisors and manager | Super admin | The teacher | Anyone else |
|---|---|---|---|---|
| Teaching market, current students | read (manager edits the market) | read + write | — | **never** |
| Bonus and deduction history: date, reason, who | read | read | — | **never** |
| Salary terms, payout account, amounts, financial summary | — | read + write | — | **never** |

* Enforced in the server and the database. No request role has a grant on the
  payroll tables, and only `src/teacher-file` may name them
  (`teacher-file-confinement.spec.ts`).
* The audit trail records what changed and why, **never an amount or an account
  detail**, because the audit trail is read more widely than payroll is.
* Payout details are sealed with AES-256-GCM under `TEACHER_PAYOUT_KEYS`. Without
  the key the server refuses to save or reveal them (503). Payroll **fails
  closed**; nothing is ever stored in clear.

**Defaults adopted at closing** (the owner may override these without reopening PD-18):
1. A **shift-based** salary is a fixed monthly amount. A **per-hour** salary is
   the rate times the hours of the lessons the teacher was there for: held, or
   the student did not come.
2. A bonus or deduction is paid in the payroll month of the record it prices.
   That is the month the bonus was recorded, or the deduction's ladder month.
3. Only the super admin holds the finance tier (PD-10). A separate finance role
   is a new decision.

**Implementation phase.** Built with the decision: migration
`20261021160000_chat_pd018_teacher_payroll.sql`; `docs/admin/teacher-file.md`.

**Consequences.**
- §1.1's CRM row no longer applies to teacher pay. Core may still hold its own
  copy, but Chat's record is the one the academy edits.
- PD-12's rule "Teachers-department staff never see salary or amounts" stands.
- A deployment needs a `TEACHER_PAYOUT_KEYS` secret before payout accounts work,
  and that key must be backed up together with the database backups. Losing it
  loses every saved account.

**Deprecated behaviour.** PD-10's "any stored copy of pay; any write path for
money in Chat" is no longer forbidden for teacher payroll. Chat still **pays
nobody**: it records what is owed and how to pay.

**Closed.** 2026-10-21.

---

### PD-19 · A member may start a call in their own chat (supersedes PD-2)

**Closed by the product owner on 2026-10-21** (owner request: "teachers,
parents, and supervisors [should] have calling permissions within their own
chats … while keeping the existing access rules for other chats unchanged").

**Background.** The call button is drawn only where the server says the viewer
may start a call (`GET /conversations/:id/call-capability`). Measured on the
system-test stack before the change: teachers and supervisors could already
start a call in every chat they belong to; the one member chat with no button
was a **parent in their family group**, refused by PD-2
(`COMM.PARENT_CANNOT_START_GROUP_CALL`).

**Decision.** Whoever may write in a conversation may also start a call in it.
A parent may start a call in their family group, Student Group or Class Group,
as well as in their 1:1 with their supervisor.

**Canonical rule.** `AuthorizationService.canCall` = `canSend` (customer
visibility) + the BR-1 / PD-7 refusal of any direct teacher<->parent pair. No
rule distinguishes starting from joining any more; `CallIntent` stays on the
signature so callers still say which question they ask.

**Unchanged — "the existing access rules for other chats".**
- A person who is not a member of a chat cannot start a call there (D1, the
  no-phantom-call rule). This includes a department manager or an active backup
  reading a chat on a PD-8 basis. (The super admin was in this list until the
  amendment below.)
- BR-1 / PD-7: no direct teacher<->parent chat or call, ever.
- C-4: a group that pairs a teacher with a parent needs a live Jawwid admin in
  it, for a call exactly as for a message.
- A silent member may not start a call.

**Consequences.**
- The parent's app shows the call button in their family group with no client
  change: the button already follows the server's answer.
- Scheduling a call (PD-13) asks the same question, so a parent may also
  schedule a call in their group, and a parent tapping **Join** on a scheduled
  call nobody has started yet starts it.
- `COMM.PARENT_CANNOT_START_GROUP_CALL` is no longer issued. The code stays in
  the error vocabulary so clients that still map it keep working.
- Protected by `apps/api/test/unit/authorization/pd019-member-may-start-call.spec.ts`,
  which replaces the PD-2 file and pins both the new permission and the limits
  above.

**Deprecated behaviour.** PD-2's start-only refusal for parents.

**Closed.** 2026-10-21.

**Amendment, 2026-10-21 — the super admin may call too** (owner request: "let
the super admin call too").
- The super admin may start a **group** call (family group, Student Group,
  Class Group) in any chat they may write in under PD-8, member or not.
- They get a **seat on the call**, not membership of the chat: the server adds
  them as a call participant, so the caller is on the call they start. That
  is what D1 exists to guarantee. The chat's member list does not change.
- A **1:1 between two other people** stays refused: a direct call has exactly
  two seats, and the database enforces it. The super admin's own 1:1 chats work
  as for anyone.
- Department managers and active backups are unchanged: no seat, no call, in a
  chat they are not a member of.
- Protected by the D1 block of
  `apps/api/test/integration/staff-call-participation.spec.ts`.

**Second amendment, 2026-10-22: calls in the trial group and the supervision
conversation** (owner answer: "Allow + super admin").
- **The defect.** A teacher's trial group (PD-11 T4) and their supervision
  conversation (PD-11 / PD-12) seat the teacher with several staff. The call
  button was offered there, but the server typed those calls as **direct**,
  and the database refuses a direct call with more than two participants, so
  every start failed with a server error. The capability check and the start
  disagreed.
- **Decision.** Calls are allowed there, and they are **group** calls. Any
  member may start one (the teacher, a Teachers-department member, or a Sales or
  Operations supervisor who has joined the trial group).
- The super admin may start one there without being a member, with **a seat on
  the call**, as in the first amendment. The chat's member list does not change.
- **Unchanged.** Someone who may write in these chats without being a member
  (for example a Sales supervisor who has not joined a trial group), a
  department manager or an active backup still may not start a call (D1). A
  direct call still has exactly two seats. C-4 is unaffected: no family contact
  can be a member of either chat.
- **Canonical rule.** `GROUP_CALL_CONVERSATION_TYPES` (in
  `apps/api/src/communication/contracts/vocab.ts`) decides a call's type and
  the super admin's seat. It is the family-facing groups plus `trial_group` and
  `teacher_supervision`. `GROUP_CONVERSATION_TYPES`, which drives C-4 admin
  presence, does not change.
- Protected by `apps/api/test/integration/call-staff-group-chats.spec.ts` and
  `apps/api/test/unit/authorization/call-seat-group-call-types.spec.ts`.

---

### PD-20 · The Sales team in the app

**Closed 2026-10-22** by the product owner. Amends PD-15 ("staff work in Admin
Web; the app is for parents and teachers") for the Sales department only.

The owner asked to "let Sales see the Payments in the app too". Staff could not
sign in to the app at all. Owner answers the same day: Sales **views and records**
payments in the app (as in Admin Web: record a payment once, void a mistake with
a reason; instalment plans stay in Admin Web), and also gets **Chats and Calls**.

**Final decision.**

```
who signs in          = a parent, a teacher (unchanged), or a Sales-department
                        staff member whose staff role is a conversation role
                        (admin, coverage, manager). GET /lessons/access says
                        `sales`. Since the amendment below, also the super
                        admin. Every other staff member is still sent to
                        Admin Web.
Sales tabs            = Chats, Calls, Payments, Settings
Chats                 = what the server already shows Sales (every trial group,
                        their own directs and supervised groups); trial groups
                        list as groups; an internal note is labelled as one
Calls                 = the server's call capability, unchanged: only a live
                        member starts a call (D1), so a Sales viewer first joins a
                        trial group from the app ("Join this group")
Payments              = search families (GET /parent-profiles?q=), a family's
                        timeline (GET /families/:id/billing), record a payment
                        (POST /instalments/:id/payment), void with a reason
                        (POST /instalments/:id/void) -- PD-17's rules, server-side
```

* **No contact channel in the app.** The app never calls a Parent Profile's
  detail route, so it never holds a parent's phone or e-mail (G-07, the
  Contact File rule). A guard test confines the payment routes to the Sales
  payments feature and fails on any parent-profile detail path anywhere in the
  app.
* **The server is unchanged** and remains the control: every route Sales uses
  in the app is the one Admin Web already uses, with the same refusals.
* A staff account the app refuses is now signed out on the server too (no
  orphaned session).

**Implementation phase.** Flutter only: `UserRole.sales`, the Sales shell, the
`sales_payments` feature, trial groups as groups, internal-note labels, Join this
group.

**Consequences.** PD-15's sentence holds for every other staff role. Adding
another department to the app is a new decision.

**Deprecated behaviour.** "Staff accounts use the Jawwid console" no longer
applies to Sales.

**Defaults adopted at closing** (the owner may override without reopening PD-20):
1. ~~The super admin keeps using Admin Web; the app does not admit it as Sales.~~
   Overridden the same day, see the amendment.
2. Composing an internal note from the app is not offered.

**Amendment, 2026-10-22: the super admin signs in too** (owner: "let owner sign in
with the Sales tabs"). The organization's `super_admin` signs in to the app with the
same tabs (Chats, Calls, Payments, Settings), labelled "Super admin" / "المدير العام".
No department is needed: the server already serves it every conversation, family
and payment of the organization. It is not offered "Join this group": it may start a
group call without a seat in the chat (PD-19 amendments). Admin Web's administration
pages (Organization, Teacher Files, discipline, the Admin Portal) are not in the app.

**Closed.** 2026-10-22.

---

### PD-21 · Account administration: password reset, inactive accounts, impersonation

**Closed by the product owner on 2026-10-22** (owner request: admins, the super
admin included, may impersonate a student's account, reset another account's
password, and set any account inactive; permissions enforced on the backend,
every action in the audit log, existing account security preserved). The plan
was reviewed before any change; the owner answered four design questions.

**Background.** Students have no login: a learner has no account, and the PRD
defers student login (row 8, "one parent login, all children"). The family
(parent) account holds the children. `users.manage`
(`../architecture/AUTHORIZATION-MODEL.md` §3) — suspend, reset credentials,
revoke sessions — was the super admin's alone, and no route served it.

**Decision.**
1. **Who.** Every staff role (admin, coverage, manager, finance, technical,
   academic, super admin), organization-wide, on any **parent or teacher**
   account. A **staff** account only by the super admin. **Nobody** acts on the
   super admin's account (the bootstrap CLI stays its only credential writer)
   or on their own.
2. **Password reset.** The administrator never sees or chooses a password. They
   issue a **one-time 6-digit code** (10 minutes, 5 tries, only its hash
   stored), shown to them once, and pass it on by hand. The person enters their
   login, the code and a password of their own (`POST /auth/password-reset`,
   public, rate-limited like login). Completing it sets the password, clears
   the lockout and **ends every session of the account**. The administrator may
   also sign the account out everywhere at issue time (a compromised account).
3. **Inactive.** "Set inactive" is `chat.account.status = 'suspended'`
   (reversible). The account is signed out everywhere at once — sessions
   revoked, sockets cut, call rooms and scheduled notifications cleaned up
   (RT-032) — and every login answers `AUTH.ACCOUNT_DISABLED`. Reactivation
   returns it to active; **no earlier session or refresh token comes back**.
   `deactivated` (offboarding) is never reversed from here.
4. **Impersonation** ("support session"). Of **parent and teacher** accounts —
   never a staff account. Messages sent while impersonating are **allowed but
   labelled** to recipients as sent by support on the person's behalf. Every
   support session records the administrator, the target, the reason, the start
   and the end, and every action taken; it is short-lived and ends with the
   administrator's own session. Calls, receipts and anything else that would act
   in the person's name unlabelled are refused in a support session (record:
   `../admin/pd021-account-administration.md`).

**Canonical rule.** `AuthorizationService.canAdministerAccount(actor, target,
act)` decides all four acts; `AccountAdminService` asks it before it reveals or
changes anything. The database states the same rule for reset codes
(`chat.guard_password_reset_code`), and reactivation is server-side only
(`chat.reactivate_account`). Every act writes `chat.audit_log` in its own
transaction with the administrator as actor and their reason.

**Consequences.**
- Admin Web: an **Accounts** page for every staff role (search by the person's,
  the family's or a child's name); "Forgot your password? I have a reset code"
  on the sign-in page. The mobile app has the same reset screen.
- Departments (finance, technical, academic) gain one page: Accounts.
- Supersedes the super-admin-only scope of `users.manage` for these acts.
- Record: `../admin/pd021-account-administration.md`.

**Deprecated behaviour.** `users.manage` as a super-admin-only key for reset and
suspension. PRD §7.1's "temporary password" wording: the administrator issues a
code, never a password.

**Closed.** 2026-10-22.

---

### Decisions still open after PD-1 to PD-21

None at the decision level. PD-8 is recorded in `../architecture/ORG-SCOPE-PD8.md`.
The implementation items left open inside PD-9, PD-10, PD-11 and PD-12 are settled when their
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
