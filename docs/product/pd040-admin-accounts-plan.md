# PD-40 · Department accounts with page- and action-level permissions — review and plan

Status: **PLAN, awaiting approval.** No feature code is written until the department head
and the owner approve this document and answer §12.
Claim: `docs/product/pd-registry/PD-40.md`. Base: `main` @ `6e809f12`.

The owner's request, in short:
- Super admins and Managers create staff ("Admin") accounts for new departments (Marketing,
  Accounting, …).
- Each account opens only the pages and actions it is granted.
- The first such account is a **Designer**, with access to the Certificates page only.
- The system scales to new roles without being rebuilt.
- A Manager can never grant more than they hold, nor create an account above the ones they
  may manage.

---

## 1. Summary

| | Finding | Consequence for PD-40 |
|---|---|---|
| F1 | **No route checks authorization.** A global guard only authenticates. 427 handlers in 63 controller files hand an actor id to a service, and the service decides. | Page-level enforcement needs a **new route layer**, a permission guard. It is feasible: the role is already read from the DB on every request. |
| F2 | **80 `staffRole ===` comparisons in 27 files**, plus 17 checks on a target's role and about 6 role lists in SQL. The decision rules are spread over about 30 services. | Rewriting those rules would be a regression risk. Keep them as the inner layer, and add the permission guard **in front** of them, so it can only narrow access. |
| F3 | **There is no API to create a staff account.** Staff rows come only from the super-admin bootstrap CLI and the QA seed. There is no invite and no first-login flow. | Account creation is new work. It reuses PD-21's one-time code. |
| F4 | **PD-21 lets every staff role reset, suspend and *impersonate* any parent or teacher account.** | A Designer created on today's model would be able to open a parent's account. This is the most important hole to close. |
| F5 | `AUTHORIZATION-MODEL.md` §1.5 and §4 already prescribe "permissions are data", a `chat.role_permission` table and `can(actor, permission)`, and say "controllers never compare roles". None of it was built. `GET /me` returns `permissions: []` **by decision**, until the table lands. | PD-40 delivers that design. It does not invent a second model. |
| F6 | Certificates are gated by one flag, `canSupervise`, which means "in the Teachers department". That flag also grants leave decisions and supervision chats. Issuing a certificate **posts the file into the family's group**. | The Designer needs a certificate-specific permission and a redacted view. Issuing counts as sending to a family (§12 Q1). |
| F7 | Departments are three fixed kinds (`operations`, `teachers`, `sales`), one of each per organization. Only `admin` and `coverage` staff may be department members, and the department manager must have `role='manager'`. | New departments need a `general` kind that can repeat. Specialist accounts need their own affiliation, kept out of PD-8 scope. |

---

## 2. Review: what exists (evidence)

### 2.1 Staff identity and departments

**`chat.staff.role`**
- It is text with a CHECK constraint: `admin, coverage, manager, finance, technical, academic, super_admin`
  (`supabase/migrations/20261013120000_chat_super_admin_role.sql:46-48`).
- The TypeScript mirror is `StaffRole` (`apps/api/src/communication/contracts/vocab.ts:17-33`).
- The role sets are `FAMILY_FACING_STAFF_ROLES = {admin, coverage, manager}` and `CONVERSATION_STAFF_ROLES`, which adds `super_admin` (`vocab.ts:40-55`).
- `finance`, `technical` and `academic` are legacy department roles. `AUTHORIZATION-MODEL.md` §2 says they "must not be restored". In the Admin Web they see only Tasks and Accounts (`apps/admin-web/src/core/permissions/capabilities.ts:124`).

**Account status** lives on `chat.account.status`: `provisioned | active | suspended | deactivated` (`20260910120000_chat_teacher_identity.sql:110-121`). `provisioned` exists but no API path uses it.

**Super admin**
- At most one per organization: the unique partial index `staff_one_super_admin_per_organization` (`20261014100200_chat_single_super_admin.sql`).
- Every grant, revoke or rebind is blocked unless the bootstrap CLI opened `chat.provisioning_super_admin` (`20261013120000:57-80`). That migration's comment says "No API route opens it".
- The CLI is `apps/api/src/cli/super-admin-bootstrap.ts:228-300`.

**Departments**
- `chat.department` (`20261015120000_chat_pd008_org_structure.sql:41-57`): its `kind` CHECK allows `operations | teachers | sales`, with one department per kind and one department per manager.
- `chat.department_member` (`:98-163`): `staff_id` is the primary key, so a member belongs to one department. `position` is `supervisor | backup_supervisor`, and members must be `admin` or `coverage` (`:131-135`).
- PD-8 scope functions (`chat.staff_conversation_access`, `staff_reaches_family`, `staff_acts_for`) are wrapped by `apps/api/src/platform/staff-scope.ts:63-112`. They fail closed (`NO_STAFF_SCOPE`, `:118-125`).

**Permission tables:** none exist. `ROLE_PROFILE_PERMISSIONS` (`apps/api/src/platform/staff-profile-policy.ts:54-79`) is the only role→permission matrix. It is a TS constant that calls itself "the profile slice of" the future `chat.role_permission`.

### 2.2 How authorization is decided

- **Guards.**
  - `AuthenticatedGuard`, `ActionThrottleGuard` and `SupportSessionInterceptor` are global (`apps/api/src/platform/auth/auth.module.ts:99-109`).
  - The opt-out is `@Public()` (`auth.guard.ts:11`). No controller uses `@UseGuards`.
  - No `@Roles` or permission metadata exists. Reflector metadata exists only for `PUBLIC_ROUTE` and `RATE_LIMITED_ACTION`.
- **Actor.** The JWT carries only `sub, sid, act, knd, org` (`jwt.ts:28-45`).
  - The guard loads the session row, then `IdentityService.resolveForAccount`, which reads `chat.staff.role` (`auth.service.ts:500-538, 688-698`; `identity.service.ts:197-249`).
  - The role is therefore read **fresh on every request**, so a change takes effect on the next HTTP call.
- **Decisions.**
  - `AuthorizationService` (`apps/api/src/platform/authorization.service.ts`, 1706 lines) contains, for example, `canInspectOrganization :1197` (super_admin only), `canAdministerAccount :1388`, `canManageDepartments :1462`, `canViewOrgStructure :1539` and `canAssignFamilies :1342`. The last allows **any `manager`**, regardless of department.
  - Department policies are DB-free functions:
    - `decidePd012StaffAccess` (`pd012-policy.ts:35-50`)
    - `decideBillingAccess` (`pd012-policy.ts:113-131`)
    - `decideTeacherFileAccess` (`teacher-file-policy.ts:40-57`)
    - `subscription-policy.ts`
- **Role comparisons.**
  - 80 `staffRole ===/!==` sites in 27 files. The largest counts are `authorization.service.ts` (23), `pd012-policy.ts` (8), and 4 each in `teacher-file-policy`, `teacher-supervisor.service`, `supervision-case.service`.
  - Raw literals also appear, e.g. `lifecycle.service.ts:122,547,549` and `message.service.ts:1556`.
  - SQL role lists appear in `supervision-conversation.service.ts:244`, `mention.service.ts:219`, `presence-policy.ts:67,98` and `trial-group.service.ts:195,353`.
- **Closest precedent for a route→policy map.** `SUPPORT_SESSION_WRITES`, a deny-by-default list of `[method, route template]` pairs, checked from `request.route.path` (`support-session.interceptor.ts:33-110`).
- **Route-walking tests.** None enumerate every route. `test/unit/abuse/rate-limited-routes.spec.ts:39-55` reads `PATH_METADATA` from named controllers, and that is the technique the new route test will extend.
- **Prefixes do not line up with pages.** Only `admin`, `admin/accounts` and `admin/impersonations` are Admin-Web-only. Pages also call shared prefixes such as `/conversations`, `/lessons`, `/org`, `/payments`, `/learner-certificates` and `/teacher-files`. Page enforcement therefore needs an explicit per-route declaration, not prefix matching.

### 2.3 PD-21 account administration (on main)

