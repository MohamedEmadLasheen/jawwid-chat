# Staff profiles & responsibilities

Every staff member's professional profile (photo, title, introduction), their
official responsibility labels and reporting line, verified workload counts, a
manager's team view, and the super admin's organization overview.

Built on the super-admin bootstrap delta (`20261013120000`, `/admin`, Bearer
Admin Web). Neither is on `main` yet; see "Baseline" below.

## Where it lives

| Layer | Piece | File |
|---|---|---|
| Database | `chat.staff.avatar_object_key`; `chat.staff_profile`; `chat.staff_responsibility`; `chat.staff_reporting_line`; guards, RLS, grants | `supabase/migrations/20261013150000_chat_staff_profile.sql` |
| Permission map | profile permission keys and role → key mapping | `apps/api/src/platform/staff-profile-policy.ts` |
| Decision | `AuthorizationService.staffProfileAccess`, `canViewOrganizationProfiles` | `apps/api/src/platform/authorization.service.ts` |
| Service | reads, edits, photo, responsibilities, reporting lines, audit | `apps/api/src/staff-profile/staff-profile.service.ts` |
| Metrics | every count and its definition | `apps/api/src/staff-profile/staff-workload.service.ts` |
| Photo checks | real signature, type match, size, dimensions, animation | `apps/api/src/staff-profile/image-inspection.ts` |
| API | `/api/v1/staff-profiles/*` | `apps/api/src/staff-profile/staff-profile.controller.ts` |
| Runtime | one transaction per request on `chat_app` with a trusted actor context (`withActor`) when `DATABASE_APP_URL` is set | `apps/api/src/platform/actor-database.ts` |
| Database (runtime) | login facts, workload, audit read/write functions for the request role | `supabase/migrations/20261014110100_chat_staff_profile_app_runtime.sql` |
| Ownership policy | families.assign / family transfer / deactivation / offboarding | `supabase/migrations/20261014110000_chat_ownership_policy_split.sql` |
| Admin Web | `/profile`, `/profile/:staffId` | `apps/admin-web/src/features/profile/` |

## Rules this feature keeps

1. **Nothing here authorizes.** A job title, an introduction or a responsibility
   label is never read to decide access. The reporting line is read for one
   decision only: which staff *profiles* a manager may view and edit. It does not
   change family, conversation, message, call or story access.
2. **Role, permissions, account status, login identity and credentials are not
   reachable** from any profile route. `PATCH /staff-profiles/:id` accepts exactly
   `jobTitle`, `about`, `displayName`, `expectedVersion`, `reason`; anything else is
   `400 COMM.STAFF_PROFILE_INVALID`. `role`, `is_active`, `left_at`, `account_id`,
   `chat.account*` are written nowhere in the service.
3. **The server decides every field group.** Each response carries `access` (what
   this viewer may do with this profile) and `viewer` (whether they may open their
   team / the organization overview). The page renders from those; the service
   re-checks them inside each write's transaction, with the target row locked and
   the caller re-read (a manager demoted or moved off a team mid-session is refused).
4. **Invisible means not found.** A profile the caller may not see answers
   `404 COMM.STAFF_PROFILE_NOT_FOUND`, exactly like a non-existent id.

## Who may do what

| | own profile | direct report (manager) | anyone in the org (super admin) |
|---|---|---|---|
| view | ✔ | ✔ | ✔ (incl. inactive) |
| job title, About me | ✔ | ✔ `team_profiles.edit_professional_info` | ✔ |
| photo | ✔ | ✘ | ✔ |
| display name | super admin only | ✘ | ✔ |
| responsibilities | super admin only | ✔ `team_responsibilities.manage` (never oneself) | ✔ |
| reporting line | never | ✘ | ✔ `reporting_lines.manage` (not for the super admin) |
| profile audit trail | managers, super admin | ✔ | ✔ |

### Permission map (effective permissions)

Effective permissions are **derived from `chat.staff.role`** through the constant
`ROLE_PROFILE_PERMISSIONS` (`staff-profile-policy.ts`). There is no per-user
grant or override: Jawwid Chat has no `chat.role_permission` table or
customizable-role mechanism yet (AUTHORIZATION-MODEL §3, Phase 1). Every key is
necessary and never sufficient — `team_*` keys also require a direct reporting
line, `org_*` keys the same organization.

