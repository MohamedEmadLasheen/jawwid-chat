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

## ADR-002 — Jawwid Chat lives in the `chat` schema of the Core database

**Status:** accepted.

Jawwid Core is a Supabase project: 126 migrations, RLS throughout, 316
`auth.uid()` references, and a React client that talks to PostgREST directly.
There is no Node backend to extend.

Three options were weighed: a standalone service with its own database and a
sync pipeline; a standalone service against Core's database; or a schema inside
Core's database.

**Decision:** a dedicated `chat` schema in the Core Supabase project.

**Why.** Parents already have an identity in `auth.users`; a separate service
means a second login for the same person. Family, subscription and payment data
would otherwise have to be replicated through a sync pipeline that can lag or
drift. The brief describes Jawwid Chat as living *"inside the Jawwid app"*.

**Consequences.** Jawwid Chat keeps its own migration ledger,
`chat.schema_migrations`, applied by `scripts/db/apply.sh`. It deliberately does
not use Core's `supabase_migrations.schema_migrations`, because `supabase db
push` run from either repository would otherwise see the other repository's
migrations as missing and try to reconcile them.

**To revisit:** the `chat.core_*` views are the entire read surface onto Core.
Extracting Jawwid Chat to its own database means re-pointing those views at an
HTTP client; nothing in the domain reads `public.*` directly.

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

## ADR-004 — No foreign keys from `chat.*` into `auth.*` or `public.*`

**Status:** accepted.

`chat.staff.auth_user_id`, `chat.contact.app_user_id`, `chat.family.core_parent_id`,
`chat.learner.core_child_id` and `chat.subscription.core_subscription_id` are
plain columns with unique indexes, not foreign keys.

**Why.** A foreign key would make Jawwid Chat able to block Core's own deletes.
Core cascades `profiles` from `auth.users`; a `RESTRICT` from chat would break
account deletion in Core, and a `CASCADE` would silently destroy CS history when
an account is removed. Keeping the reference soft also means ADR-002 can be
revisited without unpicking constraints.

**Consequences.** Referential integrity across the boundary is the sync
functions' job, not the planner's. `chat.core_parent_awaiting_owner` and
`chat.sync_health` exist so drift is visible rather than assumed away.

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
runs against the same Postgres image Supabase runs, exercising RLS as the
`authenticated` role rather than bypassing it as the owner.

**To revisit:** if an API service is introduced later, it should call these
functions rather than reimplement them.

---

## ADR-006 — Two populations, two access paths

**Status:** accepted.

Staff have a `chat.staff` row and query the tables directly under RLS. Family
contacts have no grant on any base table: they read four `chat.my_*` views and
write through one function, `chat.post_customer_message()`.

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

## ADR-013 — Three policy helpers run as their owner

**Status:** accepted.

`current_staff_id()`, `current_staff_role()`, `staff_can_see_family()` and
`current_contact_family_ids()` are `SECURITY DEFINER` with a pinned
`search_path`.

Without it they recurse: `chat.staff`'s policy calls a function that reads
`chat.staff`; `chat.task`'s policy calls a function that reads `chat.task`. Both
hit the stack limit.

They are the smallest set that breaks the cycles, and each returns only a boolean
or an id about the caller's own identity — elevating them exposes nothing the
caller could not already read. Every other helper reaches its tables through one
of these and stays `SECURITY INVOKER`.
