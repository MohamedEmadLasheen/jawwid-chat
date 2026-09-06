# Architecture decisions — Jawwid Chat backend

Owner: AI #1 (system architecture and backend core).
Source of truth: [`docs/JAWWID_CHAT_BRIEF.pdf`](../JAWWID_CHAT_BRIEF.pdf).

Each decision records what was chosen, why, and what would have to change to
revisit it. Where a decision departs from the brief, that is stated explicitly.

---

## ADR-001 — Build the brief's Customer Success operating system

**Status:** accepted (product decision, confirmed by the product owner).

The role assignment given to this agent described a different product from the
attached brief: a parent/teacher/admin messenger with a teacher↔parent
communication matrix, student groups, a message approval queue, LiveKit calling,
push notification infrastructure and `organization_id` multi-tenancy.

None of that appears in the brief, which describes a Customer Success console
for the internal CS team and says of itself: *"this brief is the contract for
what to build."* Jawwid Core corroborates the brief — it has no teacher, class
session or enrolment entity, and its own PRD lists live classes as a V1
non-goal. AI #3 and AI #4 independently reached the same reading.

**Decision:** build the brief. Keep seams so the other feature set can be added
later without migrating `family`, `thread`, `support_case` or the coverage
tables (ADR-003).

**Consequences.** Not built, and not stubbed: student groups, message approval,
calling, push infrastructure, multi-tenancy, a teacher role. `learner.teacher_id`
exists because the brief lists it, and stays null until Core has teachers.

---

## ADR-002 — Jawwid Chat owns its own PostgreSQL database

**Status:** accepted. **Supersedes an earlier decision in this same log.**

An earlier version of this ADR put Jawwid Chat in a `chat` schema inside Jawwid
Core's Supabase database, reusing `auth.users` so parents would not need a second
login, and reading Core through `chat.core_*` views.

