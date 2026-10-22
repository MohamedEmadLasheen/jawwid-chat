# PD-8 — Organization structure and strict conversation visibility

Status: **CANONICAL** · Decided by the product owner 2026-10-15 · Implemented on
`feat/org-chat-pd8` (base `integration/admin-profile-2026-10-14-rtchat` @ `eabc5c8`)

Migration `supabase/migrations/20261015120000_chat_pd008_org_structure.sql`
(rollback `db/rollback/20261015120000_pd008.down.sql`). Supersedes, for
conversation scope: BR-4's *one owner per family*, PD-3's interim on-duty rule,
the 2026-10-14 staff-scope rule (owner / on duty / sticky / manager = whole
organization) and the 2026-10-14 decision that `super_admin` is read-only.

---

## 1. Decisions (owner, 2026-10-15)

| # | Decision |
|---|---|
| 1 | Departments under the super admin: **Operations**, **Teachers**, **Sales**, each run by one manager. |
| 2 | Operations has four **primary supervisors** and two **backup supervisors** (backup A covers primaries 1–2, backup B covers 3–4); backup arrangements are configurable. Teachers has two supervisors. Sales has its manager only. |
| 3 | The **Operations Manager assigns each CHILD** (not each family) to a supervisor; children of one family may have different supervisors and teachers. |
| 4 | **Super admin: full read AND write** in every conversation of its organization (reverses the 2026-10-14 read-only decision). |
| 5 | **A backup supervisor has access only while the backup link is ACTIVE** — dormant until the Operations Manager activates it (optionally until a time, ≤ 90 days); deactivation, expiry or ending the link ends access at once. *(Owner gave no preference; this is the recommended default, consistent with PD-1/PD-3: coverage is never permanent.)* |
| 6 | Supervisors create groups and add parents and teachers. |
| 7 | QA data uses **synthetic** people — G-20 and `docs/qa/system-inventory.md` §4 keep real staff names out of seed data. |
| 8 | Base branch: the integration line, not `main`. |

## 2. The scope rule — one function

A staff member may access a conversation only on a **basis** returned by
`chat.staff_conversation_access(staff, conversation, at)`:

| Basis | Who | Which conversations |
|---|---|---|
| `super_admin` | the organization's super admin | every conversation of the organization |
| `responsible` | the supervisor of the child(ren) a group is about | `student_group` (its learner) and `family_group` (its `conversation_learner` rows) |
| `member` | a live staff member of a 1:1 or ungrouped conversation | a **family** conversation only while that member still reaches the family (supervises one of its children, or acts for whoever does) |
| `backup` | acting for a supervisor through an **active** backup link | whatever that supervisor has as `responsible` / `member` |
| `manager` | the manager of the department the supervisor belongs to | whatever the department's members have |

Nothing else grants staff access: **not** `family.owner_id`, **not**
`on_duty()`, **not** the sticky handler, **not** a membership row on its own,
**not** the `manager` role on its own. `backup` and `manager` are not
transitive. A backup link counts only while both people sit in the same
department and the backup is an active staff member (re-checked inside the
function, not trusted to whoever moved them).

Consequences the tests pin:

* A supervisor never sees another supervisor's conversations — **not even for
  a family they share** (scenarios C/D): each reaches the family through their
  own child, and a colleague's 1:1 with the same parent stays private.
* Reassigning a child moves the child's groups with it
  (`ConversationService.reconcileSupervisionChange`): its Student Group and a
  family group about it alone transfer; a family group about it *and* others
  detaches it (teachers who teach none of the remaining children leave). Since
  PD-24 (2026-10-22) the former supervisor's 1:1 with the parent passes to the
  new supervisor -- the same conversation and history -- once they supervise
  none of the family's children (unless the parent already has a 1:1 with the
  new supervisor; then it stays as history nobody below the super admin
  reads). A whole group moves with `OrgStructureService.transferGroup`, which
  moves every child of the group together so nothing is detached.
* The Sales manager reads nothing yet; the Teachers manager reads the Teachers
  supervisors' channels with teachers; the Operations Manager reads no
  Teachers-department channel.
* A learner nobody supervises has no group (`COMM.LEARNER_UNSUPERVISED`, 409)
  and is visible to the super admin only — fail closed.

## 3. Where it is enforced

| Layer | What |
|---|---|
| **SQL** | `staff_conversation_access` is THE decision; `staff_visible_conversation_ids` builds the staff list by filtering candidates through it; `staff_reaches_family`, `staff_acts_for`, `backup_is_active`, `conversation_responsible_supervisor`. EXECUTE revoked from `PUBLIC` — they take an arbitrary staff id and are never an oracle for a request role. |
| **API** | `SqlStaffScope` (`platform/staff-scope.ts`) asks the function; `AuthorizationService.canRead` admits staff **only** on the resolved basis (default false). Every path that already used `canReadResolved` — detail, messages, reactions, read receipts, uploads, attachment media, calls, approvals, socket subscribe, typing and per-delivery re-authorization — therefore uses PD-8 with no per-route change. The list, the approval queue (bounded *before* its cap) and the call history use `visibleConversationIds`, the same function. |
| **Direct channels** | `canOpenDirect` requires a Parent ↔ staff pair to have the staff side reach the family (BR-3: no open directory, in either direction). |
| **Groups** | `POST /conversations/family-group`: children of ONE family and ONE supervisor; the actor is that supervisor, their active backup, their manager or the super admin; parents must be that family's messaging contacts; teachers must teach one of the children. Adding staff to any group requires the candidate's own basis on it. |
| **Database integrity** | Triggers refuse: a supervisor outside Operations, a cross-organization row, a backup outside the primary's department, a family-group learner of another family, a family-group parent of another family, a family-group teacher of none of its children; a deferred trigger refuses, at commit, a family group whose children have more than one supervisor. A teacher who stops teaching every child of a family group leaves it automatically. |
| **Request roles (RLS)** | `chat.conversation`, `conversation_member`, `message_attachment`, `message_approval`, `call` and the five PD-8 tables carry no grant for `authenticated`/`chat_app` (deny by default). `chat.message` — the one conversation table a request role can read — had a staff policy letting every admin/coverage/manager read every family's messages; it now asks `chat.current_staff_conversation_access(conversation_id)` (SECURITY DEFINER, answers for the session's own staff only). Inserts likewise. |

