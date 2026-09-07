> **STATUS: HISTORICAL** (Phase 0, 2026-09-07). Parallel-agent reconciliation record recovered in Phase 0. Decisions it fed are consolidated under `docs/product`, `docs/architecture`, `docs/contracts`, `docs/security` and `docs/recovery`.
> Canonical index: `docs/README.md`.

# Authentication & Identity — Current State

**Owner:** AI #8 · **Date:** 2026-09-06 · **Type:** evidence / reconciliation. **No implementation.**
**Reconciled against:** `d236ce3` (`feat/infrastructure`, the integration branch) and every
peer branch reachable at that moment.

> **Authentication is NOT complete.** On the integration branch it is not started: the HTTP
> and WebSocket surfaces both trust a client-supplied identity today.

---

## 0. The single most important fact

**`80765dc` — the AI #8 commit that closed NF-08, NF-06, RT-025 and the RT-024 calling
bypass — is NOT reachable from HEAD.**

```
git merge-base --is-ancestor 80765dc HEAD   → false
git log --oneline -1 80765dc                → exists, on fix/ai8-p0-blockers only
```

Every "fixed" claim in the previous AI #8 report describes `fix/ai8-p0-blockers`, **not the
integration branch**. On `d236ce3`:

| Previously reported fixed | State on the integration branch |
|---|---|
| NF-08 `x-actor-id` spoofing closed | **STILL OPEN** — `apps/api/src/communication/api/actor.decorator.ts:14` returns `request.headers['x-actor-id']` |
| NF-06 message send | **STILL OPEN** — the author trigger fix is not present |
| RT-025 group owner presence | **STILL OPEN** — the constraint triggers are not present |
| RT-024 calling bypass | **STILL OPEN** — `call_type_immutable` is not present |

Nothing was lost — the branch and its commit are intact — but **nothing was gained on the
integration branch either.** This is the first blocker: work verified on an isolated branch
is not work in the release candidate.

---

## 1. Current authentication implementation (integration branch)

| Surface | Mechanism | Evidence |
|---|---|---|
| HTTP actor identity | **client-supplied header, unverified** | `actor.decorator.ts:14` — `String(request.headers['x-actor-id'] ?? '')` |
| WebSocket actor identity | **client-supplied handshake field, unverified** | `realtime.gateway.ts:57` — `String(client.handshake.auth?.actorId ?? '')`, with the file's own comment *"AI #1 SEAM: replace with verification of the real auth token"* |
| Guard / `CanActivate` | **none** | no `@UseGuards`, no `APP_GUARD`, no `CanActivate` in `apps/api/src` |
| Login route | **none** | no `/auth/login` in `apps/api/src` |
| Refresh route | **none** | — |
| `/me` route | **none** | — |
| Logout route | **none** | — |
| Session table | **none** | no session or device-session table in the 19 migrations on HEAD |
| Credential table | **none** | and correctly so — see §4 |
| JWT verification | **none on HEAD** | exists only on `fix/ai8-p0-blockers` (`src/platform/auth/access-token.ts`, HS256 on `node:crypto`) |

`chat.account` (migration `20260905090050`) is present and is the right foundation:
`subject` (opaque IdP subject) · `kind` · `is_active`, with `chat.staff.account_id` and
`chat.contact.account_id`, plus `chat.current_subject()` / `chat.current_account_id()`.
**The table exists; nothing authenticates against it.**

## 2. What is actually verified

| Claim | Status | Where proven |
|---|---|---|
| Core→Chat **webhook** HMAC | verified by peers | **§2A only.** See the warning below |
| Bearer token verification (HS256, `alg=none` and substitution rejected, `timingSafeEqual`, no dev-fallback secret) | **verified on `fix/ai8-p0-blockers`** | 13 unit tests in `test/unit/auth/nf008-authentication.spec.ts` |
| `x-actor-id` spoofing rejected | **verified on `fix/ai8-p0-blockers` only** | same suite + live 401s |
| Message send / idempotency / outbox persistence | **verified on `fix/ai8-p0-blockers` only** | live HTTP: `201`, repeat → same id, 1 row, 2 outbox rows |
| BR-1 · RT-024 · RT-025 | **verified on `fix/ai8-p0-blockers` only** | 10 adversarial SQL assertions |
| Empty-DB migrations, API boot, graceful SIGTERM | verified | 22/22, `/health/ready` db+redis up |
| **Real WebSocket delivery to a connected client** | **NOT VERIFIED** | §9 |

> ### ⚠️ The HMAC boundary is not user authentication
> The Core→Chat webhook HMAC authenticates **a server calling Chat**. It says nothing about
> parents, teachers, admins, coverage admins, managers or a super admin. It must never be
> cited as evidence that user authentication exists. These are two unrelated trust
> boundaries, and only the first one is built.

