# Production Runbook

Owner: AI #7 · Date: 2026-09-05
Status: procedures are written and, where possible, verified locally. The
platform-specific commands marked `PLATFORM` cannot be filled in until hosting
is chosen (ADR-003 / BLOCKER-1).

---

## 1. Deploy to production

Prerequisites: the commit is on `main`, CI is green, and it has been running on
staging.

1. Confirm what staging is running and that its smoke test passed.
2. Actions → **Deploy production** → `image_tag` = the commit SHA, `confirm` = `DEPLOY`.
3. Approve the `production` environment when prompted.
4. The workflow then, in order: validates configuration → backs up the database
   → uploads the backup as a 30-day artifact → applies migrations → releases →
   smoke-tests → records the release in the run summary.
5. Watch error rate and latency for 15 minutes.

Any step failing stops the deployment. The configuration check runs **before**
anything changes, so a missing secret costs a failed run rather than an outage.

## 2. What exactly is running?

```bash
curl -s https://<api-host>/health/live | jq .build
# { "commit": "...", "version": "...", "builtAt": "...", "environment": "production" }
```

This is the authoritative answer — it comes from the running process, not from
the pipeline's belief about it. `commit: "unknown"` means the image was not built
by the pipeline; treat that as an incident in itself.

## 3. Roll back

**Application rollback** — the safe, fast path:

```
Actions → Deploy production → image_tag = <previous good SHA> → confirm = DEPLOY
```

Then verify with §2 and re-run the smoke test.

**Database rollback — read this before assuming it exists.**

Most migrations are **not** reversible. `DROP COLUMN` and `DROP TABLE` destroy
data; redeploying the old image does not bring it back. There is no `down`
migration mechanism in `scripts/db/apply.sh`, by design — an automatic reverse
migration in production is more dangerous than a considered manual one.

So:

| Situation | What to do |
|---|---|
| Additive migration (new table/column/index), app is broken | Roll back the **application only**. Leave the schema; it is compatible. |
| Destructive migration, data lost | Restore from the pre-deployment backup (`backup-recovery.md` §4). Everything written since the backup is lost — this is the RPO you are spending. |
| Migration failed halfway | Each migration runs in a transaction with its ledger row, so a failed migration is not recorded as applied. Fix forward and re-run. |

The practical rule: prefer **expand/contract**. Add the new column, deploy code
that writes both, backfill, deploy code that reads the new one, and only then
drop the old — in a later release. Each step is independently reversible.

**Configuration rollback:** revert the variable in the environment and redeploy.
Configuration is not versioned with the code; a change to it is a deployment.

## 4. Restart a service

```
PLATFORM: restart the API service / the worker service
```

Restarting is safe: `SIGTERM` triggers graceful shutdown — stop accepting work,
finish in flight within `SHUTDOWN_GRACE_MS` (15s), then exit. The hard-stop timer
means a stuck connection cannot hold a deployment open indefinitely.

Never restart the API to "fix" a database problem. Check `/health/ready` first:
if it reports the database down, restarting only moves the outage.

## 5. Logs

```
PLATFORM: stream API logs / worker logs
```

Logs are structured JSON. Trace one request end to end by its `request_id`, and
one message through the whole pipeline by its `correlation_id`
(`monitoring.md` §4). If you find a phone number, message body or token in a log
line, that is a privacy incident — see `incident-response.md`.

## 6. Health

| Endpoint | Meaning | If it fails |
|---|---|---|
| `/health/live` | the process is functional | the container is wedged → restart |
| `/health/ready` | Postgres and Redis reachable | instance drains itself → fix the dependency, do **not** restart |
| `/health` | same detail, always 200 | for humans |

Readiness excludes Core, push and LiveKit on purpose (ADR-007): those degrade
features, and must not remove a healthy instance from the pool.

## 7. Database migration

```bash
DATABASE_URL=... scripts/db/apply.sh
```

Idempotent — already-applied versions are skipped. Runs each migration in one
transaction with its ledger row.

Before a risky migration (`DROP`, mass update, large index rebuild, type
change): take a backup and confirm it; run it on staging against
production-shaped data; write the execution plan and the abort condition; know
the lock it takes. `CREATE INDEX` without `CONCURRENTLY` locks writes on a large
table for the duration.

## 7a. Backup

```bash
APP_ENV=production DATABASE_URL=... scripts/infra/backup-db.sh --out ./backups --schema chat
```

