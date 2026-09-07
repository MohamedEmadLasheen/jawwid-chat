> **STATUS: HISTORICAL** (Phase 0, 2026-09-07). Parallel-agent reconciliation record recovered in Phase 0. Decisions it fed are consolidated under `docs/product`, `docs/architecture`, `docs/contracts`, `docs/security` and `docs/recovery`.
> Canonical index: `docs/README.md`.

# Authentication Decision Gate

Owner: AI #9 (Red Team) · 2026-09-06 · Status: **DECISION REQUIRED — implementation blocked**
Base commit: `d236ce3` · Blocks: **RT-001** (the last P0)

This is a decision document. It contains **no implementation, no migration, no
schema, no guard and no client change.** Its purpose is to stop one open product
question from being silently answered by whoever writes the code first.

The question is: **who verifies a password?** PRD §7.1 says credentials are
*"provisioned from Jawwid Core"*. It does not say Core *verifies* them, and PRD
§15.2 open question 1 lists Jawwid Core's *"authentication scheme"* as unknown.
Choosing wrong is expensive in both directions, and the choice is not the
implementer's to make.

---

## 1 · Evidence found

Every line below is from the repository. Nothing is inferred from a variable
name; `CORE_BASE_URL`, `CORE_API_KEY` and `CORE_WEBHOOK_SECRET` are declared in
`.env.example` and **read by no code**, so they are evidence of intent, not of
capability.

### 1.1 What the PRD states

| Ref | Statement |
|---|---|
| §7.1 | "Sign-in with username and password provisioned from Jawwid Core. No self-registration. Accounts are created, activated and disabled from the admin panel or by sync." |
| §7.1 | "Each session is bound to a device record… admins can revoke any session; a disabled user loses all sessions within seconds." |
| §7.1 | "Rate limiting and lockout on failed sign-ins; short-lived access tokens with rotating refresh tokens." |
| §6 | User → **"Jawwid Core for identity; Chat for devices and sessions."** |
| §12.4 | "**Preferred:** Jawwid Core exposes an API and change webhooks. **If not**, the integration service polls or consumes a read replica…" |
| §15.2 Q1 | Open for M0: "Jawwid Core: technology stack, database, existing API or the possibility of adding one, **authentication scheme**, how users and roles are modelled." |

§12.4's "if not" and §15.2's open question are the load-bearing facts: **the PRD
itself does not assert that Core has an API at all.**

### 1.2 What the repository contains