## 3. Login / token issuance status

**NOT IMPLEMENTED, and correctly blocked.**

The previous report's claim — *"token verification works; minting needs a credential model and
stays with AI #1"* — is **confirmed accurate**. Required chain and what exists:

```
POST /auth/login                     ✗ no route
  → credential verification          ✗ NO OWNER DECIDED  (§4 — the blocker)
  → authenticated account            ✓ chat.account exists
  → session                          ✗ no session table, no revocation
  → access JWT                       ✓ verification exists (unintegrated); no issuer
  → refresh token                    ✗ nothing
/me                                  ✗ no route
```

Four of six links are absent, and the second is blocked on a decision, not on effort.

## 4. Credential ownership status — **OPEN. Option B is NOT authorized.**

Searched for concrete evidence in current Core contracts, code and docs.

| Evidence | Says |
|---|---|
| `docs/architecture/decisions.md:303` | *"Credentials live in the identity provider."* |
| `docs/architecture/backend-contract.md:307` | *"verifying tokens is the identity provider's job and is not built here"* |
| `docs/architecture/core-integration-contract.md:42` | *"PRD §15.2 open question 1 (Core's stack and authentication scheme) is still [open]"* |
| PRD §7.1 | *"Sign-in with username and password provisioned from Jawwid Core. No self-registration."* |
| PRD §15.2 Q1 | Core's *"authentication scheme, how users and roles are modelled"* — **still an open question** |

**Reading.** The repository has decided that Chat does **not** store credentials, which rules
out **Option B**. It has *not* decided whether the identity provider is Jawwid Core itself
(**Option A**), or a separate IdP that Core provisions into while Chat owns sessions
(**Option C**). The phrase *"the identity provider"* is used consistently without ever naming
one, and the PRD question that would name it is open.

**Therefore: credential ownership remains OPEN.** Per instruction, no `chat.credential` and no
password store is proposed or created. PRD §7.1's *"provisioned from Jawwid Core"* leans
toward A or C but is not sufficient evidence to choose, and choosing by implementation
convenience is exactly what the gate forbids.

**No "Authentication Decision Gate" document exists in the repository.** Searched the working
tree and all reachable history; the branch `docs/auth-decision-gate` currently points at
`d236ce3` with no distinct content. This is the same failure mode that produced the original
scope divergence: a governing artifact referenced but not on disk.

## 5. Teacher identity status — **the canonical path is 80% built and unmerged**

| Link in the chain | State | Evidence |
|---|---|---|
| Core teacher identity | contract exists | `feat/core-integration-boundary` |
| **Chat teacher identity** | **BUILT, UNMERGED** | `chat.teacher` in `20260905094000_chat_core_mirror.sql` on `feat/core-integration-boundary`: `core_teacher_id` unique, `account_id uuid unique references chat.account`, `is_active`, `deactivated_at`, `core_synced_at` |
| `chat.account` accepts a teacher | **BLOCKED** | `check (kind in ('staff','family'))` — unchanged on **every** branch |
| subject → authenticated actor | blocked by the above | provisioning functions insert only `'family'` and `'staff'` accounts |
| Teacher App authenticates | **NO** | and no login route exists for anyone |

**`ActorKind` already contains `TEACHER`** (`contracts/vocab.ts:12`) while the database cannot
create a teacher account. Code and schema disagree.

**This is now a one-line schema decision, not a design problem.** `chat.teacher.account_id`
already models exactly the canonical path. The blocker is that `chat.account.kind` does not
admit `'teacher'`.

**C-1 requires a product/schema decision:** *is a teacher's account kind `'teacher'`, or is it
`'staff'` with the teacher distinguished by `chat.teacher`?* Both are defensible; the first
matches `ActorKind`, the second avoids widening a CHECK that RLS policies key on. **Not chosen
here.** Nothing invented: no fake subjects, no synthetic accounts, no hardcoded identity, and
the `learner.teacher_id` scan in `identity.service.ts` is recorded as the defect it is, not
adopted.

## 6. Role vocabulary status — **divergent from the PRD**

| PRD canonical | In `chat.staff.role` / `StaffRole` | Status |
|---|---|---|
| parent | `chat.contact` (not a staff role) | ✓ modelled separately |
| student | `chat.learner`, no login (PRD §3) | ✓ correct |
| teacher | — | ✗ not a staff role; `chat.teacher` unmerged (§5) |
| admin | `admin` | ✓ |
| **coverage_admin** | `coverage` | ⚠️ **named `coverage`, not `coverage_admin`** |
| manager | `manager` | ✓ |
| **super_admin** | — | ✗ **absent** |
| — | `finance`, `technical`, `academic` | ⚠️ still present as RBAC roles |

Two findings:

