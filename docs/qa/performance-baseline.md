# Performance Baseline

Owner: Phase 8 · First measured: 2026-09-08
Harness: `apps/api/test/perf/baseline.perf.ts` — `npx jest --selectProjects perf`

Before this file, Jawwid Chat had **no performance measurement of any kind**.
Not a slow number: no number. This is the starting point, not a capacity
promise, and §1 exists so nobody quotes it as one.

---

## 1. Read this before quoting any number below

Every figure was measured on **one developer laptop** (Apple Silicon, macOS
15.2) against **PostgreSQL 17 in a local Docker container over loopback**, with:

- no network between the application and the database,
- no load balancer, no TLS termination, no reverse proxy,
- a single Node process, single-threaded,
- one tenant, an empty-ish database, and no competing traffic,
- the service graph driven **in-process** — no HTTP, no serialisation, no
  WebSocket.

A production topology differs on every one of those, in both directions: real
network latency makes each database round trip worse, while a database with more
than one core's worth of work to do and several application instances makes
aggregate throughput better.

So these are **measured**, they are **not estimates**, and they are **not
targets**. What they are good for is regression detection: "a message send cost
61 ms at the service layer on 2026-09-08" is a fact that can be re-measured
after a change.

| Label | Meaning |
|---|---|
| **measured** | Everything in §2 and §3. Produced by the harness above. |
| **estimated** | Nothing here. No extrapolation to production has been attempted, because a single-process loopback measurement does not support one. |
| **target** | Nothing here. Targets need a production topology and a traffic model; neither exists (BLOCKER-1). |

---

## 2. Service-layer latency — **measured** 2026-09-08

Driven through the real service graph against the real migrated schema, so a
message send performs everything it performs in production: authorization, the
on-duty check, the BR-1 database trigger, receipt rows and the outbox event.

| Scenario | n | p50 ms | p95 ms | p99 ms | max ms | ops/sec |
|---|---:|---:|---:|---:|---:|---:|
| message send (sequential, 1 actor) | 200 | 61.49 | 92.94 | 101.37 | 112.21 | 16.8 |
| message send (20 concurrent) | 200 | 129.62 | 254.52 | 417.38 | 465.04 | **84.5** |
| message history (page of 50) | 100 | 20.77 | 37.86 | 45.06 | 51.67 | 46.8 |
| unread count | 100 | 10.46 | 11.30 | 17.92 | 23.84 | 92.9 |
| conversation resolve + membership | 100 | 3.25 | 4.42 | 5.13 | 11.81 | 288.2 |
| login (verify + session issue) | 20 | 70.20 | 74.64 | 75.51 | 75.51 | 14.2 |
| action throttle check (added by Phase 8) | 200 | 1.50 | 2.83 | 3.31 | 3.54 | 597.0 |

### 2a. The concurrency curve — **measured 2026-09-08 (closure pass)**

Added in the closure pass, because the single 20-concurrent point above did not
say where the ceiling was. All four rows come from ONE session against ONE
database, so they are comparable with each other; they are not comparable with
§2, which was a different session.

`JAWWID_PERF_ITERATIONS=20 JAWWID_PERF_ROUNDS=5`, varying `JAWWID_PERF_CONCURRENCY`:

| concurrent senders | n | p50 ms | p95 ms | p99 ms | ops/sec |
|---:|---:|---:|---:|---:|---:|
| 10 | 50 | 88.7 | 234.9 | 284.6 | 63.4 |
| 20 | 100 | 209.0 | 515.9 | 595.3 | 47.2 |
| 50 | 250 | 406.9 | 939.2 | 1068.3 | 67.5 |
| 100 | 500 | 709.7 | 1474.8 | 1668.6 | 78.3 |

**This corrects an over-reading in the first version of this document.** That
version said "concurrency helps, which is the important result… a 5x gain",
comparing 20 concurrent against the *sequential* baseline. Measured across a
range, the real shape is different and more useful:

- **Throughput is flat.** It sits in a 47–78 ops/sec band across a tenfold
  increase in concurrency, with no trend — the ordering (47.2 at 20 being lower
  than 63.4 at 10) is run-to-run noise on a laptop, not a curve. Do not read
  meaning into the ordering; read the band.
- **Latency grows linearly.** p50 tracks roughly 7–8 ms × concurrent senders,
  monotonically, across every step. That signal is clean.

Flat throughput plus linearly rising latency is the signature of a **saturated**
service: the ceiling is already reached by about ten concurrent senders, and
concurrency beyond it buys queueing, not work. The 1→10 gain is real; the
implication that it continues is not.

So the honest statement is: **on this machine the message-send path tops out at
roughly 50–80 messages per second**, and that is a property of one Node process
against one local Postgres, not a capacity figure for a deployed system.

