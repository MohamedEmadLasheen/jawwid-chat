# Jawwid Chat — Attack Surface Map

Owner: AI #9 · 2026-09-05 · Companion to `findings.md`

**Read this first.** The surface below is split into what is *implemented*, what
is *declared but unreachable*, and what is *absent*. Conflating the three is how
a system gets reviewed as secure because the insecure part had not been written
yet. Absence is not a control: an unimplemented surface has no findings, and
also no defences.

Legend — **Risk**: 🔴 attack proven · 🟠 attack available on the current code
path · 🟡 hardening · ⚪ nothing to attack yet.

---

## 1. Implemented and reachable

### 1.1 Authentication

| | |
|---|---|
| **Surface** | WebSocket handshake `auth.userId` (`realtime.gateway.ts:57`). The only authentication in the tree. |
| **Trust boundary** | Internet → API process. |
| **Threat** | Impersonation of any staff member or contact by naming their primary key. |
| **Existing control** | None. A `String()` cast. |
| **Verification** | Read; no token verifier exists anywhere in `apps/api`. |
| **Risk** | 🔴 **RT-001** |

`Contact.appUserId` — the column that exists to bind a contact to an
authenticated account — is read by no code. `JWT_ACCESS_SECRET` /
`JWT_REFRESH_SECRET` are declared in `.env.example` and referenced by nothing.

### 1.2 Authorization

