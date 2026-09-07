> **STATUS: HISTORICAL** (Phase 0, 2026-09-07). AI #7's D-5 analysis, recovered from an uncommitted worktree. Its dispositions are folded into `docs/contracts/API-CONTRACT.md`.
> Canonical index: `docs/README.md`.

# D-5 — API Contract Reconciliation

Owner: AI #7 · Date: 2026-09-06
Authority: `docs/product/jawwid-chat-prd-v0.1.md` (commit `62ff312`)
Reconciles: the PRD · the API controllers as built · the Admin Web client ·
`docs/admin/backend-contract-required.md` (AI #4) · the AI #2 communication
contracts.

**No Admin Web code was changed.** This document decides what the contract *is*
before anyone writes against it.

---

## 0. The finding, in one line

Admin Web and the API do not disagree about the shape of a shared endpoint —
**they share no endpoint at all**. All ten probed Admin Web calls returned 404,
and Admin Web calls none of the 32 routes the API serves.

Two independent surfaces were built from two different documents.

---

## 1. Which side is stale

**Both, in different places.** This is not "Admin Web is wrong".

| Surface | Built from | Verdict |
|---|---|---|
| API communication routes (`/conversations`, `/approvals`, `/calls`, `/notifications`) | PRD §6, §7.2–7.4, §9 | **Current.** Typed conversations, membership, approval policy and call sessions all match the PRD. Keep. |
| Admin Web inbox/coverage/dashboard client | the superseded `JAWWID_CHAT_BRIEF.pdf` | **Partly stale.** The *concepts* survive (§7.5, §10) but the endpoint names and payloads are brief-era. |
| Admin Web `shared/types/domain.ts` | superseded brief | **Stale.** `Case`, `Handoff`, `InboxRow`, `TeamNowRow`, `sticky_threads` are thread-era names. The PRD's noun is **conversation**. |
| `docs/admin/backend-contract-required.md` | superseded brief, self-described "proposed, awaiting sign-off" | **Superseded as a contract**, still useful as a list of what the inbox needs. |

AI #5 recorded on 2026-09-05 that `apps/admin-web/src/shared/types/domain.ts`
was written from the superseded brief. That is the root of this divergence.

## 2. Request/response mismatches that would survive a naive merge

Even where a name matches, the payloads do not.

| # | Mismatch | Admin Web expects | API returns |
|---|---|---|---|
| M-1 | **Field casing** | `snake_case` (`in_shift`, `shift_ends_at`, `sticky_threads`) | `camelCase` (`conversationId`, `authorKind`, `lastActivityAt`) |
| M-2 | **`/me` shape** | a `Staff` record | an **Actor** (`actorId`, `kind`, `displayName`, `locale`, `staffRole`) |
| M-3 | **Core noun** | `Case`, `Thread`, `InboxRow` | `Conversation` with an explicit `type` |
| M-4 | **Identity** | `sticky_threads` count | conversation-scoped stickiness (`stickyHandlerId`, `stickyUntil`) |
| M-5 | **Error body** | `{error:{code,message_en,message_ar}}` | `{error:{code,message}}` — single message, no locale split |
| M-6 | **Pagination** | `{items, next_cursor}` | `{messages, nextBefore}` per resource |

**Decision — casing: the API is authoritative, `camelCase`.** It is the side
with a running implementation, 32 routes and a typed DTO layer; changing it
would break the mobile client, which already conforms. Admin Web adapts.

**Decision — M-5, bilingual errors.** The PRD requires Arabic and English UI
(§11.3) but does not require the *API* to return both strings. A stable `code`
plus client-side lookup keeps translations in the client, where the rest of the
UI copy already lives. The API keeps `{code, message}`; `message` is a developer
diagnostic, never rendered to a user.

## 3. Endpoint-by-endpoint disposition

Legend: **reuse** = already exists and is PRD-correct · **build** = PRD requires
it and it does not exist · **drop** = brief-era, no PRD basis in this shape.

### Session and configuration

| Admin Web calls | PRD | Disposition |
|---|---|---|
| `POST /auth/login` | §7.1 | ✅ **built this cycle** (D-6) |
| `POST /auth/logout` | §7.1 | ✅ **built this cycle** |
| — | §7.1 rotating refresh | ✅ `POST /auth/refresh`, built this cycle |
| `GET /me` | §7.1 | ✅ **built this cycle** — returns an Actor (M-2) |
| `GET /config` | §4, §12 | ✅ **built this cycle** — every constant, staff-only |
| `GET /me/duty` | §5.2 | **build** — AI #1. On-shift, shift end, who I cover. |

### The Admin Inbox — PRD §7.5

| Admin Web calls | PRD | Disposition |
|---|---|---|
| `GET /inbox?section=…` | §7.5 views | **build** — AI #1. Sections must be the PRD's seven views, not the brief's. |
| `GET /inbox/shift-banner` | — | **drop** — presentation state; derive from `/me/duty`. |
| `GET /inbox/away-summary` | — | **drop** — brief-era. |
| `GET /inbox/order-feedback` | — | **drop** — brief-era, no PRD concept. |
| `POST /inbox/snooze-to-next-shift` | — | **drop** — no PRD basis. Nearest PRD concept is a follow-up task (§7.6). |
| `GET /families`, family panel | §7.5 | **build** — AI #1. |
| — | §7.5 timeline across all of a family's conversations | **build** — AI #1 + AI #2. |

### Communication — already built, and unused by Admin Web

| API route | PRD | Disposition |
|---|---|---|
| `GET/POST /conversations`, `/conversations/direct`, `/conversations/student-group` | §6, §7.3 | **reuse** — Admin Web must adopt these. |
| `GET/POST /conversations/:id/messages` (+ read, unread, reactions, attachments) | §7.2 | **reuse** |
| `/approvals/pending`, `/mine`, `/:id/approve`, `/:id/reject` | §7.4 | **reuse** — matches the MVP simple policy exactly, rejection reason included. |
| `/calls`, `/calls/:id/token`, history | §9 | **reuse** |
| `/notifications/devices` | §7.1 device records, §8 | **reuse** |

**This is the largest single gap: Admin Web has no messaging client at all.**
The endpoints it needs to read and send messages already exist and are tested.

### Operations

| Admin Web calls | PRD | Disposition |
|---|---|---|
| `GET /tasks` | §7.6 | **build** — AI #1. |
| `GET /staff` | §10.1 | **build** — AI #1. |
| `/coverage/shifts`, `/rules`, `/absences`, `/gaps` | §5.2, §10.1 | **build** — AI #1. |
| `GET /coverage/tonight` | — | **drop** — brief-era; a query over `/coverage/gaps`. |
| `/dashboard/header`, `/needs-action`, `/unattended` | §10.2 | **build** — AI #1, renamed to the PRD's metric areas. |
| `/dashboard/team-now`, `/this-week` | — | **drop** as endpoints; the *metrics* survive inside §10.2. |

## 4. The smallest canonical contract — what was built this cycle

Only endpoints that (a) the PRD requires explicitly, (b) unblock the runtime
path, and (c) need no new domain model:

```
POST /api/v1/auth/login      { subject, password } -> { accessToken, refreshToken, expiresIn, actor }
POST /api/v1/auth/refresh    { refreshToken }      -> same shape, token rotated
POST /api/v1/auth/logout                           -> { ok: true }
GET  /api/v1/me                                    -> Actor (server-asserted)
GET  /api/v1/config                                -> { config: {key: value}, count }   staff only
```

Nothing else was added. `/inbox`, `/families`, `/tasks`, `/staff`,
`/coverage/*` and `/dashboard/*` are **specified above and deliberately not
stubbed**: they are AI #1's domain, they need real domain logic, and a stub that
returns `[]` is worse than a 404 because it looks like it works.

## 5. What each agent should do next

**AI #4 (Admin Web).** Do not rename endpoints yet. Two things are safe now:
adopt `/auth/*`, `/me` and `/config`; and start using the existing conversation
and message endpoints, which are the surface you are missing entirely. Retire
`Case`/`Thread`/`InboxRow` in favour of `Conversation` when you touch
`domain.ts`, and expect `camelCase`.

**AI #1.** The admin surface above is yours: `/me/duty`, `/inbox`, `/families`,
`/tasks`, `/staff`, `/coverage/*`, `/dashboard/*`. Build them against the PRD's
views and metrics, not the brief's. Also: review the authentication built this
cycle (D-6) — it lives in `src/platform/auth/` and implements your seam.

**AI #2.** No change requested. The communication surface is PRD-aligned; the
problem is that Admin Web never called it.

**AI #5.** The five endpoints in §4 are new test surface. `/config` is staff-only
and worth a negative test from a parent token.
