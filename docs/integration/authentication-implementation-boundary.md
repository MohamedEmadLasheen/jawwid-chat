> **STATUS: HISTORICAL** (Phase 0, 2026-09-07). Parallel-agent reconciliation record recovered in Phase 0. Decisions it fed are consolidated under `docs/product`, `docs/architecture`, `docs/contracts`, `docs/security` and `docs/recovery`.
> Canonical index: `docs/README.md`.

# Authentication Implementation Boundary

Owner: AI #9 (Red Team) · 2026-09-06 · Base commit `d236ce3`
Companions: [`core-authentication-contract-request.md`](core-authentication-contract-request.md) ·
[`authentication-decision-gate.md`](authentication-decision-gate.md)

A one-page answer to "who is responsible for which half of authentication", and
an evidence-backed statement of what is actually built today.

**Verification rule for this document.** Every status below was checked against
the repository at `d236ce3`, and the check is cited. Anything not established by
an actual contract is marked `UNKNOWN — CORE DECISION REQUIRED`. No status here
rests on an assumption.

---

## 1 · Ownership

### Chat owns

| Responsibility | Basis |
|---|---|
| Device-bound sessions | PRD §6 "Chat for devices and sessions"; §7.1 "each session is bound to a device record" |
| Devices | PRD §7.1 |
| Refresh tokens and their rotation | PRD §7.1 "rotating refresh tokens" |
| Logout | PRD §7.1 |
| Session revocation (self-service and admin) | PRD §7.1 "admins can revoke any session" |
| The API authentication guard | Chat owns its own API surface |
| WebSocket authentication | Chat owns its own gateway |
| **Authorization** — the communication matrix, RBAC, BR-1 | PRD §12.5; `AuthorizationService` + the BR-1 database backstop |

### Core owns

| Responsibility | Basis |
|---|---|
| Authoritative identity | PRD §6 "Jawwid Core for identity" |
| Credential / authentication capability | PRD §7.1 "provisioned from Jawwid Core" |
| Authoritative user lifecycle (create, activate, disable) | PRD §7.1, §12.4 |
| Teacher identity, if and when a Teacher entity exists | PRD §12.4 synced entities |

### Unknown

Everything not established by an actual Core contract, specifically:

- Whether Core can verify credentials at all — `UNKNOWN — CORE DECISION REQUIRED`
- Whether Core issues tokens, and their format — `UNKNOWN — CORE DECISION REQUIRED`
- Whether Core owns **staff** identity, or another system does — `UNKNOWN — CORE DECISION REQUIRED`
- Whether Core has a Teacher entity — `UNKNOWN — CORE DECISION REQUIRED` (repository evidence points to no)
- The canonical username contract — `UNKNOWN — CORE DECISION REQUIRED`
- The disabled-user propagation mechanism and its latency — `UNKNOWN — CORE DECISION REQUIRED`
- The provisioning mechanism for staff and teachers — `UNKNOWN — CORE DECISION REQUIRED`

**The boundary is not negotiable by implementation convenience.** If Core cannot
supply something Chat needs, the answer is a recorded product decision, not Chat
quietly absorbing the responsibility.

---

## 2 · Current implementation status

> **Correction to the brief that requested this document.** The three items
> listed as GREEN — bearer token verification, verified actor resolution, and
> `x-actor-id` spoofing rejection — **do exist, but only on the unmerged branch
> `fix/ai8-p0-blockers`.** They are not present on the integration branch
> (`feat/infrastructure`), not on `main`, and not in any running build.
> WebSocket authentication is **not partially implemented; it is untouched on
> every branch**, so it is recorded RED rather than YELLOW.
>
> This is finding RT-023's failure mode repeating on a different surface: work
> that exists on a branch is not a control in any environment. It is recorded
> here so the merge is not mistaken for a formality.

### GREEN — implemented and verified, **on `fix/ai8-p0-blockers` only**

| Item | Evidence |
|---|---|
| Bearer access-token verification | `apps/api/src/platform/auth/access-token.ts` — HS256 over `node:crypto`, `timingSafeEqual`. **Verify-only; it does not mint tokens** (the file says so) |
| Authentication boundary as a single guard | `apps/api/src/platform/auth/authenticated.guard.ts` — `AuthenticatedGuard implements CanActivate`, registered as `APP_GUARD` in `platform.module.ts:30`, with an explicit `@Public()` opt-out for probes |
| Verified actor resolution | The guard sets `request.user`; nothing else does |
| `x-actor-id` spoofing rejected | `actor.decorator.ts` on that branch reads `request.user?.actorId` and states: *"that header is now ignored entirely"* |

**On the integration branch these are all absent**, verified at `d236ce3`:
`grep -rln "CanActivate" apps/api/src` → no match; `actor.decorator.ts` still
returns `String(request.headers['x-actor-id'] ?? '')`.

### YELLOW — partially resolved

| Item | Why yellow |
|---|---|
| The authentication boundary | Correct in design and correct in implementation, but **unmerged**. Until it lands on the integration branch, RT-001 is open in every environment that can be built from this repository |
| Token verification without token issuance | A verifier with no issuer is half a system. It cannot be exercised end to end, so its correctness is asserted by reading, not by running |

### RED — not implemented anywhere

| Item | Evidence |
|---|---|
| Login / token issuance | No `/auth/login`, no `/auth/refresh`, no minting on any branch. `grep -rn "auth/login" apps/api/src` → no match |
| Session store | No session table exists. `chat.device_token` is a push-token table and does not stand in for one |
| **WebSocket authentication** | `realtime.gateway.ts` on **every** branch, including `fix/ai8-p0-blockers`, still reads `client.handshake.auth?.actorId` — a client-asserted actor id. Untouched, not partial |
| Teacher authentication | Blocked upstream — see the contract request §D |

### OPEN — Core decisions

| Item | Status |
|---|---|
| Core authentication capability | `UNKNOWN — CORE DECISION REQUIRED` (D-1) |
| Core token contract | `UNKNOWN — CORE DECISION REQUIRED` (D-2) |
| Teacher identity | `UNKNOWN — CORE DECISION REQUIRED` (D-3, D-4) |
| Staff identity source | `UNKNOWN — CORE DECISION REQUIRED` (D-7) |

---

## 3 · What must not happen while this is open

Recorded so that a later reader does not mistake absence for permission:

- No credential table, no password storage, no Argon2 in Chat.
- No session or device-session table until the credential decision is made — its shape depends on who verifies.
- No login or refresh endpoint.
- No synthetic teacher identity, and no teacher account created in Chat.
- No fake or speculative Core client.
- No `email` field introduced into the Chat schema. A CI test already forbids contact-channel columns.
- No JWT issuance.
- No authentication fallback path — a fallback is how `x-actor-id` became production-shaped in the first place.
- No change to `AuthorizationService`, the BR-1 backstop (RT-024/RT-025), or tenant isolation.

---

## 4 · The one thing that is safe to do now

Merging `fix/ai8-p0-blockers`' authentication boundary onto the integration
branch closes RT-001 for HTTP **without** answering any Core question: the guard
verifies a token and rejects `x-actor-id`; it does not decide who issues tokens.

That merge is not this document's decision to make, and it carries one caveat
worth stating plainly: **a guard with no token issuer locks out every client**,
because nothing can obtain a token. It is only mergeable together with a decision
about how tokens are minted — which is D-1.
