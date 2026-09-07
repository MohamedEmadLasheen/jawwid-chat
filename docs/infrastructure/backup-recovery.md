# Backup, Restore and Disaster Recovery

Owner: AI #7 · Date: 2026-09-05 · Last corrected and re-drilled: 2026-09-08 (Phase 8)

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

## 4. Restoring — and the two things that will catch you

Both of these were found by an actual drill, on 2026-09-08. Both produced a
restore that *looked* like it had worked.

> ### 4.1 `pg_restore --schema chat` cannot create the schema it filters on
>
> `pg_dump` records `CREATE SCHEMA chat` as a TOC entry whose own namespace is
> `-`, not `chat`. `pg_restore --schema=chat` therefore filters that entry out,
> and the restore dies on its first object:
>
> ```
> pg_restore: error: could not execute query: ERROR:  schema "chat" does not exist
> ```
>
> `restore-db.sh` now creates the schema on the target before restoring, so
> `--schema` is usable. Nothing an operator has to remember.

> ### 4.2 The dump used to carry no privileges at all
>
> `backup-db.sh` passed `--no-privileges` to `pg_dump`. Every archive it ever
> wrote contained **zero ACL entries**, so every restore produced a database in
> which `chat_app` — the role the application actually connects as — could not
> `INSERT` into a single table. `db/tests/schema_acceptance.sql` states it
> plainly:
>
> ```
> ERROR:  chat_app cannot INSERT into chat.account, ... -- the application would fail closed
> ```
>
> The stated reason was portability, but the roles named in these GRANTs are not
> the platform's — they are ours (`chat_app`, `chat_service`, `authenticated`,
> `service_role`, created by `20260905091150` and `20260907120000`), and they
> are identical everywhere this schema is restored. `--no-owner` is what handles
> the owner role that genuinely differs. Privileges are now captured; a restore
> can always skip ACLs it does not want, but can never invent ones the dump
> never recorded.
>
> **Role attributes and memberships live in no schema-scoped dump.** `chat_app`
> must be `INHERIT` (a policy written `to authenticated` is matched with
> `pg_has_role(..., 'USAGE')`, which is false for a non-inheriting member) and
> `chat_service` must be `BYPASSRLS`. Get either wrong and the restore succeeds
> while the application reads zero rows. `restore-db.sh` restates both, mirroring
> `20260907120000`.

**The recovery unit is the `chat` schema.** This is a correction: it used to be
"Core's `public` schema plus `chat`", because `chat.core_*` were views over
Jawwid Core's tables. That coupling is gone (RT-023) — `db/tests/schema_acceptance.sql`
asserts "no non-chat tables, no auth schema" — and the Core shim the old
procedure told you to load, `db/test/00_core_shim.sql`, **no longer exists**.

Verified procedure:

```bash
# 1. Target database, on the same Postgres major version as the source.
#    Plain postgres:17 — not the Supabase image (docs/release/database-decision.md).
docker run -d --name restore-target -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=recovered -p 55489:5432 postgres:17

# 2. Restore. The schema and the runtime roles are prepared for you.
scripts/infra/restore-db.sh --file backups/<dump> \
  --into postgres://postgres:postgres@localhost:55489/recovered --schema chat

# 3. Verify. A restore is not verified until the copy passes the same gates a
#    migrated database does.
for s in schema_acceptance br1_invariants rls_enforcement \
         tenant_isolation assignment_invariants od01_conversation_model; do
  psql -v ON_ERROR_STOP=1 "$RECOVERED_URL" -f "db/tests/$s.sql"
done
```

The restoring role needs `CREATE` on the target database and on the cluster
(`CREATE ROLE`), because step 2 creates the runtime roles if they are absent. If
your target forbids that, pass `--no-privileges` — and understand that you are
choosing an investigation copy, not a recovery: the application cannot write to
it.

`restore-db.sh` verifies the checksum before touching the target, and refuses a
target whose URL looks like production unless
`--i-understand-this-overwrites-production` is passed.

## 5. Restore drill

A backup is an assumption until it has been restored, and a restore is a second
assumption until the copy has been *tested*. **Monthly**, and after any migration
that changes the schema shape.

Checklist — all six must pass:

1. [ ] The dump restores with **zero** `pg_restore` errors.
2. [ ] Table count matches the source.
3. [ ] `select count(*) from chat.config` is non-zero and matches.
4. [ ] `chat.schema_migrations` holds every expected version.
5. [ ] The restored copy passes all six `db/tests/*.sql` suites — in particular
       `schema_acceptance` (privileges and role attributes survived) and
       `rls_enforcement` (RLS still applies to the runtime role).
6. [ ] An application instance pointed at the restored database reaches
       `/health/ready` = 200.

**Last drill: 2026-09-08 — PASSED**, onto a bare `postgres:17` cluster that had
never seen this schema and held none of its roles.

| | Before the Phase 8 fix | After |
|---|---|---|
| `pg_restore` errors | 1 (aborted immediately) | **0** |
| `chat` tables | 0 | **80** |
| `chat.config` rows | 0 | **119** |
| Migrations recorded | 0 | **50** |
| `chat_app` grants | 0 | **186** |
| `schema_acceptance` | FAIL | **PASS** |
| `rls_enforcement` | not reached | **PASS** |
| Integrity suites passing | 0 / 6 | **6 / 6** |

Item 6 is the one part of the checklist this drill did **not** cover: no
application instance was pointed at the restored copy, because no environment
exists to run one against. It is listed as outstanding in §8.

CI runs this whole drill — backup, restore into a database that did not exist,
then all six suites against the copy — on every pull request. The previous
pipeline ran only the backup half, which is precisely why §4.2 survived
undetected: the archive was always fine.

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

- **The drill has never restored into a running application.** Checklist item 6
  (`/health/ready` = 200 against the restored copy) is unverified, because no
  environment exists to run an instance in. Structure, data, privileges and
  policies are proven; the application's behaviour against a restored database
  is not.
- No provider backups exist, because no managed database exists.
- Retention, PITR window and restore speed are unmeasured.
- Object storage backup is a policy, not yet a configuration.
- Backup **encryption at rest** for the `pg_dump` copies is not implemented; the
  archives are unencrypted on whatever disk they land on. Before any real dump
  leaves a managed environment, encrypt it or store it in an encrypted bucket.
