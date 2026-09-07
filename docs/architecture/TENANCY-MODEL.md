# Jawwid Chat — Tenancy Model

Status: **CANONICAL** · Decided in Phase 0 · **EXTENDED and CLOSED in Phase 1** (2026-09-07)
M-1, M-2 and M-4 are closed; M-3 was removed with the coverage machinery's `thread` dependency; M-5 stands by design (a second tenant is a deliberate migration). See `../recovery/PHASE-1-REPORT.md`.

**M-2 as closed.** `device_token.token`, `call.room_name` and
`notification.dedupe_key` are unique **per organization**, and a trigger refuses
to move a push token across the boundary. The push token mattered most: it is
not a secret, and `registerDevice` hands a device over on conflict — globally
unique meant anyone who learned a token could take delivery of its owner's
notifications, across tenants. `core_*` identifiers stay globally unique on
purpose: they are issued by Jawwid Core, which is one system.

**Also closed by the closure audit:** `chat.guard_family_assignment()` compared
the assignment's organization to the family's but never to the SUPERVISOR's, so
a family could be assigned to a supervisor in another academy — the one
cross-tenant path RLS could not catch, because every row was correctly stamped
and only the relationship crossed the boundary.
Product basis: PRD §2.3 — *"Not multi-tenant, but the data model carries an `organization_id` on every root entity from day one so a future SaaS conversion is a migration, not a rewrite."*
Reference (not adopted as-is): `organization-model.md` and the org-scoped RLS/keys on `archive/phase0/feat/core-integration-boundary`; `docs/integration/backend-decision-memo.md` §3 (the executed comparison).

---

## 1. Decision

**Yes — the foundational data model carries `organization_id`, from Phase 0.**
Jawwid Chat is operated for one organization (Jawwid) today; the schema,
identity, permissions and RLS are shaped so that a second academy is a data and
configuration change, not a redesign. No tenant management UI, no billing, no
per-tenant provisioning is built.

Implemented in Phase 0 by cherry-picking `72a5f29` (`38b2b3b` on
`integration/recovery`), the smaller of the two competing implementations:

| Element | State |
|---|---|
| `chat.organization` | exists; one row `00000000-…-0001` / `jawwid`, `chat.default_organization_id()` |
| `organization_id uuid NOT NULL default chat.default_organization_id()` | on 23 root tables (`account, staff, family, contact, learner, subscription, family_note, conversation, message, message_approval, task, call, handoff, shift, coverage_rule, absence, notification, notification_rule, notification_template, device_token, quiet_hours`, + `thread`/`support_case` skipped as absent) with FK + index |
| Derived tables | inherit tenancy through their parent FK (members, receipts, reactions, attachments, hidden_for, participant_state, call_participant, outbox, sync_state, core_event, core_parent_inbox, family_state_cache, schema_migrations) |
| Isolation | one RESTRICTIVE RLS policy per root table: `organization_id = chat.current_organization_id()`; a caller with no resolvable organization sees nothing |
| Cross-tenant references | `chat.enforce_same_organization()` triggers on family-scoped children (contact, learner, subscription, family_note, task, conversation, message) |
| Caller resolution | `chat.current_organization_id()`: session override `chat.actor_organization`, else the organization of the current account |
| Prisma | `organizationId` on 13 models with `@default(dbgenerated("chat.default_organization_id()"))` — services need no change until Phase 1 threads the actor's organization through |
| Tests | `db/tests/tenant_isolation.sql` (9 assertions, run as `authenticated`) |

---

## 2. Rules for every layer

| Layer | Rule |
|---|---|
| Database | every new root table carries `organization_id NOT NULL` with the default, FK, index and restrictive policy; every new child references a parent that carries it; `schema_acceptance.sql` gains the assertion in Phase 1 |
| Identity | `chat.account.organization_id` is the source of an actor's tenant; a session belongs to one organization; `Actor.organizationId` is set at authentication and never from a request field |
| Permissions | roles are per organization (a `super_admin` of Jawwid is nobody elsewhere); `chat.role_permission` is global until a tenant needs an override |
| Conversations / families / users | created with the actor's organization; cross-organization membership is refused by the trigger and by `canOpenDirect` (Phase 1) |
| Labels / notifications / audit | scoped by the parent (labels: Phase 2 table carries the column); `event_log`/`audit_log` **do not yet carry** `organization_id` — added in Phase 1 (M-1 below) |
| Storage | object keys are prefixed `org/<organization_id>/…` from Phase 2; signed URLs are minted only for objects in the actor's organization |
| Realtime | rooms are conversation-scoped, therefore tenant-scoped; the subscribe check runs `canRead` which carries the organization from Phase 1 |
| CRM integration | one Jawwid Core per organization is **not** assumed (that assumption in the archived implementation had no PRD basis); a Core signing key is bound to one organization (from the archived `095300`, to be re-implemented) so a delivery can never write into another tenant |
| Config | `chat.config` stays global; per-organization overrides are a later migration (`config_override(organization_id, key)`) |
| API | no `organizationId` in any request body or path in this phase; it is always derived from the actor |

---

## 3. Known gaps carried forward

| ID | Gap | Phase |
|---|---|---|
| M-1 | `event_log`, `audit_log`, `outbox_event`, `core_event` have no `organization_id` | 1 (add column + backfill default; restrictive policy for the two logs) |
| M-2 | Natural keys are globally unique rather than per organization: `core_*_id`, push tokens (`device_token.token`), call `room_name`, notification `dedupe_key`, `account.subject` | 1 for `account.subject` (compose with organization); 2 for the rest — a real correctness defect for a second tenant, accepted knowingly for one |
| M-3 | `handoff` lost its cross-organization guard when OD-01 removed `thread` (the migration guarded it through `thread_id`) | 1 (guard via `conversation_id`) or REMOVE LATER with the coverage machinery |
| M-4 | `chat.current_organization_id()` depends on the API setting `chat.actor_subject` / `chat.actor_organization` — inert until `RLS-STRATEGY.md` engages | 1 |
| M-5 | `chat.default_organization_id()` is a hard-coded uuid; a second tenant requires services to pass `organizationId` explicitly (the Prisma default must then be removed) | when a second tenant is created |

---

## 4. What is deliberately not built

Tenant creation UI, per-tenant branding, billing, tenant-scoped feature flags,
per-tenant identity providers, data residency. Each is a later product
decision; none is made cheaper or dearer by the model above.
