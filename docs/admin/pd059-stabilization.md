# PD-59 Sales pipeline: stabilization (rehearsal, hand-over gaps, legacy prospects, staging plan)

Status: **proposal and evidence**, 2026-11-21. Nothing here was run against staging or production. Everything marked
"ran" was run on a throwaway `postgres:17` container built with the repository's own tooling. Design of record:
`docs/product/pd-registry/PD-59.md`. Owner restrictions that bind this plan: no deploy, no production migration, no
automatic lead purging, no change to an existing parent or student record.

Contents: 1. what was rehearsed on the real migration chain · 2. converted-but-unlinked leads · 3. legacy prospects with
no owner · 4. the staging migration plan · 5. findings and decisions needed.

---

## 1. Real-chain rehearsal of `20261121100000_chat_pd059_sales_pipeline` (ran)

Method (own container, nothing shared):

```
docker run -d --name jc-pd59-verify-<n> -e POSTGRES_PASSWORD=... -e POSTGRES_DB=rehearsal -p 127.0.0.1:<port>:5432 postgres:17
# 1. every migration OLDER than PD-59 (182 files), with the repository's own runner:
MIGRATIONS_DIR=<dir holding the 182 older files> PSQL="docker exec -i <c> psql -v ON_ERROR_STOP=1 -U postgres -d rehearsal" scripts/db/apply.sh
# 2. synthetic seed (no real person): 10 staff in every role, 3 departments, 2 families, 3 learners, 11 prospects with
#    trial lessons, outcomes (not_subscribed / subscribed / no_show), 3 subscription forms, 2 enrolments, 1 learner-linked
# 3. apply PD-59 with the same runner; re-apply the file; roll back; re-apply
```

Postgres 17 is what CI (`ci.yml` `image: postgres:17`) and `scripts/db/integration-db.sh` use.

