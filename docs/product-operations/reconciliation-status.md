# Release Reconciliation Status — Executed Evidence

**Owner:** AI #8 · **Date:** 2026-09-06 · **Mode:** driving reconciliation in dependency order
**Every result below was executed, not inferred.** Commands and outputs are reproducible.

**Runtime used:** stock `postgres:16-alpine` + `redis:7-alpine`, isolated containers
(`jawwid-rt-pg` :55499, `jawwid-rt-redis` :56399), scratchpad copies of the migration series.
No Supabase. No Core shim. No fixture.

---

## P0-1 · CF-09 Core decoupling — **RESOLVED** ✅

AI #1 completed the decoupling between my pass-3 audit and this run.

| Check | Result |
|---|---|
| `auth.uid()` in any migration | **0 occurrences** (was 8) |
| `public.profiles / children / subscriptions / payments` | **0 occurrences** (was 5) |
| `pg_depend` rows referencing `public` or `auth` after full migration | **0** |
| `chat` views whose definition matches `(public\|auth)\.` | **0** |
| `chat` functions whose body matches `auth.uid` or a Core table | **0** |

The seven `chat.core_*` objects are now Chat-owned. **G-CORE-01, G-CORE-03: PASS.**

## P0-2 · NF-02 / RT-023 empty database — **RESOLVED** ✅

```
stock postgres:16-alpine, POSTGRES_DB=chat
  → 'no auth schema'   → '0 tables in public'
  → 19 migrations applied in order
  → RESULT: 0 failed
  → chat schema: 39 base tables · 7 views · 65 functions · 38 triggers · 23 RLS-enabled tables
```

**G-CORE-02: PASS.**

**One real finding (NF-05, P2).** On the first run `20260905091200_chat_rls.sql` failed with
`relation "chat.schema_migrations" does not exist`. That ledger table is created by
`scripts/db/apply.sh:26`, **not by a migration**, so the series is not self-contained: it
applies only through the runner. Either migration `0` should create the ledger, or CI's
G-CORE-02 must invoke `apply.sh`. With the ledger present, 19/19 pass.

## P0-3 · RC-01 API boot — **RESOLVED** ✅

`apps/api/src/main.ts` and `app.module.ts` now exist.

| Step | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** (clean) |
| `npm run build` | **PASS** — `dist/main.js` emitted |
| `node dist/main.js` against the clean DB | **listening on :3999** |
| `GET /health/live` | **200** `{"status":"ok"}` |
| `GET /health/ready` | **200** `database up 9ms · redis up 17ms` |
| `GET /health` | **200** |
| Routes mapped | **34** (conversations, messages, approvals, calls, notifications, health) |
| `SIGTERM` | **graceful** — process exited, port released |

## P0-4 · RT-024 BR-1 structural bypass — **FIXED, adversarially verified** ✅

`chat.enforce_conversation_type_immutable()` makes `conversation.type` immutable. Executed
against live data (a legal `student_group` holding teacher + parent + admin):

| Attack | Result |
|---|---|
| `UPDATE conversation SET type='direct'` | **REFUSED** — `BR-1 violation: a conversation containing a teacher and a family contact may not become a direct conversation` |
| Remove the admin member, **then** promote to `direct` | **REFUSED** — same exception |
| Create a `direct` conversation, then add teacher **and** parent | **REFUSED** — `BR-1 violation: a direct conversation may never contain both a teacher and a family contact` |

Both triggers present: `conversation_member_br1`, `conversation_type_immutable`,
plus `call_participant_br1` on `call_participant`.

**Not yet verified:** the calling half of RT-024 (a group call promoted to direct). My test
was malformed — `chat.call.initiator_id` is NOT NULL and I omitted it. **UNVERIFIED**, not passed.

## P0-5 · RT-005 / RT-007 / RT-008 — **NOT RE-RUN this pass**

Deferred behind P0-4. Last known: RT-007's own suite red while named "(fixed)".
**Status unchanged: OPEN.**

## P0-6 · CF-08 teacher identity — **PARTIALLY ADDRESSED**

`20260905090050_chat_identity.sql` introduces `chat.account`. Whether it makes a teacher a
first-class, independently-deactivatable actor is **UNVERIFIED — not yet read**. CF-08 remains
open pending that review and OD-04.

## P0-7 · RT-025 / OD-03 admin presence — **RULE NOW ANSWERED BY THE PRD; DEFECT CONFIRMED OPEN**