Other fixes made while proving this:

* **Tenant oracle (pre-existing):** another organization's conversation was
  answered `403 CONVERSATION_NOT_FOUND` on several routes while an unknown id
  was `404` — the status told a caller the id exists in another tenant.
  `CommError` now defaults every `*_NOT_FOUND` code to 404.
* Approval queue is bounded to the actor's visible conversations and
  organization before the 200-row cap.

## 4. API

All behind the global bearer guard; POST for updates (the admin-web client has no PUT).

| Route | Who |
|---|---|
| `GET /org/structure` | super admin (all), manager (own department) |
| `GET /org/learners[?supervisorId=&unassigned=true]` | super admin (all), manager (own department's children; Operations Manager also the unassigned) |
| `POST /org/learners/:learnerId/supervisor {supervisorId, reason}` | super admin, or the manager of BOTH the current and the new supervisor's department |
| `POST /org/departments {kind, displayName, managerId?, reason}` | super admin |
| `POST /org/departments/:id/members {staffId, position, reason}` · `POST /org/department-members/:staffId/remove {reason}` | super admin (ends that person's backup links) |
| `POST /org/backups {primaryId, backupId, reason}` → dormant | super admin, the primary's department manager |
| `POST /org/backups/:id/activate {until?, reason}` · `/deactivate` · `/end` | same |
| `POST /conversations/family-group {learnerIds, contactIds?, teacherIds?, title?}` | the children's supervisor, their active backup, their manager, the super admin |
| `GET /org/group-candidates` | conversation staff: the families whose children they act for (same principals as the scope), with messaging parents and active teachers |

**Admin Web.** *Organization* (`/organization` for managers; the Admin Portal's
*Organization* section, `/admin/teams`, for the super admin): a children tab
(search, filter, assign / change supervisor with a reason) and a departments &
backups tab (team, caseloads, backup links with status, create / activate with
an optional end date / deactivate / end). *Chat* → **New family group** for
operating staff: family → children (one supervisor per group, others disabled
with the reason) → that family's messaging parents and the chosen children's
teachers. The screens offer what the server allows; the server decides.

Every change writes `chat.audit_log` (who, before, after, reason). Changes that
can reduce access run the RT-009 completion barrier before reporting success.

## 5. Setting it up

1. Apply the migration. **Until the structure exists, no supervisor sees any
   conversation** (fail closed); the super admin sees everything.
2. As the super admin: create the three departments with their managers, then
   place each supervisor (`supervisor` / `backup_supervisor`).
3. As the Operations Manager: assign every child (`POST /org/learners/:id/supervisor`),
   create the backup links (dormant), activate them when needed.
4. QA only: `node dist/cli/seed-org-chat.js --target host:port/db --password-file <chmod-600 file> [--manifest out.json]`
   builds the whole synthetic organization (10 teachers, 30 parents, 68 children,
   every assignment shape) through the same services. Refuses non-local
   targets, a password on the command line, and a second run.

## 6. Evidence

* `apps/api/test/integration/org-scope-pd8.spec.ts` (36 tests): the seeded
  organization checked against the database; **every staff member × every
  conversation** (list and per-conversation read) against an oracle computed
  from the seed plan; HTTP / socket / attachment negative probes; backup,
  reassignment and group-creation lifecycles over HTTP; RLS as `chat_app`.
* `staff-scope-revocation.spec.ts`: each way access ends, on every read path.
* Mutation check: re-allowing managers org-wide in `canRead` fails 2 tests;
  letting dormant links grant in SQL fails 7.
* Unit: 656 · Integration: 59 suites (1140 tests incl. 25 pre-existing skips) ·
  Admin Web 206 · Flutter conversation/wire suites — on an isolated database.

## 7. Not done / follow-ups

* Group creation in the **mobile** app (staff use Admin Web; the mobile app is
  for parents and teachers, who never create groups). Mobile displays
  `family_group` and keeps learner-less groups listed.
* Department and manager set-up has an API (super admin) but no screen yet;
  it is a one-time configuration (or the seed CLI).
* Family/contact/learner **directory** RLS (`chat.staff_can_see_family`) still
  admits every family-facing staff member for request roles; the API never
  exposes those tables directly, and narrowing them needs the staff-profile
  workload module checked first.
* Approval and internal-note realtime events still go to live staff MEMBERS
  only (pre-existing); an active backup or manager sees them over REST.
* `family.owner_id` remains (NOT NULL, workload, transfer) but grants no scope.
* Sales department scope is empty by design until its conversations are defined.
* `staff_visible_conversation_ids` evaluates the exact function per candidate;
  fine at QA scale, worth an index review at production scale.