Writes a `pg_dump` custom-format archive plus a `.sha256`. Take one before every
risky migration and before every production deploy — the deploy workflow already
does, as a 30-day artifact.

**The archive now carries the privilege model.** Until Phase 8 the dump was taken
with `--no-privileges` and contained zero ACL entries, so anything restored from
it was a database the application could not write to. If you are holding an
archive taken before 2026-09-08, assume it has that defect and re-take it.

## 7b. Restore

**Read `backup-recovery.md` §4 before doing this under pressure.** Two failure
modes there produce a restore that looks like it worked.

```bash
# 1. Target on the SAME Postgres major version. Plain postgres:17.
docker run -d --name restore-target -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=recovered -p 55489:5432 postgres:17

# 2. Restore. The schema and the runtime roles are prepared for you.
scripts/infra/restore-db.sh --file backups/<dump> \
  --into postgres://postgres:postgres@localhost:55489/recovered --schema chat

# 3. VERIFY. A restore is not a recovery until the copy passes the same gates a
#    migrated database does. This is not optional and it takes seconds.
for suite in schema_acceptance br1_invariants rls_enforcement \
             tenant_isolation assignment_invariants od01_conversation_model; do
  psql -v ON_ERROR_STOP=1 "$RECOVERED_URL" -f "db/tests/$suite.sql"
done
```

The restoring role needs `CREATE` on the target database **and** `CREATE ROLE` on
the cluster, because step 2 creates the runtime roles when they are absent. If
your target forbids that, `--no-privileges` gets you an **investigation copy, not
a recovery** — the application cannot write to it.

Restoring over production additionally requires
`--i-understand-this-overwrites-production`, and take a fresh backup of the
current state first: you will want it if the restore turns out to be the wrong
call.

## 7c. Rotate a secret

Full procedure in `secrets.md`. The order that matters:

1. Issue the new value at the provider **before** touching the application.
2. Update the secret store.
3. Restart the API and the worker so both read it (§4).
4. Verify with `/health/ready` and a smoke test.
5. Revoke the old value at the provider — **last**, so a failed rollout can roll
   back to something that still works.

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are the exception: rotating either
invalidates every existing session, so every user is signed out. That is the
correct response to a suspected token leak and an outage if done casually.

## 8. Incidents by symptom

### API returning 5xx

1. `/health/ready` — is a dependency down?
2. Error tracker — one error dominating, or many?
3. Did something deploy in the last hour? (§2) If so, roll back first and
   diagnose after.
4. Database connections saturated? Check pool utilisation and slow queries.

### Messages send but nothing arrives

Realtime and push are separate paths; the message itself is already persisted.
Check queue depth and **oldest-job age**, the worker heartbeat, Redis health,
push provider errors, and realtime connection counts. A stalled queue with a
live worker usually means a poison job blocking a serial queue.

### Worker not processing

Is it running? Is Redis reachable? Is `QUEUE_PREFIX` correct for this
environment — a mismatched prefix means the worker is watching an empty queue
while jobs pile up in another. Check dead-letter size and the oldest job's error.

### Redis down

Readiness fails and instances drain. Restore Redis; jobs resume from the append-
only file. If Redis was lost entirely, reconcile pending work from the outbox.
No persisted message is lost — Postgres is authoritative.

### Realtime disconnect storm

Check proxy idle timeout on upgraded connections (must be ≥ 1h), the Socket.IO
Redis adapter's health, and whether one instance is unhealthy and flapping.
Clients reconcile on reconnect; a storm is a capacity and configuration problem,
not data loss.

### Push failing

Check invalid-token rate first. A sudden mass of invalid tokens on iOS almost
always means `APNS_PRODUCTION` is wrong — the sandbox gateway accepts production
tokens and delivers nothing. `check-env.sh` refuses that in production, so this
should only be possible via a manual environment edit.

### Calling failing

Check LiveKit status, token minting (TTL is 300s — clock skew on the server
invalidates tokens), and that `LIVEKIT_API_SECRET` is set and current. Messaging
is unaffected; do not roll back the whole application for a calling outage.

### Jawwid Core failing

Chat stays up. Confirm Core-dependent features degrade with a visible error
rather than silently. Do not disable the integration in a way that lets Chat
invent Core data or become a second source of truth. Retries with backoff are
expected; sustained failure is a SEV-3 and a conversation with the Core team.

## 9. Emergency contacts

**Not yet defined.** Needs an on-call rotation, an escalation path, and the
Jawwid Core team's contact — see `production-readiness.md`.
