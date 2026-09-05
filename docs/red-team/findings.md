# Jawwid Chat — Red Team Findings

Owner: AI #9 (Adversarial Red Team / Chaos) · Opened 2026-09-05 · Status: **CAMPAIGN 1 COMPLETE**

Scope of this pass: static attack of the whole tree plus **runtime-executed**
attacks against `AuthorizationService`, `SignedLocalObjectStorage`,
`AttachmentService` and `MessageService`.

## Evidence grades — read these before reading a severity

| Grade | Meaning |
|---|---|
| **CONFIRMED (runtime)** | An executing test in `apps/api/test/unit/red-team/` demonstrates the behaviour. |
| **CONFIRMED (static)** | Proven by reading the only code path that exists; no alternative path can intervene. |
| **UNVERIFIED** | The implementation strongly suggests it, but the code is not reachable at runtime yet. |
| **THEORETICAL** | Reasoned from the design; not proven. Stated as a risk, never as a defect. |

> **Environmental constraint governing every "UNVERIFIED" below.**
> There is no `main.ts`, no `AppModule`, no HTTP controller other than
> `/health`, no auth middleware, and no outbox drain worker. `RealtimeGateway`
> is defined but registered in no module. **The application cannot currently be
> started.** Runtime attacks against HTTP, WebSocket, queues and storage
> endpoints are therefore impossible today, and no finding below claims
> otherwise. Reproduce them at the service layer, or re-run this campaign once
> the app boots.

## Reproducing the runtime evidence

```bash
cd apps/api && npx jest --selectProjects unit --testPathPattern red-team
```

These specs assert **observed** behaviour, so they pass today. When a finding is
fixed, invert its assertion in the same commit as the fix — a green red-team
suite after a fix means the fix did not land.

---

# BLOCKING RELEASE — P0

## RT-001

### Title
The only runtime entry point accepts self-asserted identity: a client declares who it is.

### Category
Security / Authentication

### Severity
**P0**

### Attack Scenario
An attacker opens a WebSocket to the API and sets `auth.userId` to any staff or
contact primary key. The server resolves that id into a full `Actor` and treats
the connection as that person for its entire lifetime.

### Preconditions
The app is bootstrapped (it currently is not) and `RealtimeGateway` is
registered in a module. Knowledge of one `staff.id` or `contact.id` UUID.

### Attack Steps
1. `io(API_URL, { auth: { userId: '<victim staff uuid>' } })`
2. `socket.emit('thread.subscribe', { threadId })` for any thread.
3. Receive every realtime event for that thread; mark receipts as the victim.

### Expected Secure Behaviour
Identity is derived from a verified credential (a signed token, a session
cookie). A client-supplied identifier is never an identity.

### Actual Behaviour
`realtime.gateway.ts:57` — `const userId = String(client.handshake.auth?.userId ?? '')`,
passed straight to `identity.resolveActor`. No signature, no session, no
expiry, no audience check. `PrismaIdentityService.resolveActor` looks the id up
directly as a table primary key; `Contact.appUserId` (the field that exists to
link a contact to an authenticated account) is never read by any code.

### Impact
Complete authentication bypass at the only entry point that exists.
Every other control in this report — all of which are correctly written — is
downstream of an identity that the attacker chooses.

### Evidence
`apps/api/src/communication/realtime/realtime.gateway.ts:54-75`;
`apps/api/src/platform/identity.service.ts:20-50`. CONFIRMED (static).

