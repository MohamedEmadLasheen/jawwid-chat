# Jawwid Chat — Row-Level Security Strategy

Status: **CANONICAL** · Decided in Phase 0 · **ENGAGED and ENFORCED in Phase 1 closure** (2026-09-07)

> **Acceptance item 1 (section 7) is satisfied in code, and enforced by a gate.**
> `chat_app` holds exactly the privileges the application uses, owns nothing,
> and cannot bypass RLS; `ActorContextInterceptor` runs every authenticated
> request inside that actor's transaction-local context; and
> `apps/api/test/integration/runtime-rls.spec.ts` proves both halves by running
> the REAL services through that role — RLS constrains, and the application
> still works.
>
> The remaining step is a deployment one: point `DATABASE_URL` at `chat_app`
> (created NOLOGIN by `20260907120000`; deployment grants LOGIN and a password
> from the secret store) and the worker at `chat_service`. Until then the
> process **refuses to start** outside `local | test | ci`
> (`assertRuntimeRoleAcceptable`), and `/health/ready` reports `rlsEnforced`,
> `databaseRole` and `leastPrivileged` and drains the instance if the
> connection changes under it. See `../recovery/PHASE-1-REPORT.md` §7.1.
Companions: `../architecture/AUTHORIZATION-MODEL.md`, `../architecture/IDENTITY-MODEL.md`,
`../architecture/TENANCY-MODEL.md`, `../recovery/PHASE-0-DATABASE-RECONCILIATION.md` §3.5.

---

## 1. The finding

RLS is **defined but inert**. `20260905091200_chat_rls.sql` enables RLS on 21
tables with policies written `to authenticated` that resolve the caller through
`chat.current_subject()` → `current_setting('chat.actor_subject')` /
`request.jwt.claims`; `20260906120000` adds restrictive organization policies
on every root table. But:

* the API connects with one login role from `DATABASE_URL` (the table owner /
  superuser in every environment provisioned so far), which **bypasses RLS**;
* no code in `apps/api` calls `set_config`, `SET LOCAL`, `SET ROLE` or writes
  `chat.actor_subject` (grep over `src/` and `prisma/`: zero hits);
* the tables created by `093000` (conversation, member, message_* , approval,
  call, outbox, notifications, device_token, quiet_hours) have **no RLS at
  all** — only the organization restrictive policy from `20260906120000`.