- **`super_admin` does not exist** anywhere. Whether it should is unresolved — `domain.ts`
  and `terminology.md` explicitly reject it, this gate's instruction lists it as canonical.
  Recorded as an open decision (previously OD-06), **not resolved here**.
- **`finance` / `technical` / `academic` are still RBAC roles.** Per instruction they are not
  deleted: they carry a real operational concept (department task ownership; they may never
  message families, and `FAMILY_FACING_STAFF_ROLES` correctly excludes them). The question is
  whether they belong in the *identity role* vocabulary or in a separate department
  assignment. **Open; no change proposed.**

## 7. `organization_id` status — **LANDED, UNMERGED**

`ai4/p1-canonical-foundation` (`f9f3eca`) adds
`supabase/migrations/20260906120000_chat_organization.sql`: a `chat.organization` table and a
loop that adds `organization_id` to every root entity with a default, `NOT NULL`, and a
foreign key, plus a parent-organization consistency trigger.

**Not on HEAD, not on `feat/backend-foundation`, not on `feat/core-integration-boundary`.**

Per instruction: **not implemented in this gate.** Because it *is* built and merely unmerged,
it is a **merge-ordering blocker**, not a schema-foundation blocker — but it is load-bearing:
it rewrites every root table, so it must land **before** any further identity or session
schema, or that schema will need the same rewrite afterwards.

Tenant isolation tests: **not verified by AI #8** (the branch is unmerged and was not executed).

## 8. WebSocket authentication status — **NOT IMPLEMENTED**

`realtime.gateway.ts:57` takes `client.handshake.auth?.actorId` and passes it straight to
`identity.resolveActor`. Any client may connect as any actor. This is AI #9's **RT-001** and
it is the socket twin of NF-08.

The four properties this gate requires are all **unproven**:

| Requirement | Status |
|---|---|
| authenticated socket identity equals HTTP identity | ✗ neither surface is authenticated on HEAD |
| revoked session disconnects the socket | ✗ no session concept exists |
| room membership cannot be spoofed | ✗ the actor is spoofable, so rooms are |
| worker failure cannot mark delivery successful | ✗ on HEAD — **see §9** |

## 9. Realtime delivery status — **NOT VERIFIED, and a delivery defect is on record**

The required chain (authenticated client → message → outbox → worker → transport → connected
client receives `message.created`) has **never been executed end to end by AI #8**. Verified
so far: outbox rows are *written* (`message.created`, `conversation.updated`). Nothing beyond.

**AI #7 found the defect this gate warned about.** `feat/ai7-runtime-fixes` (`4b2d3a5`):

> `RealtimeGateway.toThread()` emits with `this.server?.to(...)`. The standalone worker runs on
> `createApplicationContext` and has no Socket.IO server, so `server` was undefined and the
> optional chain turned every emit into a silent no-op. `OutboxWorker.drain()` claims the row
> as `published` first and reverts it only when `publish()` **throws** — and a no-op does not
> throw. **Every realtime event was recorded as delivered and delivered to nobody.**

This is precisely *"worker failure cannot mark delivery successful"*, and it confirms that
outbox rows marked `published` are **not** evidence of delivery. The fix is unmerged.

## 10. Flutter authentication contract

`lib/core/data/http/unavailable_auth_repository.dart` — every method throws a terminal
`AppError` with code `auth_contract_not_published`, deliberately, *"so the gap is loud and
specific rather than papered over."* The five routes it requires:

1. **Login** — username + password → access token + refresh token + expiries, with
   **distinguishable** failures for bad credentials / disabled / locked (the app reacts
   differently to each; one generic 401 collapses that).
2. **Refresh** — refresh token → new access token.
3. **`/me`** — stable actor id, display name, avatar, **server-asserted role**
   (`parent` | `teacher`). *"The app must never infer a role."*
4. **Logout** — server-side invalidation.
5. **Device/session registry** — register device + push token, list sessions, revoke one,
   revocation observable to the client.

Token delivery: **bearer**, stored in `lib/core/storage/secure_token_store.dart`.
Socket auth: not yet defined client-side. Current actor seam: `lib/core/network/actor_identity.dart`
sends `x-actor-id`, used only for local bring-up (`lib/app/bootstrap.dart:56`).

## 11. Admin Web authentication contract

`apps/admin-web/src/core/api/client.ts:49` sets **`credentials: 'include'`** — a **cookie
session**, not a bearer token. `SessionProvider.tsx` expects `sessionApi.me()`, a `logout()`,
and treats **a 401 from anywhere as end-of-session**, clearing every cached page.
`LoginPage.tsx` exists. No refresh mechanism is expressed client-side (a cookie session
implies server-side refresh).

### The divergence