### Root Cause
A deliberate placeholder ("AI #1 SEAM: replace this with verification of the
auth token"). The defect is not the placeholder — it is that **nothing prevents
it from shipping**: no startup assertion, no `APP_ENV` guard, no failing test,
no CI (see RT-015), and no release-gate item bound to this line.

### Recommended Fix
Two changes, both small:
1. Make the placeholder fail closed outside local: refuse to construct the
   gateway when `APP_ENV !== 'local'` and no token verifier is provided.
2. Add a red-team regression test asserting that a handshake without a verified
   credential is rejected.

Independently, AI #1 lands real token verification; `resolveActor` should then
take a verified principal, not a raw id.

### Acceptance Criteria
- A handshake carrying only `auth.userId` is disconnected.
- Starting the API with `APP_ENV=staging` and no token verifier fails at boot.
- `Contact.appUserId` is the join key from authenticated principal to contact,
  or the column is deleted.

### Owner
**AI #1** (auth), with AI #7 for the boot-time guard.

---

## RT-002

### Title
Authorization is a total function of `familyId` alone — thread kind and participant set are outside its type signature, so BR-1 cannot be expressed.

### Category
Authorization / Architecture

### Severity
**P0**

### Attack Scenario
Any `Thread` row whose `kind` is `STUDENT_GROUP`, `CLASS_GROUP` or `OFFICIAL`
is readable and writable by **every contact of that family and every
family-facing staff member**, with no code change and no new migration — because
the authorization functions are never shown the thread's kind or its
participants.

### Preconditions
A thread row exists with `kind <> FAMILY`. `ThreadKind` already contains all
four values, `Thread` is `@@unique([familyId, kind])` (four threads per family
are representable today), and any seed script, admin tool, integration import or
future service can insert one.

### Attack Steps
1. Insert `Thread { familyId: F, kind: STUDENT_GROUP }`.
2. As any contact of family F, call `canReadThread` — allowed.
3. As any ADMIN / COVERAGE / MANAGER, call `canReadThread` for **any** family — allowed.

### Expected Secure Behaviour
Authorization is a function of *(actor, conversation, channel, context)*
including the conversation's type and explicit participant set, per
`docs/qa/defects.md` JC-002.

### Actual Behaviour
```ts
canReadThread(actor: Actor, thread: Pick<Thread, 'familyId'>): AuthzDecision
canSendMessage(actor, thread: Pick<Thread,'familyId'|'stickyHandlerId'|'stickyUntil'>, ...)
```
Neither signature can see `kind`, and neither receives a participant set.

### Impact
This is the finding that outlives JC-002. AI #5 correctly identified that the
"structural guarantee" makes Student Groups unrepresentable. The **stronger and
more dangerous** reading is the converse: multi-kind threads are *already*
representable, and the moment one exists the authorization layer treats it as a
family-wide broadcast channel. BR-1 — "no 1:1 conversation may contain both a
teacher and a parent" — is a predicate over a participant set that the single
authorization code path is never given. It is not unimplemented; **it is
unexpressible without changing the contract.**

Adding Student Groups (required MVP scope) therefore does not merely need new
tables. Done against the current contract, it silently creates the exact channel
BR-1 forbids.

### Evidence
`apps/api/test/unit/red-team/authz-attacks.spec.ts` → *RT-003 · authorization is
a function of familyId alone* (4 assertions). CONFIRMED (runtime): all four
`ThreadKind` values are admitted for a contact, and all family ids — including
the literal `'*'` — are admitted for every family-facing staff role.

### Root Cause
The `Pick<>` narrowing was chosen to keep the authorization service decoupled
from the Thread model. It decoupled it from the two fields the rule needs.

### Recommended Fix
Widen the contract *before* Student Groups are built:
`canReadThread(actor, thread: Pick<Thread,'familyId'|'kind'>, participants: Participant[])`,
and deny by default for any kind the function does not explicitly handle. A new
`ThreadKind` must then fail to compile rather than fall through to allow.

### Acceptance Criteria
- A `STUDENT_GROUP` thread is denied to a contact who is not a member of it.
- Adding a `ThreadKind` value without adding a branch fails the build.
- `BR1-01…BR1-14` (`docs/qa/test-plan.md` §3) run against this single path for
  both messaging and calling.

### Owner
**AI #1** (contract) · **AI #2** (call sites). Blocks JC-001 and JC-002.

---

# MUST FIX BEFORE PILOT — P1

## RT-003

### Title
`on_behalf_mode` is client-controlled for a MANAGER: ownership attribution can be forged.

### Category
Integrity / Audit

### Severity
**P1**

### Attack Scenario
A manager sends a customer-facing message with `requestedMode: 'OWNER'` on a
family they do not own. The message is persisted, and the audit trail records,
`on_behalf_mode = OWNER`.

### Preconditions
Actor is `StaffRole.MANAGER`. No other precondition.

### Attack Steps
`canSendMessage(manager, thread, someOtherOwnerId, { visibility: CUSTOMER, requestedMode: OWNER })`

### Expected Secure Behaviour
The contract states it plainly:
> `/** Only honoured for ASSIST/ESCALATION; OWNER vs COVERAGE is derived, never trusted. */`

### Actual Behaviour
`authorization.service.ts:126-128` — `return allow(intent.requestedMode ?? ESCALATION)`.
All four modes are honoured verbatim for a manager.

### Impact
`on_behalf_mode` is the field the operating model relies on to distinguish
Primary Owner from Current Handler, and it is written into `audit_log` and
`event_log` as fact. A forged `OWNER` stamp corrupts ownership analytics,
workload attribution and the audit record of who acted for whom — the exact
record the product's "the system owns the family history" rule depends on.

This survives AI #5's JC-005 fix as specified: their test only exercises a
non-manager intruder. **Fixing JC-005 without touching the MANAGER branch leaves
this open.** (Red-team fix-validation rule §55: test the boundary, not the
request.)

### Evidence
`apps/api/test/unit/red-team/authz-attacks.spec.ts` → RT-001, 2 assertions.
CONFIRMED (runtime).

### Root Cause
The manager short-circuit was written for *access* ("Manager can act on
anything") and reused for *attribution*, which is a different question.

### Recommended Fix
Split the two. A manager's access stays unconditional; the mode is still derived:
`allow(this.deriveMode(actor, familyOwnerId, intent.requestedMode ?? ESCALATION))`,
with `OWNER` reachable only when `actor.userId === familyOwnerId`.

### Acceptance Criteria
A manager requesting `OWNER` on a family they do not own is allowed to send and
the message is stamped `ESCALATION` (or `COVERAGE`), never `OWNER`.

### Owner
**AI #1** (owns `AuthorizationService` internals) · coordinate with AI #5's JC-005.

---

## RT-004

### Title
`COVERAGE` is asserted for actors who hold no coverage assignment; `on_duty()` is never consulted on the internal-note path.

### Category
Integrity / Audit

### Severity
**P1**

### Attack Scenario
Any ADMIN writes an internal note on a family they neither own nor cover. The
note is persisted with `on_behalf_mode = COVERAGE`, asserting a coverage
relationship that does not exist.

### Expected Secure Behaviour
The documented derivation:
> "The mode is DERIVED from on_duty() + ownership, never taken from the client."

### Actual Behaviour
`deriveMode()` consults **ownership only**. On the INTERNAL branch
(`authorization.service.ts:121-123`) `coverage.onDuty()` is never called at all;
any non-owner is labelled `COVERAGE` by default.

### Impact
Every internal note by a non-owner admin is an audit record that states
something untrue. Coverage is the operating model's core distinction between
"assigned to help" and "wandered in"; a mode that means "not the owner" is not
the same field as one that means "was on duty". Downstream workload and coverage
reporting inherits the error.

### Evidence
`apps/api/test/unit/red-team/authz-attacks.spec.ts` → RT-002, asserting
`onDutyCalls === 0` while the decision returns `COVERAGE`. CONFIRMED (runtime).

### Recommended Fix
Either introduce a distinct mode for "family-facing admin acting outside
ownership and coverage", or make `deriveMode` async and consult `onDuty()` on
every path that can emit `COVERAGE`.

### Acceptance Criteria
A non-owner, non-on-duty admin's internal note is never stamped `COVERAGE`.

### Owner
**AI #1**. Related to RT-003; fix together.

---

## RT-005

### Title
Object-storage URL signing falls back to a secret committed to git, and the variable is absent from the documented environment.

### Category
Security / Privacy

### Severity
**P1**

### Attack Scenario
An attacker who can name any object key mints a valid signed read URL for it,
without ever authenticating.

### Preconditions
`STORAGE_SIGNING_SECRET` is unset — which is the state an operator reaches by
following the documented setup, because **`.env.example` does not contain the
variable** and `docs/infrastructure/environment.md` (cited as the authoritative
inventory) does not exist on disk.

### Attack Steps
1. Read `'dev-only-not-a-secret'` from `object-storage.ts:35` (public repo).
2. `createHmac('sha256', secret).update('GET:' + key + ':' + expires)`.
3. `GET {STORAGE_ENDPOINT}/{key}?expires=…&sig=…` — accepted by `verify()`.

### Expected Secure Behaviour
Absence of a signing secret is a fatal startup error outside local development.

### Actual Behaviour
`private readonly secret = process.env.STORAGE_SIGNING_SECRET ?? 'dev-only-not-a-secret'`

### Impact
Forgeable read (and, via the `PUT` variant, write) capabilities over the entire
attachment store. Attachments are family communication content: photos of
children, documents, voice notes.

### Evidence
`apps/api/test/unit/red-team/storage-and-integrity-attacks.spec.ts` → RT-004,
which deletes the env var, signs a key with an attacker-constructed instance and
shows the victim instance's `verify()` returns `true`. CONFIRMED (runtime).

### Recommended Fix
Throw at construction when the secret is missing and `APP_ENV !== 'local'`; add
`STORAGE_SIGNING_SECRET` to `.env.example` and to the environment inventory.

### Acceptance Criteria
Constructing `SignedLocalObjectStorage` with `APP_ENV=staging` and no secret
throws. `grep STORAGE_SIGNING_SECRET .env.example` matches.

### Owner
**AI #2** (the class) · **AI #7** (environment inventory).

---

## RT-006

### Title
`signUrlsForMessages()` mints signed URLs for arbitrary message ids with no authorization check.

### Category
Authorization / IDOR

### Severity
**P1** (seam not yet reachable — see grade)

### Attack Scenario
A caller passes message ids belonging to another family and receives working,
short-lived read URLs for their attachments.

### Expected Secure Behaviour
Every object-level read is authorized against the requesting actor. This is the
canonical IDOR shape: an id in, an object out, no subject in the signature.

### Actual Behaviour
```ts
async signUrlsForMessages(messageIds: string[]): Promise<Map<…>>
```
No `actor`, no `userId`, no thread check. `SignedLocalObjectStorage.signedReadUrl`
likewise signs any key handed to it. The only correct gate in this file —
`authorizeUpload`, which does check `canReadThread` — sits beside it, which makes
the omission look intentional to a reader.

### Impact
Whichever controller AI #2 or AI #4 wires to this becomes a cross-family
attachment read. The function's shape invites the mistake.

### Evidence
`attachment.service.ts:90-108`; grep confirms **no caller exists yet**, so the
IDOR is not presently reachable. CONFIRMED (static) for the contract;
UNVERIFIED at runtime by construction.

### Recommended Fix
Change the signature to take the actor and filter to messages whose thread the
actor may read: `signUrlsForMessages(actor: Actor, messageIds: string[])`.
Fix it before a caller exists — it is free today.

### Acceptance Criteria
Requesting a signed URL for another family's attachment returns nothing, and a
red-team test proves it.

### Owner
**AI #2**.

---

## RT-007

### Title
Attachment MIME type, size and object key are persisted verbatim from the request body; the validator is never called on the send path.

### Category
Security / Input validation

### Severity
**P1**

### Attack Scenario
1. Call `authorizeUpload(kind: IMAGE, mimeType: 'image/png')` — passes validation,
   returns a signed `PUT` URL for key `K`.
2. `PUT` arbitrary bytes to `K`. The signature covers only `method:key:expires` —
   **not** the content type, and not the byte size.
3. Send a message with `attachments: [{ objectKey: K, mimeType: 'text/html', byteSize: 1, kind: 'FILE' }]`.

Every field is stored as supplied.

### Expected Secure Behaviour
The MIME allowlist and size ceiling are enforced where the metadata is
persisted, and the object key is verified to have come from an upload
authorization for *this* thread.

### Actual Behaviour
`MessageService` never imports `AttachmentService`. Its only attachment check is
`validateContent`, which asks solely whether the array is non-empty.

### Impact
- The MIME allowlist (which correctly rejects `text/html` and `image/svg+xml`)
  is bypassed entirely, and the declared MIME is what every client renders.
- The reference signer's built-in default is
  `STORAGE_ENDPOINT=http://localhost:3000/storage` — the API's own origin — so
  with the variable unset a stored HTML/SVG payload is same-origin stored XSS
  against anything served from the API host. (`.env.example` points the variable
  at MinIO on `:9000` instead, which is a different origin — but see RT-022:
  the reference signer cannot serve from MinIO at all, so it is not clear which
  value production will carry.)
- The size ceiling is advisory only.
- Nothing binds an object key to the thread it was authorized for.

### Evidence
`apps/api/test/unit/red-team/storage-and-integrity-attacks.spec.ts` → RT-005:
`AttachmentService.validate` correctly rejects `text/html`, `image/svg+xml` and
oversize; static assertion over `message.service.ts` shows no reference to
`AttachmentService` and no `.validate(` call, while `objectKey: a.objectKey` is
persisted verbatim. CONFIRMED (runtime + static).

### Recommended Fix
Call `attachments.validate(kind, mimeType, byteSize)` per attachment inside
`send()`, and require the object key to match `threads/{threadId}/…` for the
thread being written to. Serve storage from a separate origin.

### Acceptance Criteria
A send carrying `mimeType: 'text/html'` is rejected with
`ATTACHMENT_TYPE_NOT_ALLOWED`; a send carrying another thread's object key is
rejected.

### Owner
**AI #2**.

---

## RT-008

### Title
A parent can forge a system message: `type` and `origin` are client-controlled and `type: SYSTEM` bypasses all content validation.

### Category
Integrity / Impersonation

### Severity
**P1**

### Attack Scenario
A contact sends `{ type: 'SYSTEM', origin: 'AUTOMATION', body: '<official-looking text>' }`
into their own family thread. Authorization passes — they are a contact of the
family, `canMessage` is true, visibility is `CUSTOMER`. The row is written with
`type=SYSTEM, origin=AUTOMATION` and renders in the admin console and the mobile
apps as an official Jawwid notice.

### Expected Secure Behaviour
`type` and `origin` are server-determined facts about provenance. A non-SYSTEM
actor can never author a `SYSTEM`-typed or `AUTOMATION`/`BROADCAST`-origin
message.

### Actual Behaviour
`message.service.ts:102-103` — `const type = input.type ?? TEXT` and
`origin: input.origin ?? MessageOrigin.USER`, both straight from the request.
Neither is constrained by `actor.kind` anywhere. `validateContent` explicitly
exempts `SYSTEM` from both the body and the attachment requirement
(`type !== TEXT && type !== SYSTEM`), so a `SYSTEM` message needs no content at
all and passes every check.

### Impact
Impersonation of the product itself, by the least-privileged actor in the system.
The obvious abuse is a forged "your subscription has lapsed, pay here" notice
inside a legitimate Jawwid thread. `authorType` is set correctly to `CONTACT`,
so the forgery is detectable in the database — but only if a client renders
`authorType` rather than `type`, and `MessageDto` exposes both with equal
prominence.

### Evidence
`apps/api/test/unit/red-team/storage-and-integrity-attacks.spec.ts` → RT-006:
`validateContent(SYSTEM, { body: null, attachments: [] })` does not throw, while
the same emptiness throws for `TEXT` and `IMAGE`. CONFIRMED (runtime).

### Recommended Fix
Derive both fields: `SYSTEM` type and non-`USER` origin are permitted only when
`actor.kind === 'SYSTEM'`. Drop them from `SendMessageInput` for other callers.

### Acceptance Criteria
A contact sending `type: SYSTEM` or `origin: AUTOMATION` is rejected.

### Owner
**AI #2**.

---

## RT-009

### Title
A realtime session never re-evaluates identity: a disabled account keeps live access for the life of its socket.

### Category
Security / Session

### Severity
**P1**

### Attack Scenario
An admin is offboarded, or a contact's `canMessage` is revoked, or a staff
member's role is downgraded, while they hold an open WebSocket. Nothing changes
for them.

### Expected Secure Behaviour
Revocation is effective immediately, or within a short bounded window, on every
channel — including sockets already established.

### Actual Behaviour
`resolveActor` is called exactly once, in `handleConnection`. The resulting
`Actor` — including `isActive`, `staffRole` and `canMessage` — is cached on the
socket and reused by `subscribe`, `typingStart` and `canTouchThread` forever.
There is no TTL, no re-resolution, no invalidation channel, and no mechanism
that removes an already-joined socket from a thread room.

### Impact
Offboarding does not offboard. A dismissed employee keeps reading live family
conversations until they choose to disconnect. This compounds RT-001: an
attacker who has forged an identity once needs never re-present it.

### Evidence
`apps/api/src/communication/realtime/realtime.gateway.ts:54-75, 82-98, 171-175`.
CONFIRMED (static) — `resolveActor` appears once in the file.

### Recommended Fix
Re-resolve the actor on a TTL (or on every privileged frame), and publish a
revocation event that forces `disconnect(true)` and room eviction.

### Acceptance Criteria
Setting `isActive = false` terminates the user's live sockets within the agreed
window; a subsequent `thread.subscribe` is refused.

### Owner
**AI #1** (revocation signal) · **AI #2** (gateway). Distinct from AI #5's JC-006,
which is about `canReadInternal` ignoring `isActive` at all; this is about the
check never re-running even once it is correct. **Fixing JC-006 alone does not
close RT-009.**

---

## RT-010

### Title
Two incompatible database architectures are committed simultaneously, one of which places Jawwid Chat inside the Jawwid Core database.

### Category
Operational Safety / Tenancy isolation

### Severity
**P1**

### Attack Scenario
Not an attacker action — an architectural fork that determines the blast radius
of every other finding in this report.

### Actual Behaviour
| Source | Model |
|---|---|
| `supabase/migrations/20260905090000_chat_foundation.sql:3-7` | "It lives in the `chat` schema **inside the Jawwid Core Supabase database**." |
| `apps/api/prisma/schema.prisma:20-23` + `.env.example:37` | A standalone Postgres, `public` schema, tables `staff` / `family` / `thread`. |
| `infra/docker/postgres-init/10-app-role.sh:5-8` | Explicitly serves **both** — "both database strategies currently in the tree". |

The two define overlapping entities (`chat.config` vs `Config`, `chat.staff` vs
`Staff`) with different names, types and constraints, and neither references the
other.

### Impact
1. **Isolation.** The `chat`-inside-Core model contradicts the governing scope
   document (`docs/qa/authoritative-scope.md` §2, "Jawwid Chat is an independent
   product") and the standing instruction that Chat shares no database with any
   other product. Under it, a compromise of the Chat application role is a
   compromise of Core's customer data; the init script grants
   `grant all on database` and `alter schema public owner to` the app role.
2. **Divergence.** Two schemas for one product guarantees that a constraint added
   to one is missing from the other. `chat.forbid_mutation()` is defined for
   append-only enforcement — and attached to **no table**; the Prisma side has no
   equivalent at all, so `audit_log` and `event_log` are append-only by comment
   only, in both.
3. It is not knowable today which one a security review is reviewing.

### Evidence
CONFIRMED (static), cited above. `grep 'ROW LEVEL\|POLICY\|GRANT\|REVOKE\|TRIGGER'`
over `supabase/migrations/` returns only the `updated_at` trigger — no RLS, no
grants, no append-only trigger.

### Recommended Fix
A product-owner decision, then delete the loser. If the standalone model wins
(as the governing scope document requires), remove the `chat`-inside-Core
framing from the migration headers and the dual-mode init script.

### Acceptance Criteria
One schema definition in the tree. Append-only tables enforced by a trigger or
by revoked `UPDATE`/`DELETE` grants, not by a comment.

### Owner
**Product owner** (decision) · **AI #1** (schema) · **AI #7** (infrastructure).

---

# SHOULD FIX — P2

## RT-011 · The `familyId: '*'` probe defeats per-object authorization by construction

`thread.service.ts:142` authorizes a *list* by calling the object-level check
against a fabricated family id, then returns every thread in the system
(`take: 200`, no filter, no coverage scope).

The result is correct only because `canReadThread` currently ignores `familyId`
for staff. The moment coverage scoping is added — which the PRD requires — this
probe either denies every operator, or is "repaired" by keeping the fake id and
permanently exempting the list endpoint from the rule. A list must be built from
an authorization-derived filter, never from a probe with a sentinel value.
CONFIRMED (runtime): `authz-attacks.spec.ts` shows `familyId: '*'` is allowed for
all three operator roles. *Owner: AI #2.*

## RT-012 · `MessageDto` returns the full receipt roster to every reader

`toMessageDto` maps **all** `MessageReceipt` rows — `userId`, `deliveredAt`,
`readAt` — for every recipient. A parent therefore learns the internal user ids
of the staff on their family and precisely when each read a message. Staff ids
are the object ids used everywhere else in the system, which makes this an
enumeration primitive as well as a privacy leak. Receipts should be scoped to
the requesting user plus an aggregate. CONFIRMED (static), `dto.ts:185-190`.
*Owner: AI #2.*

## RT-013 · Internal notes are announced to customer contacts over realtime

`message.created` is fanned out with `toThread(threadId, …)` to a room
containing contacts and staff alike, and its payload carries
`visibility: 'INTERNAL'` plus `authorId` and `createdAt`. The body is correctly
withheld — but the existence, author and timing of every internal staff note is
delivered to the family. The REST path filters internal messages properly
(`visibilityFilter`); the realtime path has no audience filter at all. Not yet
reachable (no outbox drain worker exists), so **UNVERIFIED at runtime**;
CONFIRMED in the contract. Fan-out must be per-audience, not per-thread.
*Owner: AI #2.*

## RT-014 · The authorization decision is computed outside the transaction that acts on it

`MessageService.send` resolves the actor, loads the family, and evaluates
`canSendMessage` **before** opening the transaction; the row lock
(`SELECT … FOR UPDATE`) is taken afterwards, and the recipient audience is also
computed outside. A concurrent deactivation, ownership transfer, coverage change
or contact removal between the two is applied to a decision already made.
Window is small and the exploit is a race, so P2 — but the fix is mechanical:
re-read and re-decide inside the transaction, after the lock.
CONFIRMED (static), `message.service.ts:81-137`. *Owner: AI #2.*

## RT-015 · No CI exists; the QA regression suite gates nothing

`.github/workflows/` is an **empty directory**. `apps/api/test/unit/` currently
contains **four failing tests** (AI #5's JC-005 and JC-006 conformance specs)
and nothing prevents a merge. A release gate that is not executed is not a gate.
CONFIRMED (runtime): `npx jest --selectProjects unit` → *4 failed, 6 passed*.
*Owner: AI #7, with AI #5.*

---

# HARDENING — P3

| ID | Finding | Evidence | Owner |
|---|---|---|---|
| **RT-016** | `SignedLocalObjectStorage.verify` compares HMACs with `===`, not `timingSafeEqual`. Minor next to RT-005, but it is the same function. | `object-storage.ts:64` | AI #2 |
| **RT-017** | `BigInt(input.before / after / seq)` on unvalidated client strings throws `SyntaxError`, not a typed `CommError` — an uncaught 500 and a stack trace instead of a 400. | `message.service.ts:380-381, 438` | AI #2 |
| **RT-018** | Passing both `before` and `after` silently overwrites `where.seq`; `after` wins and the caller's page bound is discarded without error. | `message.service.ts:380-381` | AI #2 |
| **RT-019** | `message.delivered` accepts an unbounded `messageIds[]` straight into a SQL `IN`. No cap, no rate limit; the socket is otherwise unmetered. | `realtime.gateway.ts:155-169` | AI #2 |
| **RT-020** | Six documents are cited as authoritative and do not exist: `docs/brief/JAWWID_CHAT_BRIEF.md` (README), `docs/architecture/`, `docs/communication/` (incl. `scope-decisions.md`, cited by the schema to justify the DESIGN-ONLY section), `docs/infrastructure/{environment,architecture,decisions,handoff-ai2}.md`. A control justified by a missing document is unreviewable — and RT-005 is a direct consequence of one of them. | filesystem | all |
| **RT-022** | The storage layer has two incompatible halves. `AttachmentService` is wired to `SignedLocalObjectStorage`, which signs URLs with its own HMAC and expects **this API** to serve them — but no such route exists, and `docker-compose.yml` provisions MinIO with `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`/`STORAGE_BUCKET` that no code reads. No S3 adapter exists. Attachments cannot currently be stored or served by any path. | `object-storage.ts:33-60`, `docker-compose.yml:70-110`, `.env.example:49-53` | AI #2 / AI #7 |
| **RT-021** | `RedactingLogger._sensitiveKeys` matches keys exactly and omits `email`, `authtoken`, `idtoken`, `sessiontoken`, `jwt`, `credential`, `otp`. Phone numbers are covered; email addresses are not redacted anywhere. | `lib/core/logging/redacting_logger.dart:20-40` | AI #3 |

---

# Deferred — needs a bootable system

These are **not** clearances. They are attacks I could not run because the
application cannot start (no `main.ts`, no `AppModule`, no controllers, no
worker). Re-open this campaign when it boots.

| Area | Blocked because |
|---|---|
| Race conditions (real concurrency) | No runnable service; see `race-conditions.md` for the static analysis and the exact probes to run. |
| Chaos / recovery (§37, §52) | Nothing to kill. `docker-compose.yml` exists; the API it would run does not. |
| Queue / worker attacks | BullMQ is a dependency; no queue, worker or job is implemented. |
| Notification attacks | `src/communication/notifications/` is an **empty directory**. |
| Calling attacks | No implementation; `Call` models are DESIGN-ONLY (JC-001). |
| Search attacks | No search implementation. |
| Jawwid Core integration attacks | No integration code; `CORE_*` env vars only. |
| HTTP-layer attacks (IDOR via REST, CORS, CSRF, rate limiting) | `/health` is the only controller in the tree. |