The product owner subsequently decided that **Jawwid Chat is a standalone
product with its own database** (`docs/release/database-decision.md`, AI #5). No
shared database, no cross-schema reads, no foreign keys into Core, and Core
integration over an API/webhook boundary rather than SQL.

**Decision:** Jawwid Chat owns its database outright. It runs on plain
PostgreSQL — the test database is `postgres:17`, with no Supabase image, no
`auth` schema, and no fixture standing in for another product's tables.

**Consequences, all implemented:**

- Identity is Chat's own (ADR-015). No `auth.users`, no `auth.uid()`.
- Core-sourced facts arrive as payloads and are materialised into Chat-owned
  tables (ADR-014). The `chat.core_*` views are gone.
- Jawwid Chat keeps its own migration ledger, `chat.schema_migrations`, applied
  by `scripts/db/apply.sh`.
- Three assertions in `db/tests/invariants.sql` hold the line: no foreign key
  leaves the `chat` schema, no function in it reads another product's tables,
  and no view does either.

**Cost that was accepted with this decision.** Parents now need an identity in
Jawwid Chat as well as in Jawwid Core, and family/subscription data is a replica
that can lag. `chat.sync_health` exists so the lag is visible rather than
assumed away.

---

## ADR-003 — CHECK constraints, not Postgres ENUM types

**Status:** accepted.

Every vocabulary — staff roles, case types, message visibility, event types — is
a `text` column with a `CHECK`. Widening one is a single `ALTER`; widening a
Postgres `ENUM` inside a transaction has real restrictions, and narrowing one is
a type rewrite.

This is the mechanism that makes ADR-001's "seams for later" concrete. Adding a
`teacher` staff role, or a `student_group` conversation kind, is an additive
migration rather than a schema change. `20260905091100` widens
`event_log.type` exactly this way and is the worked example.

---

## ADR-004 — No foreign key leaves the `chat` schema

**Status:** accepted.

`chat.family.core_parent_id`, `chat.learner.core_child_id` and
`chat.subscription.core_subscription_id` record the identifier the record
carries in Jawwid Core. They are plain columns with unique indexes.

Under ADR-002 they *cannot* be foreign keys — Core is a different database — but
they would not have been anyway: a foreign key would let Jawwid Chat block
Core's own deletes, and cascade CS history away when an account is removed.

What they are instead is the **idempotency key**. Every ingestion function
upserts on one of them, so re-delivering a payload converges rather than
duplicating.

**Consequences.** Referential integrity across the boundary is the boundary's
job, not the planner's. `chat.core_parent_inbox`, `chat.sync_health` and
`chat.unmapped_core_subscription_status` exist so drift is visible.

---

## ADR-005 — The domain lives in SQL, not in an application service layer

**Status:** accepted.

`on_duty()`, the attention and workload engines, ownership transfer, owner-lock
enforcement and the authorization checks are database functions, with RLS
policies calling them.

**Why.** Given ADR-002, the clients (Flutter, React admin) talk to PostgREST.
A rule enforced only in a service layer would be bypassable by any client
holding a valid token. Brief §12's non-negotiables are mostly invariants —
"thread is UNIQUE per family", "every staff message has on_behalf_mode", "owner
changes only via transfer_ownership()" — and invariants belong where they cannot
be routed around.

**Consequences.** Business logic is reviewed as SQL. The test suite is SQL and
runs against plain `postgres:17`, exercising RLS as the `authenticated` role
rather than bypassing it as the owner.

**To revisit:** if an API service is introduced later, it should call these
functions rather than reimplement them.

---

## ADR-006 — Two populations, two access paths

**Status:** accepted.

Both populations resolve through `chat.account`. Staff have a `chat.staff` row
and query the tables directly under RLS. Family contacts have no grant on any
base table: they read four `chat.my_*` views and write through one function,
`chat.post_customer_message()`.

**Why.** The failure mode worth designing against is a staff-side policy widening
by accident and exposing internal notes to a parent. If parents are not reading
those tables at all, that class of mistake cannot reach them. `chat.my_messages`
filters on `visibility = 'customer'`, so an internal note is not in the parent's
view rather than merely hidden by the client.

---

## ADR-007 — Three columns renamed from the brief

**Status:** accepted.

| Brief | Here | Reason |
|---|---|---|
| `case` | `chat.support_case` | `CASE` is a reserved word |
| `coverage_rule.window` | `window_mode` | `WINDOW` is a reserved word |
| `absence.from` / `.to` | `from_at` / `to_at` | both are reserved words |

Quoting them everywhere would have been possible and worse to read. No other
column from the brief's §3 was renamed.

---

## ADR-008 — `on_duty()` returns NULL rather than falling back

**Status:** accepted (brief §4, transcribed).

When nobody is on shift the function returns NULL, the family is Unattended, and
the manager is alerted. It never picks the nearest available person.

The manager's catch-all coverage rule keeps her in the chain at priority 99 but
she holds no shift, so the chain falls through to NULL. That is how uncovered
hours surface, and it is asserted in `db/tests/coverage_engine.sql`.

One consequence is worth putting in front of operations: `outside_owner_shift`
coverage does not apply *during* the owner's own shift. If an owner is absent
mid-shift and her named backup is unavailable, the family becomes Unattended
rather than falling to her evening coverage admin. That follows the brief's
pseudocode exactly, and Unattended is the safe outcome — but it is a real
operational case, and the alternative (letting coverage act during an absent
owner's shift) is a product decision, not a bug fix.

---

## ADR-009 — Message idempotency via `client_id`

**Status:** accepted. **Departs from the brief:** an addition.

`chat.message.client_id`, unique per thread. Not in the brief, added because a
mobile client that retries a send after a dropped connection cannot know whether
the first attempt landed, and the alternative is duplicate messages in a
customer's thread. The client generates the key; the database refuses the
duplicate.

---

## ADR-010 — The operational timezone is configuration, and is currently a guess

**Status:** accepted, **needs confirmation from operations.**

The brief gives shift wall-clock times (Sat–Thu 09:00–17:00, Friday 10:00–22:00)
but never states a timezone. Every shift, coverage and absence comparison
resolves against `chat.config['schedule.timezone']`, seeded to `Africa/Cairo`.

If that is wrong, every shift boundary is wrong by the offset. It is one config
row to change, but it must be confirmed before launch.

---

## ADR-011 — Attention is cached for the family's current handler

**Status:** accepted.

Brief §6 marks the renewal-urgency signal "(owner only)", which makes attention
depend on who is looking. `chat.attention_score()` takes an optional viewer;
`chat.family_state_cache` stores the value for whoever is currently on duty.

So a covering admin's cached score legitimately differs from the owner's for the
same family, which is the intent: coverage is not pushed a relationship decision
§5 does not allow her to make.

---

## ADR-012 — Even distribution during offboarding is not the routing §12 forbids

**Status:** accepted. **Reads against a non-negotiable, deliberately.**

Brief §12 forbids round-robin and "least loaded" outside Phase 3 pools. Brief §8
requires one-click offboarding that transfers families "evenly or to a named
admin". `chat.offboard_staff()` therefore spreads families across active admins,
starting with whoever currently owns fewest.

The distinction: this is a manager-initiated action over a fixed set of families,
each transfer individually audited. No message and no live family is ever routed
this way — `on_duty()` remains the only thing that decides who handles a family.

---

## ADR-013 — The identity and policy helpers run as their owner

**Status:** accepted.

`current_account_id()`, `current_staff_id()`, `current_staff_role()`,
`staff_can_see_family()` and `current_contact_family_ids()` are
`SECURITY DEFINER` with a pinned `search_path`.

`current_account_id()` is elevated for a different reason from the others:
`chat.account` has RLS enabled and **no policy at all**, so nothing can read it
through the API. Identity resolution has to run as the owner or nobody could
sign in.

Without it they recurse: `chat.staff`'s policy calls a function that reads
`chat.staff`; `chat.task`'s policy calls a function that reads `chat.task`. Both
hit the stack limit.

They are the smallest set that breaks the cycles, and each returns only a boolean
or an id about the caller's own identity — elevating them exposes nothing the
caller could not already read. Every other helper reaches its tables through one
of these and stays `SECURITY INVOKER`. All five pin `search_path` to
`chat, pg_temp`.

---

## ADR-014 — Jawwid Chat translates Core's vocabulary rather than adopting it

**Status:** accepted. Required by ADR-002.

An earlier version mirrored `public.subscriptions.status` verbatim, with a
comment saying the CHECK must widen whenever Core's did. Under a standalone
database that is a release-coupling defect: a Core deploy would break ingestion
here.

**Decision.** `chat.subscription.status` is Jawwid Chat's own, smaller
vocabulary. `chat.map_core_subscription_status()` translates through
`chat.config['integration.subscription_status_map']`, and an **unmapped value
degrades to `unknown` rather than failing the ingestion**.

`chat.unmapped_core_subscription_status` reports anything that landed as
`unknown`, so a status Core added that Jawwid Chat has not been told about is a
config edit with a visible symptom — not an outage, and not a migration.

The same principle governs the payload shapes in §9 of the backend contract:
they are deliberately flat, and this boundary must not grow knowledge of Core's
internal schema.

---

## ADR-015 — Chat owns its identity, and that identity carries no contact channel

**Status:** accepted. Required by ADR-002.

`chat.account` holds `subject` (the opaque `sub` claim from Jawwid Chat's
identity provider), `kind`, and `is_active`. `chat.staff.account_id` and
`chat.contact.account_id` reference it. Nothing references `auth.users`.

The caller is resolved by `chat.current_subject()`, which reads either a
per-request GUC (`chat.actor_subject`, for an API service on a pooled
connection) or a forwarded JWT claim. Neither is trusted to be present; a caller
with neither is anonymous, and every policy denies an anonymous caller.

**`chat.account` deliberately holds no email, phone, or other contact channel.**
Credentials live in the identity provider. An identity table is exactly where an
email column gets added as a matter of routine, which is why
`db/tests/invariants.sql` fails if one appears: adding it is a privacy review,
not a migration.

A contact can exist with `account_id` null — a second guardian an admin
recorded, who has never signed in. They never pass an RLS check, because no
session can resolve to them. `chat.link_contact_account()` attaches the subject
on first sign-in.
