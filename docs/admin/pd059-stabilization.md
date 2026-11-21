# PD-59 Sales pipeline: stabilization (rehearsal, hand-over gaps, legacy prospects, staging plan)

Status: **proposal and evidence**, 2026-11-21 (revised after the owner's decisions of the same day). Nothing here was run
against staging or production. Everything marked **RAN** was run on a throwaway local `postgres:17` container built with the
repository's own tooling, on synthetic data; everything marked **PROPOSED** is a design that nothing implements. Design of
record: `docs/product/pd-registry/PD-59.md`. Owner restrictions that bind this plan: no deploy, no production migration, no
automatic lead purging, no change to an existing parent or student record, no bulk reassignment, the channel-validation
restriction stays (no silent drop or overwrite of a channel, no bypass).

Contents: 1. what was rehearsed on the real migration chain (and the open-PR slot re-check) · 2. converted-but-unlinked leads
(report, proof it is read-only) · 3. legacy prospects with no owner (report) · 4. the staging migration plan, with **4A the
staging schema review** and **4B the lock-timeout change** · 5. findings and decisions needed · 6. **F3 retention first pass:
proposal** · 7. **link-only workflow: design proposal**.

What exists in the repository after this revision (all read-only SQL or documentation except the one optional shell change):

| File | What | Status |
|---|---|---|
| `scripts/db/reports/pd059-staging-schema-review.sql` | pre-apply checklist with expected values and PASS/FAIL (4A) | RAN on a local 182-migration chain only. **NOT run on real staging.** |
| `scripts/db/reports/pd059-lead-reconciliation.sql` | parts 1-3 as before (output identical), new part 4 (unassigned prospects) and part 5 (converted-but-not-linked) | RAN on a local synthetic seed. Not run on staging or production. |
| `scripts/db/apply.sh` | optional `APPLY_LOCK_TIMEOUT` (`set local lock_timeout`); unset = unchanged | RAN locally (4B). Not deployed. |
| `.github/workflows/deploy-*.yml` | the one-line env change that sets it | **PREPARED as a patch below, NOT applied and NOT committed**: `.github/workflows/` is an owner-only path |

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
| Pre-existing data | count and md5 of every row of **every** `chat` table (217 tables before PD-59, 218 after; `trial_prospect` over its original columns) identical before and after PD-59, after the re-run, after the rollback and after the re-apply. No family, contact, learner, enrolment, lesson, outcome or subscription row changes |
| Re-apply of the file (idempotency) | no error, no change; `chat.schema_migrations` skips it |
| Backfill | 6 of 11 prospects got `owner_staff_id = created_by` (live Sales member or the Sales manager). Not owned: created by Operations (2), the Teachers department (1), the super admin (1), departed Sales staff (1). Idempotent (second run changes 0 rows) |
| Constraints and indexes | `trial_prospect_pipeline_stage_known`, `_lost_reason_coherent`, `_follow_up_note_length`, `_conversion_coherent`, FKs `converted_family_id`, `owner_staff_id`; indexes `trial_prospect_owner_idx`, `trial_prospect_follow_up_idx`. Direct SQL: a stage `lost` without a reason, an unknown stage and a half-set conversion are refused |
| `guard_trial_prospect` | body replaced (md5 `2a1670ab...` to `5b307082...`). By direct SQL: an owner that is Operations, Finance, Teachers, unrelated or departed is refused on UPDATE and INSERT; a live Sales member, the manager and the super admin are accepted; clearing an owner is refused; a family of another organization is refused; a note rewrite outside the purge is refused |
| `guard_trial_student` | body replaced (md5 `2b2e9a43...` to `a4de8ddb...`); clearing a student note outside the purge is still refused |
| Confined contact table | RLS on, no policy, owner `postgres`; `chat_app`, `anon`, `authenticated`, `service_role`, `chat_service` have no privilege (SELECT as `chat_app`/`authenticated`/`service_role`: "permission denied"; as `anon`: "permission denied for schema chat") |
| EXECUTE | `purge_expired_sales_leads`, `expired_sales_leads`, `sales_lead_expired`, `sales_lead_purging`, `sales_lead_owner_eligible`, `guard_sales_lead_contact`: ACL `{postgres=X/postgres}`, i.e. the owner (the API and worker connect as it) and superusers only; `chat_app`, `anon`, `authenticated`, `service_role`, `chat_service` and PUBLIC cannot |
| Purge (a real run inside a rolled-back transaction) | deleted the contact, cleared notes, wrote one audit row per lead (`{contactDeleted, notesCleared}`, no value), changed no family, contact, learner or enrolment row (counts 2/2/3/2 before and after) |
| Time and locks | whole migration 1.2 s wall (includes docker exec); with **50 000** extra prospects the backfill took 2.6 s (a few hundred prospects: milliseconds). Locks: ACCESS EXCLUSIVE on `chat.trial_prospect` (add columns, constraints) and SHARE ROW EXCLUSIVE on `chat.family`, `chat.staff` and `chat.organization` (new foreign keys) for the length of the transaction; no table rewrite (every new column is nullable, no default) |
| `lock_timeout` | `apply.sh` sets `statement_timeout = 0` and **no** `lock_timeout`. With a transaction holding `chat.trial_prospect` open, the migration waited for it (6 s of an 8 s holder); with `PGOPTIONS='-c lock_timeout=3s'` it failed after 3 s ("canceling statement due to lock timeout") and rolled back whole, ledger row not written, safe to retry |
| Rollback `db/rollback/20261121100000_...down.sql` | runs; both guards restored (`2a1670ab...` and `2b2e9a43...`, the originals); the `chat` schema dump is **byte-identical** to before PD-59 (this PR fixes a two-line comment that was missing from the restored `guard_trial_prospect`; it differed only in a comment); the dropped contact row is lost, as the file warns |
| Re-apply after rollback | clean; guard md5 equal to the first apply |
| Tests on the same chain | new 37-test HTTP integration spec (PR #624); 28 existing trial-facing integration suites (416 passed, 2 skipped by their authors, 0 failed); the whole unit project (3014 passed) |

Not rehearsed (cannot be from here): a real Supabase/DigitalOcean database, the real staging data, the real owner role.
Section 4 lists what a staging run must check because of that.

### Open migration PRs and slot order (F6) (RAN, re-run 2026-11-21 12:37 UTC)

Method: `gh pr list --state open` (62 open PRs), then `gh pr diff <n> --name-only` for every one of them, filtered for
`supabase/migrations/`, `db/rollback/` and `docs/product/migration-slots/`; then the added lines of each migration PR searched
for `trial_prospect`, `trial_student`, `guard_trial`, `sales_lead`, `sales_department`, `pd059`.

| Result | Value |
|---|---|
| Open PRs that add a migration | 7: #537 (`20261109120000`), #545 (`...130000`), #550 (`...140000`), #551 (`...150000`), #559 (`...160000`), #566 (`...170000`), #567 (`...180000`) |
| Slot equal to `20261121100000` | none. The only open PR touching a PD-59 file is #625 (this document PR: the PD-59 rollback file's comment fix and this doc) |
| Slots versus main | all seven are older than slots already on main (`20261110100000`, `20261117100000`, `20261117110000`, `20261121100000`) |
| PD-59 object named in their added lines | 0 hits in all seven |
| Stacking / mergeability | #537, #550, #551, #559, #566 are stacked on other branches (not on main). **#537 and #545 are CONFLICTING now** (previously only #537); #550, #551, #559, #566, #567 are MERGEABLE. They merge in stack order |
| What they do touch | org-immutability and same-organization triggers on `chat.family`, `chat.staff`, `chat.learner`, `chat.contact`, `chat.conversation`, `chat.teacher`, `chat.account`; a device-token and a deletion-request fix. PD-59 only adds foreign keys to `chat.family`, `chat.staff`, `chat.organization` and `chat.trial_prospect`; it neither redefines nor is redefined by any of these |

Conclusion unchanged: `apply.sh` applies every file not yet in the ledger in filename order, whatever the ledger's maximum is, so
each of the seven applies cleanly after PD-59 on a database that already has it. Slot order is therefore not a blocker, but the
4A script check 42 will list any ledger row it does not know, and the check must be re-run at deploy time (4.2) because the
open-PR set changes daily.

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

### Reconciliation (implemented, read-only) (RAN on a synthetic seed)

`scripts/db/reports/pd059-lead-reconciliation.sql` runs in `begin read only`, prints ids, states, counts, role labels and ages and
**no contact value** (ids may be capped with `-v id_limit=500`, default 200 per list):

```
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/db/reports/pd059-lead-reconciliation.sql
```

| Part | Prints |
|---|---|
| 1 | leads per state (the script's own numbering 1-6) with how many still hold a contact copy |
| 1b | the actionable ones, oldest first |
| 2 | prospects with no owner, by who recorded them (section 3) |
| 3 | what a retention dry run would list now (F3, section 6) |
| 4 (new) | **unassigned prospects**: total, by creator role and department, eligible for automatic ownership vs requiring manual reassignment with the reason bucket (section 3) |
| 5 (new) | **converted-but-not-linked** by the numbered states **3, 6 and 7** of the table above, how they were enrolled and by whom, and their ids |

The lead-state query is held once in a psql variable (`select $q$ ... $q$ as base \gset`, then `:base select ...`), because a
read-only transaction cannot create a view. **Parts 1, 1b, 2 and 3 were refactored onto it; their output on the same seed is
identical to the previous version** (diffed, ages normalised).

**Mapping of the script's state labels to this document's states.** The script's `4 enrolled, NOT linked` covers this document's
state 3 (lead still holds a contact copy) and state 7 (no contact copy: every pre-PD-59 prospect and every prospect booked with
typed students). Part 5 splits them. The script's `6` is state 6; its `2` and `3` are states 1-2 here (subscribed, not yet
enrolled) and are shown in part 5 as "awaiting": not a hand-over yet, so not counted as converted-but-unlinked.

**Part 5, on the synthetic seed (RAN; 12 staff, 2 organizations, 20 prospects, not the earlier rehearsal's 11):**

```
 3 enrolled, contact copy kept                   | 1 | also_learner_linked 0 | unowned 0 | contact copy 1
 6 learner linked by Core                        | 1 | also_learner_linked 1 | unowned 0 | contact copy 0
 7 enrolled, no contact copy                     | 2 | also_learner_linked 0 | unowned 2 | contact copy 0
 awaiting: subscribed, not enrolled (states 1-2) | 2 | unowned 2 | contact copy 2
 5b: enrolment kind / enrolled by:  added_children / Operations   3 leads (1 with a contact copy)
```

Each seeded shape landed in the expected state; the ids (part 5c) name the four leads. **Run it on staging and production before
deciding anything below**; the counts there decide whether the follow-ups are worth building.

**Proof that running the report changes nothing (RAN).** On the seeded, PD-59-applied database: count and md5 of every row of
**all 218 `chat` tables** (`select count(*), md5(string_agg(x::text order by x::text)) from chat.<table> x`, generated with
`\gexec`) taken before, then both reports run (this one and the 4A review), then taken again: **identical for every table**;
the stats counters (`n_tup_ins/upd/del` summed over `chat`) also unchanged (79/8/0 before and after). Both scripts are inside
`begin read only` with a final `rollback`, so the server itself refuses any write. (A later, deliberate rolled-back real purge
in section 6 changed the counters to 84/14/1, because rolled-back writes are counted, but left every row hash identical.)

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
4. **Decision (owner, 2026-11-21): the channel-validation restriction stays** (no silent drop or overwrite, no bypass), so option
   (b) below, "link and drop the channel", is **not** taken. Item 2's "link only when covered" step is superseded by the design in
   **section 7**, which links without dropping or writing anything in the family's record (O1). Until that is decided and built, the
   lead's copy is kept and item 1's list makes the stall visible. Original wording: when a lead's WhatsApp number is not in the
   family's record, do we (a) keep refusing until the family's profile is updated (current, safe, can stall), or (b) let the
   manager link and drop that channel, audited by kind? Recommendation was (a), with an aging flag on the list.

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

### Unassigned-prospects report (part 4 of the reconciliation script) (RAN on a synthetic seed)

One read-only run prints: **4a** total unassigned (and per organization); **4b** by the creator's role and department, live or
departed; **4c** the prospects **ELIGIBLE for automatic ownership assignment**; **4d** those **REQUIRING MANUAL reassignment**
with the reason bucket; **4e** a cross-check that eligible + manual = total, and the open leads older than 12 months; **4f** the
manual ids, open leads first. Counts and ids only. **Nothing is assigned; no bulk reassignment of any kind exists or is added.**

*Eligible for automatic assignment* = the creator is a live Sales member or manager of the prospect's own organization, not the
super admin (exactly the migration backfill's rule), and the prospect is an open lead (not a customer). By construction the
backfill already took every such prospect that existed when it ran, so on a real database this list is expected to be **empty
or tiny**: it can only contain a prospect whose creator joined Sales after the backfill, or one created later without an owner.
If 4c prints no rows the answer is "none". Even then the report only lists; assigning stays the Sales manager's one-at-a-time
action (section 3, proposed workflow).

*Requiring manual reassignment*: one bucket per prospect, first rule wins: customer (subscribed, enrolled, learner-linked or
converted: ownership is not needed and the service refuses to reassign a Converted lead); then who recorded it: Operations,
the Teachers department, the super admin, departed staff, other staff (finance and the like). "Older than 12 months" is a column
in 4b and 4d and a total in 4e (open and older than 12 months), not a separate bucket, because it cuts across the others and a
reassignment is meaningful activity that restarts the retention clock (F3).

On the seed (12 unassigned of 20 prospects; the numbers illustrate the shapes, they are not production counts):

```
4c eligible (open, creator joined Sales after the backfill):        1   (+ 1 eligible but a customer: leave)
4d manual: customer 4 (2 hold a contact copy) | Operations 3 (2 older than 12 months) | departed staff 1 (older)
           | other staff 1 | super admin 1 (older) | Teachers department 1
4e eligible 1 + manual 11 = total 12  (adds_up = t);  open and older than 12 months: 4
```

### Proposed workflow (not implemented)

1. **Who decides:** the Sales manager (and the super admin). Nobody else; no rule assigns silently beyond the merged backfill.
2. **See them:** an "Unassigned" filter and count on the manager's board (`GET /sales-pipeline/leads?owner=none`; the list
   already returns `owner: null` for them), with, per row, a *hint* (never applied): the Sales member who booked its latest
   trial (`lesson.created_by`), if still live, and whether the lead is a customer or older than 12 months.
3. **Assign:** one at a time with the existing `POST /sales-pipeline/leads/:id/owner` (row lock, eligible-owner check, the
   database guard, one `sales_lead.reassigned` audit row: who, from, to, never a value). **A bulk step is withdrawn (owner,
   2026-11-21: no bulk reassignment of any kind).** The earlier draft proposed `POST /sales-pipeline/leads/owner/bulk`; it is not
   to be built.
4. **By recorded-by:** Operations / Teachers / super admin created: the manager decides case by case from the hint. Departed
   staff: the manager reassigns to a live rep, or leaves it to retention. Customers: leave unowned.
5. **Order:** first run the report on staging; assign open leads (b, c) that are under 12 months; leave (a) and (d).

Tests before building (single reassignment; the bulk tests of the earlier draft are withdrawn with the bulk step): a representative
is 403; a non-Sales owner is refused; a Converted lead is refused; audit rows carry no value; a second identical call changes
nothing; the "Unassigned" filter returns exactly the leads the report's part 4 counts.

---

## 4. Staging migration plan (PD-59, `20261121100000_chat_pd059_sales_pipeline`)

**Authority.** This plan is for the owner to approve. It is not run by an agent: staging is deployed by the manual
`Deploy staging` workflow (`workflow_dispatch`), which already preflights the role, backs up, applies, releases and smoke tests.
Do not enable any retention flag (4.9).

### 4A. Staging schema review (owner decision A, 2026-11-21)

**The real staging schema is unreachable from here, and `scripts/db/reports/pd059-staging-schema-review.sql` has NOT been run
on real staging or production.** It was written from repository evidence and tested only on a local `postgres:17` built from
the 182 migrations older than PD-59. Its first run on staging is the actual finding; until then everything under "expected
staging profile" is a derivation, not an observation.

**Evidence used to derive what staging must look like** (no credential was read or needed):

| Source | What it tells us |
|---|---|
| `.github/workflows/deploy-staging.yml` | step order: credentials, spec, **role-capability preflight, backup, apply (`scripts/db/apply.sh`, `PSQL="psql -v ON_ERROR_STOP=1 $DATABASE_URL"`)**, Quran load, release, smoke. `DATABASE_URL` is the one connection; the migration role is whatever it names |
| `scripts/db/apply.sh` | the ledger is `chat.schema_migrations` (created by the script, inside `chat`); one transaction per file with `set local statement_timeout = 0`; no `lock_timeout` (F4); files not in the ledger apply in filename order |
| `scripts/db/preflight-role-capability.sh` | the connected role must be able to `CREATE ROLE ... BYPASSRLS` (proved on Supabase, 2026-11-05) |
| `supabase/migrations/20260905091150`, `20260910120200` | roles `anon`, `authenticated`, `service_role` (NOLOGIN) and `chat_app` (LOGIN, no bypass), `chat_service` (LOGIN, bypass) exist after the chain; PD-59 names `chat_app`, `anon`, `authenticated` in its `revoke` lines |
| `20261014150000` (`chat.caller_is_server_side`) | a caller is "server side" if superuser, member of the **owner of `chat.family`**, or member of `service_role`: the purge (and the `learner_id` link) depend on the connecting role being the table owner or a superuser |
| `20261019120000`, `20261021130000` | the guard functions PD-59 replaces (`guard_trial_prospect`, `guard_trial_student`) and their triggers: `create or replace` needs ownership |
| `docs/infrastructure/decisions.md` ADR-014 | the staging and production database is a Supabase project reached through the session pooler (port 5432); `postgres` there is **not a superuser** (CREATEROLE, BYPASSRLS); **the pooler drops connection `options`** (so `PGOPTIONS` is ignored: 4B); the role carries `alter role postgres set statement_timeout = '15s'`; 168 migrations had applied at that time |
| the 182 older migration files | the exact ledger (the script embeds the list), the pre-PD-59 body of both guards (md5 of `prosrc` is pinned in the script), 217 tables in `chat` |

**Expected staging profile (derived, unverified):** Postgres 17; connected as the migration role (Supabase `postgres`), which owns
every `chat` object because it ran the whole chain; not a superuser; all five roles present with `service_role` and `chat_service`
bypassing RLS and `chat_app` not; a ledger of exactly the 182 older files (plus any of the seven open-PR migrations if someone
applied them) and no PD-59 row; both guards still the original bodies; no default ACL naming `service_role` or `chat_service` for
the migration role in `chat`; no long transactions.

**What the script checks** (one result table, `n | area | what | expected | actual | status`, then a `VERDICT` row; names, counts,
booleans and md5 hashes only):

| Checks | Rule | Failing means |
|---|---|---|
| 10-14 env | major version 17 (WARN otherwise), read-only transaction, the connected role, `lock_timeout` non-zero in this session (WARN if 0: 4B), statement timeout shown | |
| 20-22 roles | `chat_app`, `anon`, `authenticated` exist (FAIL); `service_role`, `chat_service` exist and the bypass attributes are as defined (WARN) | the `revoke` lines would error, or the role model differs |
| 30-34 owner | the connected role holds the privileges of the **owner** of both guard functions and of `chat.trial_prospect`; `CREATE` on schema `chat`; `REFERENCES` on `family`, `staff`, `organization`, `trial_prospect`; the owner of `chat.family` is shown (FAIL) | `create or replace function` / `alter table` / the foreign keys fail "must be owner" partway; the apply rolls back whole, but the window is wasted |
| 40-43 ledger | none of the 182 older migrations missing (FAIL); PD-59 not yet applied (WARN if it is); ledger rows the script does not know are listed, at most 8 (WARN: newer, or from another branch) | missing older migrations would apply **together with** PD-59 |
| 50-57 schema | the 11 tables the migration and purge read exist; the 8 `trial_prospect` columns; the 3 helper functions with their signatures; **both guard bodies are the pre-PD-59 ones** (md5 of `prosrc`); the triggers are attached; `audit_log` has the six columns the purge writes and a nullable `actor_id`; `btree_gist` and `pg_trgm` (FAIL, extensions WARN) | `create or replace` would silently overwrite a body that is not the original, i.e. someone else's change |
| 60-61 absent | none of the 9 new columns, `sales_lead_contact` or the six functions exist (WARN) | a partial earlier attempt, or already applied |
| 70-73 privileges | **no default ACL that would hand a new `chat` table or function to `service_role` or `chat_service`** (FAIL: the migration's `revoke` list does not name them, and a default privilege would give the confined contact table to a role that bypasses RLS); none naming PUBLIC/`anon`/`authenticated`/`chat_app` (WARN: the migration revokes them); the existing confined `trial_subscription` is closed to every request role (WARN: the pattern PD-59 copies) | |
| 80-84 activity | the role can see other sessions (WARN if not: the next three are then blind); no other transaction older than 60 s; no other session holding or awaiting a lock on `trial_prospect`, `family` or `staff`; **no prepared transaction** (FAIL: it can hold locks forever); no session idle in transaction | the migration would queue behind it (4B) |
| 90-93 counts | `trial_prospect` (WARN above 200 000), `family`, `staff`, `lesson`, and the five other tables the migration must leave unchanged (record them; compare after, 4.5), Sales departments and Sales staff | |
| 94-96 predictions | how many prospects the backfill **will** own; how many the **first retention dry run will list**, and how many of those have a trial (F3, section 6) | |
| 97 flags | a reminder: the retention flags are environment variables and cannot be read from SQL | |

**Verdict rule:** apply only on 0 FAIL, with every WARN explained and recorded in the deploy record.

**How to run (operator, staging, before 4.3):** the same role and connection string the workflow will use (so the role checks mean
something), from a machine that reaches the session pooler:

```
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/db/reports/pd059-staging-schema-review.sql
```

**What ran (RAN, local only).** Throwaway `postgres:17` container `jc-recon-pd59-a`, the 182 older migrations through
`scripts/db/apply.sh`, then a database copy for each case:

| Case | Result |
|---|---|
| clean 182-migration chain, as the superuser | **0 FAIL, 1 WARN (lock_timeout is 0 in a plain session), 30 PASS, 13 INFO**; every expected value matched (the md5 values were taken from this chain) |
| tampered copy: default ACL granting `select` on new `chat` tables to `service_role`; `guard_trial_student` redefined; one ledger row deleted; one unknown ledger row added | **3 FAIL** (40 one migration missing; 54 guard body differs; 70 default ACL) and WARN 42 (the unknown row is listed by name) |
| a non-owner role with `select` on `chat` and nothing else | **5 FAIL** (30, 31, 32, 33: not the owner, no CREATE, no REFERENCES; 40 reports 182 missing because the ledger has row-level security on and the role sees zero rows) and WARN 80 (cannot see other sessions). A role that cannot read the ledger would make `apply.sh` believe nothing is applied, so failing is correct |
| another session holding `share` on `trial_prospect` | WARN 82; with a session in an open transaction past 60 s, WARN 81 |
| copy with PD-59 already applied | WARN 41, 60, 61 and **FAIL 53 and 54** (the guards are no longer the originals): the script refuses a second attempt on an applied database instead of overwriting |
| seeded copy (20 synthetic prospects) | predictions printed, then confirmed after apply: the backfill was predicted to own **7 of 19** prospects and the apply owned those 7; the first retention dry run was predicted to list **5** (2 with a trial) and Part 3 listed the same 5 |
| read-only proof | the script runs inside `begin read only` and rolls back; both reports run between two full row-hash passes of 218 tables left every hash identical (section 2) |

**Fixed while testing:** check 82 first matched lock holders in *other databases* of the same server (relation oids are equal in
database copies); it now filters on `pg_locks.database`.

**Not verified, and cannot be from here:** the real owner of the `chat` objects; whether `postgres` on that Supabase project holds
`pg_read_all_stats` (check 80) or owns objects another role created; the real default ACLs (Supabase sets some in schema `public`;
the script reads the `chat` and the global ones); the real ledger (it may contain applied migrations of the open PRs, or a
different count); the pooler's behaviour for `set local` (expected to work: it is ordinary SQL inside the transaction, which is how
`statement_timeout = 0` already works through it); the Postgres minor version. Those are exactly what the first run reports.

### 4B. Lock timeout for the apply step (F4, owner decision C)

**PROPOSED change to `.github/workflows/deploy-staging.yml` and `deploy-production.yml`; PREPARED, NOT applied, NOT committed, NOT
pushed.** `.github/workflows/` is an owner-only path (`.github/CODEOWNERS`: `/.github/workflows/ @MohamedEmadLasheen`; AGENTS.md:
agents never change `.github/` workflows), so the lead and the owner make this edit.

**The earlier recommendation in 4.4 (set `PGOPTIONS` in the step) would not work on the database we use.** ADR-014 measured that
Supabase's session pooler **drops the connection's startup options** (`PGOPTIONS='-c statement_timeout=15000'` still showed `2min`),
so `PGOPTIONS='-c lock_timeout=5s'` would be silently ignored there, the worst kind of safeguard. It does work on a direct
connection (RAN, local: a holder on `trial_prospect`, `PGOPTIONS='-c lock_timeout=3s'`: failed after 3.2 s with "canceling
statement due to lock timeout", ledger row not written). So the change is two parts:

1. **`scripts/db/apply.sh`** (not a protected path; committed on this branch as its own small commit, can be dropped): reads an
   optional `APPLY_LOCK_TIMEOUT` (`^[0-9]+(ms|s|min)?$`; anything else exits 2 before the migration's SQL is sent; the ledger read that precedes it still runs, and a bad value is not validated at all when every migration is already applied) and, when set, adds
   `set local lock_timeout = '<value>'` inside each migration's transaction, next to the existing `set local statement_timeout = 0`.
   Unset = the previous behaviour. **RAN locally**, without `PGOPTIONS` (simulating the pooler): with another session holding
   `share` on `chat.trial_prospect`, `APPLY_LOCK_TIMEOUT=3s` failed after 3.2 s ("canceling statement due to lock timeout"),
   **0 ledger rows**, rolled back whole; after the holder ended, `APPLY_LOCK_TIMEOUT=5s` applied the migration and an immediate
   re-run printed `skip`; `APPLY_LOCK_TIMEOUT='5s; drop table x'` was refused (exit 2) before the migration's SQL was sent.
2. **The workflow env line** (the owner-only part), the same four added lines in both files:

```diff
--- a/.github/workflows/deploy-staging.yml
+++ b/.github/workflows/deploy-staging.yml
@@ -386,6 +386,10 @@
       - name: Apply database migrations
         env:
           DATABASE_URL: ${{ secrets.DATABASE_URL }}
+          # F4: a migration waits at most this long for a lock, then rolls back whole (safe to re-run) instead of
+          # queueing behind a long transaction. scripts/db/apply.sh reads it as `set local lock_timeout`, so it
+          # also works through a pooler that drops connection options (ADR-014).
+          APPLY_LOCK_TIMEOUT: 5s
         run: |
           # AI #1's migration runner is the single migration authority.
           PSQL="psql -v ON_ERROR_STOP=1 $DATABASE_URL" scripts/db/apply.sh
```

`deploy-production.yml` takes the same four lines at its "Apply database migrations" step (around line 471). The combined patch
for both files was checked with `git apply --check` against this branch's tree (applies cleanly); it is kept outside the
repository because the path is owner-only. Trade-off to accept: a 5 s wait can fail the deploy at a busy moment; the failure is a
clean rollback and a re-run, which is the point. `ci.yml` (empty databases) is left alone.

### 4.1 Preconditions

- Main contains PD-59 (PRs #616-#622) and the slot file `docs/product/migration-slots/20261121100000.md`.
- The deploy credentials and `staging` environment of `deploy-staging.yml` are in place (BLOCKER list in
  `docs/infrastructure/production-readiness.md`).
- The migration role is the **owner** of the existing `chat` objects. `create or replace function chat.guard_trial_prospect`
  and `chat.guard_trial_student` fail ("must be owner") otherwise. The 4A script checks this (checks 30-34); the same check by hand:
  ```sql
  select p.proname, pg_get_userbyid(p.proowner) owner, current_user
    from pg_proc p where p.pronamespace = 'chat'::regnamespace and p.proname in ('guard_trial_prospect','guard_trial_student');
  ```
- Roles that must exist (created by `20260905091150`, earlier in the chain): `chat_app`, `anon`, `authenticated`
  (named by the `revoke`s). `service_role` and `chat_service` exist in the chain too; PD-59 does not name them.
- The database major version is 17 (CI and the rehearsal). Extensions needed by the chain (`btree_gist`, `pg_trgm`) are
  already there on a migrated database.

### 4.2 Pre-checks (read-only)

Run the 4A script first: it covers every query below and adds expected values, pass/fail and the pinned guard bodies. The queries
are kept for a quick manual look.

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
   APPLY_LOCK_TIMEOUT=5s PSQL="psql -v ON_ERROR_STOP=1 $DATABASE_URL" scripts/db/apply.sh
   ```
   (**Corrected 2026-11-21:** the first draft used `PGOPTIONS='-c lock_timeout=5s'`, which the Supabase session pooler drops
   (ADR-014), so it would have done nothing there. `APPLY_LOCK_TIMEOUT` is applied as `set local` inside the migration's
   transaction. The workflow runs `scripts/db/apply.sh` without it today; the owner-only workflow edit is in 4B. By hand, set the
   variable on the command line as above. A failed attempt rolls back whole and is safe to repeat.)
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
and SHARE ROW EXCLUSIVE on `chat.family`, `chat.staff` and `chat.organization` (the last through the confined contact table's foreign key; measured with `pg_locks` in a rolled-back run), held to the end of the transaction. Writes to those three tables
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
- [ ] `APPLY_LOCK_TIMEOUT` set for the apply step (4B; the workflow edit is the owner's).
- [ ] **The 4A staging schema review was run on staging by the operator: 0 FAIL, every WARN explained, output filed with the deploy record.**
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
| F1 | A lead enrolled by Operations whose channels differ from the family's form is refused `channel_missing` and **cannot be resolved by the Sales rep** | spec test 6 (PR #624); state 3 of the table | medium (stalls hand-over, keeps PII in 3 places) | owner kept the channel restriction: section 7 designs a manager-authorized link-only step that drops nothing (O1), after the visible list (section 2, item 1) |
| F2 | `converted_at` is set only by a manual Convert; enrolled leads never get it; every pre-PD-59 prospect has no contact row so it can never be set | code search; state 7 | low (data), medium (reporting) | do not report conversions from `converted_at`; link step (section 2) |
| F3 | First retention pass would act at once on **pre-PD-59** prospects older than 12 months, by `created_at` (notes cleared; no contact exists yet). By the function's definition it also covers leads with a not-subscribed trial. The dry run's count is capped by the batch size and nothing requires a review before going live | RAN twice: 3 of 11, then 5 of 20 seeded prospects listed; a real pass (rolled back) cleared all 5 at once; flag confirmed off in every manifest and workflow | medium before enabling | section 6: go-live floor in `chat.config` + uncapped, audited dry run + a second database switch for live (A + C). Not implemented; flag stays off |
| F4 | `apply.sh` has no `lock_timeout`; a long transaction makes the migration wait and queue other writers | measured | low | **`PGOPTIONS` would be dropped by the Supabase pooler (ADR-014)**; use `APPLY_LOCK_TIMEOUT` (`set local`, in `apply.sh`, RAN locally) plus the owner-only workflow line (4B, patch prepared, not applied) |
| F5 | Rollback restored `guard_trial_prospect` except two comment lines | schema diff | trivial | fixed in this PR; now byte-identical |
| F6 | Open migration PRs #537-#567 have slots older than slots already on main; order-independent today, none touches PD-59 objects | `gh pr diff` on every one of the 62 open PRs, re-run 2026-11-21 12:37 UTC: same 7 PRs, no slot collision, 0 PD-59 terms in their added lines; #537 and #545 now conflict | low | re-check at deploy time (4A check 42 lists unknown ledger rows) |
| F7 | `GET /trials` (the trial list and cards) is not ownership-scoped: a representative still sees other representatives' trials by design ("existing trial-desk rules") | PD-59.md review fixes | info | confirm with the owner that this is intended |
| F8 | The list says `handedOver: true` for an enrolled lead while the detail offers Convert | `list()` vs `detail()` | low | section 2, item 1 |
| F9 | A role that cannot read `chat.schema_migrations` (row-level security is on) sees an empty ledger; `apply.sh` would then try to re-apply everything | 4A negative test (non-owner role: 182 "missing") | info | run `apply.sh` only as the owner role; 4A check 40 fails for it |
| F10 | The unassigned-prospect backfill leaves a long tail by design; 4c is expected to be empty or tiny | reconciliation part 4 on the seed (1 eligible of 12) | info | the manager assigns one at a time (section 3); nothing is assigned automatically |

Verified OK: ownership scoping on every sales-pipeline route and on the trial prospect list and booking (37 tests, PR #624);
a foreign lead is indistinguishable from a missing one; non-Sales roles are refused; the database owner guard refuses a non-Sales
owner by direct SQL; the confined table and the purge function are closed to the request roles; audit rows carry field names
only; the migration is additive, idempotent and reversible without touching a customer row.

---

## 6. F3: the first retention pass (owner decision B). Analysis RAN, design PROPOSED, no code changed

### 6.1 What the code does today (read, not changed)

- `chat.sales_lead_expired(id)` (migration 20261121100000): not converted, no `converted_family_id`, no `learner_id`, no subscribed
  trial, no enrolment; **idle since** = the latest of `coalesce(last_activity_at, created_at)`, the newest lesson's `created_at` and
  `ends_at`; expired when that is older than **12 months**; and the lead still holds something to clear (a contact copy, the lead
  note, the follow-up note, or a student note).
- A prospect that existed before PD-59 has `last_activity_at = null`, so its clock is **`created_at`** (or its last trial). Nothing
  in the migration stamps a start date, and the backfill of `owner_staff_id` is not "activity".
- `SalesLeadRetentionService.sweep()`: off unless `SALES_LEAD_RETENTION_ENABLED=true`; a dry run unless
  `SALES_LEAD_RETENTION_DRY_RUN=false`; `SALES_LEAD_RETENTION_BATCH` (default 200, max 1000) per pass; the worker runs it every 24 h.
- **The dry run reports only a count in the worker log, and that count is capped by the batch size** (`leadIds.length` of one
  limited pass). With 5 000 qualifying prospects a dry run still says "200". It writes no audit row and no id list. Switching to
  live is one environment variable; nothing requires that anyone looked at the list.
- **The flag stays off (checked, RAN).** `git grep SALES_LEAD_RETENTION` over the repository: the three variables appear only in
  `lead-retention.service.ts`, `worker.ts`, its unit spec and documentation. None is in `infra/env/manifest.tsv`, `.do/`, or any
  workflow, so the job does not run on staging or production, and this document and the 4A script set nothing.

### 6.2 Evidence from the local rehearsal (RAN; synthetic seed, PD-59 applied)

```
dry run (chat.expired_sales_leads)            5 of 20 prospects listed: ages 800, 700, 500, 450, 400 days
                                               all five "clock = created_at" (pre-PD-59); 1 owned by a live rep (backfill) with a
                                               contact copy; 2 with a trial (one not subscribed, one no-show); every one with a note
a real pass inside a rolled-back transaction   purged 5; 5 audit rows, payload {contactDeleted, notesCleared} only; lead notes 5 -> 0;
                                               contact copies 4 -> 3; after ROLLBACK: notes 5, contact copies 4, audit rows 0;
                                               all 218 table hashes identical to before
the 4A prediction, run BEFORE the apply        predicted 5 (2 with a trial); Part 3 after the apply listed the same 5
a go-live floor (simulation, SQL only)         floor = apply time: 0 listed; any floor inside the last 12 months: 0 listed
```

Reading: with the flag on and dry-run off, the **first daily pass would clear the notes (and the contact copy, where one
exists) of all five at once**, with no grace period, including a prospect a Sales representative owns today. This is
consistent with the written rule, but the rule was written for leads PD-59 creates; for the legacy population it is a
retroactive deletion deadline that nobody has seen. Leads with a not-subscribed trial are caught by the same definition: their
clock is the trial's end, 12 months after which they expire, which is the intended rule; the surprise is only in the timing of the
first pass.

### 6.3 Options

| Option | What | Evidence / cost |
|---|---|---|
| **A. Go-live floor (recommended)** | the idle clock cannot start before a floor: `idle_since = greatest(existing clock, floor)`. The floor is a `chat.config` key, e.g. `sales.lead_retention_clock_floor` (timestamptz), **absent means retention is inert**. The operator sets it to the date retention is switched on. Existing prospects then get 12 months from that date; a lead PD-59 creates is unaffected (its activity is later than the floor) | simulated: 0 listed. A migration that replaces two functions (`sales_lead_expired`, `purge_expired_sales_leads` reads it through the first); **no row is written, no column added**; reversible by deleting the key or the rollback file |
| B. Stamp `last_activity_at = now()` on every existing prospect in a migration | the clock starts at apply time | a bulk write to a PD-59 column on every legacy prospect; fabricates an "activity" the UI and reports may show; harder to roll back; no way to choose a later date |
| **C. Review gate (recommended together with A)** | (1) the dry run reports the **true** total (uncapped) and writes **one audit row per run** with the total and the first ids; (2) going live needs a second, independent switch in the database (`chat.config` `sales.lead_retention_live = 'on'`, set by the owner after reading the dry-run report), not only an environment flag; both flags unset by default | closes "one variable and it deletes"; the owner sees the population first |
| D. Do nothing; review the list by hand before flipping the variable | as today | works only if someone remembers; the capped count hides the true size |

**Recommendation: A + C.** Order of use: keep everything off; staging and production run the 4A script (checks 94-96 print the
population before apply) and the reconciliation Part 3 (after); the owner sets the floor to the chosen date, reads the uncapped
dry-run report for a few days, then flips the live switch. The 12-month rule then has the same meaning for legacy and new leads.
Not recommended: pre-expiry notices to parents (the contact data is the very thing being cleared and no consent channel exists).

**Decisions for the owner:** (1) the floor date (recommend: the day retention is enabled, so legacy leads get a full 12 months);
(2) whether a legacy lead with a trial but never subscribed should get the same grace (recommend yes: one rule); (3) whether the
owner or a super admin sets the live switch (recommend: super admin, audited).

### 6.4 Tests the change would need first (not written)

1. A pre-existing prospect (`last_activity_at` null, `created_at` three years ago) is **not** expired while the floor key is absent,
   nor while the floor is "now".
2. With the floor 13 months in the past the same prospect **is** expired (the floor does not block what is old enough).
3. A prospect created after the floor expires only 12 months after its own latest activity (clock unchanged for new leads).
4. A malformed floor value is treated as "inert", never as "no floor"; an application role cannot write the key.
5. The dry run's reported total equals `count(*)` of `chat.expired_sales_leads(1000000)` and is **not** capped by the batch size.
6. A dry run writes exactly one summary audit row (total and ids, never a value) and changes no row (row hashes identical).
7. Live pass with the environment flags on but the database switch off: nothing is purged and one refusal row is written; both on
   and the floor in the future: nothing; both on and eligible: purged, audit per lead.
8. A customer (converted, learner-linked, subscribed, enrolled) is never listed, whatever the floor (existing guarantee).
9. Unit: `retentionConfig` and `sweep` stay off and dry by default (existing); a live sweep without the switch returns a refusal.
10. The new migration is idempotent; its rollback file restores both function bodies (md5 of `prosrc`).

---

## 7. Link-only workflow: design proposal (owner decision G). PROPOSED, nothing implemented

**Constraint kept (owner, 2026-11-21):** the channel validation stays. Linking must never drop or overwrite a channel and there is
no bypass. This design therefore does **not** relax `mergeChannels`; it adds a separate, manager-authorized step that links the
lead to the family **without touching the family's record at all**, and keeps the lead's own copy of its channels so none is lost.

### 7.1 The problem it solves

Today `convert` links a lead to the family its own trial enrolled only if every one of the lead's channels is already covered by the
family's `family_contact_key` rows or fits an **empty** slot of the parent file (the parent file has exactly one phone and one e-mail
slot: `chat.parent_file.phone`, `chat.parent_file.email`). A lead with a WhatsApp number plus a phone, or an e-mail the
form did not carry, is refused `channel_missing`, the rep cannot edit a family they do not own, and the lead sits in state 3
indefinitely, holding its contact copy (F1). States 6 and 7 are never linked at all.

### 7.2 Options

| Option | Behaviour | Verdict |
|---|---|---|
| **O1. Link-only, keep the lead's confined copy frozen (recommended)** | sets `converted_at` / `converted_family_id` and records a link row; **writes nothing to any family, parent, contact, learner, enrolment or key row**; the lead's `sales_lead_contact` row is **kept, frozen (no edit), and retired later by a defined rule** | preserves every channel and the acquisition record; costs a longer life for a confined copy |
| O2. Convert what fits, retain the rest | the existing merge into **empty** slots, then retain only the leftover | writes to the parent file; adds a second mechanism beside `convert`; the owner asked that nothing in the family's data change |
| O3. Link and drop the channels that do not fit, manager-authorized and audited | data loss, even if audited | conflicts with the kept restriction; offered only if the owner reverses it; **not recommended** |
| O4. No new action: the visible "Needs hand-over" list (section 2, item 1) and Operations adds the missing channel to the family first, then `convert` | zero schema change | safe baseline, **but the stall remains** when nobody owns the task; keep as the interim |

**Recommendation: O1, with O4's list shipped first.**

### 7.3 O1 in detail

**Endpoint (one lead at a time; no bulk):** `POST /sales-pipeline/leads/:id/link-only` with `{ confirm: true, dryRun?: boolean }`.
`dryRun` (the default in the UI) returns the plan: outcome, family id, which channel KINDS are covered and which would be retained,
whether a contact copy exists: **kinds only, never a value**.

**Reads (all inside one transaction, under the existing row lock `lockedFacts` on the prospect):**
`chat.trial_prospect` (`id, organization_id, converted_at, converted_family_id, learner_id, owner_staff_id, created_at`);
`chat.lesson` (`id, prospect_id`); `chat.student_enrolment` (`lesson_id, family_id, organization_id`) to find the family from the
lead's **own** trial; `chat.family` (`id, organization_id`); `chat.sales_lead_contact` (the channel columns, in memory only, to
compute the same HMAC `keysOf` computes; `SELECT ... FOR UPDATE`); `chat.family_contact_key` (`organization_id, key_hash, family_id`)
to see which channels the family already holds; `chat.staff` and `chat.department` (authorization).

**Writes:**

| Table | Columns | Note |
|---|---|---|
| `chat.trial_prospect` | `converted_at`, `converted_family_id`, `last_activity_at` | one UPDATE `where converted_at is null`; the existing guard checks the family's organization |
| **new** `chat.sales_lead_link` | see below | one INSERT; primary key `prospect_id` |
| `chat.audit_log` | one row | payload below |

**Not written, and the tests assert it by row hash:** `chat.family`, `chat.contact`, `chat.parent_file`, `chat.family_contact_key`,
`chat.learner`, `chat.student_enrolment`, `chat.lesson`, `chat.trial_outcome`, `chat.trial_subscription`, and **`chat.sales_lead_contact`
(kept unchanged)**.

**New table `chat.sales_lead_link` (a migration; confined like `sales_lead_contact`: RLS on, no policy, no request-role grant):**

| Column | Meaning |
|---|---|
| `prospect_id uuid` PK, FK `trial_prospect` | one link per lead |
| `organization_id uuid` | equals the prospect's, the family's and the actor's (trigger) |
| `family_id uuid` FK `family` | the family the lead's own trial enrolled |
| `basis text` check in (`enrolment`, `learner`) | why this family is authoritative |
| `acquisition_kinds text[]` | **the lead's original channels, by kind** (`phone`, `whatsapp`, `email`), copied from which columns of its contact copy were set at link time; the permanent record of how the prospect could be reached |
| `carried_kinds text[]` | kinds the family's keys already cover |
| `retained_kinds text[]` | kinds the family's record does not hold, whose only copy is the lead's contact row. `acquisition = carried + retained` (check) |
| `contact_retained boolean` | true when `retained_kinds` is non-empty |
| `linked_by uuid` FK `staff`, `linked_at timestamptz` | the authorizing manager and when |
| `retire_after timestamptz null` | when the retained copy is retired (retention rule, decision 2) |
| `retired_at timestamptz null` | set when the copy is deleted |

Guard trigger on the table: insert only by a server-side caller; a row is immutable except `retire_after` (extend) and `retired_at`
(once). `guard_sales_lead_contact` gains one rule: **a linked lead's contact row cannot be updated** (frozen), and its DELETE stays
allowed once `converted_at` is set (existing), now also requiring `retired_at`/the purge flag, so a retained copy is not deleted by
anything except the retirement rule.

**Authorization:** Sales **manager** or super admin of the lead's organization (the service's `reachesAll`). Not a representative
(they cannot resolve a family they do not own), not Operations. The family and enrolment must be in the **same organization** as the
lead and the actor; the database guard checks the family's organization again.

**Idempotency:** the UPDATE matches only `converted_at is null`; the link row's primary key makes a second insert fail. A repeat
call returns `{ outcome: 'already_linked', familyId }` when it is the same family and writes nothing (no second audit row); a lead
already converted by `convert`, or linked to a different family, is a 409. A dry run never writes.

**Concurrency:** the prospect row lock (`lockedFacts`) serializes it with `convert`, reassign, edit and the retention purge (which
skips a locked row); the contact row is locked `for update`; the enrolment is append-only and the family's organization is
immutable once PR #551 is merged, so nothing the link reads can change under the lock except the family's keys, and a key added or
removed afterwards only changes what the later retirement may decide, never the link. Two managers pressing the button: one links,
the other gets `already_linked`.

**Failure cases (each rolls back whole; a refusal is audited outside the transaction, as `convert` does; never a value):**

| Case | Result |
|---|---|
| actor is not a manager or super admin | 403, nothing read |
| lead missing or of another organization | 404 (indistinguishable) |
| lead lost, or no enrolment of its own trial and no learner link | 409 `nothing_to_link` (the family is not authoritative) |
| enrolment's family of another organization | 409, never written (guard also refuses) |
| a channel's key is held by a **different** family than the enrolment's | 409 `conflict`: possible wrong family; a human looks; **never linked** |
| the lead has no contact row (state 7, every pre-PD-59 prospect) | allowed: `acquisition_kinds = []`, `contact_retained = false`; nothing to preserve (this is the pure bookkeeping fix for F2) |
| a number that cannot be read (`keysOf` throws) | allowed; coverage cannot be computed, so **every kind is treated as retained** (safe default) |
| concurrent change, constraint or guard error | rolled back, 409/500 with a refusal audit row |

**Audit payload (no value, no hash):** action `sales_lead.linked_only`; `actor_id` = the manager; entity `trial_prospect`; `before`
`{ stage }`; `after` `{ outcome: 'linked_only', familyId, basis, acquisitionKinds, carriedKinds, retainedKinds, contactRetained }`;
reason "lead linked to its enrolled family without changing the family's record (PD-59)". Refusals: `sales_lead.link_only_refused`
`{ outcome }`. The retirement writes `sales_lead.link_copy_retired` `{ kinds }`.

**Retirement of the retained copy (the privacy cost of O1, so it must be bounded):** `retire_after` defaults to the link date plus
a period the owner sets (proposal: **12 months**, matching the lead rule), and earlier when a manager runs a per-lead "the family's
profile now holds it" confirmation (the app recomputes coverage from `family_contact_key`; SQL cannot, the HMAC key is the
server's). The retention job (section 6 conventions: off by default, dry run first) deletes the copy past `retire_after`.

### 7.4 Tests required (to write first)

1. Link-only on a state-3 lead whose WhatsApp and second e-mail are not in the family: links; **row hashes of family, contact,
   parent_file, family_contact_key, learner, student_enrolment, lesson and sales_lead_contact are identical before and after**.
2. `acquisition_kinds = carried + retained`; kinds only; the audit row and the link row contain no value or hash (assert on the JSON).
3. A representative, an Operations user, a finance user and another organization's manager are refused; a manager of another
   organization gets 404; a foreign lead is indistinguishable from a missing one.
4. Idempotent: second call is `already_linked`, one link row, one audit row; a lead converted by `convert` or linked to another
   family is 409.
5. Concurrency: two simultaneous calls link once; a simultaneous `convert` and link-only: exactly one wins, the other 409; the
   retention pass skips the locked row.
6. Lead with no contact row links with empty kinds and no retained copy; an unreadable number retains every kind.
7. A channel key held by another family: 409, nothing written, refusal audited.
8. A linked lead's contact row cannot be updated (guard), cannot be deleted except by the retirement rule; retirement past
   `retire_after` deletes it, writes the audit row, touches nothing else.
9. Dry run writes nothing (hashes identical) and shows the same plan the real call executes.
10. Existing `convert` behaviour, including `channel_missing`, is unchanged (regression on the 37-test spec).
11. Confinement spec: only `src/sales-pipeline` names `sales_lead_link`; no request role has a grant; RLS on, no policy.
12. Migration: idempotent, rollback restores both function bodies and drops the new table, ledger skips a re-apply; `schema_acceptance`
    and `br1_invariants` still pass.

### 7.5 Migration needs

Yes: a new slot (from the lead): `chat.sales_lead_link`, its guard, the one added rule in `guard_sales_lead_contact`, the retirement
function and its revoke list, plus a rollback file. No column on an existing table, no change to `convert`, no data written at
apply time. The API change is a new method in `src/sales-pipeline` only.

### 7.6 What the owner must decide

1. **Option:** O1 (recommended), or keep O4 only, or reverse the restriction (O3). O2 is not recommended.
2. **Retention of the retained copy:** 12 months from the link (recommended), shorter, or only on a manager's confirmation.
3. **Who may authorize:** Sales manager and super admin only (recommended), or also the Operations manager.
4. **State-7 leads** (no contact row, already enrolled): may the same action link them, as pure bookkeeping (recommended)?
5. **Visibility of a retained copy:** shown only to the manager on the lead's detail, read audited as today, never exported
   (recommended), or hidden until retirement.
