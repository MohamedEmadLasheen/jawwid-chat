# Phase 1 — Identity, Security & Core Foundation — Report

Status: **COMPLETE — the §7 deferrals are closed by the closure pass (§10)** · 2026-09-07
Branch: `phase1/identity-security-foundation`
Companions (all now implemented rather than planned): `../architecture/IDENTITY-MODEL.md`,
`../architecture/AUTHORIZATION-MODEL.md`, `../architecture/SUPERVISOR-OWNERSHIP.md`,
`../architecture/TENANCY-MODEL.md`, `../security/RLS-STRATEGY.md`.

---

## 1. What Phase 1 had to close

Phase 0 shipped a working communication engine whose authorization was real and
whose **identity was not**. Three facts defined the starting point:

| Fact | Evidence |
|---|---|
| There was no authentication. HTTP identity was the `x-actor-id` header; WebSocket identity was `handshake.auth.actorId`. Any caller could name any active actor. | red-team RT-001 / NF-08, the sole open P0 |
| Teachers had no identity. A teacher "existed" iff some `chat.learner.teacher_id` equalled the id; `displayName` was the literal `'Teacher'` and `isActive` was hard-coded `true`. | `identity.service.ts:52-65` |
| Roles decided everything and scope decided nothing. Any family-facing staff member could read **every** conversation in the system. | A-1 / RT-011 |

All three are closed. So are five defects found on the way, three of them
pre-existing and invisible (§4).

---

## 2. What was implemented

### 2.1 Authentication

* **Password login** against `chat.account` + `chat.account_credential`
  (scrypt from `node:crypto`, parameters stored with the hash so the cost can be
  raised later). No plaintext is stored, logged or returned; no API path selects
  a hash.
* **Access tokens** are short-lived HS256 JWTs carrying the session id. Only
  HS256 is accepted — `alg` is validated against a constant and never used to
  select an algorithm, so `alg:none` and an RS256-headed token fail exactly like
  random bytes.
* **Three gates on every request**: the signature verifies, the session row is
  live (not revoked, not expired, still owned by the account in the token), and
  the principal is re-read from the database and still active. Gate 2 makes
  logout, revocation, suspension and password reset effective on the NEXT
  request rather than at token expiry. Gate 3 makes offboarding immediate.
* **Nothing the token asserts beyond identity is used.** Role, tenant,
  permissions and scope are re-derived server-side per request.
* **Protected by default**: `AuthGuard` is an `APP_GUARD`, so a new controller
  is authenticated unless it declares `@Public()`. The three Phase 0 routes that
  took no actor at all (`student-group/:learnerId/sync`,
  `DELETE /notifications/devices/:token`, `POST /notifications/:id/delivered`)
  are authenticated and scoped.
* **The WebSocket authenticates identically** — same bearer token, same service
  — and re-validates the socket's identity on `subscribe` and
  `presence.heartbeat`, dropping it when the session or the principal has gone
  (RT-009).