| Evidence | Location |
|---|---|
| `chat.account (id, subject unique, kind ∈ {staff,family}, is_active)` — **no credential column** | `20260905090050_chat_identity.sql:14` |
| "`subject` is the opaque identifier the identity provider puts in the token's `sub` claim; **credentials and contact details live there, not here**" | same file, header |
| `chat.current_subject()` reads `chat.actor_subject` (GUC) **or** `request.jwt.claims ->> 'sub'` | `20260905090050_chat_identity.sql:43` |
| `chat.current_account_id()` → `chat.current_staff_id()` → RLS policies | `090050`, `090700`, `091200` |
| `chat.link_staff_account(staff_id, subject)` / `chat.link_contact_account(contact_id, subject)` exist and **have no caller in any application code** | `20260905090900:314,330` |
| The Core ingestion contract: `record_core_event`, `ingest_core_parent`, `ingest_core_learner`, `ingest_core_subscription`, `assign_family_owner`, `record_sync_result` | `20260905090900` |
| `ingest_core_parent` payload fields: `core_parent_id`, `display_name`, `language` | ibid. — **no credential, no subject, no email** |
| `ingest_core_learner` payload fields: `core_child_id`, `core_parent_id`, `name`, `level`, `schedule_ref`, `next_class_at`, `last_attended_at`, `consecutive_absences` | ibid. — **no teacher field** |
| **No Core HTTP client exists.** `grep -rln "CORE_BASE_URL" apps/api/src lib apps/admin-web/src` → no match | — |
| No auth route, guard, token service, session or credential table anywhere | `grep -rln "CanActivate" apps/api/src` → empty |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL=15m`, `JWT_REFRESH_TTL=30d` declared; read by nothing; marked *"the auth design is AI #1's"* | `.env.example:69-75`, `docs/infrastructure/environment.md:96-102` |

### 1.3 Capability audit — the seven questions

| | Capability | Verdict | Evidence |
|---|---|---|---|
| **A** | Core verifies username/password over HTTP | **NO EVIDENCE** | No client, no endpoint, no contract document |
| **B** | Core exposes a token/login endpoint | **NO EVIDENCE** | ibid. |
| **C** | Core issues JWTs containing a stable `sub` | **NO EVIDENCE** | `chat.current_subject()` is *prepared* to read `request.jwt.claims->>'sub'`, but nothing states Core produces it. This is Chat's readiness, not Core's capability |
| **D** | Core exposes introspection | **NO EVIDENCE** | — |
| **E** | Core provisions credentials/hashes to Chat | **NO** — and contradicted | Ingest payloads carry `display_name` and `language` only; `chat.account`'s own comment forbids credential storage |
| **F** | Core provisions identity only; Chat must verify | **CONSISTENT with the evidence, but not asserted anywhere** | The ingestion contract provisions identity and nothing else |
| **G** | **None of the above is currently known** | ✅ **THIS IS THE ACTUAL STATE** | PRD §15.2 Q1 says so explicitly |

> **Finding CG-1 · The Core authentication capability is unknown, and the PRD
> says it is unknown.** Any implementation that assumes A–E is assuming a
> capability nobody has confirmed. F is the only option the repository's own
> contract can support today — but F is an *absence of contrary evidence*, not a
> confirmation, and adopting it silently would convert an open product question
> into a shipped architecture.

---

## 2 · Canonical identity chain

```
credential
  → authenticated principal
  → stable subject  (token `sub`)
  → chat.account.subject   [unique]
  → chat.account.id
  → chat.staff.account_id  |  chat.contact.account_id   [both unique/FK]
  → Chat actor (actorId, ActorKind, staffRole, familyId)
```

**The chain already exists in the database and needs no new table for staff or
family.** `chat.current_subject()` → `current_account_id()` → `current_staff_id()`
is already what the RLS policies are written against.

### 2.1 Per-role validity

| PRD role | Chain works? | Notes |
|---|---|---|
| **parent** | ✅ | `chat.contact.account_id` FK exists; `link_contact_account()` mints the account. No caller yet, but the contract is complete |
| **admin** | ✅ | `chat.staff.account_id` unique FK; `link_staff_account()` exists |
| **coverage_admin** | ⚠️ | Chain works. **Role name mismatch:** `chat.staff.role` CHECK is `admin/coverage/manager/finance/technical/academic`; the PRD says `coverage_admin`. Cosmetic to auth, visible in `/me` |
| **manager** | ✅ | — |
| **super_admin** | ❌ | **Not in the `staff.role` CHECK at all.** A super_admin cannot be represented, so cannot sign in as one |
| **student** | n/a | PRD §3: "no separate login in MVP". Correctly absent |
| **teacher** | ❌ | **Blocked — see §3** |

> **Finding CG-2 · `super_admin` is unrepresentable.** `staff.role` has no such
> value. Not an auth defect, but it lands the moment `/me` returns a role, and it
> is AI #1's vocabulary to fix.

---

## 3 · Teacher identity gap — **CONTRACT BLOCKER**

This is the most serious finding in this document, and it is not a Chat defect.

**What exists.** `chat.learner.teacher_id uuid` — no FK, no table behind it.
`identity.service.ts` resolves a teacher by scanning `chat.learner` for a row
whose `teacher_id` equals the caller-supplied id, and returns a hardcoded
`displayName: 'Teacher'`.

**Why it cannot be fixed inside Chat.** AI #1 recorded the reason in the schema
itself:

> `comment on column chat.learner.teacher_id is`
> `'Carried from the brief SS3. Jawwid Core has no teacher entity today (its own`
> `PRD lists live classes as a V1 non-goal), so this stays null until Core`
> `gains one. Nothing in the attention or coverage engines reads it.'`
> — `20260905090300_chat_family_domain.sql:117`