| | |
|---|---|
| **Surface** | `AuthorizationService.canReadThread` / `canSendMessage` / `canReadInternal`. |
| **Trust boundary** | Actor → family data. |
| **Threat** | Cross-family read, off-duty write, internal-note disclosure, forged attribution, BR-1 bypass. |
| **Existing control** | A single centralized service — the right shape (AI #5's PF-2), and the cross-family contact check is correct. |
| **Verification** | 7 runtime probes, `test/unit/red-team/authz-attacks.spec.ts`. |
| **Risk** | 🔴 **RT-002** (kind/participant blindness), 🔴 **RT-003**, 🔴 **RT-004**; AI #5's JC-005/JC-006 |

Boundaries **not** represented in the contract at all: thread kind, conversation
participant set, coverage window, actor↔family scoping for staff, teacher
identity. Each is a rule the PRD requires and the type signature forbids.

### 1.3 Messaging

| | |
|---|---|
| **Surface** | `MessageService.send / list / markState / markReadUpTo / react / deleteFor*`. |
| **Trust boundary** | Client request body → `message` row. |
| **Threat** | Provenance forgery, unvalidated attachment metadata, TOCTOU on authorization, receipt-roster disclosure, `BigInt` parse crash. |
| **Existing control** | Server-assigned `seq` under `FOR UPDATE` (correct, and the right instinct). Server-set `moderation`. Idempotency on `(threadId, authorId, clientMessageId)` with a unique constraint behind it (correct). Reply target confined to the same thread (correct). Soft delete only (correct). |
| **Verification** | Runtime + static, `storage-and-integrity-attacks.spec.ts`. |
| **Risk** | 🔴 **RT-008**, 🔴 **RT-007**, 🟠 **RT-012**, 🟠 **RT-014**, 🟡 **RT-017/018** |

**Client-controlled fields that reach the row verbatim:** `type`, `origin`,
`caseId` (no FK, no validation that the case belongs to this family),
`clientMessageId`, and every attachment field including `objectKey`.
**Correctly server-controlled:** `seq`, `authorType`, `authorId`, `moderation`,
`onBehalfMode` (except RT-003), `createdAt`.

### 1.4 Realtime

| | |
|---|---|
| **Surface** | Socket.IO gateway: `thread.subscribe/unsubscribe`, `typing.*`, `presence.heartbeat`, `message.delivered`. |
| **Trust boundary** | Socket → thread room membership. |
| **Threat** | Unauthorized subscription, stale-session persistence, internal-note existence leak, unmetered frames. |
| **Existing control** | **Rooms are never named by the client** — a subscribe is authorized by thread id through the same `AuthorizationService` as REST. This is correct and worth preserving. `cors: { origin: false }` blocks cross-origin browser connections. |
| **Verification** | Read; gateway is not registered in any module, so unreachable at runtime. |
| **Risk** | 🔴 **RT-009** (session never re-evaluated), 🟠 **RT-013**, 🟡 **RT-019** |

`thread.unsubscribe` and `typing.stop` accept any thread id without a check —
harmless (leaving a room you are not in is a no-op) but inconsistent with the
file's own stated discipline.

### 1.5 Attachments and object storage

| | |
|---|---|
| **Surface** | `authorizeUpload`, `signUrlsForMessages`, `SignedLocalObjectStorage.{sign,verify}`. |
| **Trust boundary** | Actor → binary content of other families. |
| **Threat** | Signed-URL forgery, cross-family attachment read, content-type confusion, stored XSS. |
| **Existing control** | `authorizeUpload` **is** gated on `canReadThread` and does validate MIME and size — the one correct gate. Keys are random UUIDs under a thread prefix. `objectKey` is `@unique`, which blocks re-attaching an existing attachment's key. |
| **Verification** | Runtime forgery test, `storage-and-integrity-attacks.spec.ts` RT-004. |
| **Risk** | 🔴 **RT-005**, 🔴 **RT-006**, 🔴 **RT-007**, 🟡 **RT-016**, 🟡 **RT-022** |

The signature covers `method:objectKey:expires` only — not the content type, not
the byte size, and **not the subject**. A signed URL is a transferable bearer
capability; anyone who obtains one (a log line, a screenshot, a shared link, a
proxy) can use it until it expires.

### 1.6 Health

| | |
|---|---|
| **Surface** | `GET /health`, `/health/live`, `/health/ready` — unauthenticated by design. |
| **Threat** | Information disclosure via probe errors; restart storms from a slow dependency. |
| **Existing control** | Errors reduced to the exception *class* by `sanitiseProbeError`; every probe timeout-bounded; liveness deliberately independent of dependencies. |
| **Verification** | Read. |
| **Risk** | ⚪ — **the strongest module in the tree.** It is the model the rest should follow. |

### 1.7 Database

| | |
|---|---|
| **Surface** | Prisma schema + Supabase migrations. |
| **Threat** | Orphaned or contradictory state; unenforced append-only logs; tenancy bleed. |
| **Existing control** | `@@unique([threadId, seq])`, `@@unique([familyId, kind])`, message idempotency unique, `objectKey` unique, `dedupeKey` unique, `Family.owner` a required FK (an owner cannot be deleted out from under a family). |
| **Verification** | Read; `grep` for RLS / GRANT / REVOKE / trigger over `supabase/migrations/` returns only an `updated_at` trigger. |
| **Risk** | 🔴 **RT-010**, 🟠 append-only by comment only |

Integrity gaps with no constraint behind them: a family may be owned by a staff
member whose role can never message families (rendering the family permanently
unwritable); disabling an owner makes every family they own Unattended with no
reassignment path; `Message.caseId` has no FK; `ThreadParticipantState.userId`
and `MessageReceipt.userId` are unconstrained strings spanning two identity
tables.

---

## 2. Declared but unreachable

Nothing here can be attacked today. Each is a **future** surface whose controls
must exist before it is switched on — and several are on the MVP critical path.

| Surface | State | Note |
|---|---|---|
| Outbox → realtime/notification fan-out | Rows written; **no drain worker** | Every `message.created` is enqueued and never delivered. RT-013 lands the day the worker does. |
| `RealtimeGateway` | Implemented, registered in no module | |
| Notifications, reminders, quiet hours, device tokens | Tables only; `src/communication/notifications/` is empty | `DeviceToken.token` is globally `@unique`; token reuse across users has no handling. |
| Handoff | Table + event only; `src/communication/handoff/` is empty | |
| Student Groups, approvals, calling | `schema.prisma` §C, `/// DESIGN-ONLY. Not implemented.` | JC-001. Required MVP scope. |
| BullMQ | A dependency; no queue, worker or job | |
| Jawwid Core integration | `CORE_*` env vars only | Webhook replay/ordering/authenticity all unaddressed. |

## 3. Absent

No HTTP API beyond `/health`. No `main.ts`, no `AppModule`. No auth
middleware, no CORS wiring, no rate limiting, no request validation pipe
(`class-validator` is a dependency and is used nowhere). No search. No CI
(`.github/workflows/` is an empty directory). No RLS, no database grants.

---

## 4. Trust boundaries, ranked by what crossing them costs

1. **Unauthenticated internet → authenticated actor.** Currently free (RT-001).
2. **Actor → another family's data.** Correct for contacts; absent for staff by design ("any admin may open any family"), which the PRD's coverage model will need to revisit.
3. **Contact → staff-only data.** Correct in REST (`visibilityFilter`), absent in realtime (RT-013), leaky in DTOs (RT-012).
4. **Client request body → server-determined fact.** The weakest boundary in the codebase: `type`, `origin`, `requestedMode`, and every attachment field cross it unchecked (RT-003, RT-007, RT-008).
5. **Application → object storage.** A forgeable bearer capability over the whole bucket (RT-005).
6. **Jawwid Chat → Jawwid Core.** Undefined, and contradicted by the schema (RT-010).
7. **Live session → revoked authority.** Never re-evaluated (RT-009).