| | Admin Web | Flutter |
|---|---|---|
| Transport | **cookie session** (`credentials: 'include'`) | **bearer** access + refresh |
| Refresh | implicit/server-side | explicit refresh route |
| Role source | `/me` | `/me`, server-asserted |
| 401 handling | ends session globally | terminal error |

**Two clients expect two different authentication transports, and the backend implements
neither.** This must be reconciled *before* login is built, or one client will be rewritten
afterwards. Both are legitimate (cookies for a browser, bearer for mobile); a single backend
can serve both, but that must be an explicit decision.

---

## 12. Exact blockers

| # | Blocker | Owner | Severity |
|---|---|---|---|
| **AB-1** | `80765dc` is unmerged; NF-08, NF-06, RT-025 and the RT-024 calling bypass are **all still open on the integration branch** | AI #10 | **P0** |
| **AB-2** | Credential-verification ownership undecided (§4). Blocks `/auth/login` entirely | product owner + AI #1 | **P0** |
| **AB-3** | `chat.account.kind` does not admit a teacher, so no teacher can authenticate (§5) | AI #1 + product | **P0** |
| **AB-4** | WebSocket identity is client-supplied (RT-001) | AI #1/#2 | **P0** |
| **AB-5** | Realtime delivery unproven; the D-2 fix proving outbox-published ≠ delivered is unmerged (§9) | AI #7 → AI #10 | **P0** |
| **AB-6** | Admin (cookie) and Flutter (bearer) expect different transports (§11) | product + AI #1 | **P1** |
| **AB-7** | No session/device registry, so no revocation — PRD §7.1 requires *"a disabled user loses all sessions within seconds"* | AI #1 | **P1** |
| **AB-8** | `organization_id` built but unmerged; it rewrites every root table (§7) | AI #10 | **P1 (ordering)** |
| **AB-9** | Role vocabulary diverges: no `super_admin`, `coverage` vs `coverage_admin`, legacy department roles in the RBAC enum (§6) | product owner | **P2** |
| **AB-10** | The "Authentication Decision Gate" is not on disk (§4) | product owner | **P1** |

## 13. Exact decisions required

| # | Decision | Minimum question |
|---|---|---|
| **AD-1** | Credential verification owner | *Does Jawwid Core expose (or can it expose) an endpoint that verifies a username and password and returns an identity assertion — yes or no?* A "no" selects Option B and authorises a Chat credential store; a "yes" selects A or C. **Everything in §3 is blocked on this one answer.** |
| **AD-2** | Teacher account kind | *Is a teacher's `chat.account.kind` `'teacher'`, or `'staff'` with `chat.teacher` distinguishing them?* |
| **AD-3** | Auth transport | *Cookie session for Admin Web and bearer for mobile from one backend, or one transport for both?* |
| **AD-4** | Session model | *Is a session a database row (revocable, per PRD §7.1) or a stateless short JWT plus a refresh-token table?* PRD's "disabled user loses all sessions within seconds" implies server-side state. |
| **AD-5** | Role vocabulary | *Do `super_admin` and the rename `coverage` → `coverage_admin` exist? Do `finance`/`technical`/`academic` stay identity roles or become department assignments?* |

## 14. Recommended implementation order

Strict dependency order. **Nothing below starts before the step above is verified.**

1. **Merge `80765dc` and the peer fixes into the integration branch** (AB-1, AB-5, AB-8).
   Until this happens the release candidate has no authentication at all and every earlier
   verification describes branches nobody is shipping. AI #10 owns sequencing; `organization_id`
   should land in this wave because it rewrites every root table.
2. **Answer AD-1.** One question, and `/auth/login` is blocked on it alone.
3. **Answer AD-2, AD-3, AD-4** — cheap once AD-1 is settled, and each is a one-line answer
   that determines a schema.
4. **Teacher identity** — merge `chat.teacher`, widen `chat.account.kind` per AD-2, replace
   the `learner.teacher_id` scan in `identity.service.ts`.
5. **Session + login + refresh + `/me` + logout**, per AD-1/AD-3/AD-4, with the
   distinguishable failure modes Flutter requires.
6. **WebSocket authentication** (AB-4) — reuse the HTTP verification path so socket identity
   is provably the same identity; then prove revocation disconnects a live socket.
7. **Realtime end-to-end proof** (AB-5) — authenticated client receives `message.created`,
   an unauthorised client receives nothing, and a worker failure never marks delivery
   successful.
8. **Device/session registry** (AB-7), then client integration.

**Role vocabulary (AD-5) can proceed in parallel** — it touches no other step.

---

## Scope statement

No implementation, no migration, no credential table, no session table, no client change, and
no change to BR-1, RT-024, RT-025, the message-author trigger, idempotency, the Core HMAC
boundary or `AuthorizationService`. No regression was found in any of those on the integration
branch — they are simply **absent from it**, which §0 records. PRD v0.1 was not modified.
