# Jawwid Chat — Identity Model

Status: **CANONICAL** · Locked in Phase 0 (2026-09-07) · Implemented in Phase 1
Companions: `AUTHORIZATION-MODEL.md`, `TENANCY-MODEL.md`, `../security/RLS-STRATEGY.md`,
`../contracts/API-CONTRACT.md` §3.1–3.2.
Historical inputs (reference): `docs/integration/auth-current-state.md`,
`authentication-decision-gate.md`, `authentication-implementation-boundary.md`,
`core-authentication-contract-request.md`, `open-contract-decisions.md`.

---

## 1. What is wrong today (verified)

| Fact | Evidence |
|---|---|
| There is no authentication. HTTP identity is the `x-actor-id` header; WebSocket identity is `handshake.auth.actorId`. | `apps/api/src/communication/api/actor.decorator.ts`, `realtime.gateway.ts:57`; red-team RT-001 / NF-08, the sole open P0 |
| Teachers have no identity. A teacher "exists" iff some `chat.learner.teacher_id` equals the id; `displayName` is the literal `'Teacher'` and `isActive` is hard-coded `true`. | `apps/api/src/platform/identity.service.ts:52-65` |
| `chat.account` exists (opaque `subject`, `kind ∈ {staff, family}`, `is_active`) but nothing writes it, no credential or session table exists, and Prisma has no `Account` model. | `supabase/migrations/20260905090050_chat_identity.sql` |
| Two competing authentication implementations exist on archived branches. | `archive/phase0/feat/ai7-runtime-fixes` (D-6: login/refresh/logout, password hashing, `chat.account_credential`, `chat.session`), `archive/phase0/fix/ai8-p0-blockers` (bearer verification guard only) |
| Phase 0 containment: the seam cannot start outside `local | test | ci`. | `apps/api/src/platform/identity-seam.ts` (protected test) |

---

## 2. Concepts

```
Organization ─┬─ Account ──(1)── Credential(s)
              │     │
              │     ├── Session ──(n)── Device
              │     │
              │     └── exactly one Principal:
              │           Staff  (admin | coverage_admin | manager | super_admin)
              │           Teacher
              │           Contact (parent / guardian, on a Family)
              │
              └─ Actor = the resolved principal for one request
                 { actorId, kind: staff | teacher | contact | system, isActive, organizationId, … }
```

| Concept | Definition | Table (Phase 1) |
|---|---|---|
| **Account** | The login identity. Carries an opaque `subject`, a `kind`, a lifecycle `status`, `organization_id`. **Never** a phone number or e-mail (BR-2; enforced by the privacy test). | `chat.account` (MODIFY: add `kind='teacher'`, `status`, `deactivated_at`, `deactivated_by`, `last_login_at`) |
| **Credential** | How an account proves itself. MVP: username + password (Argon2id hash, PRD §7.1 — no public registration, no OTP reset in MVP). Provisioned by a manager or synced from Jawwid Core. | `chat.account_credential` (NEW) |
| **Principal** | The domain-side identity an account acts as. Exactly one of Staff, Teacher, Contact. `system` is an actor kind with no account. | `chat.staff.account_id`, `chat.teacher.account_id` (NEW table), `chat.contact.account_id` |
| **Session** | One authenticated login, bound to a device. Access token (short-lived JWT, HS256 today; key rotation supported by `kid`) carries `sid`; refresh token is opaque, hashed at rest, rotated on every refresh, revocable. Revocation is checked on every request (one indexed lookup). | `chat.session` (NEW) |
| **Device** | A device record: platform, app version, push token linkage, first/last seen. A session binds to a device (PRD §7.1). | `chat.device` (NEW); `chat.device_token` stays the push-token table and gains `device_id` |
| **Actor** | The request-scoped resolution of a session → account → principal. This is what `AuthorizationService` receives. Unchanged shape from today (`platform/types.ts`), plus `organizationId` and `sessionId`. | in memory |

### 2.1 Teacher identity (the blocker, resolved)

* `chat.teacher` (NEW): `id`, `organization_id`, `account_id` (unique, nullable
  until provisioned), `name`, `core_teacher_id` + `synced_at` (external id;
  Jawwid Core has no teacher entity today — `open-contract-decisions.md`), `is_active`, `left_at`.
* `chat.learner.teacher_id` becomes a foreign key to `chat.teacher.id` (backfill:
  one teacher row per distinct existing `teacher_id`).
* `IdentityService.resolveActor` resolves teachers from `chat.teacher`, with a
  real name and a real `is_active`. The `learner.teacher_id` synthesis path is
  deleted.