* **Fail-closed startup**: the process refuses to start unless
  `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are both set, ≥32 characters, and
  different from each other. There is deliberately no development fallback.
* `src/platform/identity-seam.ts` and `actor.decorator.ts` are **deleted**.

### 2.2 Account lifecycle

`provisioned → active → suspended → active`, and `deactivated` (terminal). One
predicate (`status = 'active'`), on the row, with `chat.account.is_active`
maintained as a trigger-derived mirror so every pre-Phase-1 reader agrees by
construction. Every transition requires a reason, writes `chat.audit_log`, and
revokes sessions in the same operation — an account that can no longer log in
but still holds a live token has not been deactivated.

E-mail verification is **recorded, not enforced**: nothing in the MVP is gated
on it, and silently refusing a login for it would be an invisible outage.
`/me` reports the fact; the decision to gate on it is a product one.

### 2.3 Sessions and devices

* `chat.session` binds to `chat.device`. Refresh tokens are opaque, **stored
  hashed**, and **rotated on every use** — a stolen one is good once, and using
  it invalidates the legitimate holder's, which is how the theft becomes visible.
* **One live session per device**: re-authenticating on the same installation
  replaces its session rather than consuming a second seat, so the limit counts
  devices and not logins.
* **The device limit is configuration, not code** (`chat.config`
  `auth.max_active_devices`, `auth.device_limit_policy`). Default
  `revoke_oldest`, chosen because the failure mode of the alternative is a
  person locked out of the device in their hand by a session they cannot see;
  `reject_new` is implemented and tested for operations that prefer it.
* Logout current device / one named device / everywhere. **Revoking "my"
  session filters on the account id in the WHERE clause**, so a session id
  belonging to somebody else matches zero rows and is reported as not found — a
  user can never revoke another user's session.
* Password **change** keeps the caller's session and ends every other;
  password **reset** ends every session including one an intruder is holding.

### 2.4 Identity

* `chat.teacher` exists, with a real name and a real `is_active`.
  `chat.learner.teacher_id` is now a **foreign key** to it, and the synthesis
  path is deleted. The backfill preserves ids, so no learner row and no
  conversation-membership row moved.
* A teacher cannot be deactivated while still teaching a learner — the group
  would keep a teacher member who can no longer act, which is the C-4 hole.
* `Actor` carries `organizationId`, `accountId`, `sessionId`, `department` and
  the actor's **effective permission set**. None of it comes from the request.

### 2.5 RBAC

* The canonical four staff roles (PD-5): `super_admin`, `manager`, `admin`,
  `coverage_admin`. `coverage` renamed; `finance | technical | academic` were
  never roles and are now `chat.staff.department`, an attribute that makes a
  staff member non-family-facing and ineligible to hold a family.
* **Permissions are data**: `chat.permission`, `chat.role_permission`, mirrored
  in `rbac/permissions.ts` with a test asserting the two are identical.
* **Per-account overrides**: `chat.account_permission_override`, resolved by one
  precedence function — **an unexpired DENY beats an unexpired ALLOW beats the
  role default; anything else is refused**. A DENY applies to a `super_admin`
  too. An expired override is not an override.
* Controllers call `authz.can(actor, permission)`. The role-name comparisons
  that remained (`staffRole === 'manager'` in delete-for-everyone) are gone.

### 2.6 Supervisor scope

* `chat.family_assignment` with history: exactly one live `primary` per family
  (partial unique index), `temporary` cover bounded by an explicit window, a
  mandatory reason, and `assigned_by`. `family.owner_id` becomes a mirror
  maintained by trigger, so every pre-Phase-1 reader keeps working.
* **PD-3 honoured**: `chat.on_duty()` is not an authorization input. It survives
  only as the interim routing input to `canSend`.
* `ScopeService` is the single definition of which families an actor reaches,
  **read live on every call**. A reassignment therefore takes effect on the very
  next request: there is no cache to invalidate and no session to wait out.
* `canRead` takes scope explicitly and **`undefined` denies** — a caller that
  cannot establish scope has not earned an allow.
* The conversation list, the family list and search, and the moderation queue
  **build their WHERE from that predicate** rather than filtering afterwards.

### 2.7 Tenancy

Phase 0 had already put `organization_id` on 23 root tables with restrictive
policies. Phase 1 makes the boundary real: `Actor.organizationId` is set at
authentication and never from a request field, `account.subject` is unique **per
organization** rather than globally, the two logs gain the column, and
cross-organization conversation creation and account administration are refused.
A manager — the widest scope in the model — still stops at their organization.

### 2.8 RLS

Seventeen tables had RLS **disabled**, so the restrictive organization policies
added for them constrained nothing at all. It is now enabled on **every table in
the schema**, with read policies mirroring `canRead`, per-recipient policies for
notifications and receipts, and no grant at all on credentials, sessions,
devices or tokens — those are unreadable by construction rather than by a policy
that could be widened. `PrismaService.withActor()` sets the four
transaction-local settings the policies resolve a caller through.

---

## 3. Database changes

### Tables added

| Table | Purpose |
|---|---|
| `chat.teacher` | teacher identity (id, organization, account, name, `core_teacher_id`, `is_active`) |
| `chat.account_credential` | password material, one row per account, with lockout state |
| `chat.device` | one installation per account (`account_id`, `client_key` unique) |
| `chat.session` | one login, bound to a device; hashed refresh token; revocation columns |
| `chat.account_token` | hashed single-use tokens for verification and reset |
| `chat.family_assignment` | who supervises which family, with history |
| `chat.permission`, `chat.role_permission` | the permission vocabulary and the role mapping |
| `chat.account_permission_override` | per-account ALLOW / DENY |

### Columns added

`chat.account`: `status`, `email_verified_at`, `last_login_at`,
`deactivated_at`, `deactivated_by`, `deactivated_reason` ·
`chat.staff`: `department` · `chat.device_token`: `device_id` ·
`chat.event_log`, `chat.audit_log`, `chat.outbox_event`, `chat.core_event`:
`organization_id`.

### Relationships

`learner.teacher_id → teacher.id` (was a bare uuid) · `staff.account_id`,
`contact.account_id`, `teacher.account_id → account.id` ·
`session.account_id`, `session.device_id` · `family_assignment.family_id`,
`.staff_id`.

### Indexes carrying an invariant

`family_assignment_one_live_primary` (BR-4: one family, one live primary) ·
`account_subject_per_organization_key` · `device_account_client_key` ·
`account_permission_override_unique` · `teacher_core_id_key`.

### Triggers

`family_opens_primary_assignment` · `family_assignment_is_guarded` (only an
active, family-facing, non-departmental supervisor; same organization) ·
`family_assignment_mirrors_owner` · `account_is_active_is_derived` ·
`teacher_deactivation_is_guarded` · the extended `guard_staff_deactivation`.

### RLS

RLS enabled on every table in schema `chat`. New read policies for
`conversation`, `conversation_member`, `message`, `message_attachment`,
`message_reaction`, `message_receipt`, `message_hidden_for`,
`message_approval`, `conversation_participant_state`, `call`,
`call_participant`, `notification`, `device_token`, `quiet_hours`, `teacher`,
`organization`, `family_assignment`, plus restrictive tenant policies on
`event_log` and `audit_log`. `chat_app` (NOBYPASSRLS) and `chat_service`
(BYPASSRLS) created.

### Migrations

| File | Contents |
|---|---|
| `20260907100000_chat_phase1_identity.sql` | teacher, account lifecycle, credentials, devices, sessions, tokens, session config |
| `20260907100100_chat_phase1_rbac.sql` | canonical roles, departments, permission tables, override resolver |
| `20260907100200_chat_phase1_assignment.sql` | `family_assignment`, scope predicates, reassignment/cover/offboarding |
| `20260907100300_chat_phase1_rls.sql` | RLS everywhere, communication policies, connection roles |
| `20260907100400_chat_phase1_log_event_return_type.sql` | fixes `chat.log_event()` (§4) |
| `20260907100500_chat_phase1_policy_helper_privileges.sql` | re-elevates the policy helpers (§4) |

All six apply cleanly to an **empty** database (28 migrations, verified from
zero), and the migration chain is idempotent through `scripts/db/apply.sh`.

---

## 4. Defects found and fixed on the way

Three were pre-existing and invisible; two were introduced by this work and
caught by its own tests. All five are named because a defect that is fixed
quietly is a defect nobody learns from.

| # | Defect | Why it was invisible | Fix |
|---|---|---|---|
| 1 | `chat.log_event()` declared `returns uuid` while `chat.event_log.id` is a bigint identity. **Every call failed** with `invalid input syntax for type uuid: "2"`. | Nothing in the application called it; the SQL functions that do (`transfer_ownership`, `offboard_staff`, `post_customer_message`, `assign_family_owner`) had no end-to-end test. Phase 1's `assign_family_supervisor()` was the first path a test reached it through. | migration `…100400` |
| 2 | Phase 1 redefined `chat.current_account_id()` and `chat.staff_can_see_family()` with `CREATE OR REPLACE`, which resets attributes the new definition does not restate — silently dropping the `SECURITY DEFINER` applied in `20260905091300`. Symptom: `permission denied for table account` on an ordinary SELECT. | Introduced here. Caught by `db/tests/rls_enforcement.sql`. | migration `…100500`, plus a `schema_acceptance.sql` gate that fails if any policy helper loses the attribute again |
| 3 | `ScopeService` compared a **database-written** `starts_at` against the **API host's** clock. Ten milliseconds of skew made a just-created assignment invisible to its own supervisor. | Introduced here. Caught by the integration suite. | the comparison is removed, with the reasoning recorded at the query; `ends_at` is still compared, where drift is bounded by a window measured in days |
| 4 | **A-7 / RT-012** — the receipt roster (which staff member read a message, and when) was served to whoever could read the message, family contacts included. | Pre-existing; recorded in the audit, never closed. | `toMessageDto` takes a viewer; staff see the roster, everybody else sees their own receipt, and an unspecified viewer sees none |
| 5 | **A-8 / RT-006** — `signUrlsForMessages()` minted signed object URLs for any message id handed to it, performing no scoping of its own. | Pre-existing. | it takes the conversation the read was authorized against and filters on it |

Plus: `deleteForEveryone` compared `staffRole === 'manager'`, which excluded
`super_admin` and could not see a per-account DENY. It asks for the permission.

---

## 5. API changes

| Endpoint | Auth | Authorization |
|---|---|---|
| `POST /auth/login` | public | credentials; uniform failure |
| `POST /auth/refresh` | public | live session; token rotated |
| `POST /auth/forgot-password` | public | always the same response |
| `POST /auth/reset-password` | public | single-use token; revokes all sessions |
| `POST /auth/verify-email` | public | single-use token |
| `POST /auth/logout` | bearer | own session only |
| `POST /auth/change-password` | bearer | requires the current password |
| `GET /me` | bearer | own actor, with effective permissions |
| `GET /me/sessions` · `DELETE /me/sessions/:id` · `DELETE /me/sessions` | bearer | scoped to the caller's account **in the query** |
| `GET /families` (list + `q` search) | bearer | `families.read` + scope predicate |
| `GET /families/:id` · `GET /families/:id/assignments` | bearer | `families.read` + scope; out of scope reads as **404** |
| `POST /families/:id/assignment` · `POST /families/:id/cover` · `DELETE /families/assignments/:id` | bearer | `families.assign`, reason required, audited |
| `GET /users/accounts` · `GET /users/accounts/:id` | bearer | `users.manage`, own organization only |
| `POST /users/accounts/:id/{activate,suspend,deactivate,password,reset-token,verification-token}` | bearer | `users.manage`, reason required, audited |
| `DELETE /users/accounts/:id/sessions` | bearer | `users.manage` |
| `PUT`/`DELETE /users/accounts/:id/permissions/:permission` | bearer | `users.manage`, reason required |
| every existing communication route | bearer | unchanged decisions **plus** scope |
| `GET /health*` | public | reports `rlsEnforced` |

New error codes: `COMM.OUT_OF_SCOPE`, `COMM.PERMISSION_DENIED`,
`COMM.CROSS_TENANT`, and the `AUTH.*` family.

---

## 6. Security guarantees, and how each is obtained

**IDOR.** Every by-id read applies the scope predicate **inside the query**
rather than after it. A family, conversation, message, approval, call or
account outside the caller's scope is *not found* — the response to a real id
and an invented one is byte-identical, so probing ids reveals not even
existence. Asserted for `GET /families/:id`, conversation read, message
list/send/read-cursor, membership change, approval decision, call history and
token, notification acknowledgement, and account administration.

**Privilege escalation.** Nothing the client sends is read as authority: no
role, tenant, owner, actor or session field is honoured from a request. Modes
(`on_behalf_mode`) are derived, and assist/escalation fail closed (JC-005).
Permissions are checked against the actor's effective set, so a per-account
DENY restricts a `super_admin`. Deactivating yourself is refused.

**Cross-tenant access.** `Actor.organizationId` comes from the account.
Restrictive RLS policies AND with every permissive one, so a tenant mismatch
removes rows regardless of any other policy. `chat.enforce_same_organization()`
refuses cross-tenant child rows at write time with the API bypassed entirely.
Account administration filters on the administrator's own organization and
reports another tenant's account as not found.

**Supervisor scope bypass.** Scope is a single predicate read live from
`chat.family_assignment`, consulted by `canRead` (where `undefined` denies), by
every list endpoint's WHERE clause, by the moderation queue, by search, by the
realtime subscribe check, and by RLS. **Search is not a second path**: it
narrows an already-scoped set. Reassignment is one transaction that ends the old
assignment and opens the new one, so there is no instant with two supervisors or
none — and the previous supervisor's historical *membership row* deliberately
does not rescue them.

**Session persistence after password reset.** A reset consumes a single-use
hashed token and revokes **every** session for the account, so the token an
intruder holds stops working; verified from both sides in
`auth-and-sessions.spec.ts`.

**Credential and token exposure.** No API returns a hash. `chat.account`,
`account_credential`, `session`, `device` and `account_token` have **no grant**
to `authenticated`, so there is no privilege for a policy mistake to widen.
Refresh, reset and verification tokens are stored as keyed hashes; IP addresses
are stored hashed; tokens are never logged.

---

## 7. What Phase 1 did NOT do

Stated plainly, because an unlisted gap is the one that gets assumed away.

1. **The API still connects as the database owner in this environment.** The
   `chat_app` / `chat_service` roles exist and are NOLOGIN; granting them LOGIN
   and pointing `DATABASE_URL` / `DATABASE_SERVICE_URL` at them is a deployment
   step. Until then RLS is proved live in `db/tests/rls_enforcement.sql` (which
   runs as `authenticated`) but is not the enforcing layer at runtime.
   `/health/ready` reports `rlsEnforced` so the state is visible rather than
   assumed. **`AuthorizationService` remains the only authorization boundary in
   a deployment where that is still false.**
2. **The mobile application was not changed.** No Dart toolchain is installed on
   this machine (`flutter`/`dart` absent), so anything written there would be
   unverified. `lib/core/data/http/unavailable_auth_repository.dart` still
   throws, and the debug-only `x-actor-id` header seam still exists in
   `lib/core/network/actor_identity.dart` — inert, because the server no longer
   reads that header. Remaining mobile work: implement `AuthRepository` against
   §5, delete `DebugActorHeaderIdentity`, and store tokens in the platform
   keychain.
3. **The Admin Web's non-auth API surface still does not exist.** `/inbox`,
   `/tasks`, `/coverage`, `/dashboard`, `/families/:id/messages`, `/me/duty`
   and `/config` are called by the client and implemented by nothing — a Phase 0
   gap this phase did not widen or close. There is consequently no dashboard or
   inbox endpoint to scope; when they are built they must build on
   `ScopeService`, and the family list and search demonstrate the shape.
4. **The coverage engine is deprecated but not removed** (PD-3). `on_duty()`
   remains the interim routing input to `canSend`; removing it now would be a
   regression.
5. **Rate limiting on `/auth/login` is not implemented.** Credential lockout is
   (per-account, `auth.max_failed_attempts` / `auth.lockout_seconds`), but there
   is no per-IP throttle; that belongs at the edge and the manifest has no entry
   for it yet.
6. **`TENANCY-MODEL.md` M-2 remains open for everything but `account.subject`**:
   push tokens, call room names and notification dedupe keys are still globally
   unique. Accepted knowingly for one tenant.
7. **Realtime `conversation.access_revoked`** (SUPERVISOR-OWNERSHIP §3.3) is not
   emitted on reassignment. The socket loses access within one heartbeat because
   the identity is re-validated, and a subsequent subscribe is refused — but the
   client is not proactively told.

---

## 8. Verification — actual results

Run on 2026-09-07 against a database built from empty by
`scripts/db/integration-db.sh reset`.

| Gate | Command | Result |
|---|---|---|
| Migrations | `scripts/db/integration-db.sh reset` | **28 applied from empty, 0 errors** |
| Schema acceptance | `db/tests/schema_acceptance.sql` | **pass** (86 assertions) |
| BR-1 invariants | `db/tests/br1_invariants.sql` | **pass** (18) |
| OD-01 model | `db/tests/od01_conversation_model.sql` | **pass** (12) |
| Tenant isolation | `db/tests/tenant_isolation.sql` | **pass** (9) |
| Assignment invariants | `db/tests/assignment_invariants.sql` | **pass** (24) — new |
| RLS enforcement | `db/tests/rls_enforcement.sql` | **pass** (29) — new |
| API unit | `jest --selectProjects unit` | **153 passed, 11 suites** |
| API integration | `jest --selectProjects integration` | **169 passed, 8 suites** |
| API typecheck | `tsc -p tsconfig.json --noEmit` | **pass** |
| API build | `tsc -p tsconfig.build.json` | **pass** |
| Prisma schema | `prisma validate` | **valid** |
| Admin Web tests | `vitest run` | **76 passed, 11 files** |
| Admin Web typecheck | `tsc --noEmit` | **pass** |
| Admin Web build | `vite build` | **pass** |
| Protected tests | `scripts/qa/check-protected-tests.sh` | **pass**, 17 files |
| Environment | `scripts/infra/check-env.sh local` | **pass**, 62 variables |
| Secret scan | `scripts/infra/scan-secrets.sh` | **clean** |
| Mobile | `flutter analyze`, `flutter test` | **NOT RUN — no Dart toolchain on this machine** (§7.2) |

**Baseline before Phase 1**, for comparison: API unit 114 / integration 81,
Admin Web 74, all passing; no lint script exists in either package (linting is
Dart-only, via `analysis_options.yaml`); `flutter` was already absent.

Two pre-existing environmental notes, unchanged by this work:
`test/integration/schema-invariants.spec.ts` shells out to `psql`, which is not
installed on this machine (Docker is), and one stale partially-migrated database
failed a migration that applies cleanly from empty.

---

## 9. Definition of done

| Requirement | State |
|---|---|
| Email/password authentication, login, logout, `/me` | done |
| Email verification | done (recorded, not enforced — §2.2) |
| Forgot / reset / change password | done |
| Account activation / deactivation | done |
| Device registration, multiple devices, device limit | done |
| Individual device logout, logout all | done |
| Password reset invalidates sessions | done |
| Real User/Identity model; Super Manager, Manager, Supervisor, Teacher, Family | done (`super_admin`, `manager`, `admin`/`coverage_admin`, `teacher`, `parent`) |
| Teacher no longer `learner.teacher_id` | done — it is a foreign key to a real identity |
| Roles and permissions centralized; checks reusable | done |
| Custom overrides; ALLOW/DENY precedence defined and tested | done |
| Supervisor → family assignment; reassignment changes access immediately | done |
| Conversations, messages, search, moderation, calls, notifications scoped | done |
| Dashboard scoped | **no dashboard endpoint exists** (§7.3); dashboard-style counts are asserted to derive from the scoped query |
| Academy/Tenant foundation; Jawwid as a tenant; cross-tenant blocked | done |
| IDOR fails; client cannot choose privileges, tenant or scope | done |
| Sensitive authentication data protected | done |
| Database/RLS protections reviewed | done; **runtime enforcement pending the connection-role change** (§7.1) |
| Tests, typecheck, build, migrations pass; no unrelated regressions | done (§8) |

---

# 10. Closure pass — 2026-09-07

Everything §7 left open, and what became of it. Where an item was closed, the
proof is named; where something remains, it is stated with the exact action
required.

## 10.1 Every §7 item, resolved

| § | Item | Final status |
|---|---|---|
| 7.1 | The API connects as the database owner | **CLOSED in code; one deployment step remains.** `chat_app` now holds exactly the privileges the application uses, owns nothing, cannot create, cannot bypass RLS. Every authenticated request runs inside that actor's transaction-local context. `runtime-rls.spec.ts` runs the REAL services through that role and proves both halves. The process **refuses to start** on an over-privileged connection outside `local \| test \| ci`, and `/health/ready` drains the instance if the connection changes under it. Remaining: point `DATABASE_URL` at `chat_app` (§10.6) |
| 7.2 | Mobile not changed | **UNCHANGED, and now specified.** `docs/mobile/AUTH-CONTRACT.md` is the full client contract. Server-side compatibility is asserted: a request carrying `x-actor-id` and no bearer is refused identically to one carrying nothing |
| 7.3 | Admin Web's non-auth surface does not exist | **Unchanged, out of scope.** A Phase 0 gap this phase neither widened nor closed |
| 7.4 | Coverage engine deprecated but present | **Unchanged, by design (PD-3).** `on_duty()` remains the interim routing input to `canSend` and is not an authorization input |
| 7.5 | No rate limiting on `/auth/login` | **CLOSED.** Per-source and per-target throttling on login, forgot-password and reset redemption. `docs/security/AUTH-THROTTLING.md` |
| 7.6 | Tenancy M-2 | **CLOSED.** Push tokens, call room names and notification dedupe keys are unique per organization, with a trigger against cross-tenant hand-over |
| 7.7 | `conversation.access_revoked` not emitted | **CLOSED, and it was a real gap.** The existing mechanisms covered identity, not SCOPE |

## 10.2 The runtime security model, and where each layer is enforced

```
Authentication   AuthGuard (APP_GUARD)          signature + live session + active principal,
                                                re-read from the database on EVERY request
      ↓