**Routes**
- `/admin/accounts` (`apps/api/src/account-admin/account-admin.controller.ts:28-99`): list, detail, password reset, suspend, reactivate, list sessions, revoke all, revoke one.
- `/admin/impersonations` (`impersonation.controller.ts:27-59`).

**Rule:** `canAdministerAccount` (`authorization.service.ts:1388-1414`).
- Parent and teacher accounts may be administered by **any active staff role**.
- Staff accounts may be administered by the super admin only.
- Nobody administers the super admin's account or their own.
- Staff accounts are never impersonated.
- The DB trigger `chat.guard_password_reset_code` repeats this for reset codes (`20261022100000_chat_pd021_password_reset.sql:62-82`).

**Reset code**
- 6 digits, valid 10 minutes, 5 tries, stored as a hash only (`password-reset.service.ts:12,306`).
- Completing it upserts the credential (`:176-180`), so it already works for an account that has never had a password. That makes it reusable as a first-login code.

**Suspend** (`account-admin.service.ts:217-242`), in one transaction:
- `chat.deactivate_principal(…,'suspended')`, then revoke every session, then audit.
- Then `enforceAccountRevocation`, which disconnects the account's sockets and waits on the barrier (`auth.service.ts:915-946`, `realtime-revocation.ts:25-56`).

**Realtime**
- RT-032 journal triggers fire on account and staff status changes. The confirmer polls every 1 s (`revocation-confirmer.service.ts:11,150-170`).
- A 15 s sweep re-validates every socket (`realtime.gateway.ts:49,364,883`).
- **A role change writes no journal row.** Only the sweep picks it up.

**Audit** (`chat.audit_log` via `PrismaAuditService.audit`, `audit.service.ts:46`): `account.suspended`, `account.reactivated`, `account.password_reset_issued`, `account.password_reset_completed`, `impersonation.*`, `session.revoked`. A reason is mandatory.

**Missing pieces**
- No staff account creation and no staff invite.
- PD-25 self-recovery is for parents only (`account-recovery.service.ts:19,92`).
- No 2FA. Passkeys are deferred (`session-policy.ts:29`).

### 2.4 Sessions (PD-23)

`session-policy.ts:9-69`:
- Staff app: 14 d idle / 30 d absolute.
- Admin Web: 7 d / 30 d when "kept signed in", otherwise 12 h / 7 d.
- Super admin: 12 h / 7 d, never kept signed in.
- The policy is re-evaluated from the current principal at every refresh. Access JWTs last 15 minutes.

### 2.5 Admin Web

**Capabilities.** `core/permissions/capabilities.ts` is "UX affordances only" (`:1-18`).
- `NavArea` lists 20 areas (`:21-41`), and `visibleAreas(role)` maps roles to areas:
  - super_admin: everything except organization (`:90`)
  - manager: all (`:102`)
  - admin and coverage: 15 areas (`:119`)
  - finance, technical, academic: tasks and accounts (`:124`)
- `SERVER_CONFIRMED_AREAS` (`:170-182`) hides some areas until a probe confirms them: `GET /lessons/access`, `/instalments/access`, `/materials/admin/access`, `/calendar/options` (`app/AppShell.tsx:46-62`).
- The role comes from `GET /me` (`core/auth/SessionProvider.tsx:30-35`).

**Routing.** `app/AppRoutes.tsx` guards each route with `Area` (`:54-58`, `canOpenArea(role, area)`) or `SuperAdminOnly` (`:62-66`). `/admin/:section` goes to `AdminSectionPage`, using the `ADMIN_SECTIONS` registry (`features/admin/sections.ts:89-415`). Several sections are `in_development` placeholders.

**Organization page.** `features/organization/OrganizationPage.tsx` has three tabs: Children, Teachers, Structure.
- Backups and covers are gated `super_admin || manager` (`:261`).
- No UI edits roles or department membership.

**Accounts page.** `features/accounts/AccountsPage.tsx`, from PD-21: search, filter by kind (staff only for the super admin, `:62`), and per-row actions gated by the server's `allowed{}` flags.
- There is **no "create account"** button.
- `sections.ts:204` still says account management "is not built yet". That text is stale.

**Certificates page.** `features/supervision/CertificatesPage.tsx`, routed at `/teachers/certificates` (`AppRoutes.tsx:108`, inside the Teachers area, which is gated by `lessonManager`) and `/admin/teachers/certificates` (`:172-175`).
- It renders title, achievement, date, grade, teacher note, decline reason, learner name, teacher name and state.
- Actions: issue (upload a PDF, JPEG, PNG or WebP up to 20 MB) and decline. There is no template, preview or download.
- Teacher qualification certificates (`/teacher-profiles`) are a different feature. The boundary doc says the two "must never share a table, a screen or an API" (`JAWUID-CHAT-PRODUCT-BOUNDARY.md:1222-1224`).

### 2.6 Certificates backend (PD-12 S1)

`apps/api/src/certificates/certificate.controller.ts:11-37` sits under `/learner-certificates`.

| Route | Who, today (`certificate.service.ts`) |
|---|---|
| `GET /learner-certificates?state=` | A teacher sees their own requests. Staff need `canSupervise`, and results are narrowed by PD-35 teacher scope (`:138-159`, capped at 500). |
| `POST /learner-certificates` | A teacher, for their own learner: `canRequestCertificate` (`pd012-policy.ts:61-71`). |
| `POST /:id/upload` | `requireSupervisor` and `requireOpen` (`:174-182, 329-344`). Returns a signed PUT URL scoped to `conversations/<deliveryGroupId>`. |
| `POST /:id/issue` | Same checks. Verifies the file's magic bytes, posts the file card into the learner's group (author null) and a card into the teacher's supervision chat (`:185-252`). |
| `POST /:id/decline` | Same checks (`:266-284`). |

**Data.** `chat.learner_certificate` (`20261019090000_chat_pd012_s1.sql:299-452`).
- Grants to `chat_app` are revoked, so it is server-only.
- A trigger makes the request fields write-once and allows one decision.

**Response DTO** (`:375-401`): `id, state, learner{id,name}, teacher{id,name}, title, achievement, achievedOn, grade, printedName, note, requestedAt, decidedAt, declineReason, fileName, deliveredTo, canDeliver`.
- **No parent phone, e-mail or finance data appears anywhere in this module.**
- `familyId` is read internally to choose the card language and is never returned.
- Once a file is issued it is reachable only through the group's media route.

### 2.7 Release guard G-20

`scripts/qa/guards.sh:232-252` blocks the names in `G20_NAMES` anywhere outside `docs/`, and `g20-meta` proves the guard still catches them. PD-40 seeds **role** names only ("Designer"), never people. QA accounts use the synthetic seed (`apps/api/src/cli/org-chat-seed.ts:22-25`).

---

## 3. Permission model

### 3.1 Vocabulary

| Term | Meaning | Where |
|---|---|---|
| **Permission** | A page-and-action string, `<page>.<action>`, e.g. `certificates.view`. Named in code, described in the catalogue. | `chat.permission`, mirrored by `apps/api/src/platform/permissions/catalogue.ts` |
| **Page** | A unit of the Admin Web nav. It owns a set of permissions and at least one `*.view`. | Catalogue `page` column, and the Admin Web page registry |
| **Access role** | A named bundle of permissions, stored as data. It is org-wide or belongs to one department, and has a **tier** (§5). | `chat.access_role` + `chat.access_role_permission` |
| **Tier** | The account's hierarchy level, which is today's `chat.staff.role`. It is kept for the 80 existing checks and for hierarchy. A new tier `specialist` has **no implicit powers**. | `chat.staff.role` |
| **Grant** | An access role assigned to an account. | `chat.staff_access_role` |
| **Effective permissions** | `legacy_bundle(tier, department kind) ∪ ⋃ granted roles`. The super admin holds `*`. | `chat.staff_effective_permissions(staff_id)`, loaded into `Actor.permissions` |

### 3.2 Catalogue (first cut; the PR-1 inventory completes it)

Every permission records: `key`, `page`, `action`, bilingual label and description, `risk`, `delegable`, and `introduced_by` (the PD number).
- `risk` is one of `none | pii | family_contact | finance | admin`. It drives the warnings in the role editor.
- `delegable` false means only the super admin may grant it.

