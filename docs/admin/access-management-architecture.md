# Department and access management: audit, architecture and roadmap

Status: **PROPOSAL, with stage M1 implemented on `claude/admin-web-nav-ia`** (read-only; nothing merged, pushed, deployed or migrated on any shared database).
Builds on PD-40 (access roles, the permission catalogue, `PermissionGuard`), PD-8 (organization structure), PD-59 (ownership scoping) and the earlier
platform proposal (`claude/admin-platform-vision`, section 4.3). The navigation and educational-materials work on this branch is preserved.

## 1. Audit: what exists, what is missing

**Already built (so this is an extension, not a new system).**
| Capability asked for | Today |
|---|---|
| Create/manage staff accounts, first sign-in code | `staff_accounts.*` keys; `chat.create_staff_account`; Admin Web "Staff accounts" |
| Roles as reusable permission sets | `chat.access_role` + `access_role_permission`; templates seeded per organization (Designer, Pronunciation reviewer, Scholar reviewer, Content author) |
| Page and action permissions | ~89 catalogue keys, `<page>.<action>`, with risk class and `delegable` / `inRoles` flags; every API route declares its keys (`@Requires`) and a spec fails the build otherwise |
| Cross-department page access | a role carries any keys; granting needs only the grantor to hold and be allowed to delegate them |
| Manager delegation ceilings | `chat.require_access_grantor`: H3 own department and below own tier, H5 "grant only what you hold and may delegate", barred keys never in roles, super admin only for non-delegable keys |
| Immutable audit | `chat.audit_log` (append-only): who, when, before/after, reason, for every grant and revoke |
| One source of truth for "what does X hold" | `chat.staff_access_profile()` (used by the API and by the SQL rules, so they cannot disagree) |
| Data scope | **per module, in SQL/services** (conversation scope PD-8, teacher scope PD-35, billing scope PD-12, ownership PD-59). A key is *necessary, never sufficient* |

**Missing or hard-coded (the real gaps).**
1. **Departments are a closed set of three.** `chat.department.kind CHECK in ('operations','teachers','sales')`, unique per organization; one manager per department; one department per person (`department_member` for supervisors, `department_account` for specialists). 22 migration files and ~36 API files, ~27 Admin Web files name a kind. Roles (`staff.role`) are a closed enum (`super_admin, manager, admin, coverage, specialist, finance, technical, academic`).
2. **Base permissions come from a hard-coded bundle per (tier, department kind)** (`legacy-bundles.ts` mirrored in SQL by a generated block). A new department has no bundle (it falls to the safe `:none` bundle: nearly nothing).
3. **No individual overrides, no deny.** Effective access = bundle ∪ granted roles. The only way to give one person one extra page is a one-person role; nothing can *remove* a key from one person.
4. **No department-level default** that a new hire inherits.
5. **No generic data scope.** Scope is per module and implicit; an administrator cannot see or choose it.
6. **No effective-access view.** An administrator can see a person's roles but not what they add up to, where each page came from, or what a change would do before saving.
7. **Admin Web navigation and route guards are not permission-driven:** `capabilities.ts` holds static role-to-area lists plus about a dozen server probes (`/lessons/access`, `/materials/admin/access`, …). Hiding a link is UX only (the server decides), but a new page needs code.
8. **`PermissionGuard` is in `shadow` mode** for legacy tiers: it logs would-be refusals, it does not refuse. Switching to `enforce` is the owner's decision (PD-40 PR-6) and needs the production readiness audit first.
9. **Realtime, exports and search:** each module applies its own scope; there is no shared check. They are in the test matrix (section 7), not rebuilt.

## 2. Principles
1. **Extend PD-40; do not replace it.** One database function answers "what does this person hold", and every layer asks it.
2. **Keys are necessary, never sufficient.** A permission says the person may use a page and an action; the module's rule says *which records*. Scope is part of the module's rule, declared in the catalogue so it can be shown and delegated.
3. **No role per combination.** Reusable roles and templates, plus a small number of audited individual exceptions.
4. **Deny always wins.** Explicit restrictions are never bypassed by another source.
5. **Delegation never grows.** Everything a manager grants (role, override, scope) is checked against what that manager holds *and* is allowed to delegate, in SQL, at write time.
6. **Hiding navigation is never enforcement.** Navigation is derived from effective permissions; the server and the database decide.
7. **Practical, not a framework.** Four layers, one precedence rule, five scope words.

