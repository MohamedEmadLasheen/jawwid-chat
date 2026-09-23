# Jawwid Chat — Authorization Model (roles, permissions, scope)

Status: **CANONICAL** · Locked in Phase 0 (2026-09-07) · Implemented in Phase 1
Product decisions PD-2, PD-3, PD-5 and **PD-6** are CLOSED; the record is `../product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4.
**PD-6 (2026-09-23) re-versioned BR-1**: direct Parent ↔ Teacher chat and calls are allowed for an *authorized relationship*. See §4.1.
Companions: `IDENTITY-MODEL.md`, `SUPERVISOR-OWNERSHIP.md`, `TENANCY-MODEL.md`,
`../security/RLS-STRATEGY.md`, `../contracts/API-CONTRACT.md` §1.2.
Supersedes: `docs/qa/rbac-matrix.md` role vocabulary (known wrong — no `super_admin`),
the role migrations on `archive/phase0/integration/prd-reconciliation` (`ee0dcdd`) and
`docs/recovery/evidence/uncommitted/ai4-…rbac_canonical_roles.sql` (both inputs, neither applied).

---

## 1. Principles

1. **Server-side authorization is authoritative. Client-side permissions are UX only.**
   Admin Web's `capabilities.ts` and Flutter's `communication_policy.dart` may
   hide affordances; they decide nothing.
2. **One decision point.** `apps/api/src/platform/authorization.service.ts` is
   where every read, send, membership change, approval and call is decided. It
   is preserved and extended — never replaced by scattered guards. Guards
   authenticate (Phase 1); services call `AuthorizationService`; the database
   backstops the constitutional rules (BR-1, family scope, tenancy).
3. **Scope before role.** A role says *what kind* of action an actor may take;
   scope says *on which records*. Both must pass. Today scope is the missing
   half (§6).
4. **Fail closed.** Any decision that cannot be established (unknown actor,
   unresolvable membership, no live admin, client-supplied mode) is a denial.
   (`JC-005`, `C-4`.)
5. **Permissions are data, not code.** The role → permission mapping lives in
   one table and one TypeScript constant kept in sync by a test. Adding a
   permission is a migration + a mapping row, not a new `if`.

---

## 2. Roles (canonical vocabulary — PRD §3, decision PD-5, **CLOSED 2026-09-07**)

PD-5 is closed: `super_admin` exists from day one, and departments are not roles.
The four staff roles are `super_admin`, `manager`, `admin`, `coverage_admin`.
The legacy vocabulary `coverage | finance | technical | academic` must not be
restored.

| Role | Kind | Platform | Definition | Today's value |
|---|---|---|---|---|
| `parent` | contact | mobile | A family contact who may message (`contact.can_message`) | member_role `parent` |
| `student` | context only | — | Exists as a learner record; no login in MVP | — |
| `teacher` | teacher | mobile | Teaches learners; communicates with a family inside Student Groups (live admin required, C-4) **and** 1:1 with an *authorized* parent (BR-1 as re-versioned by PD-6, §4.1) | synthesized (fixed in Phase 1) |
| `admin` | staff | web + mobile | A **supervisor**: the assigned owner of families; answers their conversations; moderates their groups | `staff.role='admin'` |
| `coverage_admin` | staff | web + mobile | A supervisor acting for others for the duration of an explicit temporary assignment (PD-3), with the owner's permissions on that family and nothing more | `staff.role='coverage'` → **rename** |
| `manager` | staff | web | Runs the operation: assigns supervisors, reads audit, edits settings, sees every family in the organization | `staff.role='manager'` |
| `super_admin` | staff | web | Organization owner: everything a manager can, plus user management, credentials, and (later) organization settings. Named `super_manager` in the Phase 0 brief; the PRD name is canonical. | absent → **add** |
| `system` | actor kind | — | Automation author (system messages, reminders); never a role a person holds | actor kind |

Not roles: `finance`, `technical`, `academic` (brief-era departments). They
become `chat.staff.department` (nullable attribute used for routing only);
existing rows keep their legacy value until the Phase 1 migration moves it.
`observer` is a *member role* on a conversation (silent presence), not a staff
role.

Family-facing staff (may take part in family conversations): `admin`,
`coverage_admin`, `manager`, `super_admin`.

---

## 3. Permission keys

| Key | Meaning | parent | teacher | admin | coverage_admin | manager | super_admin |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `conversations.read` | list/read conversations in scope | ● | ● | ● | ● | ● | ● |
| `conversations.manage` | create student groups, add/remove members, archive | | | ● | ●¹ | ● | ● |
| `messages.read` | read messages in a readable conversation | ● | ● | ● | ● | ● | ● |
| `messages.send` | post in a conversation | ●² | ●² | ● | ●¹ | ● | ● |
| `messages.delete` | delete for everyone beyond the author window | | | | | ● | ● |
| `messages.moderate` | approve / reject held group messages | | | ● | ●¹ | ● | ● |
| `messages.internal` | read/write internal (staff-only) notes | | | ● | ● | ● | ● |
| `families.read` | read family, learners, contacts (no channels) | own³ | via groups³ | ● | ●¹ | ● | ● |
| `families.assign` | assign / reassign the supervisor | | | | | ● | ● |
| `contacts.view_private` | reserved for future private fields; nothing today | | | | | ● | ● |
| `calls.start` | start a call in a readable conversation | ●⁴ | ● | ● | ●¹ | ● | ● |
| `calls.accept` | join/answer a call one is invited to | ● | ● | ● | ● | ● | ● |
| `broadcasts.send` | send official messages (Phase 2) | | | | | ● | ● |
| `audit.read` | read audit log | | | | | ● | ● |
| `settings.manage` | edit `chat.config` | | | | | ● | ● |
| `users.manage` | provision/suspend/deactivate accounts, reset credentials, revoke others' sessions | | | | | | ● |
| `sessions.manage` | list/revoke own sessions | ● | ● | ● | ● | ● | ● |

¹ only on families with an active **explicit temporary assignment** to the coverage admin (PD-3; scope, §6). A shift schedule is not an authorization input.
² in `student_group`/`class_group`, held for moderation by default (`conversation.parentRequiresApproval` / `teacherRequiresApproval`); refused entirely when no live admin is present (C-4).
³ a parent reads only their own family; a teacher reads only the families of learners they teach, through the group.
⁴ **PD-2, CLOSED 2026-09-07.** A parent may start a 1:1 call to their handler, and may JOIN a Student Group or Class Group call, but may **never initiate** one. Group calls are initiated by a teacher or by admin / authorized staff. Enforced by `canCall`'s `CallIntent` parameter, which defaults to the stricter `initiate`; denial code `COMM.PARENT_CANNOT_START_GROUP_CALL`. Protected by `apps/api/test/unit/authorization/pd002-group-call-initiation.spec.ts`.

The table is the *default* mapping. Phase 1 stores it in `chat.role_permission`
(`role`, `permission`) seeded by migration, exposes it through `GET /config`
for UX, and asserts the TypeScript mirror equals the table in a protected test.

---

## 4. Decision surface (what `AuthorizationService` answers)

| Method | Exists | Decides | Extended in Phase 1 by |
|---|---|---|---|
| `canOpenDirect(a, b, pairing)` | ✔ | closed allow-list of direct pairs (Parent↔Admin, Teacher↔Admin); Teacher↔Parent allowed **only** when `pairing` says the relationship is authorized (PD-6, §4.1) | tenancy check |
| `canRead(actor, conv, membership)` | ✔ | contacts/teachers must be live members; staff must be family-facing | **scope**: staff must be within supervisor scope of `conv.familyId` (§6); managers see the organization |
| `canReadInternal(actor)` | ✔ | staff only | unchanged |
| `canSend(actor, conv, membership, intent, now, familyOwnerId, participantKinds, liveMembers)` | ✔ | read → silence → C-4 admin presence → moderation policy for parents/teachers; ownership/coverage/stickiness → on-behalf mode for staff; assist/escalation fail closed (JC-005) | routing reads the **assignment** rather than `family.owner_id` + `on_duty()` (see `SUPERVISOR-OWNERSHIP.md` §6) |
| `canManageMembership(actor)` | ✔ | staff only | scope + permission key |
| `canApprove(actor, activeHandlerId)` | ✔ | active handler or manager | queue **listing** must also be scoped (§6) — today `approval.service.ts:45-61` lists every pending approval in the system |
| `canCall(actor, conv, membership, participants, now, familyOwnerId, liveMembers, intent, pairing)` | ✔ | read + authorized-relationship check on a direct teacher/parent pair (PD-6) + C-4 + **PD-2** (a parent may join a group call, never start one) | scope; the PD-2 rule is already implemented |
| `can(actor, permission, scope)` | ✘ | generic permission-key check for the new admin surface (families, assignment, staff, audit, config) | **new** — the single entry point for Phase 1 controllers |
| `visibleFamilies(actor)` / `visibleConversationsWhere(actor)` | ✘ | the *query predicate* for lists, so every list endpoint is scoped by construction | **new** |

Contract rule: every new endpoint calls exactly one of these; controllers never
compare roles.

### 4.1 The teacher–parent relationship predicate (PD-6)

BR-1 used to be decidable from two `Actor` objects: `contact + teacher` was
refused, full stop. Since PD-6 the decision depends on a *relationship*, which
lives in the database. That would ordinarily force `AuthorizationService` to
take a database dependency and destroy the property that makes it testable —
every one of its unit tests runs without a database.

It does not, because the relationship is resolved **before** the policy runs and
handed in as a plain fact:

```
RelationshipService.teacherParentAuthorized(teacherId, contactId) : boolean
        │   reads chat.contact → chat.family → chat.learner → chat.teacher
        ▼