| Page | Permissions (examples) | Risk |
|---|---|---|
| `certificates` | `certificates.view`, `certificates.design` (upload), `certificates.deliver` (send to the family). The names are agreed with PD-41, which owns the certificates workflow and adds `request.student`, `request.teacher`, `story` and `oversee`. | pii (the printed child name) |
| `chats` | `chat.use` (open the chat app / socket), `chat.internal_notes` | family_contact |
| `families`, `parents` | `families.view`, `families.assign`, `parents.view`, `parents.edit_contact` | family_contact |
| `instalments`, `payments` | `billing.view`, `billing.record`, `billing.verify` | finance |
| `teachers`, `teacher_files`, `supervision`, `leave`, `cases` | `lessons.manage`, `teacher_files.view`, `teacher_files.edit`, `leave.decide`, `cases.manage` | pii |
| `trials`, `schedule`, `materials`, `stories`, `calls`, `dashboard`, `reports` | `<page>.view`, `<page>.manage` | varies |
| `organization` | `org.view`, `org.manage_structure` (non-delegable) | admin |
| `accounts` (families/teachers) | `accounts.family.manage` (reset/suspend), `accounts.support_session` (impersonate; non-delegable) | admin |
| `staff_accounts` | `staff_accounts.view`, `staff_accounts.create`, `staff_accounts.manage`, `access_roles.manage` (non-delegable) | admin |
| `admin_portal` | `admin.inspect`, `admin.export` (non-delegable) | admin |
| self-service | none: `/me`, own sessions, own profile, own notifications are `@SelfService()` (§4.2) | — |

**Consistency rule.** `catalogue.ts` is the source the code compiles against. A migration seeds `chat.permission` from it, and a protected spec asserts the two are equal, as `AUTHORIZATION-MODEL.md` §1.5 prescribes. Adding a permission takes one catalogue row and one migration row, and nothing else.

### 3.3 Two layers, and why that avoids regressions

```
request ─▶ AuthenticatedGuard ─▶ PermissionGuard (NEW: page/action gate) ─▶ service ─▶ AuthorizationService / pd012 / PD-8 / PD-35 (UNCHANGED: role, department, scope)
```

- **Layer 1, the new `PermissionGuard`.** It checks only that the actor holds the route's declared permission. It denies by default. It cannot widen access, because the service still runs afterwards.
- **Layer 2, the existing services.** They keep their department and row-level rules unchanged. A permission is **necessary, never sufficient**, which is the wording `staff-profile-policy.ts` already uses.
- **The single exception.** Where a new restricted role must reach something only a department grants today, Layer 2 gains one explicit **permission basis** next to the department one. In PD-40 that applies only to certificates (§7).
- **Each legacy tier gets a bundle per department kind:** `manager@operations`, `manager@teachers`, `manager@sales`, `manager@general`, `supervisor@operations`, `supervisor@teachers`, `supervisor@none`, `legacy_department` (finance, technical, academic), and `super_admin = *`.
  - Each bundle is derived from what Layer 2 lets that combination reach today.
  - A table-driven spec checks every bundle against the DB-free decision functions (`decidePd012StaffAccess`, `decideBillingAccess`, `decideTeacherFileAccess`, `decideSubscription…`, `ROLE_PROFILE_PERMISSIONS`). A bundle that grants less than its policy fails the spec, and so does one that grants more.
  - Bundles must be accurate per department, not "everything". Otherwise a Teachers manager would appear to hold `billing.record` and could delegate it (§5).
- **Shadow mode.** `PERMISSION_GUARD_MODE=shadow|enforce`.
  - In `shadow`, a legacy-tier actor whose request would be denied is **let through**. The would-be denial is counted (`permission_guard_shadow_denied{route,tier}`) and logged.
  - The `specialist` tier is **always enforced**, even in shadow mode.
  - Enforcement is switched on only after the system-test stack shows zero shadow denials across a full QA pass.

**What this fixes on the way.** Any staff role reaching PD-21 parent and teacher administration (F4) now needs `accounts.family.manage`. Every legacy bundle includes it, so nothing regresses, but a Designer does not get it. In the same way, a future Marketing **manager** does not inherit `canAssignFamilies`'s "any manager", because `manager@general` lacks `families.assign`.

---

## 4. Enforcement

### 4.1 The server is the authority

- `PermissionGuard` is registered as an `APP_GUARD` directly after `AuthenticatedGuard` (`auth.module.ts:99`). It reads route metadata with `Reflector`, using the same mechanism as `@Public()`.
- **Every handler declares exactly one of:**
  - `@Public()`, which already exists.
  - `@Requires('certificates.view')` or `@Requires.any('a','b')`: staff need one of these.
  - `@SelfService()`: any authenticated principal, acting on their own data (`/me`, `/me/sessions`, own profile, own notifications, `/auth/logout`).
  - `@NotForStaff()`: parent- or teacher-only routes, such as a teacher's `POST /learner-certificates`. Staff get 403 here.
- **Non-staff actors** (parent, teacher, support session) pass Layer 1 on any non-`@Public` route, except an `@Requires` route marked `staffOnly: true`. Their rules stay in Layer 2, unchanged. The catalogue is a staff concept.
- **A route with no declaration is denied to staff at runtime.** This holds even in shadow mode, and is logged as `UNDECLARED_ROUTE`. The build-time test (§4.3) catches it first.
- **The realtime gateway.** The socket handshake for a staff actor requires `chat.use`. Without it, the socket joins only the account room, used for `access.changed` and notifications. `revalidateRealtime` re-reads permissions, so a 15 s sweep drops rights that were removed.

### 4.2 How a page's many routes are covered

- A page owns permissions, and each route names a permission, never a page. That covers the shared prefixes: for example, the Certificates page uses `GET /learner-certificates` (`certificates.view`) and `POST …/upload|issue` (`certificates.deliver`).
- The page registry (Admin Web) and the route map (API) meet at the permission key. A page's routes are found with `grep`, and both are listed in a generated file, `docs/security/pd040-route-permissions.md`, with one row per method + route template → declaration.
- Advisory probes stay: `GET /lessons/access`, `/instalments/access`, `/materials/admin/access`, `/calendar/options`. Each is declared as `@Requires.any(...)` of its page's permissions, or as `@SelfService()` where it only answers "what may I offer".

### 4.3 The guard test (fails when a route has no declaration)

`apps/api/test/unit/authorization/pd040-route-permissions.spec.ts`:
1. It walks every `*.controller.ts` under `apps/api/src`, using the `PATH_METADATA`/`METHOD_METADATA` technique of `rate-limited-routes.spec.ts`. It fails on any handler without exactly one declaration.
2. It fails on any `@Requires` key missing from `catalogue.ts`.
3. It fails if the generated `pd040-route-permissions.md` is stale, so every change of access is visible in review.
4. It asserts that the Designer bundle reaches **only** the routes in §7.1, plus `@SelfService` and `@Public` routes. The list is exact; a new route on the Designer's path fails the test until someone deliberately adds it.

The CI guard `bash scripts/qa/guards.sh pd040-routes` runs (1) and (3) without booting Nest.

### 4.4 The client only hides

- `GET /me` returns `permissions: string[]`. This replaces `PERMISSIONS_DEFERRED`, the one line `auth.dto.ts:79-89` anticipates. It also returns `tier`, `department` and `homePath`.
- A page registry (`apps/admin-web/src/core/permissions/pages.ts`) maps each page key to its path, required permission(s), bilingual nav label and nav destination.
  - `visibleAreas(role)` becomes `visiblePages(permissions)`.
  - `Area` and `SuperAdminOnly` become `<RequirePermission any={[…]}>`.
  - `homeFor` returns the first permitted page.
- A snapshot spec proves each legacy tier's nav **is identical** before and after the change, using the same `capabilities.ts` fixtures.

---

## 5. Hierarchy rules

Tiers, highest first: `super_admin` (4) > `manager` (3) > `admin`/`coverage` = supervisor (2) > `specialist`, `finance`, `technical`, `academic` (1).

