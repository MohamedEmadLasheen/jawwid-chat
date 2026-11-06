# Production Runbook

Owner: AI #7 · Date: 2026-09-05
Status: procedures are written and, where possible, verified locally. The
platform is DigitalOcean App Platform (ADR-010); the commands below use `doctl`
with `<app-id>` = the environment's `DIGITALOCEAN_APP_ID`. They are unexecuted
until the first app exists (`production-readiness.md`, owner steps).

---

## 1. Deploy to production

Prerequisites: the commit is on `main`, CI is green, and it has been running on
staging.

1. Confirm what staging is running and that its smoke test passed.
2. Actions → **Deploy production** → `image_tag` = the commit SHA, `confirm` = `DEPLOY`.
3. Approve the `production` environment when prompted.
4. The workflow then, in order: rebuilds the production Admin Web image
   (ADR-006) → checks the deploy credentials → validates configuration and
   resolves `.do/app.production.yaml` → checks the bucket still keeps deleted
   objects for 30 days (versioning + lifecycle) → backs up the database
   (encrypted; refused without the `BACKUP_ENCRYPTION_PASSPHRASE` secret)
   → uploads the backup as a 30-day artifact → applies migrations → releases
   with `doctl apps update` and confirms the ACTIVE deployment runs the new
   tags (`scripts/infra/do-release.sh`) → smoke-tests → records the release in
   the run summary.
5. Watch error rate and latency for 15 minutes.

Any step failing stops the deployment. The configuration check runs **before**
anything changes, so a missing secret costs a failed run rather than an outage.

### 1a. Switches that wait for a deployed worker (PD-37)

**`realtime.receipts_announce` stays OFF until the outbox WORKER runs PD-37.**
It is a `chat.config` row, seeded `false` (the compiled default is `false`), and
it gates the `receipts.advanced` outbox row from which the worker sends authors
their live ticks (`message.status`). A worker from before PD-37 has no case for
that event, and its default branch would broadcast the reader's cursor to the
whole conversation room (the RT-012 roster leak). While it is off, read and
delivery cursors and receipts still move, and the ticks are right on every fetch;
only the live push waits.

- Turn it on once the worker component runs a build with PD-37, in that
  environment. It takes effect within the 30 s config cache:
  `update chat.config set value = 'true'::jsonb where key = 'realtime.receipts_announce';`
- **Before any worker rollback** to a build without PD-37, turn it off first:
  `update chat.config set value = 'false'::jsonb where key = 'realtime.receipts_announce';`

**During a rolling deploy** of PD-37, typing indicators and live ticks may be
missing for a moment. They travel on a new node channel
(`rt009:deliver-thread-audience`) and relay target (`room-audience`) that an
older API node **drops** rather than broadcasts. They return once every node is
updated. Presence (PD-37) needs Redis 6.2 or later (`ZADD … GT/XX`). The app sends typing over HTTP
(`POST /conversations/:id/typing`, rate limited by `abuse.throttle.typing_actor`,
40 per window); a spike of 429s there means a client pinging too often, not
an outage — typing simply lapses on the other screens.

### 1b. When to raise a size (ADR-013)

Production launches on the sizes staging runs (`scripts/infra/app-spec.py`
`SIZES`): API `apps-s-1vcpu-1gb`, worker `apps-s-1vcpu-0.5gb`, Admin Web
`apps-s-1vcpu-0.5gb`, Postgres 1 GiB single node, Valkey 1 GiB. Raise one only on
a measured threshold, through `SIZES` and a regenerated spec, never in the console
(the next deploy would undo it, ADR-012):

| Component | Raise when | To |
|---|---|---|
| API | memory above 70% sustained, any out-of-memory restart, or p95 above 500 ms | `apps-s-1vcpu-2gb` |
| API, second instance | only after RISK-4 is closed on staging, and CPU above 70% sustained | `instance_count: 2`, together with the Postgres row below |
| Worker | memory above 70% sustained, or outbox lag above a few seconds | `apps-s-1vcpu-1gb` |
| Postgres | any second API instance (the pool budget in `database-pool.ts` is 20 of 22 during a deploy), storage above 70%, or CPU above 70% | the 2 GiB plan, then raise `DATABASE_POOL_MAX` |
| Postgres standby | when a recovery of up to the 2 h RTO (`backup-recovery.md` §6) is no longer acceptable | one standby node |
| Valkey | memory above 70%, or any evicted key | the 2 GiB plan |

### 1c. Launch cutover: from the review period to managed Valkey (ADR-015)