Confirmed independently: the Core integration migration contains **no teacher
reference of any kind** — no `ingest_core_teacher`, and `ingest_core_learner`'s
payload has no teacher field. `chat.learner.teacher_id` is therefore **never
populated by any code path in this repository**, so the teacher branch of
`resolveActor` can never match in a real environment.

**What is missing, exactly, to make the chain possible:**

| # | Missing item | Owner |
|---|---|---|
| T-1 | A **teacher entity in Jawwid Core**, with a stable external identifier | **Jawwid Core** — product/contract |
| T-2 | That identifier carried in the Core→Chat contract: an `ingest_core_teacher` payload, and a `core_teacher_id` field on the learner payload so assignment can be synced | **Jawwid Core + AI #1** |
| T-3 | A Chat-side teacher record with an `account_id` FK, so a teacher has a `chat.account` like every other actor | **AI #1** (this is QA correction C-1; **this document does not design it**) |
| T-4 | `chat.account.kind` extended to include `'teacher'`, or a documented decision that teachers are `kind='staff'` with a distinct role | **AI #1** |
| T-5 | A subject for that account, from whichever provider §5 selects | follows the credential decision |

> **Finding CG-3 · Teacher authentication is blocked on a Jawwid Core contract
> change, not on Chat work.** Until T-1 and T-2 exist, the Teacher mobile app
> cannot authenticate no matter what Chat builds. `docs/release/integration-matrix.md`
> I-3 already records this as **FAIL — "teacher cannot authenticate at all (JC-003)"**.
>
> **Release consequence:** either the Teacher app leaves MVP scope, or M1 waits on
> Core. That is a product decision and it is not made here.

---

## 4 · Credential ownership — A / B / C

### Option A · Core verifies username and password

Chat forwards credentials to Core; Core returns a subject or a token.

| | |
|---|---|
| **Runtime flow** | client → `POST /auth/login` → Chat → Core verify endpoint → subject → Chat creates session → Chat issues its own access+refresh → client |
| **Required Core capability** | **B and A** from §1.3 — a login/verify endpoint. **No evidence it exists.** |
| **Chat tables** | `chat.session` only. No credential store |
| **Security** | Best: Chat never holds or can leak a password. Single credential authority. Honours `chat.account`'s stated design |
| **Session/revocation** | Chat owns sessions, so revocation is fully Chat's — unaffected by Core |
| **Mobile** | No impact — receives Chat tokens either way |
| **Admin Web** | No impact |
| **WebSocket** | No impact — verifies Chat's own access token |
| **Core outage** | **Sign-in stops.** Existing sessions survive (refresh is Chat-local), so an outage degrades rather than locks out — *if* refresh does not re-check Core |
| **Migration** | `chat.session`. Nothing else |
| **Blocked by** | **CG-1.** Cannot be specified, let alone built, until Core's scheme is known |

### Option B · Chat verifies username and password

Core provisions the account; Chat stores a hash and verifies it.

| | |
|---|---|
| **Runtime flow** | client → `POST /auth/login` → Chat verifies Argon2id hash → session → tokens → client. Core is not in the path |
| **Required Core capability** | **None beyond the existing ingestion contract** — plus a way to deliver the initial password, which the PRD already answers: admin-set temporary password (§7.1) |
| **Chat tables** | `chat.session` **and** a credential store |
| **Security** | Chat becomes a password-breach target. Argon2id, lockout and rate limiting all become Chat's responsibility. **Directly contradicts `chat.account`'s stated design** ("credentials … live there, not here") |
| **Session/revocation** | Fully Chat-owned |
| **Mobile / Admin Web / WebSocket** | No impact |
| **Core outage** | **Sign-in unaffected.** Fully autonomous |
| **Migration** | `chat.session` + credential table + lockout counters. The privacy guard `no-contact-channel-columns.spec.ts` must be extended to cover the new table |
| **Blocked by** | Nothing technical. Blocked **politically**: it silently answers PRD §15.2 Q1 by making Chat the credential authority |

### Option C · Core issues an identity token; Chat manages sessions only