The rules below form one DB-free decision, `decideStaffAccountAdmin(actor, target, act, facts)`, unit-tested as a whole matrix. They are repeated by a SQL guard, `chat.guard_staff_access_change`, on `chat.staff` insert and tier change, on `chat.staff_access_role` insert and delete, and on `chat.department_account`. Today's pattern is the same: the API never offers what the DB will refuse.

| # | Rule |
|---|---|
| H1 | **Nobody creates a super admin.** The tier `super_admin` stays CLI-only (the trigger at `20261013120000:57-80`), and the one-per-organization index stays. No API path opens `chat.provisioning_super_admin`. |
| H2 | **The super admin** may create, edit, suspend, reactivate, reset and sign out any staff account below tier 4 in their organization. They may grant any role and define roles. They never act on their own account. |
| H3 | **A manager may administer only accounts in their own department** (`department.manager_id = actor`) **whose tier is below 3.** They can never touch another manager, the super admin, another department's account, or their own. |
| H4 | **A manager may create only tier 1 (`specialist`) accounts**, and supervisors (tier 2) only if §12 Q3 says yes. The new account is placed in the manager's department. |
| H5 | **Grant ⊆ hold.** A creator may grant a role only if **every** permission in it is in the creator's effective permissions, and none is `delegable=false`. The super admin is exempt from the subset check but is still bound by H1. |
| H6 | **Department fence.** A manager may grant org-wide roles that pass H5, and roles of their own department. A role belonging to another department is never offered. |
| H7 | **Roles are defined by the super admin only**, unless §12 Q4 says otherwise. Because a manager cannot change what a role contains, H5 checked at grant time cannot be bypassed by editing the role later. When the super admin adds a permission to a role, that is the super admin's grant. |
| H8 | **No self-escalation.** Nobody changes their own tier, roles or department. Nobody grants `access_roles.manage`, `staff_accounts.create`, `accounts.support_session`, `org.manage_structure` or `admin.*` except the super admin. |
| H9 | **Staff accounts are never impersonated** (PD-21, unchanged). |
| H10 | **Every change is audited** in the same transaction, with actor, reason, before and after. Actions: `staff.account_created`, `staff.setup_code_issued`, `staff.activated`, `staff.access_role_granted`, `staff.access_role_revoked`, `staff.tier_changed`, `staff.department_changed`, `access_role.created`, `access_role.updated`, `access_role.archived`, and the existing `account.suspended`, `account.reactivated` and `session.revoked`. A permission list in an audit row is the resolved key set, so history stays readable after a role is edited. |

**Amendments to closed decisions** (to be recorded in boundary §4 under PD-40):
- PD-21: managers may administer accounts in their own department, under H3. Parent and teacher administration now requires `accounts.family.manage`.
- PD-8: H4, only if Q3 is yes, because placing supervisors is super-admin-only today.

---

## 6. Account lifecycle

### 6.1 Create

1. On **Admin Web → Staff accounts → New account**, the creator enters a display name, a sign-in e-mail, the department, the tier and one or more roles, then a reason.
   - A manager's department and tier are fixed.
   - The role picker shows only roles the creator may grant (H5, H6), each with a **permission preview**: pages, actions and risk badges.