| Check | Result |
|---|---|
| Whole chain on an empty database (183 files) | applies; `db/tests/schema_acceptance.sql` and `br1_invariants.sql` pass |
| Pre-existing data | count and md5 of every row of **every** `chat` table (216 tables; `trial_prospect` over its original columns) identical before and after PD-59, after the re-run, after the rollback and after the re-apply. No family, contact, learner, enrolment, lesson, outcome or subscription row changes |
| Re-apply of the file (idempotency) | no error, no change; `chat.schema_migrations` skips it |
| Backfill | 6 of 11 prospects got `owner_staff_id = created_by` (live Sales member or the Sales manager). Not owned: created by Operations (2), the Teachers department (1), the super admin (1), departed Sales staff (1). Idempotent (second run changes 0 rows) |
| Constraints and indexes | `trial_prospect_pipeline_stage_known`, `_lost_reason_coherent`, `_follow_up_note_length`, `_conversion_coherent`, FKs `converted_family_id`, `owner_staff_id`; indexes `trial_prospect_owner_idx`, `trial_prospect_follow_up_idx`. Direct SQL: a stage `lost` without a reason, an unknown stage and a half-set conversion are refused |
| `guard_trial_prospect` | body replaced (md5 `2a1670ab...` to `5b307082...`). By direct SQL: an owner that is Operations, Finance, Teachers, unrelated or departed is refused on UPDATE and INSERT; a live Sales member, the manager and the super admin are accepted; clearing an owner is refused; a family of another organization is refused; a note rewrite outside the purge is refused |
| `guard_trial_student` | body replaced (md5 `2b2e9a43...` to `a4de8ddb...`); clearing a student note outside the purge is still refused |
| Confined contact table | RLS on, no policy, owner `postgres`; `chat_app`, `anon`, `authenticated`, `service_role`, `chat_service` have no privilege (SELECT as `chat_app`/`authenticated`/`service_role`: "permission denied"; as `anon`: "permission denied for schema chat") |
| EXECUTE | `purge_expired_sales_leads`, `expired_sales_leads`, `sales_lead_expired`, `sales_lead_purging`, `sales_lead_owner_eligible`, `guard_sales_lead_contact`: ACL `{postgres=X/postgres}`, i.e. the owner (the API and worker connect as it) and superusers only; `chat_app`, `anon`, `authenticated`, `service_role`, `chat_service` and PUBLIC cannot |
| Purge (a real run inside a rolled-back transaction) | deleted the contact, cleared notes, wrote one audit row per lead (`{contactDeleted, notesCleared}`, no value), changed no family, contact, learner or enrolment row (counts 2/2/3/2 before and after) |
| Time and locks | whole migration 1.2 s wall (includes docker exec); with **50 000** extra prospects the backfill took 2.6 s (a few hundred prospects: milliseconds). Locks: ACCESS EXCLUSIVE on `chat.trial_prospect` (add columns, constraints) and SHARE ROW EXCLUSIVE on `chat.family` and `chat.staff` (new foreign keys) for the length of the transaction; no table rewrite (every new column is nullable, no default) |
| `lock_timeout` | `apply.sh` sets `statement_timeout = 0` and **no** `lock_timeout`. With a transaction holding `chat.trial_prospect` open, the migration waited for it (6 s of an 8 s holder); with `PGOPTIONS='-c lock_timeout=3s'` it failed after 3 s ("canceling statement due to lock timeout") and rolled back whole, ledger row not written, safe to retry |
| Rollback `db/rollback/20261121100000_...down.sql` | runs; both guards restored (`2a1670ab...` and `2b2e9a43...`, the originals); the `chat` schema dump is **byte-identical** to before PD-59 (this PR fixes a two-line comment that was missing from the restored `guard_trial_prospect`; it differed only in a comment); the dropped contact row is lost, as the file warns |
| Re-apply after rollback | clean; guard md5 equal to the first apply |
| Tests on the same chain | new 37-test HTTP integration spec (PR #624); 28 existing trial-facing integration suites (416 passed, 2 skipped by their authors, 0 failed); the whole unit project (3014 passed) |

Not rehearsed (cannot be from here): a real Supabase/DigitalOcean database, the real staging data, the real owner role.
Section 4 lists what a staging run must check because of that.

### Open migration PRs and slot order (ran: `gh pr diff --name-only` on every open PR)

Open PRs that carry a migration: #537 (`20261109120000`), #545 (`...130000`), #550 (`...140000`), #551 (`...150000`),
#559 (`...160000`), #566 (`...170000`), #567 (`...180000`). No slot collides with `20261121100000`. All seven are
**older** than slots already on main (`20261110100000`, `20261117100000`, `20261117110000`, `20261121100000`). `apply.sh`
applies every file not yet in the ledger in filename order, whatever the ledger's maximum is, so each applies cleanly after PD-59
on a database that already has it. None of the seven mentions `trial_prospect`, `trial_student`, `guard_trial_*`,
`sales_*` in its added lines, so none redefines a PD-59 object. #537/#550/#551/#559/#566 are stacked on other branches
(not on main) and #537 currently conflicts; they merge in stack order. Re-run the check at deploy time (4.2).

---

## 2. Converted-but-unlinked leads

**Why they exist.** `converted_at` and `converted_family_id` are written by exactly one code path: the Sales user pressing
Convert (`SalesPipelineService.convert`). Nothing else in `apps/api/src` sets them (verified by search). A lead's *stage* is
derived on read from its trials, so a subscribed trial shows Converted at once, but the hand-over fields stay empty until a
person converts. Meanwhile Operations hands the family over through a different, older flow (New students: subscription form
`chat.trial_subscription`, then Assign, which writes `chat.student_enrolment`). The two flows do not talk to each other.

### The states (every combination that can occur)

| # | Trial outcome | Subscription form | Enrolment | `learner_id` | `converted_at` | Stage shown | List `handedOver` | Detail `canConvert` | `convert()` does | Lead contact copy | Retention |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | none / not subscribed / no-show | none | none | null | null | New Lead .. Lost | false | per stage | matches a family by key: link (rep must own it, the manager owns all), or `intake_required`, or 409 `unavailable` | kept | purges after 12 months idle |
| 1 | subscribed | none or withdrawn (rare: moving away from subscribed withdraws it) | none | null | null | Converted | false | true | `awaiting_enrolment` (audited `convert_attempted`) | kept | skipped (subscribed) |
| 2 | subscribed | recorded | none (Operations has not assigned) | null | null | Converted | false | true | `awaiting_enrolment` | kept | skipped (subscribed) |
| 3 | subscribed | recorded | **exists** (`new_family` or `added_children`) | null/set | **null** | Converted | **true** | **true** (inconsistent with the list) | links to that enrolment's family if every channel is covered or fits an empty slot; else **409 `channel_missing`**; `no_contact` if the lead has no contact row | kept until the click | skipped (enrolment) |
| 4 | subscribed | recorded | exists | any | set | Converted | true | false | 409 already converted | **deleted** at the link | skipped (converted) |
| 5 | subscribed then **corrected** to not subscribed | withdrawn | exists | any | null | Lost (derived) | true | false (`lost`: reopen first) | refused `lost` | kept | skipped (enrolment) |
| 6 | any | any | any | set by Core's confirmation | null | by trial | by enrolment | per stage | as 3 | kept | skipped (`learner_id`) |
| 7 | any | any | any | any | any | any | any | any | **no contact row at all** (every prospect that existed before PD-59, and every prospect made by booking a trial with typed students): `no_contact` refusal, never links | none | n/a |

State 7 is the common one in production on day one: PD-59 adds the contact table empty, so every existing prospect has no
contact copy. They cannot be "converted" in the pipeline sense and stay at `converted_at = null` forever even after
Operations enrolled them. Harmless for data (there is no contact to purge or lose), but `converted_at` is **not** a reliable
count of conversions; the derived stage is.

### Where contact and notes get stuck or lost

- **Stuck, not lost:** states 1, 2, 3, 5, 6 keep the lead's contact copy (parent name, phone, WhatsApp, e-mail), the lead
  note, the follow-up note and the students' notes **indefinitely**, because retention deliberately never touches a lead with
  a subscribed trial, an enrolment, a learner link or a conversion. The same parent's details then sit in three places: the
  lead copy, the confined `trial_subscription` form, and the family record.
- **`channel_missing` is the main blocker** (reproduced by the new integration spec, PR #624, test 6). Linking must not lose a
  channel, so the lead's channels are written only into the family's EMPTY phone/e-mail slots. The family Operations created
  from the subscription form already has a phone and an e-mail, so any lead whose WhatsApp number, second phone or other
  e-mail differs from the form's is refused: *"add it to the family's profile first, then convert again"*. A Sales
  representative has `parents.edit` only on families they own, and the enrolled family belongs to an Operations supervisor, so
  the representative cannot resolve it; the lead stays in state 3 indefinitely.
- **No loss path found.** The migration touches no customer row; the purge refuses states 1-6 (verified on the seeded rows:
  `sales_lead_expired` is false for subscribed, enrolled and learner-linked leads, and the 37-test spec asserts it on an old
  clock); a refused conversion rolls back and keeps the contact.
- **List and detail disagree** in state 3: the list says `handedOver: true` (enrolment counts), the detail still offers
  Convert (`canConvert` looks at `converted_at` only).

### Reconciliation (implemented, read-only)

`scripts/db/reports/pd059-lead-reconciliation.sql` runs in `begin read only`, prints ids, states, counts and ages and **no
contact value**:

```
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/db/reports/pd059-lead-reconciliation.sql
```

Part 1 counts leads per state above (and how many still hold a contact copy); 1b lists the actionable ones oldest first;
part 2 is section 3; part 3 is what a retention dry run would list. On the synthetic seed it classified every seeded
shape correctly (one state-2 lead, two state-3 leads, one learner-linked lead, seven not customers). **Run it on staging
and production before deciding anything below**; the counts there decide whether the follow-ups are worth building.

### Proposed fix (not implemented)

1. **Make the hand-over visible.** A manager-facing "Needs hand-over" list (API `GET /sales-pipeline/reconciliation`,
   manager and super admin only) returning state, age, owner, whether a contact copy exists and, for `channel_missing`, the
   channel KINDS that have no room (never values). Fix the list/detail inconsistency: `canConvert` and `handedOver` must
   use the same rule (an enrolment counts).
2. **A linking step that only links.** For state 3 and 6 (the family is known from the lead's *own trial's* enrolment, so it
   is authoritative) and for state 7 leads that were enrolled (no contact to delete):
   - one transaction per lead under the existing row lock (`lockedFacts`); `update trial_prospect set converted_at,
     converted_family_id ... where id = $1 and converted_at is null` (idempotent: a second run matches nothing);
   - it **reuses the family from `student_enrolment.family_id`**: it creates no family, contact, learner or enrolment, and
     writes **nothing** into any parent or student record;
   - it deletes the lead's contact copy only when every channel of it is already covered by that family's
     `family_contact_key` rows, i.e. the family already holds everything (no merge, so zero writes to the parent file); a lead
     that would need a merge stays in the "Needs hand-over" list with the missing KINDS shown, for a human (Operations or the
     family's Sales owner adds the channel, then the lead links);
   - dry run by default, a batch limit, manager and super admin only, a button or an explicit run, **never scheduled**;
   - one audit row per lead `sales_lead.linked_by_reconciliation` (actor, from state, family id, `contactDeleted`; never a
     value) and one summary row per run.
3. **What it must not do:** merge channels into a family's parent file, link by name or by guess, run without the lead having
   its own enrolment, or touch a lead whose enrolment's family belongs to another organization (the existing
   `converted_family_id` guard refuses it too).
4. **Decision needed from the owner** (privacy against reachability, not an engineering choice): when a lead's WhatsApp number
   is not in the family's record, do we (a) keep refusing until the family's profile is updated (current, safe, can stall),
   or (b) let the manager link and drop that channel, audited by kind? Recommendation: (a), made workable by item 1, and a
   aging flag on the list. Until decided, the lead's copy is kept.

Tests the implementation would need first: link of an enrolled lead (no second family/parent, contact removed, audit
without values); idempotent second run; a lead needing a merge is left alone and listed; another organization's family is
refused; a representative cannot run it; concurrent run (row lock) links once.

---

## 3. Legacy prospects with no owner

PD-59 already backfills `owner_staff_id = created_by` where the creator is a **live** Sales member or Sales manager of the
same organization, idempotently. What is left unowned, by who recorded it (the report's part 2; counts below are from the
synthetic seed, shown only to illustrate the shapes: real counts need the report on staging):

| Recorded by | Why unowned | Shapes seen | Who reaches it today |
|---|---|---|---|
| Operations | not Sales; booked a trial from the trial desk | with and without trial, often subscribed and enrolled (customers) | Sales manager, super admin; Operations through the trial desk (existing rules) |
| Teachers department | same | trial booked for a teacher's group, often subscribed | same |
| Super admin | not backfilled by design | no trial, old | Sales manager, super admin |
| Departed Sales staff | creator not live | old, mostly without a trial | Sales manager, super admin |
| (Sales manager) | backfilled: **the manager owns them** | any | the manager (reachesAll) |

Sub-shapes that matter: (a) *customers* (subscribed / enrolled / learner-linked): ownership no longer matters, and the service
refuses to reassign a Converted lead, so they stay unowned by design; (b) *open leads with a trial* (booked, completed, lost
by outcome); (c) *open leads without a trial*; (d) *older than 12 months*: a retention pass will clear their notes (see
finding F3), so assigning them is wasted effort and, because a reassignment is "meaningful activity", would restart the clock.

### Proposed workflow (not implemented)

1. **Who decides:** the Sales manager (and the super admin). Nobody else; no rule assigns silently beyond the merged backfill.
2. **See them:** an "Unassigned" filter and count on the manager's board (`GET /sales-pipeline/leads?owner=none`; the list
   already returns `owner: null` for them), with, per row, a *hint* (never applied): the Sales member who booked its latest
   trial (`lesson.created_by`), if still live, and whether the lead is a customer or older than 12 months.
3. **Assign:** one at a time with the existing `POST /sales-pipeline/leads/:id/owner`. A bulk step
   `POST /sales-pipeline/leads/owner/bulk { leadIds (max 50), ownerId }`, manager and super admin only, per-lead result,
   customers skipped, each lead through the same code path as a single reassignment (row lock, eligible-owner check, the database
   guard) so it cannot diverge; one `sales_lead.reassigned` row per lead (who, from, to) plus one summary row (count, to),
   never a value; idempotent (already owned by that rep is a no-op).
4. **By recorded-by:** Operations / Teachers / super admin created: the manager decides case by case from the hint. Departed
   staff: the manager reassigns to a live rep, or leaves it to retention. Customers: leave unowned.
5. **Order:** first run the report on staging; assign open leads (b, c) that are under 12 months; leave (a) and (d).

Tests before building: bulk by a representative is 403; a non-Sales owner is refused for the whole call; a Converted lead is
skipped and reported; partial failure does not roll back the others; audit rows carry no value; a second identical call
changes nothing.

---

## 4. Staging migration plan (PD-59, `20261121100000_chat_pd059_sales_pipeline`)

**Authority.** This plan is for the owner to approve. It is not run by an agent: staging is deployed by the manual
`Deploy staging` workflow (`workflow_dispatch`), which already preflights the role, backs up, applies, releases and smoke tests.
Do not enable any retention flag (4.9).

### 4.1 Preconditions

- Main contains PD-59 (PRs #616-#622) and the slot file `docs/product/migration-slots/20261121100000.md`.
- The deploy credentials and `staging` environment of `deploy-staging.yml` are in place (BLOCKER list in
  `docs/infrastructure/production-readiness.md`).
- The migration role is the **owner** of the existing `chat` objects. `create or replace function chat.guard_trial_prospect`
  and `chat.guard_trial_student` fail ("must be owner") otherwise. Check:
  ```sql
  select p.proname, pg_get_userbyid(p.proowner) owner, current_user
    from pg_proc p where p.pronamespace = 'chat'::regnamespace and p.proname in ('guard_trial_prospect','guard_trial_student');
  ```
- Roles that must exist (created by `20260905091150`, earlier in the chain): `chat_app`, `anon`, `authenticated`
  (named by the `revoke`s). `service_role` and `chat_service` exist in the chain too; PD-59 does not name them.
- The database major version is 17 (CI and the rehearsal). Extensions needed by the chain (`btree_gist`, `pg_trgm`) are
  already there on a migrated database.

### 4.2 Pre-checks (read-only)

```sql
-- the ledger: everything older than PD-59 must already be applied; PD-59 must not be
select max(version), count(*) from chat.schema_migrations;
select count(*) from chat.schema_migrations where version = '20261121100000_chat_pd059_sales_pipeline';  -- 0
-- default privileges that could hand a new chat table to a role (Supabase)
select defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl from pg_default_acl;
-- size of what the migration scans/locks
select (select count(*) from chat.trial_prospect) prospects, (select count(*) from chat.family) families, (select count(*) from chat.staff) staff;
-- who holds long transactions on the tables it locks right now (should be none)
select pid, now()-xact_start age, state, left(query,80) from pg_stat_activity where xact_start is not null and datname = current_database() and pid <> pg_backend_pid() order by xact_start;
```

Slot order, at the time of the run:

```
for n in $(gh pr list --state open --limit 100 --json number -q '.[].number'); do
  gh pr diff $n --name-only | grep -E '^supabase/migrations/' | sed "s/^/#$n /"; done
```

Expect no slot equal to `20261121100000`. Slots older than it are fine (section 1: `apply.sh` applies anything missing).

### 4.3 Backup / snapshot

The workflow's step "Back up the database before migrating" takes an encrypted `pg_dump` of `chat` (artifact
`pre-deploy-backup-<run>`, 30 days). Confirm it succeeded before the migration step. If applying by hand instead: take a
provider snapshot first, then `pg_dump -n chat`. The dump is also the only way to recover the lead contact copies after a
rollback (4.7).

### 4.4 Order of operations

1. Pre-checks (4.2). Go/no-go (4.8).
2. Backup (4.3).
3. Preflight the role capability: `scripts/db/preflight-role-capability.sh` (the workflow does it).
4. Apply, with a bounded wait for locks so it cannot queue behind a long transaction and block readers:
   ```
   PGOPTIONS='-c lock_timeout=5s' PSQL="psql -v ON_ERROR_STOP=1 $DATABASE_URL" scripts/db/apply.sh
   ```
   (The workflow runs `scripts/db/apply.sh` without `lock_timeout`; setting `PGOPTIONS` in that step's environment is the
   one change worth making. A failed attempt rolls back whole and is safe to repeat.)
5. Deploy the API and worker (the workflow's Release step) **after** the migration: the migration is additive, so the old
   API keeps working against the new schema in the gap; the new API needs the columns.
6. Verification (4.5), smoke test.

### 4.5 Verification after apply (read-only, all expected values from the rehearsal)

```sql
select count(*) from chat.schema_migrations where version = '20261121100000_chat_pd059_sales_pipeline';        -- 1
select count(*) from information_schema.columns where table_schema='chat' and table_name='trial_prospect'
   and column_name in ('pipeline_stage','lost_reason','last_contacted_at','next_follow_up_on','follow_up_note','converted_at','converted_family_id','owner_staff_id','last_activity_at');   -- 9
select relrowsecurity, (select count(*) from pg_policies where tablename='sales_lead_contact') policies
  from pg_class where oid = 'chat.sales_lead_contact'::regclass;                                                -- t, 0
select r.rolname, has_table_privilege(r.rolname,'chat.sales_lead_contact','select,insert,update,delete') any_priv
  from pg_roles r where r.rolname in ('chat_app','anon','authenticated','service_role','chat_service');         -- all f
select proname, proacl from pg_proc where pronamespace='chat'::regnamespace
   and proname in ('purge_expired_sales_leads','expired_sales_leads','sales_lead_expired','sales_lead_purging','sales_lead_owner_eligible','guard_sales_lead_contact');  -- {owner=X/owner} only
select count(*) filter (where owner_staff_id is not null) owned, count(*) total from chat.trial_prospect;       -- owned = prospects created by live Sales staff
select count(*) from chat.sales_lead_contact;                                                                   -- 0
select pg_get_functiondef('chat.guard_trial_prospect'::regproc) like '%sales_lead_owner_eligible%';             -- t
```

Row counts of `chat.family`, `chat.contact`, `chat.learner`, `chat.student_enrolment`, `chat.lesson`, `chat.trial_outcome`
and `chat.trial_subscription` must equal the pre-check counts (the migration changes none). Then run
`scripts/db/reports/pd059-lead-reconciliation.sql` and file its output (ids and counts only) with the deploy record.
On Supabase, if the `service_role` line prints `t`, a default privilege handed the confined table to a role that bypasses
row-level security: stop, tell the lead (the repository's `revoke` list, here and for `trial_subscription` before it, does
not name `service_role`).

### 4.6 Expected lock and duration

Rehearsal: ~1.2 s total at 11 prospects; 2.6 s for the backfill at 50 000. Locks: ACCESS EXCLUSIVE on `chat.trial_prospect`
and SHARE ROW EXCLUSIVE on `chat.family` and `chat.staff`, held to the end of the transaction. Writes to those three tables
queue for that second; nothing is rewritten. Run in a quiet minute; with `lock_timeout` a busy moment is a retry, not an outage.

### 4.7 Rollback

```
psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261121100000_chat_pd059_sales_pipeline.down.sql
psql "$DATABASE_URL" -c "delete from chat.schema_migrations where version = '20261121100000_chat_pd059_sales_pipeline'"
```

- Roll the API and worker back **first** (or the same time): the new code reads these columns.
- **Data-loss warning:** it drops `chat.sales_lead_contact`. Every lead contact (parent name, phone, WhatsApp, e-mail) that
  has not been linked to a family is gone, and so are the pipeline columns (stored stage, lost reason, follow-ups, owners).
  Export first (from a privileged session, to an encrypted file, never into a chat or ticket):
  `\copy (select * from chat.sales_lead_contact) to ...`. Nothing about families, parents, learners, lessons, outcomes or
  enrolments changes (verified: byte-identical schema, identical row hashes). Rehearsed: rollback, then re-apply, clean.
- It restores both guard bodies to the originals; the owner-eligibility rule disappears with it.

### 4.8 Go / no-go checklist

- [ ] The owner approved this plan for the named environment.
- [ ] Main SHA recorded; PD-59 PRs merged; slot file present; no open PR with slot `20261121100000`.
- [ ] Migration role owns the `chat` functions (4.1); `chat_app`, `anon`, `authenticated` exist.
- [ ] Ledger shows every older migration applied and PD-59 not applied.
- [ ] Backup artifact exists and was restored once in a scratch database, or a provider snapshot was taken.
- [ ] No long transactions on `trial_prospect`, `family`, `staff`.
- [ ] `lock_timeout` set for the apply step.
- [ ] Rollback file reviewed; the owner accepts the lead-contact data-loss warning.
- [ ] Verification queries and the reconciliation report ready to run right after.

### 4.9 What must NOT be done

- **No purge flags.** Do not set `SALES_LEAD_RETENTION_ENABLED` or `SALES_LEAD_RETENTION_DRY_RUN` in the staging or
  production environment (they are in no manifest today, so the job is off). No agent runs
  `purge_expired_sales_leads(…, false)`. Enabling the job is a separate owner decision after the dry-run review in F3.
- No `lead` data seeded into staging by hand; no edit of an existing parent, family or learner row; no `--force`
  re-application; no editing the ledger except the rollback's one `delete`.
- Do not apply to production before staging has run clean and the owner approved production separately.

---

## 5. Findings and decisions

| # | Finding | Evidence | Severity | Proposal |
|---|---|---|---|---|
| F1 | A lead enrolled by Operations whose channels differ from the family's form is refused `channel_missing` and **cannot be resolved by the Sales rep** | spec test 6 (PR #624); state 3 of the table | medium (stalls hand-over, keeps PII in 3 places) | section 2: visible list, link-only step, owner decision on dropping a channel |
| F2 | `converted_at` is set only by a manual Convert; enrolled leads never get it; every pre-PD-59 prospect has no contact row so it can never be set | code search; state 7 | low (data), medium (reporting) | do not report conversions from `converted_at`; link step (section 2) |
| F3 | First retention pass would act at once on **pre-PD-59** prospects older than 12 months, by `created_at` (notes cleared; no contact exists yet). By the function's definition it also covers leads with a not-subscribed trial | rehearsal: 3 of 11 seeded prospects listed by the dry run | medium before enabling | review `Part 3` and the list with the owner first; keep the flag off |
| F4 | `apply.sh` has no `lock_timeout`; a long transaction makes the migration wait and queue other writers | measured | low | `PGOPTIONS` in the deploy step (4.4) |
| F5 | Rollback restored `guard_trial_prospect` except two comment lines | schema diff | trivial | fixed in this PR; now byte-identical |
| F6 | Open migration PRs #537-#567 have slots older than slots already on main; order-independent today, none touches PD-59 objects | `gh pr diff` on every open PR | low | re-check at deploy time |
| F7 | `GET /trials` (the trial list and cards) is not ownership-scoped: a representative still sees other representatives' trials by design ("existing trial-desk rules") | PD-59.md review fixes | info | confirm with the owner that this is intended |
| F8 | The list says `handedOver: true` for an enrolled lead while the detail offers Convert | `list()` vs `detail()` | low | section 2, item 1 |

Verified OK: ownership scoping on every sales-pipeline route and on the trial prospect list and booking (37 tests, PR #624);
a foreign lead is indistinguishable from a missing one; non-Sales roles are refused; the database owner guard refuses a non-Sales
owner by direct SQL; the confined table and the purge function are closed to the request roles; audit rows carry field names
only; the migration is additive, idempotent and reversible without touching a customer row.