### What is worth noticing

**The Phase 8 rate limit costs 1.5 ms at p50.** That was a claim ("one indexed
upsert") until it was timed. It is ~2% of a message send.

**Login is slow on purpose.** 70 ms is argon2 doing its job. It is in this table
so that nobody later "optimises" it without understanding that the cost *is* the
feature.

---

## 3. Database work per operation — **measured** 2026-09-08

Postgres's own counters (`pg_stat_user_tables`), reset immediately before 201
message sends.

| Table | scans / send | rows inserted |
|---|---:|---:|
| conversation | 9.1 | — |
| family | 5.1 | — |
| conversation_member | 5.1 | — |
| staff | 5.0 | — |
| message | 3.0 | 201 |
| message_receipt | 3.0 | 201 |
| organization | 2.1 | — |
| account | 2.1 | — |
| account_permission_override | 2.0 | — |
| family_assignment | 1.0 | — |

**There is no N+1.** The decisive property is that every count above is
*constant per send* rather than proportional to the number of messages,
conversations or members already present. An N+1 shows up here as a per-send
figure that climbs as the table grows; none does.

**Indexes are being used.** Essentially all of this is `idx_scan`. Sequential
scans are in single digits *in total* across 201 sends — they come from setup,
not from the send path. A missing index on this path would show as `seq_scan`
climbing with row count, which is the failure mode that only appears in
production, and it is not present.

**The path is chatty, and that is the honest headline.** ~35 indexed lookups per
message, with `conversation` resolved about nine times and `family`, `staff` and
`conversation_member` about five times each within a single send. Each lookup is
sub-millisecond, so the effect is 61 ms rather than a hazard — but it is the
clearest available optimisation, and a request-scoped memo of the resolved
actor, conversation and membership would remove most of it.

**It is deliberately not done here.** It is an optimisation, not a defect;
nothing is failing; and Phase 8's rule is to prefer targeted fixes over
speculative rewrites of a path that eleven test suites depend on. It is recorded
as a measured opportunity with the evidence attached, which is what makes it
actionable later instead of a hunch.

---

## 4. What has NOT been measured — and must not be assumed

Stated plainly, because a baseline document otherwise implies coverage it does
not have.

| Not measured | Why | What it would take |
|---|---|---|
| **HTTP-layer latency** (p50/p95/p99 per endpoint) | The harness drives services in-process; there is no running API to point a load generator at | A deployed environment (BLOCKER-1) |
| **WebSocket concurrency** — connection count, reconnect storms, fan-out under load | Requires a running gateway and many real clients | Staging + a WS load tool |
| **Multi-instance realtime** | The Socket.IO Redis adapter is a declared dependency, never a demonstrated behaviour. Two instances without it deliver events to only one | Two API instances on staging. **RISK-4, still open** |
| **Broadcast fan-out at 100+ families** | Fan-out is queue work; measuring it needs a worker and a queue under load | Staging with the worker running |
| **Queue processing rate / depth under load** | Same | Same |
| **Connection-pool behaviour at the limit** | `DATABASE_POOL_MAX` is configured but exhaustion has never been driven | A load generator against a deployed instance |
| **Sustained and burst traffic over time** | Every run above is seconds long. Leaks, cache growth and pool drift appear over hours | A soak test on staging |
| **Database performance at realistic data volume** | The database held hundreds of rows, not years of messages. Query plans change with cardinality | Seed a production-sized dataset and re-run §3 |

The last row is the one most likely to surprise: **§3 proves there is no N+1 at
small scale, not that the plans stay good at large scale.** A planner that
chooses an index scan over 200 rows may choose differently over 20 million.
Re-running §3 against a production-sized dataset is the single highest-value
performance task remaining.

---

## 5. Re-measuring

```bash
scripts/db/integration-db.sh up

# The 2026-09-08 baseline in §2 (defaults: 200 iterations, 20 concurrent, 10 rounds)
cd apps/api && DATABASE_URL=... npx jest --selectProjects perf --runInBand

# Any other scale. Defaults reproduce §2 exactly, so an unparameterised run is
# still the same run.
JAWWID_PERF_ITERATIONS=20 \
JAWWID_PERF_CONCURRENCY=100 \
JAWWID_PERF_ROUNDS=5 \
  npx jest --selectProjects perf --runInBand -t "message send, N concurrent"
```

The harness prints the §2 table ready to paste. Record the machine alongside it:
a number without its conditions is not evidence.

`perf` is deliberately excluded from `npm test` and from CI. A timing assertion
on a shared runner is a flaky test, and a flaky test in a security pipeline is
one that gets disabled.