| Key | admin, coverage, finance, technical, academic | manager | super_admin |
|---|:-:|:-:|:-:|
| `profile.self.edit` (own photo, title, About me) | ● | ● | ● |
| `team_profiles.view` | | ● | ● |
| `team_profiles.edit_professional_info` | | ● | |
| `team_responsibilities.manage` | | ● | |
| `org_profiles.view` (+ organization overview) | | | ● |
| `org_profiles.edit_professional_info` | | | ● |
| `org_profiles.edit_identity` (name, photo of others) | | | ● |
| `org_responsibilities.manage` | | | ● |
| `reporting_lines.manage` (team membership) | | | ● |
| `profile_audit.read` | | ● | ● |

No key covers role, permissions, account status, credentials or sessions.

A manager's team is the staff whose `chat.staff_reporting_line.manager_id` is the
manager, excluding managers and the super admin. Inactive targets are view-only.
Admin / supervisor / coverage / departments get self-service only.

The hierarchy is enforced by `chat.guard_staff_reporting_line` for every writer:
staff → a manager or the super admin; manager → the super admin; super admin →
nobody; same organization; active manager. Cycles are unrepresentable.

## Metrics: what each number counts

"Assigned family" = `chat.family` with `owner_id` = the staff member, `state <> 'churned'`, same organization.

| Label | Source |
|---|---|
| Assigned families | `chat.family` as above |
| Students | `chat.learner` in those families |
| Parent contacts | `chat.contact` in those families, `is_active` |
| Teachers of these students | DISTINCT active `chat.teacher` teaching those learners (not a supervision relationship) |
| Open conversations | `chat.conversation` of those families, not archived, not resolved |
| Awaiting our reply | the subset where `last_customer_message_at > last_staff_message_at` (same rule as `needsReply()`) |
| Messages awaiting approval | `chat.message_approval.decision = 'pending'` in those conversations |
| Direct reports | active staff whose reporting line names this person |

Families, learners, contacts, conversations and approvals belong to exactly one
supervisor, so team sums are exact. Teachers do not: team and organization teacher
counts are their own DISTINCT queries, and the summed figure is never shown. The
organization overview reports **unique totals** (each its own query) separately
from **sums across teams**, plus "families supervised outside any team".

**Not shown, because no records exist:** tasks (frozen, PD-4), cases / complaints
(removed, C-3), follow-ups, escalations, attendance (Jawwid Core), performance
scores (no documented calculation). The page says "Not tracked" instead of a zero.

## Audit

Every successful change writes one `chat.audit_log` row **in the same
transaction**, through `chat.record_staff_profile_audit` (actor from
`chat.trusted_staff_actor`; no request role holds INSERT on `chat.audit_log`) (`entity = 'staff_profile'`, `entity_id` = the target staff id,
`actor_id` = the editor): `staff_profile.updated` (changed fields only, before
and after), `staff_profile.photo_set` / `photo_removed` (a has-photo flag and the
server-measured type and dimensions — never the object key or a URL),
`staff_responsibility.assigned` / `ended`, `staff_reporting_line.set` /
`cleared`. Reasons: required for ending a responsibility and for reporting-line
changes; optional for edits on someone else's profile (a default names the
relation); self edits record "self-service profile edit". A save that changes
nothing writes nothing; a refused change writes nothing. `chat.audit_log` is
append-only (existing `audit_log_is_append_only` trigger); no route edits it.
Readable through `GET /staff-profiles/:id/activity` by holders of
`profile_audit.read`, for profiles they may view.

## Photo pipeline

1. `POST /staff-profiles/:id/avatar/upload {mimeType, byteSize}` — JPEG/PNG/WebP,
   ≤ 2 MiB → a signed PUT bound to type and size, key `avatars/staff/<id>/<uuid>`.
2. The browser re-encodes to a ≤512 px square (canvas; drops EXIF) and PUTs straight
   to storage.
3. `POST /staff-profiles/:id/avatar {objectKey}` — the key must be structurally
   under the target's prefix; the stored bytes are read back (≤256 KiB) and must be
   a real JPEG/PNG/WebP matching the stored type, 64–4096 px per side, not animated.
   A rejected object is deleted; on success the previous photo's object is deleted.