During the store-review period production runs with `LAUNCH_PHASE=review`: a
private in-app Redis (`redis`, Valkey 8.1, `REDIS_URL=redis://redis:6379`). **No
real customer may sign in while it does.** The public launch, meaning the store
release switched from manual to public, comes **only after** a successful
`LAUNCH_PHASE=launch` deploy. The database cutover (ADR-014) happens in the same
window.

**Before the window (any day, no downtime):**

0. `TRUSTED_PROXY_HOPS` is measured and set (§1d), and the `PROXY_HOPS_PROBE` secret is deleted.
   The launch deploy refuses otherwise.
1. Create the cluster: `doctl databases create jawwid-chat-prod-valkey --engine
   valkey --version 8 --region fra1 --size db-s-1vcpu-1gb --num-nodes 1 --wait`,
   and assign it to the "Jawwid Chat" project.
2. Eviction: `doctl databases configuration get <id> --engine valkey`, then set the
   `…maxmemory_policy` field to `noeviction` with `configuration update`.
3. Trusted Sources: add **only** the App Platform app
   (`doctl databases firewalls append <id> --rule app:<DIGITALOCEAN_APP_ID>`), and
   no IP address. The runner cannot reach it then, which is intended; the deploy
   checks it through DigitalOcean's API instead.
4. The `production` token needs **read access to databases** (as well as apps).

**In the window:**

5. Set the `production` secret `REDIS_URL` to the cluster's **TLS** connection
   string (`rediss://…`, port 25061), and the variable `LAUNCH_PHASE=launch`.
6. Run **Deploy production**. Before anything changes it now:
   - resolves the spec, which **drops the in-app `redis` component** and refuses a
     `REDIS_URL` that is not `rediss://` to a non-in-app host;
   - runs `scripts/infra/verify-managed-redis.sh`: the cluster is the one
     `REDIS_URL` names, online, in `fra1`, `noeviction`, and its Trusted Sources
     are this app only.
   Any refusal stops the run before the backup and the migrations.
7. **Connection test:** the smoke test's `GET /health/ready -> 200` proves the API
   reaches the cluster (readiness fails while Redis is unreachable). Then sign in
   on a phone, send a message between two accounts, and watch the live tick and
   the typing indicator arrive: that exercises the worker → API relay and presence.

**What to expect (persistence):** nothing durable lives in Redis. The switch
clears presence, typing and the source-based login limiter's windows, once. The
account lockout and the outbox live in Postgres and are untouched. No data is
copied from the in-app Redis, and none needs to be.

**Rollback:** the previous deploy is still active if the run refuses (ADR-012).
After a launch deploy, roll back by setting `LAUNCH_PHASE=review` and
`REDIS_URL=redis://redis:6379` and redeploying the same `image_tag`: the resolver
re-adds the in-app component. **Only before the store release is public.** Once
real customers can sign in, fix the managed cluster instead: rolling back would
put them on the review-period Redis this section exists to keep them off.

**After launch:** delete nothing until a week of normal running. The in-app
component is already gone from the app. `LAUNCH_PHASE` stays `launch`.

### 1d. Measure TRUSTED_PROXY_HOPS (once, after the first deploy)

`TRUSTED_PROXY_HOPS` is the number of proxies in front of the API that append to
`X-Forwarded-For`; the login, reset, signup and recovery limiters' per-address
budget keys on the address it yields (`apps/api/src/platform/auth/client-address.ts`).
DigitalOcean does not document it, so it is **measured, never guessed**:

- **Unset** (the first deploy): no forwarded header is read, nothing can be
  spoofed, and the per-address budget is OFF. Per-account lockout is unaffected.
  Acceptable only while no real user can sign in (the review period).
- **0 is wrong on App Platform**: the TCP peer is DigitalOcean's router, the same
  for every client, so every client would share ONE budget and about thirty failed
  sign-ins from anyone would lock everybody out.
- **One too many** lets a client choose its own address by forging an entry.

Media and payment links do not depend on it: the deploys set
`MEDIA_PUBLIC_BASE_URL` and `PAYMENT_LINK_BASE_URL` to the public HTTPS origin
unless those variables say otherwise (the deploy refuses a base that is not
`https://<host>[/<path>]/api/v1`, or an API origin with a trailing slash), and the API never reads `X-Forwarded-Host`
(App Platform passes a forged one through).

**Steps** (the owner sets the values; the token is a secret and is never printed):