ConversationService / CallService            (resolve the fact)
        ▼
AuthorizationService.canOpenDirect / canSend / canCall   (decide on the fact)
```

The predicate:

```
authorized(contact C, teacher T) :=
  ∃ learner L :  L.family_id  = C.family_id
              ∧  L.teacher_id = T.id
              ∧  C.is_active ∧ C.can_message
              ∧  T.is_active ∧ T.left_at IS NULL
              ∧  C.organization_id = T.organization_id
```

Three properties this design has to keep, each with a test:

1. **Client input is never evidence.** `parent_id`, `teacher_id` and
   `conversation_id` from a request are lookup keys. The predicate reads only
   rows synchronized from Jawwid Core.
2. **It is re-evaluated, not cached.** Every send, every call start and every
   media-token issue resolves it again, so a relationship revoked in Core is
   refused on the next operation even mid-call.
3. **The database enforces it independently.** `chat.teacher_parent_authorized()`
   is the same rule in SQL, reached by the existing deferred constraint
   triggers, and holds with the application entirely bypassed.

`AuthorizationService` itself gains no database access, no Prisma import and no
`async` work of its own. Fail-closed still applies: an unresolvable relationship
is `false`, which denies.

---

## 5. Known authorization defects carried into Phase 1 (verified)

| ID | Defect | Where | Fix |
|---|---|---|---|
| A-1 | Staff visibility is blanket: any family-facing staff reads **every** conversation (`canRead` returns `allow()` for staff; `listForActor` returns `take: 200` of all conversations) — RT-011 | `authorization.service.ts:134-142`, `conversation.service.ts:423-440` | scope predicate (§6) |
| A-2 | Moderation queue is globally visible: `GET /approvals/pending` lists all pending approvals unless a `conversationId` is supplied | `approval.service.ts:45-61` | scope predicate on `conversationId ∈ visible conversations` |
| A-3 | Ownership is used for attribution (`deriveMode`) but not for visibility | `authorization.service.ts:318-333` | `canRead` consults assignment |
| A-4 | Roles hard-coded: `StaffRole` and `FAMILY_FACING_STAFF_ROLES` in `contracts/vocab.ts`, `CHECK` in `chat.staff.role` | `vocab.ts:17-36`, `090200:20` | role table + migration (rename `coverage`, add `super_admin`, move departments) — **PD-5, closed** |
| A-5 | No `super_admin` | everywhere | as above; Admin Web's "has no super_admin" test is KNOWN WRONG and is replaced. **PD-5 closed: it exists from day one.** |
| A-6 | Three routes take no actor at all | `conversation.controller.ts:36`, `notification.controller.ts:21,28` | `AuthenticatedGuard` + scope |
| A-7 | Receipt roster disclosed to contacts (staff ids, read times) — RT-012 | `dto.ts` `toMessageDto` | viewer-scoped receipts |
| A-8 | Object-level authorization absent on `signUrlsForMessages` — RT-006 | `attachment.service.ts` | actor parameter + `canRead` |
| A-9 | Authorization computed outside the acting transaction — RT-014 | services | re-check inside `$transaction` where state can change |
| A-10 | Realtime actor cached for the socket lifetime — RT-009 | `realtime.gateway.ts` | re-validate on heartbeat; drop on revocation |

---

## 6. Scope (the missing half)

Scope is derived from `SUPERVISOR-OWNERSHIP.md`:

```
visible_families(actor) =
  parent          → { family of the contact }
  teacher         → { families of learners where learner.teacher_id = teacher }
  admin           → { families currently assigned to actor }
                    ∪ { families with an active temporary assignment to actor }
  coverage_admin  → { families with an active temporary assignment to actor }
  manager, super_admin → { every family in actor.organizationId }

visible_conversations(actor) =
  { c : c.familyId ∈ visible_families(actor) }
  ∪ { c : actor is a live member of c }            (Teacher↔Admin directs have no family)
```

Temporary assignments are created explicitly by a manager (**PD-3**, closed
2026-09-07). `chat.on_duty()` is not consulted by this predicate; it survives
only as the interim routing input to `canSend` until Phase 1's assignment model
replaces it.

This predicate feeds `canRead`, every list endpoint (`GET /conversations`,
`GET /families`, `GET /approvals/pending`, search, notifications, dashboards,
broadcast audiences) and the realtime `conversation.subscribe` check. Solving
`canRead()` alone is explicitly **not** the finish line.

---

## 7. Where each layer stands

| Layer | Role | Phase 0 state |
|---|---|---|
| Guard (Phase 1) | authenticates, attaches `Actor` | seam contained |
| `AuthorizationService` | decides role + scope | role decisions exist; scope missing |
| Database triggers | BR-1 as re-versioned (authorized relationship), immutable type, admin presence, family scope, org isolation | complete and tested |
| RLS | defence in depth once the API sets the actor context | defined, inert (see `RLS-STRATEGY.md`) |
| Clients | UX affordances only | Admin Web has one client-only rule to move server-side |