2. `POST /api/v1/admin/staff-accounts` creates the account in one transaction:
   - `chat.account` (kind `staff`, status **`provisioned`**), `chat.staff` (tier) and the affiliation (§9).
   - The grants, and the audit rows.
   - A **setup code**, through the first-login primitive PD-43 built (PR #184, migration `20261028100000_chat_pd043_teacher_onboarding`). It works for any account kind, so PD-40 reuses it:
     - Issue the code with `PasswordResetService.issue({ ..., purpose: 'first_login' })` on the provisioned staff account. That gives 72 h (`FIRST_LOGIN_CODE_HOURS`) and 5 tries, and audits `account.first_login_code_issued`.
     - `chat.guard_password_reset_code` allows `purpose = 'first_login'` only on the admin channel, for a `provisioned` account, expiring within 72 h.
     - **PR-3 must widen that guard's staff-target rule.** As of #184 (b7af19ce), a `first_login` code may be issued only to a TEACHER account, and a staff account's code only by the super admin. PR-3 admits `first_login` for a `provisioned` staff account, issued by the super admin or by a manager for a `specialist` of their own department (S1, H3–H6).
3. **Delivery** (§12 Q5): the setup code is e-mailed to the sign-in address through the PD-25 mailer, and also shown once to the creator, for hand delivery as a fallback.

### 6.2 First login

1. The Admin Web sign-in page offers **"I have a setup code"**. That is the existing reset-code screen with new copy, completing through `POST /auth/password-reset` (`password-reset.controller.ts:27-36`).
2. Completing the code sets the password, and in the same transaction calls `chat.activate_account_with_code(code)` (PD-43).
   - The minimum password length is 4 for every account (#171), which supersedes this plan's earlier "12 for staff".
   - That function moves the account from `provisioned` to **`active`** (never the super admin) and writes `account.activated` `{kind, codeId, issuer}`.
   - Trigger `account_activation_is_by_first_login` refuses any other provisioned→active change.
3. The person signs in. `GET /me` returns their permissions and `homePath`. A Designer lands on **`/certificates`** and sees only that item in the nav.
4. **2FA:** not in PD-40, because none exists today. Recommended follow-up: TOTP, mandatory for any account holding a `finance`, `family_contact` or `admin` permission. Passkeys are already tracked under PD-23 phase B.

### 6.3 Ongoing management

| Act | Route | Effect |
|---|---|---|
| View the list | `GET /admin/staff-accounts?department&status&role` | Shows name, e-mail, department, tier, roles, status, last login and pending setup. A manager sees their own department only. |
| Edit roles, department, tier | `PATCH /admin/staff-accounts/:id` | Checked against H3–H8. Takes effect on the next HTTP request, because permissions are read per request. Writes a `principal_revocation` journal row of kind `access_changed`, so the confirmer pushes `access.changed` and re-validates the account's sockets **at once**, not after 15 s. Sessions are **not** revoked, because a narrowed role does not need a fresh login. |
| Suspend (UI: "Deactivate") | Reuses `POST /admin/accounts/:id/suspend` | PD-21 path: sessions revoked, sockets cut, barrier. A manager may suspend within H3. |
| Reactivate | Reuses `…/reactivate` | No old session comes back (PD-21). |
| Reset access | `POST /admin/staff-accounts/:id/setup-code` | A new code. Optionally signs the account out everywhere. Valid for a `provisioned` or `active` account. |
| Sign out devices | Reuses `…/sessions/revoke-all` | |
| Offboard (permanent) | Unchanged | Super admin only (`canDeactivateStaff`, `authorization.service.ts:1355`). |
| Audit trail | `GET /admin/staff-accounts/:id/history` | Requires `staff_accounts.view` in scope. |

**Super admin count:** exactly one, enforced by the existing index and trigger. The super admin's account is not visible as an editable row to anyone. Break-glass recovery stays with the CLI.

---

## 7. The Designer role

A seeded **template** role, `designer`: org-wide, tier `specialist`, permissions `certificates.view` and `certificates.design`. The super admin may edit it as data. **Aligned with PD-41 (2026-10-27):** the Designer designs and uploads, and never sends, cancels or declines. Sending is `certificates.deliver`, held by the requester. That settles §12 Q1 the PD-41 way, pending the owner.

### 7.1 Exactly what it reaches

| Route | Permission | Note |
|---|---|---|
| `GET /learner-certificates?state=` | `certificates.view` | Every request in the organization, or by assignment (§12 Q2). PD-35 teacher scope does not apply, because the Designer is not a supervisor. |
| `POST /learner-certificates/:id/upload` | `certificates.design` | A signed PUT URL, as today. PD-41 moves upload to its own design routes. |
| `POST /learner-certificates/:id/issue` | `certificates.deliver` | **Not** in the Designer bundle: sending is the requester's act (PD-41). |
| `POST /learner-certificates/:id/decline` | `certificates.deliver` | **Not** in the Designer bundle. Today the issuer declines; PD-41 replaces this with the requester cancelling and the Designer returning. |
| `GET /me`, `/me/sessions`, own profile, `POST /auth/logout`, own notifications | `@SelfService()` | |

**Nothing else.** No `/conversations`, `/families`, `/parent-profiles`, `/payments`, `/instalments`, `/teacher-files`, `/lessons`, `/org`, `/admin/*`, `/admin/accounts` or `/stories`. Also no socket rooms, because the Designer lacks `chat.use`. The route spec (§4.3 item 4) pins this list.

### 7.2 What the Designer sees: a redacted projection

`CertificateService` gains a **permission basis** next to `canSupervise`:
- If `canSupervise` is true, the full DTO, unchanged.
- Otherwise, if `certificates.view` is held, the **design projection**.

| Field | Shown to the Designer | Why |
|---|---|---|
| `id`, `state`, `requestedAt`, `canDeliver` | ✔ | workflow |
| `title`, `achievement`, `achievedOn`, `grade` | ✔ | what the certificate says |
| `printedName` | ✔ | the name printed on it, the only child PII the design needs |
| `teacher.name` | ✔ (signatory line) | Drop it if certificates are not signed by the teacher |
| `learner{id,name}` | ✘ | `printedName` covers it; the learner record is not needed |
| `teacher.id`, `deliveredTo`, upload `conversationId` | ✘ | internal ids that point at family conversations |
| `note` (teacher's free text) | ✘ | may contain family details. If the teachers use it for design instructions, add a separate `design_note` field later |
| `declineReason` | ✘ | |

**Issue as the Designer.** The family card is already posted with author null (`certificate.service.ts:236-242`). The supervision-chat card falls back to author null for a non-member (`card-poster.ts:62-73`), and the card says "Issued by Jawwid", never the Designer's name. `decided_by` records the Designer's staff id for the audit. The DB trigger's "active staff of the org decides" (`20261019090000:398-404`) gains a `chat.staff_has_permission(decider,'certificates.deliver') or teachers_department_role(...)` check.

### 7.3 Admin Web

There is a new top-level page, `/certificates`, outside the Teachers area. It reuses `CertificatesPage` and renders the design projection. The Teachers-area tab and the super-admin copy stay.

---

## 8. Admin Web UX

**Staff accounts** (a new tab on the existing Accounts page, or its own page; visible with `staff_accounts.view`):
- **List:** filter by department, status and role. Columns: name, e-mail, department, tier, roles (chips), status, last login, "setup pending".
- **New account** (a dialog with three steps):
  1. Identity: name and e-mail.
  2. Placement: department and tier, fixed for a manager.
  3. Roles: the picker with a live **permission preview**, a list of "This account will open: Certificates (view, deliver)". Any `pii`, `finance` or `family_contact` permission gets a red badge.
  - Confirm, with a reason, then a code sheet showing the code once and "e-mailed to …".
- **Detail:**
  - Roles, editable under H3–H8.
  - Status actions: deactivate, reactivate, reset access, sign out devices.
  - Devices, and the history from the audit trail.

**Roles** (super admin, `access_roles.manage`):
- A list of roles with member counts.
- **Create or edit:** name (English and Arabic), department or org-wide, and a checklist **grouped by page**: tick the page to grant `*.view`, then tick its actions.
  - A permission that a tier may not hold is disabled, with the reason.
- "Archive" stops new grants, while existing grants keep working until they are removed.

**The legacy nav is unchanged** (snapshot spec, §4.4). The stale "not built yet" note at `sections.ts:204` is removed.

**Flutter.** A `specialist` without `chat.use` who signs in to the staff app sees "This account uses Admin Web". The `POST /auth/login` response needs no change. The app reads `/me`.

---

## 9. Schema (one migration, PR-2; the slot is claimed at PR time)

```sql
chat.permission          (key text pk, page text, action text, label_en, label_ar, description_en, description_ar,
                          risk text check (risk in ('none','pii','family_contact','finance','admin')),
                          delegable bool, introduced_by text)                      -- seeded from catalogue.ts
chat.access_role         (id uuid pk, organization_id, key text, name_en, name_ar, description,
                          department_id uuid null,        -- null = org-wide
                          max_tier text,                  -- the highest tier it may be granted to
                          is_template bool, created_by, created_at, archived_at,
                          unique (organization_id, key))
chat.access_role_permission (role_id, permission_key → chat.permission, primary key (role_id, permission_key))
chat.staff_access_role   (staff_id, role_id, granted_by, granted_at, reason, primary key (staff_id, role_id))
chat.department_account  (staff_id pk → chat.staff, department_id, organization_id, assigned_by, assigned_at)
                          -- affiliation of a specialist; PD-8 scope functions NEVER read it
alter chat.staff.role check  … add 'specialist'
alter chat.department.kind check … add 'general'; uniqueness only for operations|teachers|sales
alter chat.password_reset_code add purpose text default 'reset' check (purpose in ('reset','first_login'))
chat.staff_effective_permissions(staff_id) returns text[]   -- legacy bundle(tier, dept kind) ∪ grants; '*' for super_admin
chat.staff_has_permission(staff_id, key) returns boolean
trigger chat.guard_staff_access_change … (H1–H8)
RT-032 journal: kind 'access_changed' on staff_access_role / tier / department changes
RLS: enabled, no chat_app grants (server-only, like learner_certificate)
```

**Legacy bundles live in SQL as well** (`chat.legacy_permission_bundle(tier, dept_kind)`). The TS mirror (`legacy-bundles.ts`) is asserted equal, so the API, the triggers and `/me` cannot disagree. This follows the same rule as PD-8's "one function".

**Which department a staff member belongs to:** `department.manager_id`, then `department_member`, then `department_account`.

**The SQL sites that say "any manager"** (`supervision-conversation.service.ts:244`, `mention.service.ts:219`, `presence-policy.ts:67,98`, `trial-group.service.ts:195,353`, the `isConversationStaff` set) are audited in PR-2. A manager of a `general` department (Marketing) must reach no family data. A spec seeds a Marketing manager and asserts empty results for families, conversations, mentions and presence.

---

## 10. Scaling: adding the Accountant or Marketing later

1. If the role needs a page that exists (for example the Accountant on Instalments and Payments), the super admin creates the role in the Roles UI. **No code and no deploy.**
2. If the page needs a Layer-2 permission basis (as certificates did), that is one small PR: a basis next to the department check and a projection if PII must be trimmed. Billing will need `billing.view` and `billing.record` as a basis in `decideBillingAccess`.
3. A **new page** is a catalogue row, a migration row, `@Requires` on its routes (which the route test forces), and one page-registry entry in the Admin Web.
4. A new department is data: a `general` department created by the super admin (`org.manage_structure`), its manager, and its roles.

---

## 11. Rollout, tests and PR breakdown

### 11.1 PRs (stacked; each merged by hand after all-green CI)

| PR | Scope | Behaviour change | Migration |
|---|---|---|---|
| **PR-0** (this) | PD-40 claim and this plan | none | — |
| **PR-1** API route layer | `catalogue.ts`, `@Requires`/`@SelfService`/`@NotForStaff` decorators, `PermissionGuard` in **shadow** mode, declarations on all 427 handlers, legacy bundles in TS, the route spec plus the generated route table, the bundle ⇔ policy consistency spec, the `pd040-routes` guard | none (shadow) | — |
| **PR-2** Data model | The §9 migration: tables, `specialist`, `general` kind, effective-permission functions, `guard_staff_access_change`, `access_changed` journal, catalogue ⇔ table spec, the "any manager" SQL audit, `Actor.permissions` loaded per request, `/me` returns permissions | none for existing accounts | 1 slot |
| **PR-3** Staff account lifecycle API | `decideStaffAccountAdmin` (H1–H10) plus its matrix spec, `/admin/staff-accounts` create/list/detail/patch/setup-code/history, `/admin/access-roles` CRUD, `/admin/permissions`, first-login activation, PD-25 mailer delivery, `accounts.family.manage` on PD-21 routes, realtime `chat.use` handshake | new endpoints only | maybe a sub-slot (code `purpose`) |
| **PR-4** The Designer role | **Scope cut 2026-10-27:** PD-41 owns the certificates workflow, its pages, its `certificates.*` keys, the design projection and the certificate rules. PD-40 PR-4 only seeds the `designer` template role with PD-41's keys (`certificates.view`, `certificates.design`) and pins its exact routes. | additive | maybe a sub-slot |
| **PR-5** Admin Web | Page registry, `visiblePages`, `<RequirePermission>`, the legacy-nav snapshot spec, the Staff accounts and Roles UI, the setup-code sign-in, Flutter's "uses Admin Web" screen. The `/certificates` page itself is PD-41's. | legacy nav identical | — |
| **PR-6** Enforce | System-test QA pass with zero shadow denials, then flip `PERMISSION_GUARD_MODE=enforce`, rewrite `AUTHORIZATION-MODEL.md` §3/§4, record PD-40 in boundary §4, update `docs/admin/pd021-account-administration.md` | enforcement on | — |

**PR-2 as built (2026-10-27)**
- **Built:**
  - Migration `20261027190000_chat_pd040_access_roles`: the `specialist` tier; `chat.permission` and `chat.legacy_permission_bundle`, seeded from the TypeScript sources and pinned by `pd040-catalogue-seed.spec.ts`; `chat.access_role`, `chat.access_role_permission` and `chat.staff_access_role`.
  - `chat.staff_access_profile` and `chat.staff_has_permission`.
  - The only writers: `define`, `update` and `archive_access_role`, and `grant` and `revoke_access_role`. A trigger refuses any other write. They enforce H1, H3, H5, H7 and H8, and audit H10 in the same transaction.
  - `PermissionGuard` and `GET /me` now read the SQL profile.
- **Moved to PR-3:**
  - The repeatable `general` department kind, `chat.department_account` for specialists, and the `access_changed` journal kind. Prisma upserts departments on the unique `(organization_id, kind)`, which a partial index would break, so these land with the department-creation code that needs them.
  - Until PR-3 hands out `staff_accounts.manage`, only the super admin grants. The SQL already refuses everyone else.
- **"Any manager" audit:**
  - The PD-8 functions grant a manager a basis only over members of their own department. `chat.mention_eligible_staff` and the seat reasons require a PD-8 basis. So a manager with no supervisors reaches no family data through SQL.
  - PR-3 must keep `general` departments free of `department_member` rows (a trigger), and must enforce, not shadow, any account placed in a `general` department.
  - The TypeScript role-set checks (`FAMILY_FACING_STAFF_ROLES`, `canAssignFamilies`) are behind Layer 1 for such accounts. `canAssignFamilies` and `canTransferStaffFamilies` have no callers.

**Order and parallel work**
- PR-1 and PR-2 can be built side by side (different files), but PR-2 merges first, because PR-1's bundles move into SQL.
- PR-5 can start once PR-3's contract is frozen in `docs/contracts/API-CONTRACT.md`.
- Within the machine-load rules, at most two builder sessions at once.

### 11.2 Tests

**Unit, DB-free**
- `decideStaffAccountAdmin`: the full matrix of tier × department × act × target.
- `PermissionGuard`: declared / undeclared / non-staff / shadow / enforce.
- Bundle ⇔ policy consistency.
- Catalogue ⇔ route coverage.
- The Designer's exact route set.
- The design projection: no redacted field present.

**Integration** (own database, capped workers, per the machine-load rules)
- Each H rule is refused both by the API and by the SQL trigger, attempted directly.
- Create, then setup code, then first login, then `/me`, then the Designer reaches Certificates and gets 403 on a representative route of every other page.
- A role change narrows access on the next request, and sockets re-validate within 1 s.
- Suspend cuts sessions and sockets.
- A Marketing manager reaches no family data.

**Admin Web**
- The legacy-nav snapshot per tier.
- `visiblePages`.
- The role picker hides roles that may not be granted.
- The Designer's home is `/certificates`.

**Guards:** `scripts/qa/guards.sh` before every commit (G-20, pd-registry, the new `pd040-routes`).

### 11.3 Rollout

1. Merge PR-1 through PR-5 with the guard in shadow mode. Existing staff see no difference.
2. On the system-test stack, create a QA Designer (synthetic name) and run the end-to-end flow. Run a full legacy QA pass and read `permission_guard_shadow_denied`.
3. Fix any shadow denial in a bundle, then merge PR-6 (enforce).
4. In production, the owner creates the real Designer from the Admin Web, so no person's name is ever in the repo (G-20).

---

## 12. Questions for the owner (each with a recommendation)

> **DECIDED 2026-10-28.** The owner approved the recommendations to Q3–Q6, with six security safeguards; see §13. The questions below are kept as asked.
>
> **2026-10-27:** Q1 and Q2 moved to PD-41, which owns the certificates workflow (`docs/product/pd041-certificates-design.md`). PD-41's design already has the Designer designing and uploading, never sending, and seeing a design projection only. PD-40 still needs Q3–Q6.

1. **Does the Designer send the certificate to the family, or only prepare it?** Issuing posts the file into the family's group.
   - **Recommended: the Designer uploads and issues** (that is the page's job), but **cannot decline**.
   - Alternative: the Designer uploads a draft and a Teachers-department supervisor issues it. That needs a new `prepared` state.
2. **Which certificate requests does the Designer see, and which details?**
   - **Recommended: every request in the organization**, showing only the design fields in §7.2. No learner record and no teacher note.
3. **May a Manager create *supervisor* (admin) accounts in their own department, or only department staff accounts?**
   - **Recommended: department staff accounts (specialists) only in this release.** Placing supervisors changes who reaches families (PD-8) and stays with the super admin.
4. **Who defines roles?**
   - **Recommended: the super admin only.** Managers pick from roles the super admin made and may grant only those whose permissions they hold themselves.
5. **How does a new account receive its first-login code?**
   - **Recommended: e-mailed to the sign-in address (valid 72 h), and also shown once to the creator.** Alternative: shown to the creator only.
6. **Roles only, or also per-account page ticks?**
   - **Recommended: roles only.** The Roles screen makes a new role from a page checklist in one step. Per-account exceptions drift and cannot be reviewed.

**Not asked, decided by this plan** (the owner can overturn any of them):
- Exactly one super admin.
- No staff impersonation.
- 2FA as a follow-up PD, mandatory for accounts holding finance or family-contact permissions.
- "Deactivate" in the UI means reversible suspension; permanent offboarding stays with the super admin.

---

## 13. Owner decision on Q3–Q6 (2026-10-28) and its safeguards

The owner answered, verbatim: "Approve all 4 recommendations, with these security safeguards". So:
- **Q3:** managers create department staff (specialist) accounts only.
- **Q4:** only the super admin defines roles.
- **Q5:** the first-login code is e-mailed and shown once.
- **Q6:** roles only, with no per-account overrides.

### 13.1 Each safeguard, its mechanism and its test

| # | Safeguard (owner) | Mechanism | State | Test |
|---|---|---|---|---|
| S1 | Managers create regular staff accounts only in their own department. Only the super admin creates supervisor accounts or assigns elevated supervisory roles. | H4: a manager creates tier `specialist` only, in their own department. Supervisor and manager tiers come from the super admin only. **A non-super-admin grantor may grant only a role with `max_tier = 'specialist'`, and only to a `specialist` account in their department.** | Tier rules: PR-3. Grant narrowing: **PR-3 changes `chat.require_access_grantor`**, which today admits any tier below manager (C1). Department fence: `chat.staff_in_managed_department`, which PR-3 extends to `department_account`. | Integration, against the API and the SQL. A manager is refused when: creating a supervisor or manager; granting to a supervisor; granting a role with `max_tier` above specialist; acting on another department's account. Plus the unit matrix for `decideStaffAccountAdmin`. |
| S2 | RBAC enforced in the backend and the database, not only the UI. Never beyond one's own permissions, directly or through a role. No privilege escalation, no cross-department access. | Layer 1: `PermissionGuard`. Layer 2: the services. The SQL writers are the only path, and `guard_access_role_writes` refuses direct DML. H1: never the super admin. H5: every key of the role held and `delegable`. H7: only the super admin edits a role, so a manager cannot widen a role after granting it. H8: never oneself. No key is delegable until verified. | On main (#172, #174), except that the guard is still SHADOW for legacy tiers and enforce is the head's call after review and QA. PR-3 marks a verified, delegable set. | `pd040-access-roles` (integration): direct writes refused, H1/H3/H8, and a specialist refused over HTTP. `pd040-legacy-bundles`: no key is delegable unverified. PR-3 adds: a manager granting a role with one key they don't hold is refused (H5); a manager granting a non-delegable key is refused. |
| S3 | The initial sign-in code is CSPRNG, single-use, 72 h, e-mailed to the sign-in address and shown to the creator once, never stored or logged in plaintext, with expiry and a reissue flow, and invalidated after use. | PD-43's first-login primitive (#184): `purpose = 'first_login'`, 72 h, 5 tries, `crypto.randomInt`. Single use comes from `used_at`, which is set in the same transaction that activates. Reissue supersedes every live code. Only a hash is stored. The plaintext is returned once in the creator's response. Logs carry the code id only. E-mail goes through PD-25's `SmtpRecoveryMailer` (`SMTP_URL` + `RECOVERY_MAIL_FROM`), with a first-login template. | Primitive: #184 (PD-43), with **gap G1** (§13.2, sent to PD-43). E-mail and the reissue route for staff: PR-3. | PR-3 tests, unit and integration: a code is shown once and appears in no audit row and no log line; after 72 h it is refused; a reissue kills the old code; a second use is refused; activation happens only through the code. |
| S4 | Roles only, no per-account overrides. The super admin creates a role from a checklist in one step, validated so a role cannot grant unauthorized privileges. | `chat.define_access_role`: one call, keys and tier, unknown keys refused, at least one key, super admin only. There is no per-account grant table: grants are roles. **Addition (C2): a role can never contain a super-admin-only key** (`admin.inspect`, `org.departments`, `chat.export`, `staff_profiles.organization`, `staff_profiles.reporting_lines`, `accounts.support_session`, and PR-3's `access_roles.manage` / `staff_accounts.*` at tier manager), so no role can rebuild the super admin. A catalogue flag `inRoles: false` is mirrored in SQL. | Define and validation: on main. Exclusion: PR-3, with a migration. | Integration: defining a role with a super-admin-only key is refused. Unit: the catalogue flag matches the SQL rows. |
| S5 | Audit logs for account creation, role assignment, code issuance and reissuance, and permission changes. | On main: `access_role.created`, `access_role.updated` and `access_role.archived`; `staff.access_role_granted` and `staff.access_role_revoked`, each with its resolved keys. PD-43: `account.first_login_code_issued` and `account.activated`. PR-3 adds: `staff.account_created`, `staff.tier_changed`, `staff.department_changed`, and a reissue audited as `account.first_login_code_issued` with `{ supersedes: <code id> }`. | Partly on main; the rest in PR-3. | `pd040-access-roles` asserts the grant, revoke and role audits once each. PR-3 asserts the rest. |
| S6 | Verify consistency with the permission model and department structure first. Do not touch Jawwid Core. Follow the project safeguards. | §13.2. Nothing in PD-40 reads or writes Jawwid Core (the repo has no Core code: `jawwid-chat-is-not-core`). Slots, guards, G-20, the stack and hand merges are followed. | Done (this section). | — |

### 13.2 Consistency check against main (`a547b0e2`, 2026-10-28)

| # | Finding | Consequence |
|---|---|---|
| C1 | `chat.require_access_grantor` lets a manager grant to any account below tier manager. That includes supervisors (`admin`/`coverage`) in their department, and roles up to `max_tier` supervisor. Not reachable today, because nobody holds `staff_accounts.manage`. | **Conflicts with S1.** PR-3 narrows it: a non-super-admin grants only roles with `max_tier = 'specialist'`, only to `specialist` accounts. |
| C2 | `chat.define_access_role` accepts any catalogue key, including the super admin's own powers. Only the super admin can call it, but a role could still reproduce super-admin powers for someone else. | **Gap against S4.** PR-3 adds the `inRoles: false` exclusion, in TypeScript and SQL. |
| C3 | Every catalogue key is `delegable = false` (pinned by spec). | Consistent with S2, which fails safe: a manager can delegate nothing yet. PR-3 must verify and flip a minimal set, each key backed by a policy in `pd040-legacy-bundles`. Otherwise managers can create accounts but not give them anything. |
| C4 | `chat.guard_password_reset_code` lets only the super admin issue a code for a staff account, and #184 (b7af19ce) allows `first_login` codes for teacher accounts only. | PR-3 widens it: `first_login` for a `provisioned` staff account, issued by the super admin, or by a manager for a `specialist` of their own department (S1). Nothing more. |
| C5 | The departments are `operations`, `teachers` and `sales`, one each per organization, and `department_member` admits only `admin`/`coverage`. There is no home for a specialist yet. | PR-3 adds `chat.department_account` (specialists only) and keeps `department_member` closed to `general` departments (plan §9). S1's "own department" is `department.manager_id`, then `department_member`, then `department_account`. |
| C6 | Reset and first-login codes were 6 digits stored as unkeyed `sha256(accountId:code)`. That's 10⁶ candidates, so a leaked table would recover a live code offline. | **Resolved in #184 (PD-43, b7af19ce).** EVERY one-time code, reset and first-login alike, is hashed with HMAC-SHA256 (`resetCodeHash(accountId, code)`) under a dedicated `RESET_CODE_HASH_SECRET`. The manifest marks it secret: optional locally (derived from `JWT_REFRESH_SECRET` there), required in staging and production, and the API fails closed without it. The table alone recovers nothing. The migration retires every code stored the old way. A reissue audits `after.supersedes`. A 5th wrong try supersedes the code. Activation requires the code to have been spent in the same transaction. |
| C7 | The e-mail channel exists (PD-25 `SmtpRecoveryMailer`), but `SMTP_URL` is optional in production. When it is absent, the channel is unavailable. | **Deployment prerequisite for S3:** production needs `SMTP_URL` and `RECOVERY_MAIL_FROM`. The e-mail is sent after commit, with a first-login template (Arabic and English) and `emailed: false` when the channel is unavailable. Teachers get it in PD-43 PR-2; staff in PD-40 PR-3. On failure only the code id is logged. The development log sender (`RECOVERY_DELIVERY_LOG`) is refused at boot in production. |
| C8 | `PermissionGuard` shadows legacy tiers, while a `specialist` is enforced from its first request. | Consistent with S2 for every new account. Enforcing for legacy accounts is the head's PR-6 decision, after an independent security review and a `SHADOW_DENIED` QA pass. |
| C9 | The owner's "only the super admin creates supervisor accounts" matches PD-8: placing a supervisor in a department is `org.departments`, super admin only. | Consistent; no change. |

---

## 14. Shadow QA (2026-10-28): what answers 200 today stays allowed

On the systest stack at main `a547b0e2`, QA ran every parameter-free Admin Web GET for each seeded persona, with the guard in shadow mode. The results:
- **No undeclared routes, and the super admin was denied nothing.**
- The Operations and Teachers managers: no route that answers 200 would be refused.
- **Eleven routes that answer 200 today would be refused once the guard enforces.**

`test/unit/authorization/pd040-shadow-qa.spec.ts` now pins every persona's 200 routes. Fixture: `fixtures/pd040-systest-200-a547b0e2.json`. Each pair was decided from the current Layer-2 rule:

| Persona | Route | Layer 2 today | Decision |
|---|---|---|---|
| Sales manager | `GET /admin/impersonations`, `/:id/actions` | `ImpersonationService.list` returns the caller's own support sessions (the super admin's: all) | **Declaration corrected** to `@SelfService()`. It's the caller's own record. Starting, re-tokening and ending a session stay `accounts.support_session`, and Sales still cannot start one (the #167 rule). |
| Sales manager | `GET /cases` | any staff member, filtered to cases they own, opened or manage. Sales can open none (subject scope) and own none (targets are Teachers or Operations), so it's an empty list | **Intended, kept as is:** `cases.view` goes into the Sales bundles. Not delegable. |
| Sales manager | `GET /courses`, `/lessons`, `/correction-requests` | courses: any staff. Lessons and correction requests: any staff, filtered by standing and visibility | **Intended:** Sales picks the course on the enrolment form (PD-16). `lessons.view` goes into the Sales bundles. |
| Sales manager | `GET /materials/quran/surahs` (and `/quran/ayahs`, `/quran/tajweed`) | any signed-in account ("the shared, verified Quran text") | **Declaration corrected** to `@SelfService()`. It's reference text that holds nothing about anyone. |
| Operations supervisor, Teachers supervisor | `GET /org/group-candidates` | any conversation staff member, scoped to the families they supervise; it feeds "open a family group" | **Declaration corrected** to `chat.manage`, the key of `POST /conversations/family-group`. |
| Operations supervisor, Teachers supervisor | `GET /staff-profiles/team` | any staff member, filtered to the direct reports the profile policy lets them view | **Declaration corrected** to `@SelfService()`, like `/staff-profiles/:staffId`. |
| Teachers supervisor | `GET /stats/teachers` | `StatsService.isStatsReader`: the Teachers department (members too) and the super admin | **Intended:** `reports.view` goes into Teachers members' bundle. |

None of these needed a tighter Layer 2: every 200 matched the service rule as written.

The bundle rows are in migration `20261028120000_chat_pd040_shadow_qa_bundles` (a generated `LATER` block; the `20261027190000` seed is frozen). The integration check is `pd040-access-roles` (table equals TypeScript).

Not covered: parameterised and write routes, and the Flutter staff app. Those come with the PR-6 QA pass.

---

## 15. PR-3 as built (2026-10-28)

**Migration `20261029100000_chat_pd040_staff_accounts`:**
- `chat.permission.in_roles` (S4/C2).
- The `staff_accounts.view` / `.create` / `.manage` and `access_roles.manage` keys, none of which goes in a role. The department managers' bundles hold the `staff_accounts.*` keys.
- The minimal delegable set (C3): `certificates.view`, `certificates.design`, `billing.view` and `subscriptions.view`. Each is verified both ways in `pd040-legacy-bundles`.
- `chat.department_account` (C5).
- `chat.create_staff_account` and `chat.may_administer_staff_account`.
- `chat.require_access_grantor` narrowed (C1). `chat.set_access_role_permissions` refuses barred keys. PD-43's `chat.guard_password_reset_code` is widened in its staff branch only (C4).

**API:**

| Route | Key | Rule |
|---|---|---|
| `GET /admin/staff-accounts`, `GET /:staffId` | `staff_accounts.view` | The super admin: every staff account but their own and the super admin's. A department manager: the specialists of their department. Anything else is not found. |
| `POST /admin/staff-accounts` | `staff_accounts.create` | `decideStaffAccountCreate` and `chat.create_staff_account`. The roles are granted, and the first sign-in code (PD-43, HMAC-keyed, 72 h) is issued, in the same transaction. The code is e-mailed after the commit and shown once (`emailed`). |
| `POST /:staffId/roles`, `/:staffId/roles/:roleId/revoke` | `staff_accounts.manage` | `chat.grant_access_role` / `revoke_access_role` (H1, H3, H5, H8, C1). |
| `POST /:staffId/setup-code` | `staff_accounts.manage` | A reissue for a provisioned account. It supersedes every live code, and the audit names them. |
| `GET /admin/access-roles`, `GET /admin/permissions` | `staff_accounts.view` or `access_roles.manage` | The roles, each with `grantable` for this caller, and the checklist they're made from. |
| `POST /admin/access-roles`, `/:roleId`, `/:roleId/archive` | `access_roles.manage` | The super admin only (H7, S4). |
| PD-21 `/admin/accounts/:id/{password-reset,suspend,reactivate,sessions/*}` | `accounts.administer` | Also open to a department manager for their own specialists while the subset rule below holds (`managedByActor`, decided by `chat.may_administer_staff_account`). A manager's reset code is e-mailed, never returned. Never impersonation. |

**After the department head's review (2026-10-28):**
- **P1: a reset code is impersonation.** Administering an account includes resetting its password, which is as good as holding the account. So a manager administers a specialist only while every key the specialist holds is one the manager holds and may delegate. `chat.may_administer_staff_account` applies that rule, and so do `decideStaffAccountManage`, the grantor rule, the reset-code guard and the list. Otherwise only the super admin administers that account.
- **P1: manager-issued codes are e-mailed only.** When a manager issues a code for a staff account (a PD-21 reset or a setup-code reissue), it goes to the sign-in address and is never returned. With e-mail off, the manager issues none (409). Only the super admin sees a staff member's code. Creation keeps the owner's rule (shown once and e-mailed): a new account holds only what its creator granted.
- **P2: role edits.** `chat.update_access_role` refuses an edit that adds a key a granting manager may not grant. The refusal names those grants (`COMM.ACCESS_ROLE_CONFLICT`, 409). `chat.grant_access_role` reads the role `FOR SHARE`, so a grant and an edit never interleave.
- **P2: suspend, reactivate and sign-out.** The database refuses them for a staff account too, using the same predicate:
  - `chat.guard_staff_account_status` takes the actor from `chat.account_admin_actor` (set by the PD-21 service) or from `deactivate_principal`'s requester. A suspension that names nobody is an operator's (the CLI). A reactivation always names someone.
  - `chat.guard_staff_session_revocation` checks a session ended by another account.
- **P2: defence in depth.** `chat.staff_access_profile` ignores a role's barred keys, and the migration stops if any role holds one. `accounts.administer` is barred too. The `in_roles` generator is append-only: each migration bars its own keys.

**Known limit (accepted by the department head, 2026-10-28):** the database does not check a staff account's suspension when the suspension names no actor. That is how the operator command-line tool suspends: `deactivate-principal --suspend` passes no requester. So a server-side writer that calls `chat.deactivate_principal` without a requester can still suspend any staff account. Suspension only takes access away, never grants it. A reactivation, a sign-out by another account, and any suspension that does name an actor are always checked.

**Still to come:**
- PR-5: the Admin Web Staff accounts and Roles UI.
- Repeatable `general` departments and moving a specialist between departments.
- The `access_changed` journal: today, HTTP picks up a role change on the next request and sockets within 15 s.

## 16. PR-4 as built (2026-10-28)

- **Migration `20261029190000_chat_pd040_designer_template`.** `chat.seed_access_role_templates(org)` adds the template roles an organization lacks:
  - It is idempotent and returns how many roles it added.
  - It skips a key the organization already uses.
  - It audits each role it adds as `access_role.created`, with no actor and `template: true`.
  - The migration runs it for every organization that exists at that point. An organization created later gets the templates by running the same function.
- **The template list.** It lives in `apps/api/src/platform/permissions/role-templates.ts`, and the migration seeds it from a generated block. `pd040-role-templates.spec.ts` keeps the two in step, as the catalogue seed spec does. The catalogue, the legacy bundles and the earlier seed blocks are unchanged.
- **The Designer.** It is a specialist role holding `certificates.view` and `certificates.design`, never `certificates.deliver`. Both keys are delegable and held by the Teachers manager only. So the super admin and the Teachers manager can grant it, the latter to a specialist of the Teachers department.
  - Its exact routes are pinned by PD-41 in `pd040-route-permissions.spec.ts`.
  - This PR adds a check that everything its keys open is a `/certificates` or `/learner-certificates` route.
- **Once seeded, a template is ordinary data.** The super admin edits or archives it like any other role. `GET /admin/access-roles` now marks it with `template: true`.

**PR-4b, the review of #231 (migration `20261029220000_chat_pd040_template_followups`):**
- **The seed no longer skips silently.** If an organization already has a non-template role with a template's key, the seed raises a notice and audits `access_role.template_skipped` (the key and the existing role's id). So a manager's later H5 refusal of "designer" has a trail. A template that is already seeded is still skipped quietly: that is what makes the seed idempotent.
- **`is_template` is provenance only.** `chat.update_access_role` clears it when the super admin changes a template's keys. From then on it is the organization's own role. Its audit row records `template`.
- **New organizations.** The super-admin bootstrap seeds the templates for its organization (`templatesSeeded` in its output). The runbook (`docs/admin/super-admin-bootstrap.md`) says how to seed an organization provisioned another way.