Core is an OIDC-style IdP. The client authenticates against Core and presents a
Core token to Chat; Chat exchanges it for its own session.

| | |
|---|---|
| **Runtime flow** | client → Core IdP → Core ID token (`sub`) → `POST /auth/exchange` → Chat validates signature/issuer/audience → maps `sub` → `chat.account` → session → Chat tokens |
| **Required Core capability** | **C and D** — JWTs with a stable `sub`, published keys (JWKS), and ideally introspection. **No evidence any of it exists.** |
| **Chat tables** | `chat.session` only |
| **Security** | Strongest. Chat never sees a password *or* forwards one. Exactly what `chat.account.subject` was designed for |
| **Session/revocation** | Chat owns sessions; Core owns credential lifecycle. Disabled-at-Core propagates via the existing sync → `account.is_active=false` → Chat revokes |
| **Mobile** | **Significant**: the app authenticates against Core, not Chat. `UnavailableAuthRepository` and the login screen both change shape |
| **Admin Web** | **Significant**: probable browser redirect flow instead of a form post |
| **WebSocket** | No impact |
| **Core outage** | **Sign-in stops** and may be harder to degrade gracefully |
| **Migration** | `chat.session` + JWKS cache/config |
| **Blocked by** | **CG-1**, most severely — needs the most from Core |

### 4.1 Recommendation

**Recommended: Option C as the target architecture; Option B as a
time-boxed fallback that may only be adopted by an explicit, recorded product
decision.**

The reasoning is ownership, not convenience:

1. **PRD §6 assigns identity to Core and sessions to Chat.** Option C is that
   sentence expressed as an architecture. Option B moves identity into Chat,
   which contradicts it. Option A splits the difference and still requires Core
   to expose an endpoint, so it carries C's dependency without C's benefit.
2. **The repository was built for C.** `chat.account.subject` is documented as
   the IdP's token subject; `chat.current_subject()` already reads
   `request.jwt.claims->>'sub'`; the account table deliberately has no credential
   column. Options A and B both leave that design half-used; B contradicts it.
3. **Option B is the only one implementable today** — and that is precisely why
   it must not be chosen by default. "It is the only one we can build this week"
   is a schedule argument, not an ownership argument, and the instruction for
   this gate was explicit that ease must not decide it.

**Therefore the recommendation is conditional, and the condition is a fact
nobody in this repository possesses:**

- **If Core can expose an OIDC-style token endpoint with a stable `sub`** →
  Option C. No Chat credential store, ever.
- **If Core can expose a verify-credentials endpoint but not tokens** → Option A.
- **If Core can expose neither, and this is confirmed in writing by whoever owns
  Core** → Option B, adopted as a recorded decision with an explicit migration
  path to C, and with the `chat.account` comment amended in the same change so
  the schema stops asserting something untrue.

**No option may be implemented until §15's questions are answered.**

---

## 5 · Username vs email

**Recommendation: `username`. Change Admin Web.**

Evidence that `email` is not canonical anywhere:

- **No `email` column exists in the `chat` schema.** (`information_schema` query: zero rows.)
- `chat.account`'s header explicitly forbids one: *"Adding an email column to this table would be the ordinary way to break phone/contact privacy… must not be added without a privacy review."*
- The Core ingestion payloads carry no email.
- `20260905093000` header: *"no table here has a phone, email or address column."*
- Flutter already models a username: `app_ar.arb` → `"usernameLabel": "اسم المستخدم"`, and `fake_repositories.dart` takes `username`.
- Admin Web's own login field is already `autoComplete="username"` — **only the API call names the parameter `email`** (`endpoints.ts:32`).

So the divergence is one word in one file, on the client, against a canonical
contract that says `username` everywhere else. **Do not accept both.** Accepting
`email` as an alias would make a non-canonical field look supported and would
invite an `email` column later, which the privacy guard exists to prevent.