4. Reads are short-lived signed URLs minted only for viewers allowed to see the
   profile. The column holds a key, never a URL.

## Verification (2026-10-13)

* API unit: 32 suites / 524 tests (new: authorization matrix, image inspection,
  text normalization).
* Privilege escalation (`staff-privilege-escalation.spec.ts`, 14 tests, as
  `chat_app`; 7 fail without the fix).
* Ownership functions (`ownership-functions-authorization.spec.ts`, 17 tests;
  13 fail on the vulnerable schema, 2 with the boundary only).
* Final run 2026-10-14: API unit 524, integration 803 (38 suites), Admin Web
  140, builds, G-20 / JC-011 / backup guards, 35 HTTP probes, photo probes.
* API integration on a private database (`staff-profiles.spec.ts`, 41 tests:
  ownership, role boundaries, hand-built requests, hierarchy at the database,
  cross-tenant, RLS as `chat_app`, photo bytes, counts vs. independent SQL).
  Three mutants (dropped reports-to check, dropped key-ownership check, dropped
  churned filter) were each caught.
* Real HTTP against a local API + MinIO: 35 authorization probes; photo upload,
  HTML-as-PNG rejection, replacement cleanup, private bucket, size binding.
* Admin Web: 140 tests (18 new) and production build; browser QA as supervisor,
  manager and super admin in English and Arabic, desktop and 375 px.

## Known limitations

* **Department** and **preferred language** are not stored server-side for staff
  (`toStaffActor` hard-codes `ar`; the toggle is per-browser). PD-5 plans
  `chat.staff.department`; not pre-empted here.
* **No contact details** beyond the sign-in identifier (BR-2), shown to its owner only.
* **Metadata**: the server checks headers, not pixels, and does not strip EXIF; the
  Admin Web's canvas re-encode does. A client that skips it can store EXIF.
* **Abandoned uploads** (grant issued, never committed) are not swept.
* **Local reference storage**: `/storage/*` is behind the global auth guard, so
  `<img>` cannot load a locally-signed URL (falls back to initials). S3/MinIO works.
* **Roles and permissions** have no management screen; `super_admin` is granted only
  by the bootstrap CLI.
* RLS is the live control for **this module only**, and only when
  `DATABASE_APP_URL` is set (see "Runtime on `chat_app`"). Every other module
  still runs on the owner connection.
* A manager's team-editing rights come from the role map above; they cannot be
  granted or withheld per manager until a permission-assignment model exists.

| Limitation | Classification |
|---|---|
| No per-user permission-assignment model | Future improvement (role map is the documented model) |
| No department / preferred-language storage | Future improvement |
| No server-side EXIF stripping | Non-blocking (browser re-encodes; server validates content, type, size, dimensions) |
| Abandoned uploads not swept | Non-blocking (private bucket, unreferenced keys grant nothing) |
| Local reference storage → initials | Non-blocking (S3/MinIO is the deployment storage) |
| Whole-API `chat_app` deployment | **Blocked**; the remaining dependencies are listed under "Runtime on `chat_app`" |

## Migration requirements

* Requires `20261013120000_chat_super_admin_role.sql` (bootstrap delta) before
  `20261013150000_chat_staff_profile.sql`; the reporting-line guard and the
  policies name `super_admin`.
* Additive only; rows with no profile, responsibility or reporting line read as
  "not added yet". Nothing is backfilled.
* `20261013160000_chat_staff_column_privileges.sql` depends only on
  `20260905091200` and `20260910120200`. Verified on a disposable database: it
  applies alone on `main@09512c0`; when the account-avatar, bootstrap and
  profile migrations land afterwards (earlier timestamps), they apply cleanly
  and the newly added `avatar_object_key` stays non-updatable by the request role.
* `20261014090000` then `20261014090100`, in that order (the repair is only safe
  once the boundary exists). They depend on `20260905090700` and `20260905090900` (the
  functions), `20260905090500` / `20260905093200` (`event_log`),
  `20260905094000` (OD-01, the current five-argument `log_event`) and
  `20260910120200` (`chat_app`); they are independent of the bootstrap and
  profile migrations.