Session          chat.session                   revocable; checked per request, so logout,
                                                suspension and reset are immediate
      ↓
Identity         IdentityService                actor resolved from the session, never the request
      ↓
Tenant           Actor.organizationId           set at authentication; RESTRICTIVE RLS policies AND
                                                with every permissive one, so a mismatch removes rows
      ↓
Role             chat.staff.role                the canonical four; a department is an attribute
      ↓
Permission       chat.role_permission           + per-account ALLOW/DENY; DENY beats ALLOW beats role
                 + account_permission_override
      ↓
Scope            ScopeService                   read LIVE from chat.family_assignment; `undefined`
                 chat.staff_in_scope()          denies; list endpoints build their WHERE from it
      ↓
Resource         AuthorizationService           the single decision point: canRead / canSend /
                                                canCall / canApprove / can(permission)
      ↓
RLS              chat_app, NOBYPASSRLS          the catch, not the decision: a missing WHERE returns
                 + ActorContextInterceptor      nothing instead of everything
```

Two properties of that stack are worth stating because they are what make it a
stack rather than a list:

* **Each layer fails closed on its own.** An unresolvable scope denies; an
  unresolvable actor context makes the database return zero rows; a missing
  permission set holds nothing. No layer's failure is another layer's default.
* **The database layer is never the reason a request is allowed.** It is the
  reason a buggy query returns less than it asked for. An unexpectedly empty
  result on a write path is treated as an authorization failure.

## 10.3 What the closure pass built

**Least privilege (`20260907120000`).** `chat_app` with explicit DML on the 19
tables the application writes and SELECT on the reference tables it reads.
Identity tables (`account`, `account_credential`, `session`, `device`,
`account_token`) are reachable by `chat_app` alone and by no policy for
`authenticated` — because authentication cannot be policed by the mechanism it
bootstraps, and that concession is bounded rather than hidden. Write policies
mirroring `canRead` on every domain table.

**Request-scoped actor context.** `PrismaService.runWithActor()` +
`withRequestScopedTransaction()` + `ActorContextInterceptor`. Services were not
changed: an `AsyncLocalStorage` carries the transaction, and a proxy routes
every query into it. Nested `$transaction` calls are flattened into the
request's, which is what those call sites already wanted.

**Throttling (`20260907120100`).** `chat.auth_throttle` with a single-statement
counter. Per-source and per-target, counted before the credential is examined
and identically for unknown subjects.

**Tenant natural keys (`20260907120200`).** M-2, plus the cross-tenant
assignment defect below.

**Realtime revocation.** `revokeLostSubscriptions()` on `presence.heartbeat`.

## 10.4 Defects found by the closure pass

| # | Defect | Severity | Fix |
|---|---|---|---|
| 1 | **A family could be assigned to a supervisor in another organization.** `guard_family_assignment()` compared the assignment's organization to the family's, and never to the STAFF member's. The supervisor then held full, legitimate scope over another academy's family | **High** — the one cross-tenant path RLS could not catch, because every row was correctly stamped and only the *relationship* crossed the boundary | trigger compares all three organizations (`20260907120200` §4) |
| 2 | **A push token could be captured across tenants.** `device_token.token` was globally unique and `registerDevice` moves the row to the caller on conflict. A push token is not a secret | **High** — redirects a victim's notifications | unique per organization + a hand-over trigger |
| 3 | **Membership additions were unvalidated.** `setMembership` wrote a client-supplied `actorId`/`actorKind` with no check that the actor exists, is active, is the kind claimed, or belongs to this family | **Medium** — an in-scope supervisor could pull an out-of-scope contact into a conversation, or smuggle a contact in as a `teacher` past the BR-1 kind checks | `assertAddable()` |
| 4 | `chat_app` and `chat_service` were created **NOINHERIT**, so membership of `authenticated` conferred neither its grants nor its policies (`pg_has_role(..., 'USAGE')` is false for a non-inheriting member). The application would have seen zero rows everywhere | **Would have blocked the deployment**, fail-closed | `alter role ... inherit` + re-grant; asserted by `schema_acceptance.sql` |
| 5 | `INSERT ... RETURNING` fails when a table's SELECT policy re-reads the row being inserted. `conversation`'s policy called `can_read_conversation()`, so every conversation creation failed under a NOBYPASSRLS role | **Would have blocked the deployment** | policy expressed against the row's own columns; `notification` and the two logs insert without `RETURNING` |
| 6 | RLS policies inherited from Phase 0 assumed a STAFF reader: a parent could not read their own `chat.contact` row, so every request from a family device failed `unknown actor` | **Would have blocked the deployment** | narrow self/co-member read policies |

## 10.5 Verification — fresh results, 2026-09-07

Run against a database built from empty in an isolated worktree and container.

| Gate | Result |
|---|---|
| Migrations from empty | **32 applied, 0 errors** |
| `db/tests/schema_acceptance.sql` | **pass** |
| `db/tests/br1_invariants.sql` | **pass** |
| `db/tests/od01_conversation_model.sql` | **pass** |
| `db/tests/tenant_isolation.sql` | **pass** |
| `db/tests/assignment_invariants.sql` | **pass** |
| `db/tests/rls_enforcement.sql` | **pass** |
| API unit + integration | **482 passed, 26 suites** (322 before the closure pass; the count includes the Phase 2 messaging work merged in alongside it) |
| — of which `runtime-rls.spec.ts` | **17 passed** — least privilege proved end to end |
| — of which `security-regression.spec.ts` | **25 passed** |
| — of which `auth-throttling.spec.ts` | **12 passed** |
| — of which `realtime-revocation.spec.ts` | **10 passed** |
| API typecheck / build / `prisma validate` | **pass / pass / valid** |
| Admin Web tests / typecheck / build | **76 passed / pass / pass** |
| Protected-tests gate | **pass**, 21 files |
| Merged with the concurrent Phase 2 messaging work | clean; `chat.message_revision` granted to `chat_app` with policies mirroring its message (§10.4 note) |
| `check-env.sh local` | **pass**, 64 variables |
| `scan-secrets.sh` | **clean** |
| Lint | **no lint script exists** in either package; linting in this repository is Dart-only (`analysis_options.yaml`) and Dart is not installed |
| Mobile (`flutter analyze/test`) | **NOT RUN — no Dart toolchain on this machine** |

## 10.6 The one remaining action, and what it is

**Point the API at `chat_app`.** Everything else is done.

```sql
-- once, per environment, from the secret store's provisioning path
ALTER ROLE chat_app     LOGIN PASSWORD '<from the secret store>';
ALTER ROLE chat_service LOGIN PASSWORD '<from the secret store>';
GRANT CONNECT ON DATABASE <db> TO chat_app, chat_service;
```

```
DATABASE_URL          = postgres://chat_app:...@host/db      # API only
DATABASE_SERVICE_URL  = postgres://chat_service:...@host/db  # worker, migrations
```

The roles are created NOLOGIN by migration because a migration must never carry
a credential. `scripts/db/integration-db.sh` does exactly this for the test
database, so the shape is exercised on every run.

**Does it block production?** It blocks *deploying with RLS as a live control* —
and the application enforces that itself: outside `local | test | ci` the
process **will not start** on an owner, superuser, creator or BYPASSRLS
connection. There is no configuration in which the gap is silent.

## 10.7 Verdict

**PHASE 1 — PRODUCTION READY**, subject to §10.6, which the application refuses
to let anyone skip. The two genuinely open items are a mobile client that cannot
yet sign in (a feature gap, not a security one — the server is safe against the
legacy client) and edge-level volume protection, which no application-level
limiter can provide and which `AUTH-THROTTLING.md` §5 states rather than implies.