* `chat.account.kind` gains `'teacher'`. Teacher is **not** a staff role
  (`domain-reconciliation.md` C: "do not fix this by adding teacher to
  staff.role").
* Conversation membership continues to reference teachers by
  `(actor_kind='teacher', actor_id=teacher.id)`; no membership row changes.

### 2.2 Parent / contact identity

A Contact belongs to a Family and may or may not have an Account (a
"secondary read-only" contact without login never authenticates and never
matches an RLS policy). `can_message` and the other capability flags stay on
the contact row; they are inputs to authorization, not roles.

### 2.3 Staff identity

Staff are Jawwid's internal people with exactly one role from
`AUTHORIZATION-MODEL.md` §2. `department` is an attribute, not a role.
`super_manager` in the Phase 0 brief maps to the PRD's `super_admin`; the PRD
name is canonical.

---

## 3. Account lifecycle

```
provisioned ──(credential set / first login)──► active ──► suspended ──► active
      │                                            │
      └────────────── deactivated ◄────────────────┘   (terminal; offboarding)
```

| State | Meaning | Effects |
|---|---|---|
| `provisioned` | account exists (from Core sync or manager action), no usable credential yet | cannot log in |
| `active` | normal | may log in; sessions valid |
| `suspended` | temporarily blocked by a manager (reason required, audited) | every session revoked immediately; new logins refused with `AUTH.ACCOUNT_DISABLED` |
| `deactivated` | offboarded (staff/teacher) or family departed (contact) | terminal; sessions revoked; principal `is_active=false`; for staff, `offboard_staff()` semantics apply first (all families must be reassigned — `SUPERVISOR-OWNERSHIP.md` §5) |

Every transition writes `chat.audit_log` with a reason and `chat.event_log`.
`IdentityService` treats anything but `active` as `isActive=false`, and every
existing authorization path already fails closed on that.

---

## 4. Authentication flow (Phase 1 contract)

```
POST /auth/login    {subject, password, device{platform, appVersion, pushToken?}}
                    → {accessToken, refreshToken, expiresIn, actor}      (+ chat.session, chat.device)
POST /auth/refresh  {refreshToken} → same shape, refresh token ROTATED, old one invalid
POST /auth/logout   (bearer) → {ok:true}; session revoked
GET  /me            (bearer) → ActorDto
GET  /me/sessions   (bearer) → own sessions; DELETE /me/sessions/:id revokes one
                    managers: DELETE /staff/:id/sessions (all) — "admins can revoke any session" (PRD §7.1)
```

* HTTP: `Authorization: Bearer <access>` verified by an `AuthenticatedGuard`
  that sets `request.user = actor`; `@ActorId()` reads only that. The
  `x-actor-id` header is ignored and the seam guard is deleted.
* WebSocket: handshake `auth.token` verified identically; the socket's actor
  is re-validated on `presence.heartbeat` and dropped on revocation (RT-009).
* Secrets: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` ≥ 32 chars, fail-closed
  at startup (as both archived implementations already do; RT-005 lesson).
* Rate limiting on `/auth/login`; uniform 401 body so failures do not
  distinguish "unknown account" from "bad password".
* Public registration: none. Password reset: manager-driven in MVP.

### 4.1 Jawwid Core's role

PRD §6 assigns *identity* to Core and *sessions* to Chat, but Core's
authentication capability is `UNKNOWN — CORE DECISION REQUIRED`
(`core-authentication-contract-request.md`). Decision for Phase 1: **Chat owns
credentials and sessions** (ADR-002/ADR-015 already made Chat identity-owning).
If Core later exposes a verifier or an OIDC issuer, `Credential` gains a kind
(`core_oidc`) and `POST /auth/login` gains a second path; nothing else changes.
Provisioning (which parents/teachers/staff exist) remains Core's through the
integration boundary.

---

## 5. Offboarding

| Principal | Steps (one manager action, one transaction) |
|---|---|
| Staff | 1. every family they supervise is reassigned (`offboard_staff()`), 2. sessions revoked, 3. account `deactivated`, 4. `staff.is_active=false, left_at`, 5. realtime sockets dropped, 6. audit + event |
| Teacher | 1. group memberships remain as history (`left_at` set) — C-4 keeps groups safe because presence is evaluated live, 2–6 as above |
| Contact | 1. `contact.is_active=false`, 2. sessions revoked, 3. account deactivated, 4. memberships `left_at`, 5–6 as above |

Nothing is deleted. Messages authored by a deactivated principal stay
attributed (BR-5: history belongs to Jawwid).

---

## 6. Auditability

Every login, refresh, logout, revocation, suspension, deactivation and
credential change writes `chat.audit_log` (actor, action, entity, reason) in the
same transaction. Session rows keep `created_at`, `last_seen_at`,
`revoked_at`, `revoked_by`, `revoked_reason`, `device_id`, `ip_hash`,
`user_agent` (no raw IP). Tokens are never logged (`RedactingLogger` on mobile,
`Logger` discipline on the API).

---

## 7. Phase 1 implementation baseline (decided)

Build on **D-6** (`archive/phase0/feat/ai7-runtime-fixes` @ `16857af`):
`src/platform/auth/{auth.service,auth.controller,auth.guard,jwt,password}.ts`,
`20260906130000_chat_authentication.sql` (`account_credential`, `session`),
`test/unit/auth/spoofing.spec.ts`. Adopt from **AI #8's guard**
(`archive/phase0/integration/ai8-auth-subset` @ `315ed95`): the
`AuthenticatedGuard` shape, uniform-401 discipline, no-dev-secret fallback.
Required changes to D-6 before it lands: teacher resolution through
`chat.teacher` (not `account.teacher_id`), `chat.device` binding,
`organization_id` on account/session, lifecycle `status`, session re-check on
the socket, and the migration renumbered after `20260906120000`.

---

## 8. Invariants (to be protected by tests in Phase 1)

1. A request with no verified bearer token reaches no controller (401), including every existing route that today lacks `@ActorId()` (`student-group/:learnerId/sync`, `DELETE /notifications/devices/:token`, `POST /notifications/:id/delivered`).
2. `x-actor-id` and `handshake.auth.actorId` are ignored everywhere.
3. A revoked session is refused on the next request and its sockets are closed within one heartbeat.
4. A deactivated principal cannot log in, refresh, or hold a socket.
5. A teacher actor is resolvable only from `chat.teacher` with `is_active=true`.
6. No table, DTO, event or log carries a contact channel.