1. Create a probe token (`openssl rand -hex 32`), keep it in your password manager,
   set it as the `production` **secret** `PROXY_HOPS_PROBE`, and run **Deploy
   production** with the same `image_tag`. The API logs a warning that the probe is
   on. Only requests carrying that token are measured, so nobody else can add a
   reading to the log or use up its 50 lines (per process start).
2. From a machine whose public IPv4 address you know:
   `PROXY_HOPS_PROBE_TOKEN=<token> scripts/infra/measure-proxy-hops.sh send https://api.chat.jawwid.com --my-ip <that address>`.
   It prints a fresh **run id** and makes three requests to `/health/live`: one
   plain, one with a forged `X-Forwarded-For`, one with a forged `do-connecting-ip`.
   Your address is sent only as a SHA-256 hash, compared and dropped; the probe
   logs positions and counts, never an address, a header value or the token.
3. `doctl apps logs "$DIGITALOCEAN_APP_ID" api --type run | scripts/infra/measure-proxy-hops.sh interpret --run <run id>`.
   It reads ONLY that run and prints `TRUSTED_PROXY_HOPS = N`, or **STOP** with the
   reason: a line missing or duplicated, your address not found or at different
   hops, a public TCP peer (the API reachable directly), or a forged entry inside
   the trusted hops. On STOP, fix the cause and `send` again (a new run id).
4. On `TRUSTED_PROXY_HOPS = N`: set that variable, **delete** the `PROXY_HOPS_PROBE`
   secret, and redeploy. The boot log then says
   `trust proxy = N; login source-IP rate limit enabled`.
5. Make it required again: in `infra/env/manifest.tsv` change the `TRUSTED_PROXY_HOPS`
   row's STAGING and PROD columns back to `req`, regenerate the specs and templates,
   in a PR. A later deploy then cannot lose it.

Evidence so far (2026-11-06, not yet measured on this app): a third-party measurement
on App Platform saw `X-Forwarded-For: <client>,<Cloudflare edge>` with a private TCP
peer, which would mean **N = 2**. Express 5 with `trust proxy = 2` returns the client
for that chain even when the client forges an entry in front (unit test
`proxy-hop-probe.spec.ts`). That is the expected answer, and the reason to measure
rather than assume it.

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

## 3a. Restore a deleted or overwritten file (object storage)

The bucket keeps every deleted or overwritten object for **30 days**
(`backup-recovery.md` §1a). Restoring copies an old version back on top. It
needs a storage key with read and write on the bucket, held by an authorised
operator. Never paste the key into a ticket or a chat.

```bash
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…   # in your shell only
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
E=https://fra1.digitaloceanspaces.com B=<bucket>

# 1. Find the object's key. It is in Postgres (e.g. chat.message_attachment.object_key),
#    never guessed. Then list its versions:
aws --endpoint-url $E s3api list-object-versions --bucket $B --prefix '<object-key>' \
  --query '{versions: Versions[].[VersionId,LastModified,Size,IsLatest], deleted: DeleteMarkers[].[VersionId,LastModified,IsLatest]}'

# 2. Copy the version you want back. It becomes the current object again:
aws --endpoint-url $E s3api copy-object --bucket $B --key '<object-key>' \
  --copy-source "$B/<object-key>?versionId=<VersionId>"

# 3. Confirm:
aws --endpoint-url $E s3api head-object --bucket $B --key '<object-key>'
```

* **Restore only to the same key.** The API authorises by key and namespace.
  A file copied to a new key is unreferenced, and is never served.
* **Undoing a deletion of the database row** (a message deleted in the app) is
  a database restore, not this. Restoring the bytes alone brings back nothing
  the app can show.
* **A file an admin deliberately deleted** (moderation, a privacy request) must
  not be restored without the same authority that ordered the deletion. To
  make such a deletion permanent before 30 days, delete each version by
  `--version-id`. Record why.
* This exact procedure (delete, find the version, copy back, compare bytes) is
  what `scripts/infra/storage-versioning.sh --verify-expiry start` drills on
  the `_lifecycle-probe/` prefix.

## 4. Restart a service

```bash
doctl apps restart <app-id> --components api --wait     # or: worker, admin-web
```

Restarting is safe: `SIGTERM` triggers graceful shutdown — stop accepting work,
finish in flight within `SHUTDOWN_GRACE_MS` (15s), then exit. The hard-stop timer
means a stuck connection cannot hold a deployment open indefinitely.

Never restart the API to "fix" a database problem. Check `/health/ready` first:
if it reports the database down, restarting only moves the outage.

## 5. Logs

```bash
doctl apps logs <app-id> api --follow --no-prefix        # or: worker, admin-web
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
