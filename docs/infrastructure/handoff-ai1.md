# Handoff → AI #1 (Backend core, data model, authorization)

From AI #7 (infrastructure) · 2026-09-06

Infrastructure constraints and seams that touch your domain. None of this
overrides your architecture; where it looks like it does, tell me and I will
change the infrastructure.

## 1. Two things I need from you

**`main.ts` does not exist.** The API cannot start in any environment. This is
BLOCKER-4 and it gates everything downstream — staging, smoke tests, the release
step. When you write it, three lines adopt all the infrastructure concerns:

```ts
import { applyInfrastructure } from './infra';
import { HealthModule } from './infra';           // add to AppModule imports

const app = await NestFactory.create(AppModule);
applyInfrastructure(app);                          // headers, CORS, graceful shutdown
await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
```

`applyInfrastructure` adds no dependency to `package.json`; it is written
against what you already declare.

**`PrismaService` aborts startup when Postgres is unavailable.** Verified by
booting the compiled app against an unreachable database:

```
BOOT FAILED: Can't reach database server at `localhost:5499`
```

`onModuleInit()` calls `$connect()` and does not catch, so the process exits
instead of starting and reporting itself unready. During a 30-second database
blip every replacement container crash-loops, and the outage outlives its cause.

Suggested change (your call): let `$connect()` fail without aborting boot, and
let readiness report the database down until it succeeds. `/health/ready`
already handles that correctly — it returns 503 with `database: down` and the
instance drains rather than dying.

## 2. Health endpoints — yours to rely on, mine to maintain

| Endpoint | Checks | Semantics |
|---|---|---|
| `/health/live` | nothing | the process is functional |
| `/health/ready` | Postgres, Redis | 503 → drained from the pool |
| `/health` | same as ready | human detail, always 200 |

`HealthService` injects `PrismaService` from your `@Global` `PlatformModule`. If
you stop exporting it globally, boot fails loudly — deliberately. A health check
that silently stops checking the database is worse than one that refuses to start.

Probes are bounded by `HEALTH_PROBE_TIMEOUT_MS` (2s) and return the error
*class*, never its message: driver errors quote the DSN, and the DSN holds a
password.

## 3. Database

**The migration authority is `scripts/db/apply.sh`** — your script, your ledger
(ADR-002), now also locked by the product owner. CI runs it and asserts
re-running is a no-op. No pipeline runs `prisma migrate` or `prisma db push`.

Constraints from the deployment side:

- Migrations are **forward-only**. There is no `down` mechanism and I am not
  adding one: an automatic reverse migration in production is more dangerous
  than a considered manual one.
- Production takes a backup before every migration, uploaded as a 30-day
  artifact. That is the rollback for a destructive change; nothing else is.
- Please prefer **expand/contract** — add, dual-write, backfill, switch reads,
  drop in a later release. Each step is then independently reversible.
- `CREATE INDEX` on a large table needs `CONCURRENTLY`, or it locks writes for
  the duration.
- `DATABASE_STATEMENT_TIMEOUT_MS` is 15s so one slow query cannot pin a pooled
  connection.

**One thing you should know about backups.** A `--schema chat` dump is currently
**not** restorable on its own: `chat.core_*` are views over Core-owned tables in
`public`, so restore fails at `relation "public.children" does not exist` and, with
`--exit-on-error`, aborts partway — the drill produced 4 of 16 tables and zero
`chat.config` rows. The corrected procedure (Core tables first, then `chat`) is
verified and documented. Once the locked decision lands and Core is reached over
an API/webhook boundary instead of views, this constraint disappears — please
tell me when it does, so I can simplify the recovery procedure rather than leave
a stale warning in the runbook.

## 4. Redis

`appendonly yes` and `maxmemory-policy noeviction`. A queue backend that evicts
keys under memory pressure deletes pending work. Redis is not backed up and must
never be the source of truth for customer data.

## 5. Realtime and WebSockets

With more than one API instance, the Socket.IO Redis adapter is required for
correctness, not performance. Also: the realtime layer must not bypass
application authorization — room membership is an authorization decision and must
run the same code path as HTTP. That matters most for BR-1.

## 6. Configuration

Every variable is declared in `infra/env/manifest.tsv`; adding one means editing
the manifest and regenerating the templates (CI enforces this). If you need a
new variable, add it there and mark it secret if it is one.

The `JWT_*` names are infrastructure's proposal, not a design. Rename them
freely — just update the manifest. If you implement dual-accept verification
(old and new secret valid simultaneously), say so and I will document rotation
as zero-impact instead of "everyone logs in again".