*Change required (AI #4, at implementation time, not now):* rename the parameter
and local state in `endpoints.ts` and `LoginPage.tsx`. No visual change — the
field already says username.

---

## 6 · Security invariants — non-negotiable under every option

These hold whichever of A/B/C is chosen. They are the acceptance criteria for
RT-001 and must not be renegotiated during implementation.

| ID | Invariant |
|---|---|
| **AUTH-INV-1** | Actor identity derives **exclusively** from the verified authenticated principal. No `x-actor-id` header, no `actorId` in a body, query parameter, cookie, or WebSocket handshake field may influence actor selection |
| **AUTH-INV-2** | An unauthenticated API request has no actor and returns **401** — never 500, never a default actor. *(Today an unauthenticated request returns HTTP 500.)* |
| **AUTH-INV-3** | WebSocket identity comes from the same verified principal, and the same verifier, as HTTP |
| **AUTH-INV-4** | A disabled or revoked account cannot continue authenticated activity beyond the defined revocation window, **on every transport including established sockets** |
| **AUTH-INV-5** | No credential, token, password or hash material appears in logs, audit records, or error bodies |
| **AUTH-INV-6** | `AuthorizationService` and the BR-1 database backstop remain **unchanged** unless a specific incompatibility is proven and recorded |

---

## 7 · Session architecture — validated against PRD §7.1

**Chat owns sessions under all three options.** This is settled by PRD §6
("devices and sessions → Chat") and is not part of the open question.

| PRD §7.1 requirement | Chat-owned? | Note |
|---|---|---|
| Multi-device sign-in | ✅ | |
| Session bound to a device record | ✅ | `chat.device_token` exists but is a **push-token** table with no session linkage — it does not satisfy this |
| Users see and sign out their own devices | ✅ | |
| Admins revoke any session | ✅ | |
| Disabled user loses all sessions **within seconds** | ✅ | Requires a live revocation signal to sockets, not just token expiry |
| Rotating refresh tokens | ✅ | |
| Rate limiting and lockout | ✅ | Chat's edge under every option; under A/C the credential authority may also rate-limit |

> **Finding CG-4 · No session table exists**, and `chat.device_token` does not
> stand in for one. This is required under every option, so it is the one piece
> of work that is safe to specify before the credential decision — **but it is
> not implemented here, as instructed.**

---

## 8 · Impact if implementation proceeds (specification only)

### 8.1 Migration impact

| Under | Change |
|---|---|
| **All options** | New session table (device-bound, rotating refresh, revocation). Config keys for TTLs, lockout thresholds, re-verify interval — in `chat.config`, never inline |
| **All options** | A per-request mechanism to set `chat.actor_subject` so the existing RLS policies become live rather than inert |
| **Option B only** | Credential store; lockout counters; extension of `no-contact-channel-columns.spec.ts` to cover it |
| **Option C only** | JWKS/issuer/audience configuration |
| **Teacher (blocked)** | Whatever T-3/T-4 require — **AI #1's design, not specified here** |
| **Unchanged** | `AuthorizationService`, the BR-1 triggers, the RLS policy bodies, the communication matrix |

### 8.2 API contract impact

New: `POST /auth/login` (or `/auth/exchange` under C), `POST /auth/refresh`,
`POST /auth/logout`, `GET /me`, session list/revoke. Existing: `GET /me/duty`
already expected by Admin Web. `actor.decorator.ts` changes to read the
principal — a six-line change, because every controller already takes an
`actorId` and re-resolves it through `IdentityService`.

Mobile requires **distinguishable** failures — bad credentials vs disabled
account vs revoked session (`docs/mobile/backend-dependencies.md` C1). One
generic 401 collapses three different app behaviours and is a contract breach.

### 8.3 WebSocket impact

Token in `handshake.auth.token`, verified by the same verifier as HTTP;
`handshake.auth.actorId` deleted. Re-verification on an interval and a
revocation subscription — which also closes **RT-009** (a socket's `Actor` is
currently resolved once and cached for the connection's lifetime).

### 8.4 Admin Web impact

`username` instead of `email` (§5). Real `/auth/login`. Session transport
decision (cookie vs bearer) — `setUnauthenticatedHandler` already exists and
already clears the query cache on 401. Under Option C, a redirect flow instead
of a form post: **materially larger**.

### 8.5 Flutter impact

`AuthSession {accessToken, refreshToken, accessTokenExpiresAt}` and secure
storage are already built. `UnavailableAuthRepository` is replaced; the
`DebugActorHeaderIdentity` seam is deleted, not merely disabled. Under Option C,
the app authenticates against Core: **materially larger**.

---

## 9 · Implementation order — once, and only once, §15 is answered

1. **Product/Core answers §15.** Nothing below may start first.
2. **AI #1** — session table + `chat.actor_subject` per request.
3. **AI #1** — the chosen credential path behind a single verifier port.
4. **AI #1** — `AuthGuard` + `actor.decorator` rewrite, landed **in one commit**; removing the header before the guard exists breaks all six controllers.
5. **AI #2** — WebSocket handshake and revocation (closes RT-009).
6. **AI #5** — the twelve-test matrix, plus the protected-test manifest.
7. **AI #4 / AI #3** — clients, in parallel.
8. **AI #9** — re-attack RT-001 and its nearby variants.
9. **Teacher app** — waits on CG-3 regardless of everything above.

---

## 10 · What must be decided before implementation

| # | Decision | Owner | Blocks |
|---|---|---|---|
| **D-1** | **Does Jawwid Core expose an authentication capability, and which?** (§1.3 A–D). This is PRD §15.2 Q1, still open | Product + whoever owns Core | **Everything.** A/B/C cannot be chosen without it |
| **D-2** | If Core exposes nothing: is Chat authorised to become the credential authority, contradicting `chat.account`'s stated design? | Product | Option B |
| **D-3** | **Does Jawwid Core have a teacher entity, and will it expose a stable teacher identifier?** | Product + Core | Teacher app entirely (CG-3) |
| **D-4** | If not: does the Teacher app leave MVP, or does M1 wait for Core? | Product | Release scope |
| **D-5** | Teacher representation in Chat once D-3 is answered — `account.kind='teacher'` vs a role on staff (QA correction C-1) | AI #1 | Teacher auth |
| **D-6** | `staff.role` vocabulary: `coverage` vs PRD `coverage_admin`; **`super_admin` is absent entirely** (CG-2) | AI #1 + Product | `/me`, RBAC surface |
| **D-7** | Confirm `username` as canonical and change Admin Web (§5 recommends this; evidence is one-sided) | Product + AI #4 | Login contract |
| **D-8** | Session transport for Admin Web: HttpOnly cookie vs bearer | AI #1 + AI #4 | Guard implementation |
| **D-9** | Revocation window for AUTH-INV-4 — PRD says "within seconds"; the exact number is a config value nobody has set | Product + AI #1 | Socket re-verification |

**D-1 and D-3 are the two that matter.** Both are questions about Jawwid Core
that this repository cannot answer, and both were already open in the PRD before
this audit began.

---

## Appendix · How to re-run this audit

```bash
# Core capability — expect no matches
grep -rln "CORE_BASE_URL" apps/api/src lib apps/admin-web/src

# Teacher in the Core contract — expect no matches
grep -n "teacher" supabase/migrations/20260905090900_chat_core_integration.sql

# Ingestion payload fields actually accepted (union across all ingest functions;
# no credential, no subject, no teacher field appears in any of them)
grep -oE "p_payload ->> '[a-z_]+'" supabase/migrations/20260905090900_chat_core_integration.sql | sort -u
# Verified per-function at the time of writing:
#   ingest_core_parent       core_parent_id, display_name, language
#   ingest_core_learner      core_child_id, core_parent_id, name, level, schedule_ref,
#                            next_class_at, last_attended_at, consecutive_absences
#   ingest_core_subscription core_subscription_id, core_parent_id, plan, status,
#                            ends_at, renewal_due_at, last_payment_at, last_payment_status

# Email as canonical identity — expect zero rows
psql "$DATABASE_URL" -tAc "select table_name||'.'||column_name from information_schema.columns
  where table_schema='chat' and column_name ilike '%email%';"

# Auth surface in the API — expect empty
grep -rln "CanActivate" apps/api/src
```
