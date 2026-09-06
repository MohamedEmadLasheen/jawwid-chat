# Jawwid Chat — backend contract

For AI #2 (communication engine), AI #3 (Flutter mobile), AI #4 (admin
operations) and AI #5 (QA / security / DevOps).

Owner: AI #1. Source of truth for the product:
[`docs/JAWWID_CHAT_BRIEF.pdf`](../JAWWID_CHAT_BRIEF.pdf). Decisions and their
reasoning: [`decisions.md`](./decisions.md).

**Read [ADR-001](./decisions.md#adr-001--build-the-briefs-customer-success-operating-system)
first if you were briefed on parent/teacher messaging, student groups, approvals
or calling.** That is not this product. What exists is the CS console the brief
describes.

---

## 1. Where the backend is

Jawwid Chat is a **standalone product with its own PostgreSQL database**. It
depends on no other product's schema: no Supabase image, no `auth` schema, no
foreign key leaving the `chat` schema, and no function or view that reads
another product's tables. Three assertions in `db/tests/invariants.sql` enforce
that, so it cannot regress quietly
([ADR-002](./decisions.md#adr-002--jawwid-chat-owns-its-own-postgresql-database)).

Everything lives in the `chat` schema, and the rules are enforced by RLS and
database functions rather than by a service layer any client could bypass
([ADR-005](./decisions.md#adr-005--the-domain-lives-in-sql-not-in-an-application-service-layer)).
An API service in front of this database is expected — it should **call these
functions, not reimplement them**.

### Identity

Every actor resolves through `chat.account`, which holds an opaque token
`subject` and nothing else — no email, no phone
([ADR-015](./decisions.md#adr-015--chat-owns-its-identity-and-that-identity-carries-no-contact-channel)).
Tell the database who is calling in one of two ways:

```sql
-- an API service on a pooled connection, per request
select set_config('chat.actor_subject', '<token sub>', true);
set local role authenticated;

-- or a gateway that forwards verified JWT claims in request.jwt.claims
```

A caller with neither is anonymous and every policy denies them. Attach a
subject to a person on first sign-in with `chat.link_staff_account(staff_id,
subject)` or `chat.link_contact_account(contact_id, subject)`.

```
supabase/migrations/     the chat schema, in order -- the single schema authority
scripts/db/apply.sh      apply migrations (own ledger: chat.schema_migrations)
scripts/db/test-db.sh    local postgres:17 in Docker
scripts/db/test.sh       run every suite
db/testkit/              role bootstrap, assertions, the operations fixture
db/tests/                seven suites, 177 assertions
```

`supabase/migrations/*.sql` is the **only** schema authority. Nothing else may
create or alter a table: no ORM migration, no `db push`. A generated client is
fine as a read model, introspected from the migrated database.

```bash
bash scripts/db/test.sh
```

That resets a throwaway database, applies every migration from scratch, and runs
all suites. It needs Docker and nothing else.

---

## 2. The one rule

**One family → one primary owner.** `chat.family.owner_id` is `NOT NULL` and can
only be changed by `chat.transfer_ownership()`. A direct `UPDATE` is refused by
trigger.

**Who handles a family right now is `chat.on_duty(family_id, at)`** and nothing
else. It reads four tables — `staff`, `shift`, `coverage_rule`, `absence` — and
returns the one person on duty, or NULL, which means Unattended and is a real
answer, not an error. There is no queue table, no routing table, and no
assignment table; a test asserts none has appeared.

`chat.effective_handler(family_id, at)` is `on_duty()` plus the stickiness
override from brief §4. **Use `effective_handler` for anything user-facing**;
use `on_duty` when reasoning about the roster itself.

---

## 3. Data model

Names follow the brief's §3 except for three reserved-word renames
([ADR-007](./decisions.md#adr-007--three-columns-renamed-from-the-brief)):
`case` → `support_case`, `coverage_rule.window` → `window_mode`,
`absence.from`/`.to` → `from_at`/`to_at`.

| Table | Notes |
|---|---|
| `chat.family` | `owner_id` NOT NULL and trigger-guarded. `tier`, `state`, `manual_flag` (a flag requires a reason). `core_parent_id` mirrors Core. |
| `chat.contact` | Six capability flags are the authority; `role_preset` is a display label no check reads. `account_id` links to `chat.account`, and is null until that person signs in. |
| `chat.learner` | `next_class_at` drives the class attention signal. `teacher_id` stays null until Core has teachers. |
| `chat.subscription` | Mirror of Core billing. `status` copies Core's vocabulary verbatim. |
| `chat.family_note` | Internal. Any admin may write one on any family at any time. |
| `chat.thread` | `family_id` **UNIQUE**. `needs_reply` is a generated column. |
| `chat.support_case` | `owner_locked` is computed from config, never supplied. |
| `chat.message` | **Immutable.** `visibility` is `customer` or `internal`. Every staff message carries `on_behalf_mode`. |
| `chat.task` | Belongs to a case. Department staff see only their own. |
| `chat.handoff` | Every transfer of live handling, with a reason. |
| `chat.event_log`, `chat.audit_log` | **Append-only at the database level.** Audit `reason` is NOT NULL and non-blank. |
| `chat.family_state_cache` | Derived. Safe to truncate and rebuild. |
| `chat.config` | Every weight, threshold and window. Manager-only write. |

Structural guarantees, each asserted in `db/tests/invariants.sql`: one thread per
family; messages cannot be edited or deleted; neither log can be rewritten; a
staff message without `on_behalf_mode` is refused; a contact cannot author an
internal note or post onto another family's thread; **no table or view in the
schema has a phone-number column.**

---

## 4. Configuration, not constants

Every number from the brief is a row in `chat.config`, read at evaluation time.
Nothing is compiled in. Read with `chat.config_num/int/text/json(key)`; a missing
key raises rather than defaulting silently.

Values the brief fixes are marked `[brief]`. Values it names but does not fix are
marked `[hypothesis]` and need operations sign-off:
`workload.reply_burst`, `handoff.grace_minutes`, `absence.auto_detect_minutes`,
`shift.end_banner_minutes`, and **`schedule.timezone`**
([ADR-010](./decisions.md#adr-010--the-operational-timezone-is-configuration-and-is-currently-a-guess) —
seeded `Africa/Cairo`, unconfirmed; if wrong, every shift boundary is wrong).

---

## 5. Engines

```sql
chat.on_duty(family_id, at)                     -> staff_id | NULL
chat.effective_handler(family_id, at)           -> staff_id | NULL
chat.next_on_duty_at(family_id, at)             -> timestamptz | NULL
chat.in_shift(staff_id, at)                     -> boolean
chat.coverage_chain(owner_id, at)               -> (staff_id, chain_position, rule_id)

chat.attention_signals(family_id, at, viewer)   -> (signal, points, reason)
chat.attention_score(family_id, at, viewer)     -> numeric
chat.attention_bucket(family_id, at, viewer)    -> now | today | waiting_on_family | quiet
chat.attention_top_reason(family_id, at, viewer)-> text
chat.response_target_minutes(family_id, at)     -> integer

chat.workload_units(staff_id, at)               -> (unit, count, weight, points)
chat.workload_score(staff_id, at)               -> numeric
chat.workload_level(staff_id, at)               -> LOW | MEDIUM | HIGH
chat.families_on_duty(staff_id, at)             -> family_id
```

`attention_top_reason` returns readable text — *"waiting 10 minutes for a reply"*,
*"Yusuf's class starts in 12 minutes"*. **Show that string. Never show the score,
and never invent a P1/P2/P3 label** (brief §6).

Workload counts live work only. Twenty-one quiet families score zero; there is a
test that says so.

---

## 6. Authorization

| Who | Sees | May do |
|---|---|---|
| `admin`, `coverage` | every family | reply when `effective_handler` is them; internal notes anywhere; not the audit log; not config or the roster |
| `manager` | everything | transfer ownership, offboard, edit config/shifts/coverage/absences, read the audit log |
| `finance`, `technical`, `academic` | only families they hold a task on | complete their own tasks. **Never message a family** |
| family contact | own family only, through `chat.my_*` | `chat.post_customer_message()` if `can_message` |

One function answers whether a staff member may speak to a family:

```sql
chat.staff_may_send(staff_id, family_id, mode, at) -> boolean
```

`mode` is `owner`, `coverage`, `assist` or `escalation`. The message `INSERT`
policy is its only caller — **do not reimplement this check in a client or a
service.** Internal notes bypass it deliberately: brief §5 lets any admin write
one at any time.

`chat.may_assist()` implements the brief's assist rule and depends on inbox
telemetry that **AI #4 must emit**: `chat.log_event('family_opened', family_id,
…)` when an admin opens a family, and `'assist_requested'` when the on-duty admin
asks for help. Until `family_opened` is emitted, assist is permitted more often
than the brief intends.

---

## 7. The family-side surface — AI #3

Family contacts have **no grant on any base table**
([ADR-006](./decisions.md#adr-006--two-populations-two-access-paths)).

Sign the parent in, attach their subject with `chat.link_contact_account()`, then
set `chat.actor_subject` per request. Build against exactly this:

| Surface | Gives you |
|---|---|
| `chat.my_family` | family name, language, owner name, who is replying now, `next_reply_expected_at` |
| `chat.my_permissions` | the six capability flags — drive the self-service buttons from these |
| `chat.my_topics` | open topics in plain status: `in_progress`, `waiting_for_you`, `scheduled`, `done` |
| `chat.my_messages` | customer-visible messages only, with `sender_kind` (`family`/`jawwid`/`system`) and `sender_name` |
| `chat.post_customer_message(body, client_id, attachments, family_id)` | the only write |

Pass a stable `client_id` per composed message and reuse it on retry: a duplicate
is refused rather than posted twice
([ADR-009](./decisions.md#adr-009--message-idempotency-via-client_id)).

Never show an internal status value, a staff role, an attention score or a case's
`root_cause`/`resolution_summary`. They are not in these views; keep it that way.

---

## 8. Admin surface — AI #4

Query the tables directly; RLS scopes them. The inbox is
`chat.family_state_cache` joined to `chat.family`:

```sql
select f.display_name, c.bucket, c.attention, c.top_reason
from chat.family_state_cache c
join chat.family f on f.id = c.family_id
where c.on_duty_id = chat.current_staff_id()
order by c.bucket, c.attention desc;

-- the manager's Unattended list
select * from chat.family_state_cache where on_duty_id is null;
```

Refresh with `chat.recompute_family_state(family_id, at)` after any family event,
and `chat.recompute_all_family_states()` on a timer for the time-based buckets.

Manager actions:

```sql
chat.transfer_ownership(family_id, to_staff_id, reason, actor_id)
chat.offboard_staff(staff_id, reason, to_staff_id, actor_id)  -- returns the reassignments
select * from chat.orphaned_coverage_rule;                    -- rules pointing at departed staff
select * from chat.sync_health;
chat.dispute_attention_order(family_id, staff_id, expected_rank, note)  -- "this order is wrong"
```

`reason` is mandatory on the first two and lands in `chat.audit_log` in the same
transaction. Both refuse a non-manager.

Set `chat.actor_staff_id` for server-side calls that have no session. In a
signed-in session the actor resolves from `chat.actor_subject` (or the forwarded
JWT claim) automatically — see §1.

---

## 9. Jawwid Core boundary — AI #2 / AI #5

**Moved.** The authoritative contract is
[`core-integration-contract.md`](./core-integration-contract.md): authentication,
envelope, event types, payload schemas, ordering, retry and duplicate semantics,
failure handling, audit, the per-entity authority table, and the known gaps.

The payload shapes previously described in this section were proposals. They have
been ratified against PRD v0.1 §12.4 and superseded — do not build against them.

In short: Jawwid Core is a separate product in a separate database, reached only
through `POST /integration/core/events` (HMAC-signed). Core-sourced facts are
materialised into Chat-owned tables keyed by their `core_*_id`. Ownership never
arrives that way — a new parent waits in `chat.core_parent_inbox` until a manager
calls `chat.assign_family_owner()`.

## 10. Events

`chat.log_event(type, family_id, case_id, actor_type, actor_id, payload)`.
Append-only, and the substrate for re-deriving the weights after 60–90 days
(brief §7). The `type` vocabulary is a CHECK constraint in
`20260905090500` and `20260905091100`; widen it with an `ALTER`
([ADR-003](./decisions.md#adr-003--check-constraints-not-postgres-enum-types)).

Emit an event for anything a later calibration pass would want to count. Payload
shape is per type and not enforced, so logging can never fail a business
transaction.

---

## 11. What is intentionally not built

Deferred to whoever picks them up, with the seams already in place:

- **Timers and automation** (brief §9) — auto-acknowledgement with an honest
  reply time, no-reply reminders, auto-resolve, reopen-on-reply. The config keys
  and `chat.next_on_duty_at()` exist; the scheduler does not. **This is AI #2's.**
- **Shift-end flow** — the handoff *table* and stickiness exist. The banner, the
  automatic handoff cards at shift end, and "what happened while you were away"
  are queries over `chat.handoff` that nobody has written yet.
- **Absence auto-detection** — `absence.auto_detect_minutes` is configured and the
  `absence_auto_detected` event type exists. Nothing watches for it. It must only
  ever suggest; the brief forbids auto-activating a backup.
- **Case lifecycle transitions** — statuses and guards exist; the automatic
  transitions (last task done → `waiting_internal` → `open`) do not.
- **Realtime** — nothing configured. `chat.message` is append-only, so a
  `LISTEN/NOTIFY` trigger or logical replication both work; whatever fans it out
  must re-check visibility rather than trusting the client's filter.
- **Authentication itself** — `chat.account` stores an opaque subject. Issuing
  and verifying tokens is the identity provider's job and is not built here.
- Everything in [ADR-001](./decisions.md#adr-001--build-the-briefs-customer-success-operating-system):
  student groups, approvals, calling, push, multi-tenancy, a teacher role.

---

## 12. Extending this safely

**Do not modify** (they encode brief §12 non-negotiables; changing them changes
the product):

```
20260905090600_chat_coverage_engine.sql        on_duty() and the chain
20260905090700_chat_ownership_invariants.sql   ownership, owner-lock, offboarding
20260905091100_chat_authorization.sql          staff_may_send(), may_assist()
20260905091200_chat_rls.sql                    the policies and the my_* views
20260905091300_chat_policy_helper_privileges.sql
20260905090050_chat_identity.sql               chat.account and caller resolution
```

Adding to them is fine; weakening a guard is a product decision.

**Safe to extend:** new tables in `chat`; new columns on `family`, `contact`,
`learner`, `support_case`, `task`; new `event_log` types; new config keys; new
views. Never add a column that stores a phone number, an email address or any
other contact channel — on `chat.account` least of all. A test fails if you do,
and on the identity table it is a privacy review rather than a migration.

**Rules that must survive any change:**

1. Nothing assigns a family to a staff member except `on_duty()`, stickiness,
   assist or escalation — each logged with a reason.
2. No queue, no round-robin, no "least loaded".
3. `owner_id` changes only through `transfer_ownership()`, audited in the same
   transaction.
4. One thread per family. Cases never create a second one.
5. Every staff message carries `on_behalf_mode`.
6. Attention and workload are computed, never stored as input; all constants come
   from `chat.config`.
7. A family is in exactly one inbox, or in the manager's Unattended list.
8. Coverage cannot close owner-locked cases or change owners.
9. No AI output reaches a customer, and no AI changes state.
10. No foreign key leaves the `chat` schema, and nothing here reads another
    product's database.

Add a test to `db/tests/` for anything you add. `bash scripts/db/test.sh` must
stay green.