## 3. The model: layers and precedence

Effective permissions of a person P (keys, each with a scope):

1. **Super admin:** every key, every scope, not deniable. (Unchanged.)
2. **Deny overrides:** per-person explicit denies. Remove the key whatever granted it. **A deny is real only where it is enforced:** today `PermissionGuard` is in `shadow` mode for the legacy tiers (manager, supervisor, department accounts) and lets their requests through, so a deny written before enforcement would only be honoured by SQL callers of `staff_has_permission`. A deny therefore ships together with enforcement for the denied key (M2b), never before it. Only the super admin or a manager within their own ceiling can write one; a deny can never touch the person's own self-service routes or sign-in.
3. **Allows**, the union of:
   a. **Tier base** (today's legacy bundle by tier and department kind; generalised in M3 to a *department type template*).
   b. **Department default role** (new, M3): the role every member of a configurable department inherits.
   c. **Access roles** granted to the person (today's mechanism; reusable, templated).
   d. **Individual allows** (new, M2): a key (and scope) granted to one person, with a reason and an optional expiry.
4. **Barred keys** (`inRoles = false`: the super admin's own powers and account administration) never come from roles, defaults or overrides.
5. **Scope** is the widest scope among the allows for that key, capped by the key's declared `scopes`, narrowed by a deny of a scope. Default (nothing stated) = the module's current rule: no behaviour changes on migration.

`staff_access_profile()` stays the single function; it gains layers 2, 3b, 3d. Its signature is extended additively so every existing caller keeps working.

## 4. Data scope
Five words, used only where the module implements them: `own`, `assigned`, `team`, `department`, `organization`.
- The catalogue gains `scopes` per key (empty = not scoped; the module's rule applies as today). Sales pipeline already has ownership (`owner_staff_id`): `own` for a member, `department` for the manager. Tasks have `own`/`team`/`all`. Cases: opener, owner, department manager.
- A grant (role key, individual allow) carries the scope it confers. **A grantor can confer a scope only up to the scope they themselves hold** (extension of H5).
- Every service resolves scope through one helper (`ScopeResolver`) that returns the predicate or id set. No module re-derives it.
- **Rule: access to a page never exposes private records beyond the granted scope** (Sales pipeline access does not expose every prospect or family's details). This is checked per module in the test matrix before a scoped grant is offered in the UI for that module; modules that do not implement scopes do not offer the choice.

## 5. Dynamic departments

**Decision needed (section 10): two classes of department.**
- **Core departments** (Operations, Teachers, Sales): their kinds carry workflow semantics deep in SQL and services (children's supervision, teacher scope, billing basis, trials). They stay exactly as they are.
- **Configurable departments** (new): any number, created by the super admin in Admin Web, with `kind = 'general'`, Arabic and English names, description, active/inactive, manager, members, supervisors/teams (reporting lines), and **no hard-coded semantics**: their members hold *only* what the department default role plus granted roles and overrides give them. A new department therefore cannot see families, conversations or money unless explicitly granted, and never accidentally reaches a core department's records.

Why not make the core three data-driven too? It would move business logic into configuration that must then be versioned and tested, and it risks the PD-8/PD-35/PD-12 scope rules protecting children's and families' data. The earlier red-team reached the same conclusion; this keeps all of it intact while still removing the need for a developer to add a department.

Schema direction (M3, additive; see 12.1 for what must be fixed first): widen `department.kind` to allow `'general'`; replace `unique (organization_id, kind)` with uniqueness only for the three core kinds; add `name_ar`, `description`, `is_active`, `default_role_id`; one manager per department stays. A person keeps *one primary department*; collaboration across departments is by granted roles and overrides, never by multiple memberships.

Lifecycle: create → configure default role → assign manager and members → deactivate (members keep accounts, lose the department default; nothing is deleted, history kept) → reactivate.

Hard-coding to remove or guard before a configurable department is safe (inventory, to be burned down in M3): any code path that switches on `kind` must treat `'general'` as "no workflow semantics" (the `:none` bundle already does); the Admin Web probes become permission-driven through the page registry (M5).

## 6. Administration experience
Staff profile gets an **Access** panel (M1 shows it read-only; M2-M4 make it editable):
- **Summary:** primary department, role (tier), manager/supervisor, status.
- **Pages:** one row per page the person can open, with the actions held (view, create, edit, approve, publish, manage…) using the module's *actual* keys only (labels from the catalogue; no invented actions), and the data scope where the module has one.
- **Provenance** on every row: *Default for tier/department*, *Department default*, *Role: name, granted by X on date, reason*, *Individual exception*, *Denied by …*.
- **Preview before saving:** choose a role to add or remove and see pages and actions gained or lost, before confirming (M1 delivers this for roles).
- **History:** the audit entries for this person (who, what, when, previous and new state).
- A manager sees this only for people below them in their own department (the existing visibility rule).

## 7. Security risks and test scenarios
| Risk | Control | Test |
|---|---|---|
| A manager grants beyond their authority (role, override, scope) | H3/H5 extended to overrides and scopes in SQL at write time | manager grants a key they lack / non-delegable / wider scope: refused; cross-department: refused |
| Privilege escalation through a deny or override on the grantor | grantor cannot edit own access; denies by manager only within ceiling | self-edit refused |
| A new department sees data it should not | `general` kind has empty base; no core scope function ever reads it | new-department member: no family, conversation, money, teacher file |
| Deny bypassed by another source | precedence in one SQL function | deny beats bundle, role, default, override; barred keys unaffected |
| Page access exposes all records | scope declared per key, resolved by one helper, per-module scope tests | sales: member sees own prospects only; manager department; other department: none |
| Hidden nav treated as security | server and DB enforce | route table spec + direct-API tests for every scoped route |
| Realtime/notifications/exports/search leak | each re-checks the same helper; matrix per channel | a revoked person stops receiving events (existing revocation journal), exports honour scope |
| Existing users lose access in migration | additive; defaults = today; readiness audit before `enforce` | the pd040 legacy-bundle specs stay green; shadow comparison |
| Lock-out of the last super admin | unchanged guard | existing |
| Audit gaps | all writes through SQL functions that audit; append-only table | each new writer has an audit test |

## 8. Migration and backward compatibility
Every step is additive and reversible (a `db/rollback` script each, tested apply/rollback/re-apply on a disposable database). No existing role, bundle or restriction changes. New columns default to today's behaviour. `PermissionGuard` mode is untouched (still `shadow`).

## 9. Roadmap (reordered after the independent red-team, section 12)
| Stage | Content | Schema | Risk | Status |
|---|---|---|---|---|
| M0 | Navigation IA; materials roles (author/review/manage) | migration (disposable only) | low | done, awaiting merge approval |
| **M1** | **Effective-access read model: per-key provenance, per-page rollup, role add/remove preview, Admin Web Access panel** | additive SQL function | low (read-only) | **implemented here** |
| M2a | **Department kind audit** (no behaviour change): list and fix every rule that compares departments by kind or ignores kind (section 12.1), partial unique index plan, Prisma call sites | tests + rewrites of kind-agnostic functions, behind the existing three kinds | medium | proposed, **must precede M3** |
| M2b | Enforce denies: a deny must be honoured by the SQL path every route uses (`staff_has_permission` / `staff_access_profile`) **and** by the guard for the denied key, not only after M6 | none | high | proposed, **must precede M2c** |
| M2c | Individual allows/denies (reason, expiry in the function, audit), tier ceiling, delegation triple check, self-edit block | new table + function change | **high** | proposed |
| M3 | Configurable departments: schema, super-admin CRUD UI, default role that reaches specialists **and** supervisors, members/teams | additive schema | high | proposed |
| M4 | Data scopes: catalogue `scopes`, total order, `ScopeResolver`, first modules (Sales pipeline, Tasks, Cases) | catalogue + services | high | proposed |
| M5 | Permission-driven navigation: page registry replaces `capabilities.ts` lists and probes | none | medium | proposed |
| M6 | `PermissionGuard` shadow to enforce | none | owner decision, after production readiness audit | proposed |

## 10. Decisions that need the owner
1. **Two classes of department** (core three unchanged; new departments configurable). Alternative (everything data-driven) is rejected above; confirm.
2. **One primary department per person**, collaboration through roles and exceptions (no multi-membership). Confirm.
3. **Deny semantics**: a deny always wins and only the super admin (or a manager within their ceiling) can write one. Confirm who may deny.
4. **Scopes first for Sales pipeline, Tasks and Cases only**, other modules later.
5. **M6 (enforce)** and its production readiness audit: separate decision.

## 11. Implemented in M1 (this branch)
- `chat.staff_access_sources(staff)`: every held key with its source (super admin, tier default, role) and, for roles, who granted it and when. Read-only, additive migration (`db/rollback` script included).
- API `GET /admin/staff-accounts/:staffId/access` (visibility = the existing account-visibility rule) and `POST /admin/staff-accounts/:staffId/access/preview` (roles to add/remove: pages and actions gained and lost). Read-only.
- Admin Web: an Access panel in the staff profile (pages, actions, provenance) and the preview in the grant dialog.
- Tests: SQL function and API on a disposable database (visibility, provenance, super admin, manager scope), Admin Web.

## 12. Independent red-team of this proposal (read-only review against the code) and what changed

An independent reviewer checked the proposal against the migrations and services. Findings, all adopted:

**12.1 A `general` department is not safe until these are fixed (M2a, before any schema change).**
1. **Prisma and uniqueness.** `chat.department` is unique on `(organization_id, kind)` and code reads it with the compound key `organizationId_kind` (`apps/api/src/moderation/departments.ts`). The unique must become a partial index for the three core kinds; every `findUnique`/`limit 1` by kind must be rewritten.
2. **"Same kind" means "same department" today.** `chat.staff_department_kind` is compared with `=` in the testimonial-void rule (PD-52). Two `general` departments would count as one. Every such test must compare department ids.
3. **Manager rules that ignore kind:** `staff_acts_for` and `staff_principals` (PD-8), `department_room_party` (PD-35 rooms) and `chat.work_task_visibility` (PD-47) join on `manager_id` with no kind filter. Harmless today only because family reach requires an Operations placement; each must get an explicit `kind in (...)` guard before a `general` manager can exist.
4. **`CASE d.kind ... ELSE false`** in the PD-35 case-party rule: a latent coupling (safe today because case targets are limited to Teachers and Operations); keep that restriction explicit.
5. **`staff_access_profile` ignores `department_account`.** It reads only `department_member` (supervisors). Specialists are placed through `department_account`, and `staff_in_managed_department` reads only that table. A department default role implemented the obvious way would reach supervisors but **not** specialists, the main members of a new department. The default role must resolve through both tables.
6. The `legacy_permission_bundle.department_kind` CHECK, `legacy-bundles.ts` (must mirror SQL), `org-structure.service.ts` and the Admin Web organization/tasks features also hard-code the closed set.

**12.2 Precedence and bypasses.**
- Direct readers of role keys that do not go through `staff_access_profile`: the staff-accounts role editor and `reach()`, `chat.may_administer_staff_account`, the template follow-up role-edit check, and M1's `staff_access_sources`. Every reader must honour denies (M1 has none to honour yet; it must before M2c ships, or the Access panel would show keys a person does not hold).
- Every new source (department default, override) needs the same `p.in_roles` join that roles have, so barred keys stay barred.
- `profileOf` is read fresh on every request, so a change applies to the next request (good).

**12.3 Escalation paths the first draft missed (now requirements for M2c).**
- Block deny/override/role-edit on oneself, not only self-grant (H8).
- An individual allow obeys the target's tier ceiling (`max_tier`), or a manager could attach a manager-grade key to a specialist as an "exception".
- A manager's deny stays inside H3: specialists of their own department only, never a supervisor, a peer or a super-admin-granted key.
- The overrides writer needs the same triple check as role grants (`delegable` AND `in_roles` AND held by the grantor) and the "edit may not widen existing grants" re-check.
- Scope comparison needs a total order and a write-time check; nothing exists to extend.
- Expiry must be evaluated inside `staff_access_profile` (`now()`), or an expired allow persists.

**12.4 Roadmap order.** M2 before enforcement would give false assurance (deny inert); the kind audit must precede M3; the department default role needs the precedence rules and the `department_account` fix. Reordered in section 9.

