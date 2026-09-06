# Backup, Restore and Disaster Recovery

Owner: AI #7 · Date: 2026-09-05

## 1. What is backed up

| Data | Method | Frequency | Retention | Status |
|---|---|---|---|---|
| Postgres (authoritative state) | Managed provider continuous backup + PITR | continuous | 7–30 days | **not provisioned** |
| Postgres (portable copy) | `scripts/infra/backup-db.sh` (`pg_dump -Fc`) | before every deploy; nightly | 30 days | **implemented and tested** |
| Object storage | Provider versioning + lifecycle rules | continuous | 30 days | **not provisioned** |
| Redis | Not backed up by design | — | — | — |
| Secrets | Secret store's own durability | — | — | not provisioned |
| Container images | Registry, tagged by commit | per deploy | 90 days | pipeline written |

Redis is deliberately not backed up: it holds cache entries and in-flight jobs,
not customer data. It is configured `appendonly yes` so queued jobs survive a
restart, and `noeviction` so it cannot silently drop pending work. If Redis is
lost, queued jobs are lost — which is why jobs must be reconstructible from the
database outbox (AI #2). **Redis must never be the source of truth.**

## 2. Two layers, on purpose

The provider's continuous backup is the primary line: it supports point-in-time
recovery and is what a real disaster uses. The `pg_dump` copy exists because a
provider snapshot cannot be restored onto a laptop to answer "what did this
table look like on Tuesday", and because a compromise of the provider account
takes its snapshots with it.

## 3. Taking a backup

```bash
APP_ENV=production DATABASE_URL=... scripts/infra/backup-db.sh --out ./backups --schema chat
```

Writes a compressed `pg_dump` custom-format archive plus a `.sha256`. Uses local
`pg_dump` if present, otherwise runs it from a container. Notes:

- The container image's major version must match the **server's**; set
  `PG_IMAGE` (default `postgres:17-alpine`).
- Docker must be able to see the output directory. On macOS, `/tmp` and
  `/private/tmp` usually are **not** shared with the Docker VM: the dump is
  written inside the VM and silently disappears while docker exits 0. The script
  detects a missing output file and says so.
- The checksum records the **basename**, so it still verifies after the dump is
  copied elsewhere.
- `--no-owner --no-privileges`: role names differ between the managed production
  database and any machine you restore onto.

## 4. Restoring — and the thing that will catch you

> ### A `chat`-only dump is NOT restorable on its own.
>
> `chat.core_*` are boundary views over Jawwid Core's tables in the `public`
> schema. Restoring `--schema chat` into an empty database fails at the first
> such view:
>
> ```
> pg_restore: error: relation "public.children" does not exist
> ```
>
> With `--exit-on-error` the restore **aborts partway**. A drill run on
> 2026-09-05 produced 4 of 16 tables and **zero** `chat.config` rows — a
> silently partial database. Finding this during an incident would be very
> expensive.

**The recovery unit is the whole database** (Core's `public` schema plus
`chat`), not the `chat` schema alone. When restoring `chat` in isolation — a
drill, or an investigation copy — recreate the Core tables first.

Verified procedure:

```bash
# 1. Target database, on the same Postgres major version as the source.
docker run -d --name restore-target -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=restore -p 55498:5432 public.ecr.aws/supabase/postgres:17.6.1.140

# 2. Core tables first. Locally that is the shim; for a real restore it is
#    Core's own backup.
docker exec -i restore-target psql -v ON_ERROR_STOP=1 -U supabase_admin -d restore \
  < db/test/00_core_shim.sql

# 3. Then chat.
scripts/infra/restore-db.sh --file backups/<dump> \
  --into postgresql://supabase_admin:<pw>@localhost:55498/restore
```

The restoring role needs `CREATE` on the target database. In the Supabase image
the plain `postgres` superuser is **not** sufficient — use `supabase_admin`.

`restore-db.sh` verifies the checksum before touching the target, and refuses a
target whose URL looks like production unless
`--i-understand-this-overwrites-production` is passed.

## 5. Restore drill

A backup is an assumption until it has been restored. **Monthly**, and after any
migration that changes the schema shape.

Checklist — all five must pass:

1. [ ] The dump restores with **zero** `pg_restore` errors.
2. [ ] Table count matches the source.
3. [ ] `select count(*) from chat.config` is non-zero and matches.
4. [ ] `chat.schema_migrations` holds every expected version.
5. [ ] An application instance pointed at the restored database reaches
       `/health/ready` = 200.

**Last drill: 2026-09-05 — PASSED**, against the live schema, after the
correction in §4 was applied.

| | Naive `--schema chat` restore | Corrected procedure |
|---|---|---|
| pg_restore errors | 1 (aborted) | **0** |
| `chat` tables | 4 | **31** |
| `chat.config` rows | 0 | **57** |
| Migrations recorded | — | **13** |

CI re-runs the backup half of this on every pull request that touches
migrations, so §4 cannot silently stop being true.

## 6. Objectives

| Environment | RPO | RTO |
|---|---|---|
| Production | ≤ 5 min (provider PITR) | ≤ 2 h |
| Staging | ≤ 24 h | best effort |

These are proposals until a provider is chosen; PITR granularity and restore
speed are provider-dependent, and the RTO must be measured by a real drill
rather than assumed.

## 7. Disaster scenarios

| Scenario | Response |
|---|---|
| Database corrupted or data deleted | Stop writes. PITR to just before the event. If only `chat` is affected, restore per §4. Verify with the §5 checklist before reopening. |
| Database host lost | Provider failover, or provision a new instance and restore. Update `DATABASE_URL`; redeploy. |
| Redis lost | Provision a new instance, update `REDIS_URL`, redeploy. Queued jobs are gone — reconcile from the outbox (AI #2). Expect delayed notifications, not lost messages. |
| Object storage lost | Restore from versioning. Attachments are not reproducible from Postgres: this is the one data class with no second copy in the system. |
| Bad deployment | Roll back the image (`production-runbook.md`). If a migration ran, roll back the **application only** and assess the migration separately — most are not reversible. |
| Credential compromised | `secrets.md` §5. Revoke at the provider first. |
| Jawwid Core outage | Chat stays up; Core-dependent reads degrade visibly. Do not fabricate Core data; do not let Chat become a second source of truth. |
| LiveKit outage | Calling unavailable; messaging unaffected. |
| Push provider outage | Notifications retried by the worker; in-app delivery unaffected. |
| Region outage | Accepted risk for MVP. Recovery is restore-into-a-new-region, hours not minutes. Multi-region is explicitly out of scope (ADR-003). |

## 8. Gaps

- No provider backups exist, because no managed database exists.
- Retention, PITR window and restore speed are unmeasured.
- Object storage backup is a policy, not yet a configuration.
- Backup **encryption at rest** for the `pg_dump` copies is not implemented; the
  archives are unencrypted on whatever disk they land on. Before any real dump
  leaves a managed environment, encrypt it or store it in an encrypted bucket.