**PRD v0.1 landed** (`62ff312`, `docs/product/jawwid-chat-prd-v0.1.md`) — the single highest-leverage
fix in this audit, and it answers the base invariant. **§7.3:** *"One official Student Group per
student, created automatically from Jawwid Core relationships: the parent, every assigned
teacher, **and the family's primary owner**."* **§5:** *"Inside the Student Group; admin present."*

> **INV-RT025 (from the PRD, not invented)** — every live `student_group` contains the
> family's primary owner as a live member.

**Executed, and the defect is confirmed:**

| Test | Result |
|---|---|
| Create `student_group` with teacher + parent, **no admin** | **SUCCEEDED** — `admin_members=0 live_members=2` |
| Remove the admin from a compliant group | **SUCCEEDED** — `admin_members=0` |

Teacher↔parent communication is therefore possible in a group with no admin present, which
defeats BR-1's premise. **RT-025: CONFIRMED OPEN.**

### The one residual product decision — PRD §15.2 open question 4

The PRD itself leaves exactly one sub-question open, and it does **not** block INV-RT025:

> **Should coverage admins be permanent silent members of every Student Group, or join only
> during their coverage window?**

That is the smallest possible decision question. **Not guessed here.**

---

## Real HTTP E2E — **PARTIAL, and it found the important defect**

| # | Test | Result |
|---|---|---|
| 1 | `GET /api/v1/conversations` as staff | **200**, real conversation returned |
| 2 | `POST /conversations/:id/messages` as parent | **500 Internal Server Error** ❌ |
| 3 | Same `clientMessageId` again (idempotency) | **500** — untestable |
| 4 | `GET /conversations/:id/messages` as staff | **200** `{"messages":[]}` |
| 5 | Unknown actor reads the conversation | **401** `COMM.UNKNOWN_ACTOR` ✅ |
| 6 | Rows in `chat.message` | **0** |

### NF-06 (P0) · The message send path fails at runtime

`PrismaClientKnownRequestError P2003` — *foreign key constraint violated* — at
`tx.message.create()` (`message.service.js:96`), `meta: { modelName: 'Message', constraint: null }`.

**Isolated to the client layer, not the schema:** the *same row* inserted by raw SQL into
`chat.message` **succeeds**. This is DA-2 territory — the legacy `thread` relation surviving
alongside `conversation` on the write path (`threadId: conv.threadId`). **AI #2 to diagnose.**

### NF-07 (P1) · Unmapped Prisma errors surface as untyped 500s

The failure returned `{"statusCode":500,"message":"Internal server error"}` rather than the
engine's `{error:{code,message}}` shape. `CommErrorFilter` is registered globally but does not
map `PrismaClientKnownRequestError`. Related to AI #9's RT-017.

### NF-08 (P0) · **There is no authentication**

`apps/api/src/communication/api/actor.decorator.ts:14`:
```ts
return String(request.headers['x-actor-id'] ?? '');
```
No `CanActivate`, no `AuthGuard`, no `@UseGuards`, no login route exists anywhere in
`apps/api/src`. **Any client may claim any actor identity by setting a header.** This is the
HTTP twin of AI #9's RT-001 (the WebSocket equivalent).

The decorator is honestly labelled as a seam, and the 401 in test 5 shows the identity
*resolution* path works. But **item 4 of the reconciliation order — "authenticate, obtain valid
session/token" — is NOT EXECUTABLE**: there is nothing to authenticate against.

---

## Realtime — **NOT TESTED**

Blocked on NF-06: no message can be created, so no outbox row, no worker publish, no socket
delivery. The gateway registers and Redis connects; the end-to-end path is **UNVERIFIED**.

## Status by environment

| Environment | Status | Basis |
|---|---|---|
| **LOCAL RUNTIME** | 🟠 **PARTIAL** | migrations, boot, health, GET, authz denial and BR-1 all verified; **send path broken**, no auth, realtime untested |
| **STAGING RUNTIME** | 🔴 **NOT ESTABLISHED** | never deployed; no staging evidence exists |
| **PRODUCTION READINESS** | 🔴 **NOT READY** | NF-08 alone disqualifies it |

## Cleanup

Containers `jawwid-rt-pg`, `jawwid-rt-redis`, `jawwid-cleandb-ai8` and the API process on :3999
are AI #8's. They are disposable and hold no work.
