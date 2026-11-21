# PD-59 staging runbook: migration `20261121100000_chat_pd059_sales_pipeline`

Status: **PREPARED, NOT EXECUTED, NOT APPROVED.** One-page operator sequence. The reasoning, evidence and the local
rehearsal results are in `docs/admin/pd059-stabilization.md` (sections 1, 4A, 4B, 4.1-4.9); this page only orders the steps.
Nothing here was run against real staging. Production is a separate approval; **purging stays off** (never set
`SALES_LEAD_RETENTION_ENABLED` / `SALES_LEAD_RETENTION_DRY_RUN`).

Who does what: the **operator** (owner or lead) runs every step on staging; an agent never connects to staging.

## 0. Gate (all must be true before step 1)

- [ ] The owner approved this runbook for **staging** by name.
- [ ] `main` contains PD-59 (PRs #616-#622); the slot file `docs/product/migration-slots/20261121100000.md` is present; the main SHA is recorded.
- [ ] No open PR carries slot `20261121100000` (re-run the F6 check, doc section 1, on the day).
- [ ] The owner accepts the rollback's data-loss warning (step 7).

## 1. Read-only schema review on REAL staging (the actual finding)

Same role and connection string the deploy workflow uses, from a machine that reaches the pooler:

```
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/db/reports/pd059-staging-schema-review.sql > staging-schema-review.txt
```

The script is `begin read only` and rolls back; it prints names, counts and hashes only (no personal value). Go only on **0 FAIL**;
every WARN is explained in the deploy record. File the output (never paste it into a chat or ticket without reading it first).
Any FAIL on 30-34 (owner), 40 (ledger), 53/54 (guards not original), 70 (default ACL) stops the run; bring the output back to the lead.

## 2. Pre-counts for later comparison (read-only)

From doc 4.2: ledger state (every older migration present, PD-59 absent), the row counts of `chat.family`, `chat.contact`,
`chat.learner`, `chat.student_enrolment`, `chat.lesson`, `chat.trial_outcome`, `chat.trial_subscription` and `chat.trial_prospect`, and
`select pid, now()-xact_start, state from pg_stat_activity where xact_start is not null` (expect no long transactions).
Run the reconciliation report once for the baseline and file its output (ids and counts only):

```
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/db/reports/pd059-lead-reconciliation.sql
```

## 3. Backup

Use the workflow's "Back up the database before migrating" artifact, or a provider snapshot plus `pg_dump -n chat`. Confirm it
succeeded **before** step 4. The dump is the only way to recover the lead contact copies after a rollback.

## 4. Apply (bounded lock wait)

```
APPLY_LOCK_TIMEOUT=5s PSQL="psql -v ON_ERROR_STOP=1 $DATABASE_URL" scripts/db/apply.sh
```

`APPLY_LOCK_TIMEOUT` is applied as `set local lock_timeout` inside the migration's transaction, so it also works through the
Supabase session pooler (which drops `PGOPTIONS`, ADR-014). A lock timeout rolls the migration back whole, writes no ledger row, and
is safe to repeat in a quieter minute. Expected cost: about a second; `ACCESS EXCLUSIVE` on `chat.trial_prospect`, `SHARE ROW
EXCLUSIVE` on `chat.family`, `chat.staff`, `chat.organization` until commit.
The deploy workflows do not set this variable yet: that is an owner-only edit (`.github/workflows/`, doc 4B). When the workflow
runs the apply, either the owner has made that edit, or the apply is run by hand as above before the workflow's release step.

## 5. Release

Deploy the API and worker **after** the migration (the workflow's Release step). The migration is additive, so the old API keeps
working against the new schema in the gap; the new API needs the columns.

## 6. Verify (read-only; expected values from the rehearsal)

Run the doc 4.5 queries. Expected: ledger row 1; 9 new `trial_prospect` columns; `sales_lead_contact` RLS on with 0 policies; no
request role holds any privilege on it (all `false`; **if `service_role` prints `t`, stop and tell the lead**); the six functions' ACL is
the owner only; `owned` equals the prospects created by live Sales staff; `sales_lead_contact` is empty; `guard_trial_prospect`
mentions `sales_lead_owner_eligible`. The row counts from step 2 are **identical** (the migration changes none). Re-run the
reconciliation report and file it next to the baseline. Then the smoke test.

## 7. Rollback (only on a failed verification, with the lead)

1. Roll the API and worker back **first** (or at the same moment): the new code reads these columns.
2. Export what the rollback destroys, from a privileged session, to an encrypted file, never into a chat or ticket:
   `\copy (select * from chat.sales_lead_contact) to ...`
3. ```
   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261121100000_chat_pd059_sales_pipeline.down.sql
   psql "$DATABASE_URL" -c "delete from chat.schema_migrations where version = '20261121100000_chat_pd059_sales_pipeline'"
   ```
4. Effect: drops `chat.sales_lead_contact` (unlinked lead contacts are gone), drops the pipeline columns (stored stage, lost reason,
   follow-ups, owners) and restores both guard functions to their original bodies. No family, parent, learner, lesson, outcome or
   enrolment row changes (rehearsed locally: schema byte-identical, row hashes identical; rollback then re-apply clean).

## 8. Never

No purge flag; no agent connection to staging; no seeding leads by hand; no edit of any parent, family or learner row; no `--force`
re-apply; no ledger edit except step 7's single `delete`; no production apply before staging ran clean and the owner approved it.