* `20261014100000_chat_request_role_write_boundaries` (needs `20261014090000`
  and `20261013150000`; redefines `guard_super_admin_grant` only if
  `20261013120000` is present), `20261014100100_chat_definer_function_hardening`
  (needs `20261014090100`), `20261014100200_chat_single_super_admin` (a no-op
  without `20261013120000`; refuses if an organization already has two super
  admins), `20261014100300_chat_identity_binding_and_engine_writers` (needs
  `20261014100000`), `20261014100400_chat_offboard_target_rules` (needs
  `20261014090100`; repeats its body plus the target rule).
* `20261014110000_chat_ownership_policy_split` (needs `20261014090000`,
  `20261014090100`, `20261014100400`, `20261013120000`): the approved policy
  below. `20261014110100_chat_staff_profile_app_runtime` (needs
  `20261013150000`, `20261014090000`, `20261014100000`): this module's
  functions for the `chat_app` path. Both are forward-only, touch no data, and
  end in catalog self-assertions.
* `20261014130000_chat_avatar_key_format` (needs `20261005140000`,
  `20261005160000`): one key format, as a CHECK; stops if existing keys do not
  conform.
* `test/unit/migrations/security-regression-guard.spec.ts` refuses a duplicate
  version, a redefinition of a protected function with a timestamp older than
  `20261014090000` (it would run after the fixes), a caller-named actor in an
  actor function, and any re-grant of a revoked column or EXECUTE.
* Coexists with `feat/account-avatar` (`20261005140000`, `20261005160000`): both
  add `chat.staff.avatar_object_key` with `add column if not exists` and the
  same comment. Verified on disposable databases in both orders (this branch
  first then account-avatar, and filename order): no errors, one column, and an
  existing avatar key preserved.

## Security findings

All verified as `chat_app` (the request login role, NOBYPASSRLS) in rolled-back
transactions on isolated databases, and fixed in this repository's own Chat
database. Jawwid Core was not touched: every table involved is created by a
Chat migration in Chat's database, and Core reaches Chat only through the
API/webhook boundary.

