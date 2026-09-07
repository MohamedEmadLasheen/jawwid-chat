# Phase 0 — Database Reconciliation

| | |
|---|---|
| Branch / HEAD | `integration/recovery` @ `755e870` |
| Date | 2026-09-07 |
| Scope | The 22 files in `supabase/migrations/`, `db/tests/*.sql`, `scripts/db/*.sh`, `apps/api/prisma/schema.prisma`, `.github/workflows/ci.yml`, `apps/api/test/integration/schema-invariants.spec.ts` |
| Purpose | Fix the single migration authority, record the full object inventory with one classification label per object, name the invariants the schema already enforces, list the defects, and record the verification run |
| Not decided here | How RLS engages at runtime (`docs/security/RLS-STRATEGY.md`); the Phase 1 role vocabulary, supervisor-assignment model and teacher identity (`docs/architecture/AUTHORIZATION-MODEL.md`, `docs/architecture/SUPERVISOR-OWNERSHIP.md`) |
| Product decisions | PD-1 to PD-5 were CLOSED on 2026-09-07, after this document was written. Two of them change classifications here and the deltas are recorded in the addendum at the end: **PD-3** (coverage machinery moves from frozen-pending-decision to frozen-and-scheduled-for-removal) and **PD-4** (`chat.task` is never revived). The record is `../product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4. |

Product direction assumed throughout: Jawwid Chat is a communication platform for parents, teachers, supervisors (admins) and managers around families and learners. It is not a customer-success CRM. The communication core is kept; identity, ownership, permissions, tenancy and RLS are modified in Phase 1; CRM machinery is deprecated in place and removed by a later numbered migration after product confirms.

Classification vocabulary (exactly one label per object):

| Label | Meaning |
|---|---|
| KEEP | Retained as-is. New code may depend on it. |
| MODIFY | Retained; shape or semantics change in Phase 1 by a new numbered migration. |
| DEPRECATE | Retained and frozen: no new code may depend on it; existing callers are listed so the freeze is checkable. Removal is a later migration after product confirmation. |
| REMOVE LATER | Technical leftover with no product decision attached; removed by a later migration. |
| UNKNOWN | Cannot be classified from the evidence in the tree; the resolving question is stated. |

---

## 1. Authority & discipline

| Rule | Where it is enforced | Evidence |
|---|---|---|
| `supabase/migrations/*.sql`, applied in filename order by `scripts/db/apply.sh`, is the only DDL authority. | `scripts/db/apply.sh:19,34-50` — iterates `"$MIGRATIONS"/*.sql`, wraps each file in `begin; … ; insert into chat.schema_migrations …; commit;` so a failed file is never recorded. | `apply.sh:41-49` |
| The ledger `chat.schema_migrations(version text pk, applied_at)` is created by the runner, not by any migration. | `apply.sh:24-30`. Migration `20260905091200_chat_rls.sql:43` then enables RLS on it, so the chain is only self-contained through the runner (defect NF-05, §5). | |
| Prisma is a typed client, not a schema authority. | `apps/api/prisma/schema.prisma:3-5` ("THE SQL MIGRATIONS … ARE AUTHORITATIVE FOR DDL … it never defines the schema"); `datasource … schemas = ["chat"]` (`:15-19`). No `prisma/migrations` directory exists. CI runs `npx prisma generate` only (`ci.yml:127,222`). | Residual risk: `apps/api/package.json:11` still defines `"prisma:push": "prisma db push --skip-generate"` (§5). |
| History is immutable. A shipped migration file is never edited; a correction, deprecation or removal is a new file with a later timestamp. | Convention already followed in the chain: `093300` fixes `093000` by adding triggers rather than editing (`093300:29-41`); `094000` drops `thread`/`support_case` rather than editing `090400`. `20260906120000` guards every step with `if not exists` / `to_regclass` (`:109-118,131-139,145,210-219`). | |
| How deprecation happens. | A DEPRECATE label in §3 freezes the object: no new reference from `apps/api/src`, `apps/admin-web`, mobile, or a new migration. Removal is one future numbered migration (`2026MMDDhhmmss_chat_crm_removal.sql`) that drops the objects in dependency order, deletes their `chat.config` keys, and is accompanied by a `db/tests/*.sql` assertion that they are absent — the same pattern `094000` used for `thread`/`support_case` (`schema_acceptance.sql:101-105`). | |
| CI gates. | `G-19` (`ci.yml:190-199`): apply from empty `postgres:17`, then re-apply must print no `apply` line. `G-19` fresh-database acceptance (`ci.yml:203-204`) runs `db/tests/schema_acceptance.sql`. `G-01` (`ci.yml:209-210`) runs `db/tests/br1_invariants.sql`. `JC-011` (`ci.yml:74-75`, `scripts/qa/check-protected-tests.sh`) fails the build if a protected suite is deleted or drops below its assertion floor — floors for the SQL suites are `br1_invariants.sql ≥ 20` and `schema_acceptance.sql ≥ 61` (`docs/qa/protected-tests.tsv`). | `db/tests/od01_conversation_model.sql` and `db/tests/tenant_isolation.sql` are **not** run by CI nor by `integration-db.sh verify` (`integration-db.sh:61-64`) and are not in the protected manifest (§5). |
| Local harness. | `scripts/db/integration-db.sh` — plain `postgres:17`, `reset` rebuilds from empty through `apply.sh`, `verify` runs the two CI suites. Composition across branches and stub schemas were removed (`integration-db.sh:17-27`, RT-023). | |

---

## 2. Migration chain

All 22 files are recorded in `chat.schema_migrations` of the verification container (§6). Order is lexical by filename; note that `20260905094000` (OD-01) sorts **before** `20260906120000` (organization), which is why the organization migration finds no `thread`/`support_case` and skips them (`20260906120000:109-112`).

| # | File | What it does (one line) | Status |
|---|---|---|---|
| 1 | `20260905090000_chat_foundation.sql` | Creates schema `chat`, `set_updated_at()`, `forbid_mutation()`, `chat.config` and the four typed `config_*` accessors. Header (`:3-7`) still says Chat lives inside Core's Supabase database (RT-010 remainder, §5). | Applied |
| 2 | `20260905090050_chat_identity.sql` | `chat.account` (subject, kind ∈ staff/family, no contact channel); `current_subject()` reads `chat.actor_subject` or `request.jwt.claims.sub`; `current_account_id()`. | Applied |
| 3 | `20260905090100_chat_config_defaults.sql` | Seeds CRM config keys: `attention.*`, `response_target.*`, `workload.*`, coverage, `cases.*`, `lifecycle.*`, `timers.*`, `integration.subscription_status_map`, `schedule.timezone`. | Applied |
| 4 | `20260905090200_chat_staff_and_coverage_config.sql` | `chat.staff` (role ∈ admin/coverage/manager/finance/technical/academic), `shift`, `coverage_rule`, `absence`. | Applied |
| 5 | `20260905090300_chat_family_domain.sql` | `family` (owner_id NOT NULL → staff), `contact` (capability flags), `learner` (bare `teacher_id`), `subscription` (Core mirror), `family_note`. | Applied |
| 6 | `20260905090400_chat_conversation_domain.sql` | `thread` (UNIQUE per family), `support_case`, `message` (thread-parented, blanket immutable), `task`, `handoff`. | Applied; **thread model superseded by 094000** (thread and support_case dropped; message/task/handoff rehomed) |
| 7 | `20260905090500_chat_logs_and_state_cache.sql` | `event_log`, `audit_log` (append-only triggers), `log_event()`, `write_audit()`, `family_state_cache`. | Applied |
| 8 | `20260905090600_chat_coverage_engine.sql` | Coverage engine: `local_at`, `window_contains`, `in_shift`, `is_absent`, `absence_backup`, `coverage_chain`, `on_duty`, `effective_handler`, `extend_stickiness`. | Applied |
| 9 | `20260905090700_chat_ownership_invariants.sql` | `current_staff_id`, `staff_role`, owner-change guard + `transfer_ownership`, owner-locked case triggers, deactivation guard, `offboard_staff`, view `orphaned_coverage_rule`. | Applied; owner-lock trigger/functions later dropped by 094000:624-631 |
| 10 | `20260905090800_chat_attention_and_workload.sql` | Attention signals/score/bucket, `recompute_family_state(s)`, `families_on_duty`, workload units/score/level, `dispute_attention_order`. | Applied; `attention_signals`, `attention_bucket`, `response_target_minutes`, `workload_units` re-defined by 094000 |
| 11 | `20260905090900_chat_core_integration.sql` | `core_parent_inbox`, `sync_state`, `core_event`; ingest functions; `assign_family_owner`; `link_*_account`; views `unmapped_core_subscription_status`, `sync_health`. | Applied; `assign_family_owner` re-defined by 094000:973 |
| 12 | `20260905091000_chat_message_idempotency.sql` | Adds `message.client_id` and unique index `message_client_id_uniq (thread_id, client_id)`. | Applied; **index implicitly dropped** when 094000:76 dropped `thread_id`; column survives (§5) |
| 13 | `20260905091100_chat_authorization.sql` | Widens `event_log.type`; `current_staff_role`, `is_manager`, `current_contact_family_ids`, `staff_can_see_family`, `may_assist`, `staff_may_send`, `next_on_duty_at`. | Applied; `may_assist`/`staff_may_send` re-defined by 094000 |
| 14 | `20260905091150_chat_application_roles.sql` | Creates NOLOGIN roles `anon`, `authenticated`, `service_role` (bypassrls) when absent (RT-023). | Applied |
| 15 | `20260905091200_chat_rls.sql` | Enables RLS on 23 tables (incl. the runner-created `schema_migrations`), grants to `authenticated`, 38 permissive policies, `my_*` views, `post_customer_message()`. | Applied; message/handoff policies and `my_messages`/`my_topics` re-derived or dropped by 094000 |
| 16 | `20260905091300_chat_policy_helper_privileges.sql` | Makes the five identity helpers SECURITY DEFINER with pinned `search_path` to break policy recursion. | Applied |
| 17 | `20260905093000_chat_communication.sql` | Communication domain: `conversation`, `conversation_member` + immediate BR-1 trigger, message extended in place (seq, moderation, `client_message_id`, `message_idempotency`), `message_no_rewrite` replaces blanket immutability, attachments/reactions/receipts/hidden/participant_state/approval, `outbox_event`, notification engine, `call`, `call_participant`. Enables RLS on **none** of the 16 new tables. | Applied |
| 18 | `20260905093100_chat_communication_config.sql` | Seeds `communication.*`, `realtime.*`, `notification.*`, `approval.*`, `call.*` config; bilingual `notification_template` rows; `notification_rule` rows. | Applied |
| 19 | `20260905093200_chat_shared_logs.sql` | `create table if not exists` for `event_log`/`audit_log` (already created by 090500) plus a second pair of append-only triggers. | Applied; **no-op duplicate of 090500 for the tables**, kept because `schema_acceptance.sql:139-140` asserts its trigger names `event_log_append_only` / `audit_log_append_only`; also leaves duplicate indexes (§5) |
| 20 | `20260905093300_chat_br1_structural_backstop.sql` | BR-1 second layer: deferred constraint triggers on both tables of each pair, `type` immutability on conversation and call, admin-presence rule (RT-024, RT-025). | Applied |
| 21 | `20260905094000_chat_od01_conversation_reconciliation.sql` | OD-01: message parented only by conversation; drops `thread`, `support_case`, `my_topics`; rehomes task/handoff; re-expresses attention/workload/authorization off Case; family-scope constraint (C-2); rebuilds `my_messages`, `post_customer_message`, `assign_family_owner`; deletes 7 Case config keys. | Applied; **supersedes 090400's thread model** |
| 22 | `20260906120000_chat_organization.sql` | `chat.organization` (one seeded row), `default_organization_id()`, `current_organization_id()` (reads `chat.actor_organization` or the account's org), adds NOT NULL `organization_id` + FK + index + RESTRICTIVE isolation policy to 21 root tables, `enforce_same_organization()` guards on 7 child tables. | Applied; tenancy. Two of its targets (`thread`, `support_case`) and the `handoff→thread` guard are skipped because OD-01 ran first (§5) |

Dropped along the way (historical, not in the live catalogue): tables `chat.thread`, `chat.support_case`; view `chat.my_topics`; triggers `message_is_immutable`, `message_touches_thread`, `thread_set_updated_at`, `support_case_set_updated_at`, `support_case_thread_matches_family`, `support_case_owner_lock`, `support_case_owner_locked_closure`; functions `touch_thread_from_message`, `apply_owner_lock`, `guard_owner_locked_case_closure`, `assert_case_thread_matches_family`, the 6-arg `log_event`, the `(p_thread_id, …)` `extend_stickiness`; index `message_client_id_uniq` (implicit); columns `message.thread_id`, `message.case_id`, `task.case_id`, `handoff.thread_id`, `event_log.case_id`, `conversation.thread_id`.

---

## 3. Object classification

Live inventory in the verification container after all 22 migrations: 38 base tables (37 from migrations + `schema_migrations` from the runner), 6 views, 76 functions, 40 non-internal triggers, 55 policies (34 permissive + 21 restrictive), 3 application roles.

### 3.1 Tables (38)

| Object | Created by | Domain | Classification | Reason / Phase |
|---|---|---|---|---|
| `chat.config` | 090000:50 | platform | KEEP | Config-driven constants stay. CRM keys (`attention.*`, `workload.*`, `response_target.*`, `lifecycle.*`, `timers.*`, `reopen.*`, `automation.*`, `absence.*`, `shift.*`, `assist.*`, `handoff.grace_minutes`, `integration.subscription_status_map`, `schedule.timezone`) are DEPRECATED rows, pruned by the removal migration. Communication keys (093100:14-40) and `approval.*` are kept. |
| `chat.organization` | 20260906120000:25 | tenancy | KEEP | Tenant root; one seeded row. RLS not enabled on it (§5). |
| `chat.account` | 090050:14 | identity | MODIFY | Phase 1: `kind` gains `'teacher'` (today `check (kind in ('staff','family'))`), lifecycle columns, and new `session`/`device` tables. Privacy rule (no contact channel, `090050:7-12`) is preserved. |
| `chat.staff` | 090200:14 | identity | MODIFY | Phase 1: role vocabulary → `admin \| coverage_admin \| manager \| super_admin` per `AUTHORIZATION-MODEL.md`; `finance/technical/academic` are departments, not roles (a `department` column, see the rescued `docs/recovery/evidence/uncommitted/ai4-20260906130000_chat_rbac_canonical_roles.sql`, which is **not** applied). `capacity_override` (workload) becomes dead once workload is removed. |
| `chat.family` | 090300:11 | family | MODIFY | Phase 1: `owner_id` → supervisor-assignment model with a history table (`SUPERVISOR-OWNERSHIP.md`). `tier`, `state`, `manual_flag*` are CRM-era columns whose fate is UNKNOWN (question: does the product keep a family "state" and "priority tier" outside CRM scoring?). `core_parent_id` stays as the Core correlation key. |
| `chat.contact` | 090300:61 | family | MODIFY | Capability flags (`can_*`) are the parent-side permission model; Phase 1 reviews them against the parent role. `account_id` links to identity. |
| `chat.learner` | 090300:102 | family | MODIFY | Phase 1: `teacher_id` becomes an FK to a new `chat.teacher` (today a bare uuid, `090300:117-121`). `next_class_at`, `last_attended_at`, `consecutive_absences` are attention inputs — keep only if class reminders remain a product feature (`notification_rule` `class_reminder_*` rows suggest yes). |
| `chat.subscription` | 090300:142 | CRM mirror | DEPRECATE | Renewal/subscription mirror of Core. Still read by `attention_signals` (094000:344-386), `response_target_minutes` (094000:913-917), `workload_units` (094000:486-490) — all DEPRECATED — and by the `renewal_*`/`payment_*` notification rules' event sources (outside SQL). Frozen. |
| `chat.family_note` | 090300:178 | family | MODIFY | Internal notes on a family remain useful for supervisors; scope review in Phase 1 (who may read; `author_id` → staff). |
| `chat.message` | 090400:124, extended 093000:246-351, rehomed 094000:66-104 | communication | KEEP | Conversation is the only parent (`conversation_id NOT NULL`, 094000:77). Legacy column `client_id` (091000:8) → MODIFY sub-item: drop later; its unique index is already gone (§5). `attachments jsonb` is superseded by `message_attachment` but must stay NOT NULL default `[]` (`schema.prisma:246`). |
| `chat.task` | 090400:231, rehomed 094000:150-176 | CRM | DEPRECATE | PRD-vocabulary tasks (`follow_up/renewal/payment/complaint/onboarding/custom`). Frozen. Note the dependency: `staff_can_see_family()` (091100:61-64) still reads `chat.task` in its department-staff branch, so the removal migration must land after the Phase 1 rewrite of that function. |
| `chat.handoff` | 090400:266, rehomed 094000:212-227 | CRM / coverage | DEPRECATE | Coverage handoff log. Frozen. Has `organization_id` but **no** `*_same_organization` guard (§5). |
| `chat.shift` | 090200:50 | coverage | DEPRECATE | Input to `on_duty()`. Frozen, not removable until `AuthorizationService.canSend` stops routing through `CoverageService.onDuty` (see §3.2 note on `on_duty`). |
| `chat.coverage_rule` | 090200:75 | coverage | DEPRECATE | As above. Also read by `offboard_staff()` (090700:272-274) for the orphan count. |
| `chat.absence` | 090200:113 | coverage | DEPRECATE | As above. |
| `chat.family_state_cache` | 090500:126 | CRM | DEPRECATE | Derived attention/on-duty cache; writer `recompute_family_state` is DEPRECATED. Safe to truncate at any time (`090500:123-124`). |
| `chat.event_log` | 090500:11 (093200:11 no-op) | logs | KEEP | Append-only. The `type` check still carries Case/coverage vocabulary (`case_*`, `handoff_*`, `absence_*`, `attention_order_disputed`); pruning the vocabulary is part of the removal migration, not before. |
| `chat.audit_log` | 090500:60 (093200:25 no-op) | logs | KEEP | Append-only, reason NOT NULL. `actor_id` FK to staff was dropped in 093000:403 so non-staff actors can be audited. |
| `chat.core_parent_inbox` | 090900:23 | integration | MODIFY | Parents received from Core awaiting a supervisor assignment. Rename/scope as the CRM-integration inbox in Phase 1; `assign_family_owner()` is its consumer. |
| `chat.sync_state` | 090900:38 | integration | KEEP | Sync bookkeeping for the Core boundary. |
| `chat.core_event` | 090900:54 | integration | KEEP | Inbound event ledger with `(source, external_event_id)` uniqueness — the replay-safety guarantee. |
| `chat.conversation` | 093000:41 | communication | KEEP | `type` immutable (093300:168); `family_id` nullable under C-2 (094000:784-789). `sticky_handler_id`/`sticky_until` remain but their only writer `extend_stickiness()` is DEPRECATED — UNKNOWN sub-item: does stickiness survive as a supervisor-assignment concept in Phase 1? |
| `chat.conversation_member` | 093000:119 | communication | KEEP | The participant set BR-1 is enforced against. |
| `chat.message_attachment` | 093000:412 | communication | KEEP | |
| `chat.message_reaction` | 093000:430 | communication | KEEP | |
| `chat.message_receipt` | 093000:440 | communication | KEEP | |
| `chat.message_hidden_for` | 093000:459 | communication | KEEP | |
| `chat.conversation_participant_state` | 093000:468 | communication | KEEP | |
| `chat.message_approval` | 093000:488 | communication | KEEP | `approver_id` FK → staff; Phase 1 may widen to the supervisor model but the table stays. |
| `chat.outbox_event` | 093000:519 | communication | KEEP | |
| `chat.device_token` | 093000:543 | communication | KEEP | |
| `chat.notification_template` | 093000:561 | communication | KEEP | |
| `chat.notification_rule` | 093000:576 | communication | KEEP | Seeded `renewal_*`/`payment_*` rules depend on Core events (`renewal_due`, `payment_due`), not on `chat.subscription`; they stay. |
| `chat.notification` | 093000:594 | communication | KEEP | `dedupe_key` unique is the delivery-once guarantee. |
| `chat.quiet_hours` | 093000:634 | communication | KEEP | |
| `chat.call` | 093000:651 | communication | KEEP | `type` immutable (093300:282). |
| `chat.call_participant` | 093000:679 | communication | KEEP | |
| `chat.schema_migrations` | `scripts/db/apply.sh:26` | platform | KEEP | Ledger. Created outside the chain (NF-05, §5); RLS enabled by 091200:43 with no policy, so only the owner reads it — acceptable because `apply.sh` runs as the owner. |

### 3.2 Functions (76)

| Object | Created by (last definition) | Domain | Classification | Reason / Phase |
|---|---|---|---|---|
| `set_updated_at()` | 090000:23 | platform | KEEP | |
| `forbid_mutation()` | 090000:35 | platform | KEEP | Append-only enforcement. |
| `config_num/config_int/config_text/config_json(text)` | 090000:71-126 | platform | KEEP | Raise on missing key by design. |
| `log_event(text,uuid,text,uuid,jsonb)` | 094000:187 (replaces 090500:89) | logs | KEEP | SECURITY DEFINER. `case_id` argument removed by OD-01. |
| `write_audit(uuid,text,text,uuid,text,jsonb,jsonb)` | 090500:104; SECURITY DEFINER at 091200:17 | logs | KEEP | |
| `current_subject()` | 090050:43 | identity | MODIFY | Reads `chat.actor_subject` / `request.jwt.claims`; the API sets neither today (§5). Phase 1 defines the actor-context contract. |
| `current_account_id()` | 090050:54; SECURITY DEFINER at 091300 | identity | MODIFY | As above. |
| `current_staff_id()` | 090700:16; SECURITY DEFINER at 091300 | identity | MODIFY | Also honours `chat.actor_staff_id` for jobs. |
| `staff_role(uuid)` | 090700:28 | authz | MODIFY | Role vocabulary changes. |
| `current_staff_role()` | 091100:25; SECURITY DEFINER at 091300 | authz | MODIFY | |
| `is_manager()` | 091100:31 | authz | MODIFY | `'manager'` literal; super_admin added in Phase 1. |
| `current_contact_family_ids()` | 091100:38; SECURITY DEFINER at 091300 | authz | MODIFY | |
| `staff_can_see_family(uuid,uuid)` | 091100:51; SECURITY DEFINER at 091300 | authz | MODIFY | Hard-codes `manager/admin/coverage`; ELSE branch reads DEPRECATED `chat.task`. |
| `may_assist(uuid,uuid,timestamptz)` | 094000:513 | authz | MODIFY | Calls DEPRECATED `response_target_minutes`; assist semantics re-expressed on the supervisor model. |
| `staff_may_send(uuid,uuid,text,timestamptz)` | 094000:589 | authz | MODIFY | Calls DEPRECATED `effective_handler` → `on_duty`. Still the WITH CHECK of `message_written_by_staff` (094000:662-675). |
| `guard_owner_change()` | 090700:36 | ownership | MODIFY | Semantics kept (owner changes only through the transfer function); re-expressed on assignment history. |
| `transfer_ownership(uuid,uuid,text,uuid)` | 090700:55 | ownership | MODIFY | Manager-only, audited in-transaction; accepts `admin/coverage` targets (090700:79-83) — vocabulary changes. |
| `guard_staff_deactivation()` | 090700:183 | ownership | MODIFY | Refuses deactivating an owner with families; re-expressed on assignments. |
| `offboard_staff(uuid,text,uuid,uuid)` | 090700:209 | ownership | MODIFY | Reads DEPRECATED `coverage_rule` for the orphan count (090700:272-274); that read goes with the removal migration. |
| `current_organization_id()` | 20260906120000:63 | tenancy | MODIFY | Reads `chat.actor_organization` or the account's org; part of the actor-context contract. |
| `default_organization_id()` | 20260906120000:47 | tenancy | KEEP | Column default. |
| `enforce_same_organization()` | 20260906120000:166 | tenancy | KEEP | |
| `assert_message_author_exists()` | 094000:81 (replaces 090400:169) | communication | MODIFY | Checks `staff` and `contact` authors only; an `author_type='teacher'` row is accepted without an existence check until `chat.teacher` exists. |
| `touch_conversation_from_message()` | 094000:109 | communication | KEEP | |
| `enforce_direct_conversation_rules()` | 093000:153 | BR-1 | KEEP | Immediate layer. |
| `enforce_conversation_type_immutable()` | 093000:206 | BR-1 | REMOVE LATER | Orphaned: 093300:167-170 re-created trigger `conversation_type_immutable` on `forbid_conversation_type_change()`; no trigger references this function. No product decision needed. |
| `forbid_message_rewrite()` | 093000:328 | communication | KEEP | |
| `enforce_call_participant_rules()` | 093000:691 | BR-1 | KEEP | Immediate layer for calls. |
| `assert_conversation_br1(uuid)`, `tg_conversation_br1()`, `tg_conversation_row_br1()`, `forbid_conversation_type_change()` | 093300:66-165 | BR-1 | KEEP | Deferred layer + type freeze. |
| `assert_call_br1(uuid)`, `tg_call_br1()`, `tg_call_row_br1()`, `forbid_call_type_change()` | 093300:189-279 | BR-1 | KEEP | |
| `assert_conversation_family_scope(uuid)`, `tg_conversation_family_scope()`, `tg_conversation_family_scope_row()` | 094000:701-770 | communication | KEEP | C-2 family scope. |
| `post_customer_message(text,text,jsonb,uuid)` | 094000:833 | communication | MODIFY | SECURITY DEFINER; writes legacy `client_id`; identity via `current_account_id()`. |
| `record_core_event(…)`, `mark_core_event_processed(…)`, `record_sync_result(…)` | 090900:72-97, 348 | integration | KEEP | |
| `ingest_core_parent(jsonb)` | 090900:126 | integration | MODIFY | Feeds `core_parent_inbox` (MODIFY). |
| `ingest_core_learner(jsonb)` | 090900:226 | integration | MODIFY | Follows `learner` changes (teacher FK). |
| `assign_family_owner(uuid,uuid,text,uuid)` | 094000:973 | integration / ownership | MODIFY | Creates family + primary guardian + persistent direct conversation with both members (keep) and assigns `owner_id` (re-expressed as supervisor assignment). |
| `link_contact_account(uuid,text)`, `link_staff_account(uuid,text)` | 090900:314-344 | identity | MODIFY | Account linking; teacher variant needed. |
| `map_core_subscription_status(text)` | 090900:104 | CRM mirror | DEPRECATE | With `subscription`. |
| `ingest_core_subscription(jsonb)` | 090900:268 | CRM mirror | DEPRECATE | With `subscription`. |
| `local_at`, `window_contains`, `in_shift`, `is_absent`, `absence_backup`, `coverage_chain` | 090600:15-125 | coverage | DEPRECATE | Coverage engine internals. |
| `on_duty(uuid,timestamptz)` | 090600:134 | coverage | DEPRECATE — **frozen, not removable** | **Live runtime dependency:** `apps/api/src/platform/coverage.service.ts:22-23` executes `SELECT chat.on_duty(...)`; `AuthorizationService.canSend` (`authorization.service.ts:180-197`) derives owner/coverage from it, and `ConversationService.activeHandler` (`conversation.service.ts:433-439`) falls back to it. The deprecation therefore cannot become a removal until the Phase 1 ownership model replaces the routing decision in `canSend` and `activeHandler`. Until then no *new* caller may be added. |
| `effective_handler(uuid,timestamptz)` | 094000:554 | coverage | DEPRECATE | Wraps `on_duty` with conversation stickiness; called by `staff_may_send` (MODIFY) — same freeze condition as `on_duty`. |
| `extend_stickiness(uuid,uuid)` | 094000:578 | coverage | DEPRECATE | Only writer of `conversation.sticky_*`. |
| `next_on_duty_at(uuid,timestamptz)` | 091100:166 | coverage | DEPRECATE | Read by view `my_family` (MODIFY). |
| `response_shift_kind`, `response_target_minutes` | 090800:17; 094000:903 | attention | DEPRECATE | |
| `attention_signals`, `attention_score`, `attention_top_reason`, `attention_bucket` | 094000:253; 090800:253, 270; 094000:928 | attention | DEPRECATE | |
| `recompute_family_state`, `recompute_all_family_states` | 090800:319, 346; SECURITY DEFINER at 091200:19 | attention | DEPRECATE | |
| `families_on_duty`, `workload_units`, `workload_score`, `workload_level` | 090800:367; 094000:443; 090800:430, 438 | workload | DEPRECATE | |
| `dispute_attention_order(…)` | 090800:475 | attention | DEPRECATE | Calibration hook; writes `event_log` type `attention_order_disputed`. |

Freeze check for the DEPRECATE set: the only `apps/api/src` reference to any DEPRECATED SQL object is `chat.on_duty` in `coverage.service.ts` (grep over `apps/api/src` for `on_duty|attention_|workload_|recompute_|families_on_duty|next_on_duty_at|ingest_core_subscription` at HEAD). Phase 1 should add a unit-level tripwire so a new reference fails CI.

### 3.3 Triggers (40 live)

Classification follows the table unless stated.

| Object | Created by | Table | Classification | Reason / Phase |
|---|---|---|---|---|
| `config_set_updated_at` | 090000:64 | config | KEEP | |
| `account_set_updated_at` | 090050:28 | account | MODIFY | With table. |
| `staff_set_updated_at` | 090200:40 | staff | MODIFY | With table. |
| `staff_deactivation_is_guarded` | 090700:203 | staff | MODIFY | Re-expressed on assignment history. |
| `family_set_updated_at` | 090300:50 | family | MODIFY | |
| `family_owner_is_guarded` | 090700:51 | family | MODIFY | Owner-change guard; re-expressed on assignment history. |
| `contact_set_updated_at` | 090300:90 | contact | MODIFY | |
| `learner_set_updated_at` | 090300:130 | learner | MODIFY | |
| `subscription_set_updated_at` | 090300:169 | subscription | DEPRECATE | |
| `family_note_set_updated_at` | 090300:190 | family_note | MODIFY | |
| `task_set_updated_at` | 090400:256 | task | DEPRECATE | |
| `event_log_is_append_only` | 090500:52 | event_log | KEEP | |
| `audit_log_is_append_only` | 090500:81 | audit_log | KEEP | |
| `event_log_append_only` | 093200:44 | event_log | KEEP | Duplicate of the above (both fire); name asserted by `schema_acceptance.sql:139`. |
| `audit_log_append_only` | 093200:49 | audit_log | KEEP | Duplicate; name asserted by `schema_acceptance.sql:140`. |
| `core_parent_inbox_set_updated_at` | 090900:32 | core_parent_inbox | MODIFY | |
| `sync_state_set_updated_at` | 090900:48 | sync_state | KEEP | |
| `conversation_set_updated_at` | 093000:111 | conversation | KEEP | |
| `conversation_member_br1` | 093000:193 | conversation_member | KEEP | BR-1 immediate. |
| `conversation_type_immutable` | 093300:168 (replaces 093000:235) | conversation | KEEP | |
| `conversation_br1_row` (constraint, deferred) | 093300:173 | conversation | KEEP | |
| `conversation_member_br1_deferred` (constraint, deferred) | 093300:179 | conversation_member | KEEP | |
| `conversation_family_scope` (constraint, deferred) | 094000:779 | conversation | KEEP | C-2. |
| `conversation_member_family_scope` (constraint, deferred) | 094000:773 | conversation_member | KEEP | C-2. |
| `conversation_same_organization` | 20260906120000:223 | conversation | KEEP | |
| `message_author_exists` | 090400:189 (function replaced 094000:81) | message | MODIFY | Teacher branch. |
| `message_no_rewrite` | 093000:349 | message | KEEP | |
| `message_touches_conversation` | 094000:141 | message | KEEP | |
| `message_same_organization` | 20260906120000:223 | message | KEEP | |
| `conversation_participant_state_set_updated_at` | 093000:480 | conversation_participant_state | KEEP | |
| `call_type_immutable` | 093300:282 | call | KEEP | |
| `call_br1_row` (constraint, deferred) | 093300:287 | call | KEEP | |
| `call_participant_br1` | 093000:716 | call_participant | KEEP | |
| `call_participant_br1_deferred` (constraint, deferred) | 093300:293 | call_participant | KEEP | |
| `organization_set_updated_at` | 20260906120000:38 | organization | KEEP | |
| `contact_same_organization` | 20260906120000:223 | contact | KEEP | |
| `learner_same_organization` | 20260906120000:223 | learner | KEEP | |
| `family_note_same_organization` | 20260906120000:223 | family_note | KEEP | |
| `subscription_same_organization` | 20260906120000:223 | subscription | DEPRECATE | With table. |
| `task_same_organization` | 20260906120000:223 | task | DEPRECATE | With table. |

Not present although 20260906120000:205 lists it: `handoff_same_organization` (skipped because its parent `thread` no longer exists at that point — §5).

### 3.4 Views (6 live + 1 dropped)

| Object | Created by | Domain | Classification | Reason / Phase |
|---|---|---|---|---|
| `chat.my_messages` | 094000:795 | family-side surface | KEEP | Projects `client_id` (legacy column); drop that column from the projection when the column goes. |
| `chat.my_family` | 091200:224 | family-side surface | MODIFY | Reads `family.owner_id`, `effective_handler()`, `next_on_duty_at()` — all changing/deprecated. Rewritten on the supervisor model. |
| `chat.my_permissions` | 091200:236 | family-side surface | MODIFY | Follows `contact` capability review. |
| `chat.sync_health` | 090900:362 | integration | MODIFY | Reads `unmapped_core_subscription_status` (DEPRECATE) and `core_parent_inbox` (MODIFY); rewrite when those change. |
| `chat.orphaned_coverage_rule` | 090700:293 | coverage | DEPRECATE | |
| `chat.unmapped_core_subscription_status` | 090900:114 | CRM mirror | DEPRECATE | |
| `chat.my_topics` | 091200:243, dropped 094000:51 | — | dropped | Not rebuilt (094000:823-827): projected `support_case`. |

### 3.5 Policies (55 live: 34 permissive, 21 restrictive)

Permissive policies are all from 091200 (re-derived for message/handoff by 094000:654-682); restrictive policies are all `<table>_organization_isolation` from 20260906120000:146-152. Every permissive policy is written `to authenticated` and calls the identity helpers, so all of them are MODIFY in Phase 1 (rewritten against the actor context that `RLS-STRATEGY.md` will define); those on DEPRECATED tables go with their tables.

| Table | Permissive policies (091200 / 094000) | Restrictive (120000) | RLS enabled? | Classification | Note |
|---|---|---|---|---|---|
| config | `config_readable_by_staff`, `config_managed_by_manager` (:78-81) | — | yes | MODIFY | |
| staff | `staff_readable_by_staff`, `staff_managed_by_manager` (:55-60) | `staff_organization_isolation` | yes | MODIFY | |
| shift | `shift_readable_by_staff`, `shift_managed_by_manager` (:62-65) | `shift_organization_isolation` | yes | DEPRECATE | |
| coverage_rule | `coverage_rule_readable_by_staff`, `coverage_rule_managed_by_manager` (:67-70) | `coverage_rule_organization_isolation` | yes | DEPRECATE | |
| absence | `absence_readable_by_staff`, `absence_managed_by_manager` (:72-75) | `absence_organization_isolation` | yes | DEPRECATE | |
| family | `family_visible_to_staff`, `family_edited_by_admins`, `family_created_by_manager` (:91-100) | `family_organization_isolation` | yes | MODIFY | Only table exercised by `tenant_isolation.sql`. |
| contact | `contact_visible_to_staff`, `contact_edited_by_admins` (:102-107) | `contact_organization_isolation` | yes | MODIFY | |
| learner | `learner_visible_to_staff`, `learner_edited_by_admins` (:109-114) | `learner_organization_isolation` | yes | MODIFY | |
| subscription | `subscription_visible_to_staff` (:116) | `subscription_organization_isolation` | yes | DEPRECATE | |
| family_note | `family_note_visible_to_staff`, `family_note_written_by_admins` (:120-124) | `family_note_organization_isolation` | yes | MODIFY | |
| message | `message_visible_to_staff`, `message_written_by_staff` (094000:655-675) | `message_organization_isolation` | yes | MODIFY | WITH CHECK delegates to `staff_may_send` → `on_duty`. |
| task | `task_visible_to_assignee_or_admins`, `task_created_by_admins`, `task_updated_by_assignee_or_admins` (:167-179) | `task_organization_isolation` | yes | DEPRECATE | |
| handoff | `handoff_visible_to_staff` (094000:678), `handoff_written_by_admins` (:184) | `handoff_organization_isolation` | yes | DEPRECATE | |
| event_log | `event_log_visible_to_staff`, `event_log_written_by_staff` (:189-194) | — | yes | MODIFY | |
| audit_log | `audit_log_manager_only` (:197) | — | yes | MODIFY | |
| family_state_cache | `family_state_visible_to_staff` (:200) | — | yes | DEPRECATE | |
| sync_state | `sync_state_manager_only` (:203) | — | yes | MODIFY | |
| core_event | `core_event_manager_only` (:205) | — | yes | MODIFY | |
| core_parent_inbox | `core_parent_inbox_manager_only` (:207) | — | yes | MODIFY | |
| account | none (by design, :210-212) | `account_organization_isolation` | yes | MODIFY | |
| schema_migrations | none | — | yes | KEEP | Owner-only by construction. |
| conversation, call, message_approval, notification, notification_rule, notification_template, device_token, quiet_hours | none | `<table>_organization_isolation` | **no** | KEEP (dormant) | Restrictive policy exists but RLS is not enabled on the table, so it does nothing (§5). |
| conversation_member, conversation_participant_state, message_attachment, message_reaction, message_receipt, message_hidden_for, outbox_event, organization | none | — | no | — | No policy, no RLS; also no grant to `authenticated` (only `message` has `SELECT, INSERT`). Access today is entirely through the owner connection. |

### 3.6 Roles

| Object | Created by | Classification | Reason / Phase |
|---|---|---|---|
| `anon` (NOLOGIN, NOINHERIT) | 091150:33-35 | MODIFY | Named so denial is explicit; whether the API ever assumes it is a `RLS-STRATEGY.md` decision. |
| `authenticated` (NOLOGIN, NOINHERIT) | 091150:39-41 | MODIFY | Target of every permissive policy and every grant; never assumed by the API today. |
| `service_role` (NOLOGIN, NOINHERIT, BYPASSRLS) | 091150:45-47 | MODIFY | Granted `usage` on schema (091200:21) and nothing else. |
| Connection role (`postgres` in harness/CI; `jawwid` per `.env.example:37`) | outside migrations | UNKNOWN | Question for `RLS-STRATEGY.md`: does the API keep a single owner-privileged connection (RLS inert) or `SET ROLE authenticated` + set `chat.actor_subject`/`chat.actor_organization` per request? `apps/api/src` contains no `set_config`, `SET ROLE`, `actor_subject` or `actor_organization` at HEAD. |

### 3.7 Indexes of note

| Object | Created by | Classification | Reason / Phase |
|---|---|---|---|
| `message_idempotency` unique `(conversation_id, author_id, client_message_id) where client_message_id is not null` | 093000:305 | KEEP | The single surviving idempotency mechanism (§4). |
| `message_conversation_seq` unique `(conversation_id, seq)` | 093000:299 | KEEP | Ordering invariant. |
| `conversation_one_group_per_learner` unique partial | 093000:102 | KEEP | PRD §7.3 one live Student Group per learner; tested `od01:111-116`. |
| `conversation_member_unique_live` unique partial | 093000:144 | KEEP | |
| `conversation.direct_key` unique, `call.room_name` unique, `notification.dedupe_key` unique, `device_token.token` unique, `message_attachment.object_key` unique | 093000 | KEEP | |
| `core_event_is_unique (source, external_event_id)` | 090900:64 | KEEP | Replay safety. |
| `contact_account_family_uniq` | 090300:87 | MODIFY | Follows identity changes. |
| `account.subject` unique | 090050:16 | MODIFY | |
| `<table>_organization_idx` ×21 | 20260906120000:141-142 | KEEP | |
| `message_client_id_uniq (thread_id, client_id)` | 091000:10 | **gone** | Dropped implicitly with `message.thread_id` at 094000:76; `message.client_id` is now unconstrained (§5). |
| `event_log_family_at`, `event_log_type_at`, `audit_log_entity` | 093200:22-38 | REMOVE LATER | Exact duplicates of `event_log_family_idx`, `event_log_type_idx`, `audit_log_entity_idx` (090500:48-78); confirmed live. Double write cost, no benefit. |
| `family_state_cache_inbox_idx`, `family_state_cache_unattended_idx` | 090500:139-142 | DEPRECATE | With table. |
| `task_*`, `handoff_*`, `shift_staff_idx`, `coverage_rule_covered_idx`, `absence_staff_range_idx`, `subscription_*` | 090200/090400/090300/094000 | DEPRECATE | With tables. |

---

## 4. Preserved invariants

| Invariant | Enforcing objects | Proof (test) | Gap |
|---|---|---|---|
| **BR-1 — a teacher and a family contact never share a `direct` conversation or call; a group containing both must carry a live staff admin.** Two layers. | Immediate: `conversation_member_br1` → `enforce_direct_conversation_rules()` (093000:153-195); `call_participant_br1` → `enforce_call_participant_rules()` (093000:691-718). Deferred (commit-time, both tables of each pair): `conversation_br1_row`, `conversation_member_br1_deferred` → `assert_conversation_br1()` (093300:66-182); `call_br1_row`, `call_participant_br1_deferred` → `assert_call_br1()` (093300:189-296). Type freeze: `conversation_type_immutable`, `call_type_immutable` (093300:168, 282). | `db/tests/br1_invariants.sql` A1, B1-B2, C1-C5, D1-D3, E1-E7 (18 executed assertions; 20 by the JC-011 count, which includes the two helper definitions). `schema_acceptance.sql:128-135` (trigger presence). `schema-invariants.spec.ts:80-154` (4 tests). | None. |
| **Admin presence (C-4)** — the staff member satisfying presence must be `actor_kind='staff' and member_role='admin'`. | `assert_conversation_br1()` counts `actor_kind='staff' and member_role='admin'` (093300:86, 105-111); calls require any `actor_kind='staff'` (093300:212, 227-232). | `br1_invariants.sql` C1-C5 (C5 is the teacher-claiming-admin case); `schema-invariants.spec.ts:111-122`. | The API-side C-4 check (`authorization.service.ts:190-193`, `liveMembers`) is the first layer; not covered by a DB test — by design, the DB is the backstop. |
| **Append-only logs** — `event_log` and `audit_log` refuse UPDATE/DELETE. | `forbid_mutation()` (090000:35); triggers `event_log_is_append_only`, `audit_log_is_append_only` (090500:52, 81) and duplicates `event_log_append_only`, `audit_log_append_only` (093200:44-51). `audit_log.reason NOT NULL` + non-blank check (090500:70). | `schema_acceptance.sql:139-140`; `schema-invariants.spec.ts:161-188` (real rows inserted first, then UPDATE/DELETE rejected). | None. |
| **Message immutability** — `body`, `author_id`, `author_type`, `conversation_id`, `seq` cannot change after insert; `moderation` and soft-delete columns may. | `forbid_message_rewrite()` + `message_no_rewrite` (093000:328-351). The blanket `message_is_immutable` was dropped deliberately (093000:314-325). | `schema_acceptance.sql:141`; `schema-invariants.spec.ts:190-237` (body rewrite rejected, moderation change accepted). | `deleted_for_all=true` allows a body change (093000:333-334) — intended for redaction; keep in mind for the audit trail. |
| **`seq` monotonic per conversation, assigned under a row lock.** | Column `message.seq` and `conversation.last_seq` (093000:78, 249); unique `message_conversation_seq` (093000:299). Allocation: `message.service.ts:161-167` does `SELECT last_seq … FOR UPDATE` then `last_seq + 1` inside a transaction. | `schema_acceptance.sql:160` (index presence only). | No DB-level test proves monotonicity or the lock; the guarantee lives in the API transaction. Phase 1 candidate: a `db/tests` assertion that `seq` is NOT NULL for conversation-parented rows (it is nullable today, `schema.prisma:233`). |
| **Idempotent send** — one row per `(conversation_id, author_id, client_message_id)`. | `message_idempotency` (093000:305-307). Legacy `message_client_id_uniq` no longer exists. | `schema_acceptance.sql:161`. | `message.client_id` remains as an unconstrained column (§5). |
| **Owner change guard** — `family.owner_id` changes only through `transfer_ownership()`, which is manager-only and writes `audit_log` + `event_log` in the same transaction. | `guard_owner_change()` + `family_owner_is_guarded` (090700:36-53); `transfer_ownership()` sets the `chat.transferring_ownership` GUC around the update (090700:96-98) and audits (090700:101-109). | **None** in `db/tests`. | Untested at the DB level. Phase 1 must add a test before the guard is re-expressed on assignment history. |
| **Deactivation guard** — a staff row cannot go `is_active=false` while it owns families. | `guard_staff_deactivation()` + `staff_deactivation_is_guarded` (090700:183-205); `offboard_staff()` is the sanctioned path. | **None** in `db/tests`. | Same as above. |
| **Organization isolation (RESTRICTIVE)** — a caller sees and writes only rows of `current_organization_id()`; unresolved tenant sees nothing; child rows cannot point at a parent in another organization. | `<table>_organization_isolation` restrictive policies (20260906120000:146-152) on 21 tables; `enforce_same_organization()` (:166) with triggers on `contact`, `learner`, `subscription`, `family_note`, `task`, `conversation`, `message` (:221-225). | `db/tests/tenant_isolation.sql` A1-A3, B1-B3, C1-C2, D1 (9), run as `authenticated` with `chat.actor_subject` set. | Holds only where RLS is enabled (13 of the 21 policy-bearing tables; the 8 communication tables are dormant, §5). `handoff` has no same-organization guard. Not run in CI. |
| **Family scope (C-2)** — a conversation containing a live family contact must have `family_id`, and that contact must belong to it; `class_group` may span families; teacher↔admin direct may have no family. | `assert_conversation_family_scope()` with deferred triggers `conversation_member_family_scope`, `conversation_family_scope` (094000:701-782). | `db/tests/od01_conversation_model.sql` B1-B3. | Not run in CI. |
| **Conversation is the only parent of a message; no thread, no Case.** | `message.conversation_id NOT NULL` (094000:77); tables dropped (094000:633-636). | `od01_conversation_model.sql` C1-C2, D1-D3; `schema_acceptance.sql:101-105`. | — |
| **One live Student Group per learner.** | `conversation_one_group_per_learner` (093000:102-104). | `od01_conversation_model.sql` A1-A2. | — |
| **No dependency on another product's database or on Supabase `auth`.** | 091150 creates the roles; `schema_acceptance.sql:165-179` asserts no non-`chat` tables and no `auth` schema. | `schema_acceptance.sql:165-179`. | — |

---

## 5. Known defects and debts

| # | Defect / debt | Evidence | Phase |
|---|---|---|---|
| D-1 | **Ledger created outside the chain (NF-05).** `chat.schema_migrations` is created by `apply.sh:26`, then `091200:43` enables RLS on it. Running the SQL files without the runner fails at 091200. | `docs/product-operations/reconciliation-status.md:38-42` | Phase 1: a new migration `create table if not exists chat.schema_migrations (…)` with the identical shape, so the chain is self-contained; the runner keeps its own `create … if not exists`. |
| D-2 | **RLS is inert at runtime.** The API connects as one owner-privileged role and never sets `chat.actor_subject`, `request.jwt.claims`, `chat.actor_staff_id` or `chat.actor_organization`, and never `SET ROLE`s. Every policy and helper therefore resolves to NULL/"nobody" and is bypassed by owner privilege. | grep of `apps/api/src` at HEAD: zero hits for `set_config`, `SET ROLE`, `actor_subject`, `actor_organization`, `current_organization_id`; `.env.example:37` single user. | Decision deferred to `docs/security/RLS-STRATEGY.md` (not yet written). This document only records the fact and the dependency: §3.5 policies and §3.2 identity helpers are MODIFY pending that decision. |
| D-3 | **RLS never enabled on the 17 communication/tenancy tables**, so the 8 restrictive `organization_isolation` policies on `conversation`, `call`, `message_approval`, `notification`, `notification_rule`, `notification_template`, `device_token`, `quiet_hours` are dormant, and `conversation_member`, `message_attachment`, etc. have no isolation at all. `093000` enabled RLS on none of its tables; `20260906120000` created policies without `enable row level security`. | Live catalogue query (§6): `relrowsecurity=false` for those 17; `tenant_isolation.sql` exercises `family` only. | Phase 1 (with D-2): enable RLS on the communication tables in the same migration that defines the actor contract; extend `tenant_isolation.sql` to `conversation`/`message`. |
| D-4 | **`handoff` has no cross-organization guard.** `20260906120000:205` guards `handoff` via `thread_id`, which OD-01 removed; the guard loop skips it (`:214-219`), so a `handoff` in org A may reference a `conversation` in org B. | No `handoff_same_organization` trigger live. | Phase 1 if `handoff` survives the product decision; otherwise moot at removal. Cheapest fix: a migration adding the guard `('handoff','conversation','conversation_id')`. |
| D-5 | **`message.client_id` legacy column without its unique index.** 091000 added `client_id` + `message_client_id_uniq (thread_id, client_id)`; 094000:76 dropped `thread_id`, taking the index with it. `post_customer_message()` and `my_messages` still write/read `client_id`; `message_idempotency` on `client_message_id` is the only real guarantee. Two idempotency columns coexist. | Live indexes on `chat.message`: no `message_client_id_uniq`. | Phase 1: migrate `post_customer_message()` to `client_message_id`, then a later migration drops `client_id`. |
| D-6 | **Prisma omits 13 tables and several columns.** Not modelled: `account`, `shift`, `coverage_rule`, `absence`, `subscription`, `family_note`, `task`, `handoff`, `family_state_cache`, `core_parent_inbox`, `sync_state`, `core_event`, `schema_migrations`. Column drift on modelled tables: `Staff` lacks `account_id`, `capacity_override`; `Family` lacks `tier_reason`, `state_reason`, `state_changed_at`, `manual_flag`, `manual_flag_reason`, `core_parent_id`; `Contact` lacks `account_id`; `Learner` lacks `schedule_ref`, `last_attended_at`, `consecutive_absences`, `core_child_id`; `Config` lacks `description`, `updated_by`; `Message` lacks `client_id` and declares `conversationId String?` although SQL is NOT NULL (094000:77); `seq BigInt?` although every API-written row has one. | `schema.prisma` vs `information_schema.columns` in §6 container. | Acceptable while Prisma is a client (omission ≠ drift), but the NOT NULL mismatch on `conversation_id` is a typing lie. Phase 1: regenerate the model for KEEP/MODIFY tables; never add DEPRECATED tables to Prisma (that would create new dependents). |
| D-7 | **No drift check.** `schema.prisma:5` claims `npm run db:drift` proves agreement; no such script exists in `apps/api/package.json`, CI, or `scripts/`. | `docs/integration/02-domain-conformance-plan.md:487-490` | Phase 1: implement (`prisma db pull` into a scratch file + diff of mapped columns) and wire into the `migrations` CI job, or delete the claim. |
| D-8 | **`prisma:push` script exists** (`apps/api/package.json:11`), a one-command path to DDL outside the authority. | `docs/integration/02-domain-conformance-plan.md:486` | Phase 1: delete the script. |
| D-9 | **090000 header still says Chat lives inside Core's Supabase database** (`090000:3-7`, contradicting `091150:51-54`, `integration-db.sh:3-9`, `docs/release/database-decision.md`). History is immutable, so the fix is a `comment on schema` in a later migration (091150 already did this) plus a note here; the file text stays. RT-010 remainder. | `docs/red-team/findings.md:146` | Documentation only; closed by this record plus the schema comment already in 091150. |
| D-10 | **Two DB suites are outside CI and outside JC-011.** `od01_conversation_model.sql` (12 assertions) and `tenant_isolation.sql` (9) are not in `ci.yml`, not in `integration-db.sh verify`, and not in `docs/qa/protected-tests.tsv`. | `ci.yml:203-210`; `integration-db.sh:61-64` | Phase 1: add both to the `migrations` job and the manifest (floors 12 and 9). |
| D-11 | **Duplicate append-only triggers and duplicate indexes** from 093200 (`event_log_append_only`/`audit_log_append_only` alongside `*_is_append_only`; `event_log_family_at`, `event_log_type_at`, `audit_log_entity` alongside the 090500 indexes). Harmless for correctness; doubles write cost. | Live catalogue (§6). | REMOVE LATER migration drops the three duplicate indexes; keep both trigger names because `schema_acceptance.sql:139-140` asserts the 093200 names. |
| D-12 | **Orphaned function** `chat.enforce_conversation_type_immutable()` (093000:206) — no trigger references it after 093300:167-170. | Live trigger list. | REMOVE LATER. |
| D-13 | **`assert_message_author_exists()` does not validate `author_type='teacher'`** (094000:86-101 handle staff and contact only). A teacher-authored message has no existence check because `chat.teacher` does not exist. | 094000:81-104 | Phase 1 with the teacher table. |
| D-14 | **DEPRECATED engine is still a live runtime dependency.** `AuthorizationService.canSend` and `ConversationService.activeHandler` route through `CoverageService.onDuty` → `chat.on_duty()`; `message_written_by_staff` WITH CHECK → `staff_may_send` → `effective_handler` → `on_duty`. `shift`/`coverage_rule`/`absence`/`on_duty` are therefore frozen but not removable until the Phase 1 ownership model replaces the routing decision. | `coverage.service.ts:22-23`; `authorization.service.ts:185-187`; `conversation.service.ts:437-439`; 094000:610, 662-675 | Phase 1 (blocking prerequisite of the removal migration). |
| D-15 | **`staff_can_see_family()` reads DEPRECATED `chat.task`** (091100:61-64) and `offboard_staff()` reads DEPRECATED `coverage_rule` (090700:272-274). | — | Phase 1 rewrite of both precedes the removal migration. |
| D-16 | **`event_log.type` and `chat.config` still carry Case/coverage vocabulary** (`case_*`, `handoff_*`, `absence_*`, `attention_order_disputed`; `lifecycle.*`, `timers.*`, `reopen.*`, `automation.batch_ack_seconds`, `cases.*` already deleted by 094000:640-648). | Live `event_log_type_check`; config key list (§6). | Removal migration prunes; until then rows are valid but unused. |
| D-17 | **`chat.family` CRM columns** (`tier`, `tier_reason`, `state`, `state_reason`, `state_changed_at`, `manual_flag`, `manual_flag_reason`) — UNKNOWN whether the product keeps a family lifecycle state and priority outside CRM scoring. | 090300:20-33 | Product question for Phase 1; until answered they stay (MODIFY table). |
| D-18 | **`conversation.sticky_handler_id`/`sticky_until`** — UNKNOWN whether stickiness survives the supervisor model; only writer is DEPRECATED `extend_stickiness()`, reader is DEPRECATED `effective_handler()` and `ConversationService.activeHandler` (`conversation.service.ts:434-436`). | 093000:73-74, 094000:554-586 | Product question for Phase 1. |
| D-19 | **Rescued, unapplied migration** `docs/recovery/evidence/uncommitted/ai4-20260906130000_chat_rbac_canonical_roles.sql` (role rename `coverage`→`coverage_admin`, `super_admin`, department column). Not in `supabase/migrations`; not applied; competes with `ee0dcdd` on `integration/prd-reconciliation`. | `docs/recovery/evidence/uncommitted/README.md` | Input to the Phase 1 role migration; must be re-authored against `AUTHORIZATION-MODEL.md`, never copied in as-is. |

---

## 6. Verification record

Executed 2026-09-07 by the Phase 0 lead and re-executed for this document against the disposable container `jawwid-chat-p0` (`JAWWID_INT_CONTAINER=jawwid-chat-p0`, `JAWWID_INT_PORT=55434`, image `postgres:17`, server reports `PostgreSQL 17.11 (Debian) aarch64`, database `jawwid_chat_int`). Read-only against that container; every suite runs inside `begin … rollback`.

| Step | Command | Result |
|---|---|---|
| Ledger | `select count(*), min(version), max(version) from chat.schema_migrations` | **22** rows, `20260905090000_chat_foundation` … `20260906120000_chat_organization`; all 22 filenames present in order. |
| Fresh apply | `scripts/db/integration-db.sh reset` (Phase 0 lead, 2026-09-07) | 22 migrations applied from an empty `postgres:17`, 0 failed. |
| Re-apply is a no-op | `PSQL="docker exec -i jawwid-chat-p0 psql -v ON_ERROR_STOP=1 -U postgres -d jawwid_chat_int" bash scripts/db/apply.sh` | 0 `apply` lines (22 `skip`), matching the G-19 rule at `ci.yml:193-199`. |
| `verify` | `JAWWID_INT_CONTAINER=jawwid-chat-p0 JAWWID_INT_PORT=55434 bash scripts/db/integration-db.sh verify` | exit 0; `FRESH DATABASE ACCEPTANCE PASSED`; `ALL BR-1 INVARIANT TESTS PASSED`. |
| `schema_acceptance.sql` | via `verify` | **PASS** — 58 executed assertions (NOTICE lines); **62** by the JC-011 count (`check-protected-tests.sh:29-31` also counts the four `pg_temp.want_*` helper definitions); floor 61. |
| `br1_invariants.sql` | via `verify` | **PASS** — 18 executed assertions (A1, B1-B2, C1-C5, D1-D3, E1-E7); **20** by the JC-011 count (includes the two helper definitions); floor 20. |
| `od01_conversation_model.sql` | `docker exec -i jawwid-chat-p0 psql -v ON_ERROR_STOP=1 -U postgres -d jawwid_chat_int -q < db/tests/od01_conversation_model.sql` | **PASS** — 12 assertions; `ALL OD-01 CONVERSATION MODEL TESTS PASSED`. |
| `tenant_isolation.sql` | same, `< db/tests/tenant_isolation.sql` | **PASS** — 9 assertions (A1-A3, B1-B3, C1-C2, D1), executed as `authenticated` with `chat.actor_subject='subject-a'`. |
| JC-011 guard | `bash scripts/qa/check-protected-tests.sh` | `JC-011 guard: pass` — `br1_invariants.sql` 20/20, `schema_acceptance.sql` 62/61, `schema-invariants.spec.ts` 12/9. |
| Live catalogue (for §3) | `pg_tables`, `pg_views`, `pg_proc`, `pg_trigger`, `pg_policies`, `pg_indexes`, `pg_roles` | 38 tables, 6 views, 76 functions, 40 triggers, 55 policies (34 permissive / 21 restrictive), RLS enabled on 21 tables and disabled on 17, roles `anon`/`authenticated`/`service_role` present with `service_role.rolbypassrls=true`. |

Not verified in this record: `apps/api` `npm run test:int` (`schema-invariants.spec.ts`) was not re-run here; it is protected by JC-011 and runs in the `migrations` CI job (`ci.yml:218-223`). No Prisma drift check exists to run (D-7).


---

## 7. Addendum — effect of product decisions PD-1 to PD-5 (closed 2026-09-07)

This document was written before PD-1 to PD-5 were closed. The classifications
above stand except where this addendum narrows them. The decision record is
`../product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4.

| PD | Effect on the classification above |
|---|---|
| PD-1 (coverage admins join a Student Group only for the window) | No change to any object. `chat.conversation_member.is_silent` stays KEEP; it is not used to make coverage admins permanent members. Window-scoped membership is Phase 2. |
| PD-2 (a parent may join but never start a group call) | No schema change. Enforced in `AuthorizationService.canCall`; `chat.call` / `chat.call_participant` stay KEEP unchanged. The database BR-1 backstop is untouched. |
| **PD-3 (coverage is an explicit temporary assignment)** | `chat.shift`, `chat.coverage_rule`, `chat.absence`, `chat.handoff` and the coverage-engine functions (`local_at`, `window_contains`, `in_shift`, `is_absent`, `absence_backup`, `coverage_chain`, `on_duty`, `effective_handler`, `extend_stickiness`, `next_on_duty_at`) move from **DEPRECATE (frozen pending a product decision)** to **DEPRECATE → REMOVE LATER (frozen, removal scheduled)**. The removal migration lands after Phase 1's `chat.family_assignment` carries the routing decision. `chat.on_duty()` keeps exactly one caller until then: `CoverageService` feeding `AuthorizationService.canSend`. Nothing new may depend on it. |
| **PD-4 (system events are system messages)** | `chat.task` stays **DEPRECATE** and is now explicitly **not to be revived**: the only remaining candidate use for it, carrying system-event types, is rejected. `chat.task.type`'s OD-01 re-pointing to the PRD §7.6 vocabulary is left in place as history and is not a signal that Tasks return. No new column is added to `chat.message` in Phase 0; the event-metadata carrier is a Phase 2 design item. The four `chat.conversation.type` values stay exactly four. |
| PD-5 (`super_admin` exists; departments are not roles) | Confirms the MODIFY already recorded for `chat.staff`: one Phase 1 migration changes `staff_role_check` to `super_admin \| manager \| admin \| coverage_admin`, renames the existing `coverage` rows, and moves `finance` / `technical` / `academic` to a new `chat.staff.department` attribute. The legacy role values must not survive as roles. |

Nothing in this addendum changes the migration chain, the invariants in §4, or
the verification record in §6. No migration was added or edited when the
decisions were closed.