So the policies constrain nothing at runtime. A false security boundary is
worse than none: it is cited as a control (`ADR-006`, `backend-contract.md`)
while every read runs as owner. Red-team recorded it (handoff §5: "RLS is
currently inert in practice").

---

## 2. Decision

**RLS becomes a live, second layer — defence in depth behind
`AuthorizationService` — engaged per transaction by the API. It is never the
primary authorization path, and it is never a substitute for scope checks in
the service layer.**

Rationale: the API already has the actor and already decides; the database is
where a service-layer bug (a missing `where`, an unscoped list) is caught. The
PostgREST-style model the policies were written for (client → Postgres with a
JWT) is not the architecture (client → NestJS → Postgres), so the policies must
be driven by the API, not by a JWT.

---

## 3. How identity reaches Postgres

Two connection roles, one per process kind:

| Role | Used by | RLS | Purpose |
|---|---|---|---|
| `chat_app` (LOGIN, NOBYPASSRLS, member of `authenticated`) | API request path | enforced | every request runs with the actor's context |
| `chat_service` (LOGIN, member of `service_role`, BYPASSRLS) | worker (outbox drain, reminders), migrations, integration ingestion, backups | bypassed | system work that acts for no user; audited by the event it processes |

`DATABASE_URL` (API) points at `chat_app`; `DATABASE_SERVICE_URL` (worker,
migrations) at `chat_service`. The owner role is used by nothing at runtime.
The three NOLOGIN roles from `091150` (`anon`, `authenticated`,
`service_role`) stay as the policy targets.

Per request, every Prisma unit of work runs inside a transaction that first
sets the context:

```sql
select set_config('chat.actor_subject',      $account_subject, true);  -- transaction-local
select set_config('chat.actor_kind',         $kind,            true);
select set_config('chat.actor_id',           $actor_id,        true);
select set_config('chat.actor_organization', $organization_id, true);
```

Implementation shape (Phase 1): a `PrismaService.withActor(actor, fn)` helper
that opens `$transaction`, executes the four `set_config` calls, then runs
`fn(tx)`; services already take a `tx` for audit writes, so the change is
mechanical. Interactive transactions are required (no `$queryRaw` outside a
transaction may rely on RLS — with a pooled connection the setting would leak
or vanish). Pooling: transaction-mode pooling is compatible because the
settings are transaction-local (`is_local = true`).

Tenant identity: `chat.current_organization_id()` already reads
`chat.actor_organization` first; the API sets it from the authenticated actor,
never from a request field.

---

## 4. Policy model to converge on (Phase 1)

| Table group | Policy source of truth | Notes |
|---|---|---|
| Root tables (all) | restrictive `organization_id = chat.current_organization_id()` (exists) | keep |
| `conversation`, `conversation_member`, `message*`, `message_approval`, `call*`, `conversation_participant_state` | **new** permissive policies: contact/teacher → live member; staff → `chat.staff_in_scope(family_id)` (assignment-based, `SUPERVISOR-OWNERSHIP.md`); manager/super_admin → organization | mirrors `AuthorizationService.canRead` exactly; a unit test asserts both agree on the scope matrix |
| `family`, `contact`, `learner`, `family_note` | existing `staff_can_see_family` re-expressed over assignments; contacts see own family | `091100`/`094000` helpers are rewritten, not edited |
| `staff` | readable by staff of the same organization; managed by manager/super_admin | exists (`091200:55-58`), scope by organization |
| `account`, `session`, `device`, `account_credential` | **no policies** for `authenticated` — reachable only through `chat_service` or SECURITY DEFINER helpers | keeps credentials unreadable by construction |
| `event_log`, `audit_log` | insert via SECURITY DEFINER (`log_event`, `write_audit`, exists); select manager-only | add `organization_id` (TENANCY M-1) |
| `outbox_event`, `notification*`, `device_token`, `quiet_hours` | `chat_service` only, plus owner-scoped select for `device_token`/`quiet_hours`/`notification` | |
| `config`, `schema_migrations` | config readable by staff / managed by manager (exists); `schema_migrations` policies removed — it is created outside migrations (NF-05) and must move into one | |
| Deprecated CRM tables | keep current policies; frozen | |

Helpers stay SECURITY DEFINER with `search_path = chat, pg_temp` (`091300`) to
avoid policy recursion; every helper must be `STABLE` and read only
`current_setting(..., true)`.

---

## 5. How RLS complements `AuthorizationService`

| Question | Service layer | RLS |
|---|---|---|
| May this actor do this action? | **decides** (role, scope, BR-1, C-4, moderation, on-behalf mode) | not involved |
| Can a bug in a service leak a row outside the actor's scope? | — | **catches**: the row is invisible, the query returns nothing |
| Can a raw query or a new endpoint forget scoping? | code review | **catches** |
| Can the worker act for the system? | — | `chat_service` bypasses; its inputs are outbox rows the service layer already authorized |
| Who is authoritative when they disagree? | the service (it has more context: intent, live membership, moderation) — but a disagreement is a **defect**, surfaced by the parity test | |

RLS is therefore *never* the reason a request is allowed; it is a reason a
request returns fewer rows than a buggy service asked for. The API must treat
an unexpected empty result on a write path as an authorization failure
(`COMM.CONVERSATION_NOT_FOUND` / 403), never as "nothing to do".

---

## 6. Service-role isolation

* `chat_service` is used only by processes that hold no user session:
  `worker.ts`, `scripts/db/apply.sh`, the Core ingestion path, backups.
* The API process never has `DATABASE_SERVICE_URL` in its environment
  (`infra/env/manifest.tsv`: `forbid` for the API container; `req` for the worker).
* Every `chat_service` write that originates from a user action carries the
  user's `actor_id` in the outbox payload and is audited under that actor.

---

## 7. Phase 1 acceptance

1. API connects as `chat_app`; `select rolbypassrls from pg_roles where rolname = current_user` is `false` in the readiness probe (`/health/ready` reports it).
2. `db/tests/rls_parity.sql`: for each role in the scope matrix, the rows visible under RLS equal the rows `AuthorizationService` allows (fixtures shared with the unit test).
3. `db/tests/rls_contact_isolation.sql`: a contact context cannot read another family's conversation, message, receipt, or call; a teacher context cannot read a family it does not teach.
4. Every table in schema `chat` has RLS enabled; every root table has the restrictive organization policy; `schema_acceptance.sql` asserts both.
5. The integration harness runs the Prisma-based specs as `chat_app` with a set actor context — the specs that today run as owner must keep passing.
6. Documentation (`ADR-006`, `backend-contract.md`) is superseded by this file; no document may describe RLS as a live control until item 1 is true.

Until item 1 is true, `AuthorizationService` is the **only** authorization
boundary, and every review must treat it as such.