| # | Finding (all pre-existing) | Status | Fixed by |
|---|---|---|---|
| 1 | `chat.staff`: table-level UPDATE let any staff member set their own `role` (then rewrite others') | Fixed | `20261013160000` |
| 2 | `transfer_ownership` / `offboard_staff` / `assign_family_owner` authorized a caller-supplied `p_actor_id` | Fixed | `20261014090000` |
| 3 | `chat.family.owner_id` writable directly; the `chat.transferring_ownership` gate is self-settable | Fixed | `20261014090000` (column) + `20261014100000` (gate requires a server-side caller) |
| 4 | `write_audit` / `log_event` (SECURITY DEFINER, caller-named actor) executable by every role: audit/event forgery | Fixed | `20261014090000`, `20261014090100` |
| 5 | `log_event` returned `uuid` from a `bigint` id; 6-argument calls in `transfer_ownership` / `offboard_staff` | Fixed (only after #2) | `20261014090100` |
| 6 | `chat.learner.teacher_id` (PD-6 input) writable by the request role; `chat.syncing_assignment` self-settable | Fixed | `20261014100000` |
| 7 | `chat.provisioning_super_admin` gate self-settable (latent behind #1) | Fixed | `20261014100000` |
| 8 | `chat.contact.account_id` writable by the request role: re-bind a contact to another login | Fixed | `20261014100300` |
| 9 | `extend_stickiness`, `link_staff_account`, `link_contact_account`: writers taking a caller-named principal, PUBLIC-executable | Fixed | `20261014100300` |
| 10 | `recompute_family_state`: SECURITY DEFINER, no `search_path`, PUBLIC-executable, caller-chosen time | Fixed | `20261014100100` |
| 11 | `dispute_attention_order`: caller-named actor, 6-argument `log_event`, PUBLIC-executable | Fixed | `20261014100100` |
| 12 | No database-level single-super-admin rule | Fixed | `20261014100200` (at most one per organization, as the CLI already required) |
| 14 | `offboard_staff` did not restrict its target: a manager could deactivate another manager or the super admin (owner lock-out) | Fixed | `20261014100400` |
| 13 | Phase-7 `20260907100100` would overwrite #2 if ported (older timestamp) | Guarded | `test/unit/migrations/security-regression-guard.spec.ts` |
| 15 | `offboard_staff` deactivated in the same call as the family transfer, so a manager (families.assign) could also deactivate (users.manage, super admin only) | Fixed | `20261014110000` (split; see the policy below) |
| 16 | `caller_is_server_side()` read `current_user`, which is the function owner inside any SECURITY DEFINER caller: every definer looked server-side | Fixed before use | `20261014110100` (`chat.invoking_role()`: `role` setting, else `session_user`) |

### The trust model these fixes rely on (stated, not fixed)

On the request role, "who is acting" is `chat.current_staff_id()`, resolved
from `chat.actor_subject` (or the raw `chat.actor_staff_id` fallback). By
RLS-STRATEGY §3 those settings are written per transaction **by the API**,
from the authenticated actor; end-user clients never connect to Postgres. The
fixes ensure that a `chat_app` connection acting as staff member X cannot exceed
X's rights, cannot name someone else to a function, and cannot flip a gate. They
cannot stop a holder of the `chat_app` credential from claiming to be X; that is
custody of the credential, as for every RLS policy in the schema.

Re-assessed 2026-10-14, with tests:

* **Clients cannot choose the identity.** The guard resolves the actor from the
  verified bearer token only (`x-actor-id` is not read: `identity-seam.spec.ts`,
  `identity-security.spec.ts`). `ActorScopedDatabase` reads the subject server
  side from that actor's own staff row; no request value reaches `set_config`.
* **Only the API establishes context.** `test/unit/auth/db-identity-boundary.spec.ts`
  refuses any identity setting (`chat.actor_*`, `request.jwt*`, `SET ROLE`,
  `SET SESSION AUTHORIZATION`) outside `platform/actor-database.ts`, any
  elevation gate outside the bootstrap CLI, any `$queryRawUnsafe` /
  `$executeRawUnsafe` (none exist), and `DATABASE_APP_URL` read anywhere else.
  It has a negative control.
* **No identity survives on a pooled connection** (`actor-scoped-database.spec.ts`,
  real `chat_app` login): after commit, application error, database error and
  permission error; one backend serving alternating actors; 16 interleaved
  requests on a two-connection pool. A mutant using session-level `set_config`
  fails 6 of its 12 tests.
* **No endpoint runs arbitrary SQL or changes identity**: every raw query in
  `apps/api/src` is a tagged template with bound parameters.
* **No database or server credential in the browser**: the same guard scans
  Admin Web's source, and the final run greps the production bundle.
* **Residual, stated:** `chat.current_staff_id()` still honours the raw
  `chat.actor_staff_id` setting as a fallback (documented for jobs in
  backend-contract §8). On `chat_app` it adds no power beyond `chat.actor_subject`,
  which the credential holder can also set. The API never sets it; the guard
  above keeps it that way.

## Runtime on `chat_app`

**State: this module runs on the restricted role when `DATABASE_APP_URL` is
set, tested end to end. The rest of the API does not, so a whole-API `chat_app`
deployment stays blocked** (dependencies below).

### How a request runs

1. The global guard verifies the bearer token and resolves account → staff on
   the owner connection (`IdentityService`), exactly as today. Login, refresh
   and session bookkeeping stay server side; `chat_app` holds no privilege on
   `chat.account`, `chat.session` or `chat.account_credential`.
2. `StaffProfileService.run(actor, fn)` opens ONE transaction per request:
   * with `DATABASE_APP_URL`: `ActorScopedDatabase.withActor` on a separate
     `chat_app` pool. It reads the actor's subject server side (active staff,
     active login, same organization), sets `chat.actor_subject` and
     `chat.actor_organization` with `is_local => true`, and before `fn` runs
     confirms that the connection is not server side, not BYPASSRLS, and that
     `chat.current_staff_id()` is exactly this actor. Anything else is refused
     (`403 COMM.ACTOR_INACTIVE`) instead of running as the wrong person or nobody;
   * without it: an ordinary owner transaction, as before.
   The service's own rules run in both modes; on `chat_app` RLS, column grants,
   triggers and the functions below apply them again.
3. Writes name their columns. `chat.staff` writes are `update chat.staff set
   name | avatar_object_key`, because Prisma's `@updatedAt` would add
   `updated_at` (no grant; trigger `staff_set_updated_at` maintains it).

### The operations `chat_app` needs, and how each is granted

| Operation | Mechanism | Why not a table grant |
|---|---|---|
| read profiles, responsibilities, reporting lines | SELECT + RLS (`staff_profile_visible_to_reports` added) | — |
| edit title / about, responsibilities, reporting lines | column-level UPDATE + guards (from `20261013150000`/`100000`) | — |
| name / photo | `UPDATE (name, avatar_object_key)` on `chat.staff` + `guard_staff_request_writes` | — |
| login facts (has login, status, last sign-in; subject for oneself) | `chat.staff_login_facts(uuid[])` | no SELECT on `chat.account` for the request role |
| workload counts | `chat.staff_workload`, `chat.staff_distinct_teachers`, `chat.organization_workload_totals` | the counts cross families, learners, contacts, conversations the viewer may not read row by row; the functions return numbers only, for staff the caller may view |
| profile audit write | `chat.record_staff_profile_audit(...)` | an INSERT grant on `chat.audit_log` is refused by its RLS and would let a request name any actor; the function takes the actor from `chat.trusted_staff_actor`, accepts only `staff_profile.*` actions on staff the caller may view |
| profile audit read | `chat.staff_profile_activity(uuid[], int)` | managers (their team) and the super admin; server side unrestricted |

All are SECURITY DEFINER with a pinned `search_path`, EXECUTE revoked from
PUBLIC and `anon`, and the migration asserts that `chat_app` has no SELECT or
UPDATE on `chat.account` and no INSERT on `chat.audit_log`.

### Not granted, deliberately

* No UPDATE on `chat.account` (the `feat/account-avatar` runtime-grant draft
  `20260929120000` grants it; do not land that line).
* No `chat.conversation`, `message`, `call`, `story`, `notification` or outbox
  grants: their callers are other modules, still on the owner connection, and
  granting ahead of a caller-by-caller review would only widen the role.

### Remaining dependencies for a whole-API `chat_app` deployment

1. Route every other module's request work through `withActor`
   (communication: conversations, messages, attachments, calls, stories,
   notifications; family; coverage; admin inspection), with grants derived
   from each module's actual queries.
2. Outbox, workers and webhooks keep the owner / `service_role` path; they
   must stay off the request pool.
3. A `chat_app` credential per environment, held by the API only
   (secret store), and `DATABASE_APP_URL` set in that environment.
4. Re-run this module's suites and the HTTP probes on that environment.

## Authorization model for ownership and offboarding

**Approved 2026-10-14** (AUTHORIZATION-MODEL §3): `families.assign` = manager
and super admin; `users.manage` (which includes deactivation) = super admin
only. Implemented by `20261014110000`, in the API
(`AuthorizationService.canAssignFamilies` / `canTransferStaffFamilies` /
`canDeactivateStaff`) and in Admin Web (`ownershipActions` in
`capabilities.ts`). Hiding a button is never the control: every function
re-checks with `chat.trusted_staff_actor`, and on a request role has no EXECUTE.

| Operation (function) | super_admin | manager (same org, active) | admin / coverage / departments |
|---|---|---|---|
| assign a family owner (`assign_family_owner`) | allowed | allowed | refused |
| transfer one family (`transfer_ownership`) | allowed | allowed | refused |
| move a leaver's families (`transfer_staff_families`) | allowed for any staff member | allowed for admin / coverage targets; never another manager's or the super admin's families | refused |
| deactivate an account (`deactivate_staff`) | allowed, never the super admin or self; refused while the target still owns a family | refused | refused |
| offboard = move + deactivate in one transaction (`offboard_staff`) | allowed | refused (it deactivates) — run `transfer_staff_families`, the super admin deactivates | refused |
| grant / revoke super_admin | bootstrap CLI only (owner, gate, at most one per org) | refused | refused |

The new owner must be an active admin or coverage admin **of the same
organization**. Every refusal leaves ownership, staff status, assignments,
audit rows and event rows unchanged (asserted per role in
`ownership-functions-authorization.spec.ts`). Nobody can lock the organization
out: the super admin cannot be deactivated through any function, and
`chat.staff.is_active` / `left_at` / `role` are not writable by a request role.

No API route calls these functions yet; when one does, it calls the
`AuthorizationService` check first and the function second.

## Integration (done locally 2026-10-14, branch `integration/admin-profile-2026-10-14`)

Not pushed. Every source worktree's full working state is kept under
`refs/checkpoints/20261014/*` (made with a throwaway index; no source worktree
was modified).

| Order | Source | How | Conflicts and resolution |
|---|---|---|---|
| 1 | super-admin bootstrap (`jawwid-super-admin-bootstrap-944e17`) | commit `topic/super-admin-bootstrap` on `main@09512c0` | — |
| 2 | security remediation (`jawwid-admin-portal-audit-81f31f`) | merge `topic/security-remediation` | `errors.ts`: both sides appended codes; both kept |
| 3 | this branch | merge `topic/admin-profile` (built on step 1) | `errors.ts`: both kept |
| 4 | `feat/account-avatar`, the compatible part | cherry-pick `d2cdba2` (avatar columns) + `20261014130000` | none |
| 5 | Admin Portal redesign (`jawwid-admin-portal-redesign-eca27b`) | merge `topic/admin-portal-redesign` (built on step 1) | `AppShell.tsx`: redesign header kept, its user block is the `/profile` link; `sections.ts`: redesign's placement, profile branch's note |

### One avatar key format

`20261014130000_chat_avatar_key_format` makes `avatars/<kind>/<row id>/<uuid>`
(kind = staff, contact, learner, teacher) a CHECK constraint, so a flat
`avatars/<name>` key is refused for every writer, the owner connection
included. Contact, learner and teacher `avatar_object_key` have no request-role
writer; staff keeps its guarded grant. Tested by `avatar-key-format.spec.ts`; the
migration guard refuses a re-grant.

### What was NOT integrated from `feat/account-avatar`, and why

* **Its API** (`2917661`, `/me/avatar`, signed photo URLs for contacts,
  learners, teachers): it builds on `5fdecbe` and `986fa33`, a ~2,000-line
  rework of the conversation controller, DTOs, conversation and message
  services and authorization that never reached `main`, and that overlaps the
  security remediation in the same files. A full merge of the branch conflicts
  in 28 files. It also issues flat keys, now refused by the database. To land
  it: rebase that line onto this branch and issue `avatars/<kind>/<id>/<uuid>`.
* **Its Admin Web slice** (`251fa2f`) and its uncommitted `/profile` routing:
  superseded. `/profile` is this branch's page alone; it already covers a staff
  member's own photo, with byte inspection.
* **Its mobile commits** (`a19bf84`, `ccf23d4`, …): depend on that API.
* **`20260929120000_chat_app_runtime_grants`** (`67fe1e5`): not integrated.
  It grants UPDATE on `chat.account` and an INSERT on `chat.audit_log` that RLS
  refuses; the profile runtime here (`20261014110100`) replaces what it was for.
* **That worktree's 66 uncommitted paths** (cookie transport, story lifetime,
  Flutter branding, iOS entitlements): unrelated in-progress work; preserved in
  `refs/checkpoints/20261014/account-avatar-worktree`, not integrated.

Phase-7 RBAC remains reference only; the migration guard refuses its
older-timestamp redefinitions.

## Baseline

This work was built on a checksum-identical copy of the uncommitted
`jawwid-super-admin-bootstrap-944e17` delta (31 paths; re-verified unchanged on
2026-10-13). Land that first, or both together. Seven of those files also carry
this feature's hunks (`app.module.ts`, `authorization.service.ts`, `errors.ts`,
`error-codes.md`, `AppRoutes.tsx`, `AppShell.tsx`, `features/admin/sections.ts`).
Overlaps measured 2026-10-14 are listed under "Integration plan". `Staff.avatarObjectKey` is declared
with the same text and position as on `feat/account-avatar`, so a three-way merge
yields one field (verified: 0 conflicts, merged schema validates);
`object-storage.ts` / `s3-object-storage.ts` do not overlap with that worktree.
