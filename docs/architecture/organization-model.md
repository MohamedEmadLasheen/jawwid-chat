> **STATUS: REFERENCE** (Phase 0, 2026-09-07). Root-entity analysis for tenancy; the adopted implementation is described in `TENANCY-MODEL.md`.
> Canonical index: `docs/README.md`.

# organization_id — the tenant model

**Requirement.** PRD v0.1 §2.3, verbatim and in full:

> Internal product for Jawwid in this phase. Not multi-tenant, but the data model
> carries an `organization_id` on every root entity from day one so a future SaaS
> conversion is a migration, not a rewrite.

That is the only sentence in the PRD about `organization_id`. It does not define
"root entity", and §6's domain model is a list of *entities*, not of roots. So the
term was not interpreted by intuition — the schema was measured.

---

## 1. How root was determined

A table is **derived** when it has a `NOT NULL` foreign key with `ON DELETE
CASCADE` to another chat table. That is the schema's own declaration that the row
cannot exist without its parent, and it means the parent already determines the
tenant. Everything else is **root**.

The measurement was taken against the schema **before** this change. It cannot be
re-run against the schema after it: every foreign key is now composite and
includes the `NOT NULL` `organization_id` column, so a table whose only cascade
key was nullable (`chat.conversation.family_id`, for instance) would now be
misread as derived. The numbers below are the pre-change measurement.

### Root — 18 tenant tables

`account` · `audit_log` · `config` · `conversation` · `core_event` ·
`core_parent_inbox` · `device_token` · `event_log` · `family` · `message` ·
`notification` · `notification_rule` · `notification_template` · `outbox_event` ·
`quiet_hours` · `staff` · `sync_state` · `teacher`

`chat.schema_migrations` also has no parent, and is **excluded**: it is the
deployment's migration ledger, not tenant data. It is the only table in the schema
without `organization_id`.

### Derived — 24 tables

| Table | Cannot exist without |
|---|---|
| `contact`, `family_note`, `family_state_cache`, `learner`, `payment`, `subscription`, `thread` | `family` |
| `absence`, `coverage_rule`, `shift` | `staff` |
| `message_attachment`, `message_hidden_for`, `message_reaction`, `message_receipt` | `message` |
| `call`, `conversation_member`, `conversation_participant_state` | `conversation` |
| `class_session`, `enrollment` | `learner` |
| `support_case` | `family` + `thread` |
| `task` | `family` + `support_case` |
| `message_approval` | `conversation` + `message` |
| `handoff` | `thread` |
| `call_participant` | `call` |

---

## 2. Why every tenant table carries the column, not just the roots

Putting `organization_id` only on roots makes a derived row's tenant a matter of
traversal. Two consequences, both bad:

- RLS would have to re-derive the tenant on every read of every child table, by
  joining back to its root.
- Nothing would prevent a row from **straddling** two tenants — a
  `chat.conversation` in organization A referencing a `chat.learner` in
  organization B. No amount of policy fixes that; it is a shape the schema allows.

Carrying the column on all 42 tenant tables lets every foreign key become
composite:

```sql
alter table chat.conversation
  add constraint conversation_learner_id_fkey
  foreign key (learner_id, organization_id)
  references chat.learner (id, organization_id) on delete cascade;
```

All **67** foreign keys were rewritten this way. A cross-organization reference is
no longer rejected by a check that has to be remembered — it is unrepresentable.

The roots additionally reference `chat.organization` directly.

---

## 3. Lifecycle

**The first organization** is created in migration `095000`, as data, in the same
migration that adds the columns. No table is ever briefly nullable, and no row
ever exists without a tenant.

**Further organizations** go through `chat.bootstrap_organization(slug, name)`,
which also copies the config defaults — an organization with no config would fail
on its first engine call. It is deliberately not reachable from the API:
onboarding an academy is an operator action, not a request.

**Resolution.** `chat.current_organization_id()` answers, most explicit first:

1. an explicit `chat.organization_id` setting (workers, migrations, the Core
   webhook — see below);
2. the signed-in account's own organization, **only when exactly one account
   matches the subject**;
3. the only active organization, when there is exactly one.

Steps 2 and 3 both stop answering the moment they become ambiguous, returning
`NULL` so that every `NOT NULL` insert fails loudly. Silently picking a tenant is
the failure this whole change exists to prevent. Step 3 is what makes the
single-tenant phase work with no caller changes, and it retires itself
automatically when a second organization is created.

**Defaulting.** Every tenant column defaults to `chat.current_organization_id()`,
so ordinary inserts need no change and an insert that cannot name a tenant fails
rather than guessing.

**Immutability.** `organization_id` cannot be updated on any tenant table — a
trigger on all 42 refuses it. Moving a row between tenants is never a legitimate
update; it is how a mis-scoped write becomes a cross-tenant read.

**Core-originated rows** get their tenant from the **signing key**, never from the
payload. `CORE_WEBHOOK_ORGANIZATIONS` maps key id → organization slug, and the
boundary binds it transaction-locally for the whole delivery. A caller holding
organization A's key cannot write into B by naming B in the body — verified.

---

## 4. Natural keys are scoped too

Surrogate keys are uuids and are globally unique by construction. The **natural**
keys are not: each organization has its own Jawwid Core and its own identity
provider, and two of them can mint the same identifier. Left globally unique, the
second organization's parent would collide with the first's — rejected at best,
merged into another tenant's family at worst.

Every externally-supplied key is therefore unique per organization:
`family.core_parent_id`, `learner.core_child_id`, `teacher.core_teacher_id`,
`enrollment.core_enrollment_id`, `class_session.core_class_session_id`,
`subscription.core_subscription_id`, `payment.core_payment_id`,
`core_parent_inbox`'s primary key, `core_event (source, external_event_id)`,
`sync_state.source`, `account.subject`, `notification_rule.key`,
`notification_template (key, locale, version)`, `notification.dedupe_key`,
`device_token.token`, `call.room_name`, and `config.key`.

`chat.config`'s primary key became `(organization_id, key)`. The accessors keep
their signatures, so no engine function changed.

---

## 5. What enforces what

| Attack | Stopped by |
|---|---|
| A reads B's rows | RLS: every one of the 38 policies carries `organization_id = chat.current_organization_id()` in `USING` |
| A writes a row stamped B | The same predicate in `WITH CHECK` |
| A row references another tenant's row | Composite foreign keys — unrepresentable, no policy involved |
| A row is moved between tenants | `organization_id` immutability trigger on all 42 tables |
| Two Cores collide on an identifier | Per-organization natural keys |
| A webhook body names another tenant | The tenant comes from the signing key; the payload is ignored |

Evidence: `db/tests/tenant_isolation.sql` (25 assertions) and
`scripts/verify-core-boundary.mjs` (5 cross-tenant checks against the running
application).
