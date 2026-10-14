# Real-time chat across Admin, Teacher and Parent — 2026-10-14

Status: implemented and verified on an isolated stack; **uncommitted** in worktree
`jawwid-realtime-chat-accounts-386689` (base `09512c0` + the security-remediation and
super-admin-bootstrap deltas, which this work builds on).

## The rules this implements

- **PD-7 (product owner, 2026-10-14) supersedes PD-6.** No direct Teacher ↔ Parent
  conversation or call, whatever the relationship. Teacher–Parent communication only
  in the Student Group with a live admin (C-4). Enforced in `AuthorizationService`
  (`canOpenDirect`, `canSend` both sides, `canCall`) and in the database
  (`20261014120000_chat_pd007_restore_br1_direct.sql`). PD-6-era rows stay readable
  and accept nothing new. Record: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4.
- **Staff scope.** `manager` → their organization; `admin` / `coverage` → conversations
  they are a live member of, or whose family they own, are on duty for, or are the live
  sticky handler of. Same rule on the list, every read path, approvals and realtime
  delivery (`canRead(..., staffInScope)`). Teams and per-family supervisor assignment do
  not exist in the schema; they would refine `staffInScope`, not replace it.

## The delivery path (one implementation, three clients)

```
POST /conversations/:id/messages
  → MessageService.send (identity from the token, canSend, seq under FOR UPDATE,
    receipts, chat.outbox_event — one transaction)
  → outbox wake hint (Redis, best effort)            ← NEW: removes the 5 s idle wait
  → worker drains the outbox → Redis relay channel
  → API RealtimeRelay → RealtimeGateway: per-recipient canRead AT DELIVERY (RT-009)
  → socket.emit('message.created' {conversationId, messageId, seq, ...} — no body)
  → client re-reads through the authorized REST route
```

Clients: Flutter (parent, teacher) and Admin Web (admin, coverage, manager) use the
same REST routes and the same socket contract. Each client subscribes to **every**
conversation in its list, retries only `COMM.UNKNOWN_ACTOR` (the handshake race),
re-subscribes after reconnect and only then catches up (watermark loop + newest
page), and treats events as signals — duplicates cost one idempotent re-read.

## Defects found and fixed

| # | Defect | Fix |
|---|---|---|
| 1 | Flutter had no chat realtime at all (only call signalling used the socket) | `ChatSignal` decoding on the session's one client; `ChatRealtimeCoordinator` |
| 2 | Flutter socket was one app-lifetime object, disposed for good on sign-out: realtime dead for every later session | socket keyed on the account in `bootstrap.dart` |
| 3 | Flutter handed `…/api/v1` to socket.io, which reads it as a namespace: never connected to a real API | `SocketIoRealtimeSocket.originOf` (ported verbatim from unmerged PR #27) |
| 4 | socket_io_client caches one Manager per URL: a reconnect after refresh, or the next session, reused the previous socket and auth | `enableForceNew()` |
| 5 | Admin Web realtime targeted a `/staff` namespace with cookies; its chat called `/families/*` routes that do not exist | default namespace + bearer `auth` function; new `features/chat` workspace on the real API |
| 6 | Every admin read every conversation in the database | staff scope (above) |
| 7 | `GET /approvals/pending` showed every family's held text to any admin | filtered by `canRead` |
| 8 | Realtime events waited up to 5 s (worker idle backoff) | outbox wake hint; measured 103–199 ms |
| 9 | A DB error inside the socket handshake was an unhandled rejection that killed the API process | contained per socket (transport close) |
| 10 | A conversation someone was added to never reached their client until refresh | `conversation.membership_changed` on create + `conversation.added` to the added actors' rooms |
| 11 | An approved message keeps its send-time seq, so "after my newest seq" never fetched it | clients fetch `after = seq - 1` for a lower seq |
| 12 | Malformed ids returned 500 | treated as unknown (401/404) |
| 13 | No way to approve a held teacher/parent group message from Admin Web | Approve / Reject on held messages (server decides who may) |
| 14 | RT-031: calls and notifications filed under the default organization; cross-tenant participants/recipients routable | tenant from the conversation/recipient; worker filters; 4 DB guards (`20261014140000`) |
| 15 | RT-033: concurrent approve/reject (or double approve) could both win | the decision claims the PENDING row |
| 16 | RT-034: any manager (any tenant) or out-of-scope admin could decide an approval; deactivated manager too | `decide` runs `canReadResolved`; `canApprove` checks activity |
| 17 | RT-035: reactions and typing indicators still worked in a PD-6-era direct teacher↔parent conversation | refused (`isDirectTeacherParent`); Flutter shows it read-only |
| 18 | Outbox claim precision (issue #29): a row stamped 1 ms after the claim clock waited a pass | 1 ms claim tolerance; deterministic test |
| 19 | A delivery refused at the socket was silent in the logs | counted warning (no ids, no content) |
| 20 | A lost realtime event had no upper bound on staleness | 60 s safety resync (Flutter coordinator, Admin Web thread) |
| 21 | RT-032: a deactivation written to the database (any writer) never ran the completion barrier; request roles could deactivate through RLS grants | journal in the deactivating transaction (ENABLE ALWAYS triggers, request roles refused) + `RevocationConfirmer` runs the barrier and stamps completion; operator CLI waits for it (`docs/security/DEACTIVATION.md`) |
| 22 | Send, react, approve, call start/accept and media-token issue checked liveness only at authentication, so a deactivation could commit between the check and the operation's commit | each re-reads liveness under `FOR SHARE` in its own transaction (`ConversationService.assertActorLive`) |
| 23 | A deactivated person's open socket stayed connected until the 15 s sweep | disconnected on confirmation (cleanup; delivery checks remain the control) |
| 24 | A push scheduled before a deactivation (quiet hours, retries) was still sent after it: liveness was checked only when scheduling | dispatch re-reads liveness (principal + login) at send time and cancels; the confirmer cancels what is still scheduled |
| 26 | RT-037: attachment and story media were presigned storage URLs, usable after a deactivation until expiry | media route: links bound to the reader, re-authorized on every request, bytes streamed by the API |
| 27 | RT-037: a deactivated person stayed in a live LiveKit room; a still-valid token could re-join | removal via RoomService before confirmation; join-time ejection on `participant_joined` |
| 28 | RT-038: every real LiveKit webhook was refused (bearer guard; `application/webhook+json` raw body never captured) | `@Public()` on the webhook controller; a raw-body parser for that one type |
| 29 | The legacy Inbox (its API routes exist on no branch) was offered in navigation | `navAreas()` leaves it out; its route stays for old links |
| 25 | Delivery refusals were logged but not counted | `realtime` counters on `/health/ready` (counts only), beside each log line; `checks.revocations` reports unconfirmed deactivations |

## Evidence

- Round 3 (2026-10-14, final code): API unit 582/582, integration 47/47 suites (949 passed,
  1 skipped); Admin Web 136/136 + typecheck + build; Flutter analyzer clean, 1113 passed,
  17 skipped (16 env-gated live suites + `realtime_live_test`, which passes 1/1 against QA);
  migtest 20/20 (PD-7, RT-031), migtest32 25/25. Combined tree: see the integration map §6.
- Live QA (round 3): e2e 55/55 and a 10-run soak 550/550; sessions 30/30; RT-032 operator probe
  11/11; 100-message stage probe 100/100, 0 duplicates, 0 missing, POST-return → arrival
  p50 91 ms / p99 132 ms / max 132 ms.
- One transient in round 3: in the first full integration run `auth-trusted-proxy.spec.ts` failed
  to start ("Connection is closed" from its Redis client); alone it passed 3/3 and the full re-run
  passed 47/47. Recorded, not explained.
- API unit and integration suites, Flutter and Admin Web suites (earlier rounds): see the final report.
- Live probe (real logins, sockets, worker, isolated DB/Redis): 55 checks, the test
  matrix in executable form; 19 consecutive green runs after the latency fix.
- Flutter's real socket stack against the real API: `test/integration/realtime_live_test.dart`
  (skipped unless `JAWWID_RT_*` is set).
- Admin Web in a browser: admin reply reached a parent socket; teacher message held,
  approved in Admin Web, delivered to the parent with its original seq.

## The unexplained missed delivery (2026-10-14 investigation)

One live check missed once, in the first 3 runs after the latency fix, and never again:
40-run soak at production poll settings (2,200 checks), 150-message stage probe (p50 83 ms,
p99 200 ms, max 351 ms, 0 missing, 0 duplicates), 30-check session probe. Persisted outbox rows
cover that run: **no event after the fix took more than 334 ms from insert to worker claim and
none was retried**, so the worker side was healthy; the API log of that process was overwritten
by a later restart, so the delivery-side cause is **not established**. Mechanisms that can
delay or drop the last hop, and what now bounds each: claim precision (fixed, deterministic
test); a delivery refused under row-lock / lease / fence rules (now logged; healed by the next
event, reconnect, or the 60 s safety resync); Redis outage (events return to the outbox and are
delivered after recovery — tested live). Missed, duplicated and early wake hints are covered by
`outbox-pacer.spec.ts`; the outbox stays the source of truth.

## Known limits

- A covering admin who is not a member learns of a brand-new conversation of a covered
  family by the 60 s list poll, not by an event (no membership row = no room).
- Typing indicators and presence exist server-side but no client renders them.
- Read receipts per message are not emitted (`message.receipt.updated` is declared,
  never enqueued — pre-existing).
- **RT-032 is CLOSED** (2026-10-14): a deactivation is complete only when an API node has run
  the completion barrier after its commit, whoever wrote it; until then nobody is told it is
  complete (the CLI exits 75, `/health/ready` reports unconfirmed revocations). The window
  between commit and confirmation still exists — emits are not transactional — and is pinned by
  a test; the guarantee is that nothing decided before the commit emits after the confirmation.
- **RT-037 is OPEN**: media credentials issued before a deactivation (attachment URLs ≤ 300 s,
  LiveKit tokens ≤ 120 s, an already-joined LiveKit session until it ends) are bearer
  credentials this API cannot recall; no LiveKit room control exists. See the findings record.
- RT-031 is CLOSED (see the findings record).
- Admin permissions are scope-by-existing-facts (membership, ownership, duty, live stickiness;
  managers org-wide) — see "Admin authorization" below.

## Admin authorization — what exists, what is undefined (2026-10-14)

**In force (this task, on existing data only):** `manager` reads every conversation of their
organization; `admin` / `coverage` read a conversation they are a live member of, or whose family
they own (`family.owner_id`), are on duty for (coverage engine), or are the live sticky handler of;
approving needs that read plus `canApprove` (manager, or the active handler); another tenant reads as
not found. `super_admin` has the read-only `/admin` inspection from the bootstrap work.

**What the staff-profile work on `integration/admin-profile-2026-10-14` adds** (read-only review):

| Table / policy | What it is | Does it reach conversations? |
|---|---|---|
| `chat.staff_profile` | job title, introduction, photo | no |
| `chat.staff_responsibility` | descriptive labels in 14 categories (`family_follow_up`, `message_moderation`, `complaints_escalations`, `team_management`, …) with a free-text scope note | **no** — not bound to any family, learner or conversation |
| `chat.staff_reporting_line` | at most one manager per staff member ("team" = direct reports) | **no** — its own comment: "never widens family, conversation or message access" |
| `StaffProfilePermission` keys | `profile.self.edit`, `team_profiles.*`, `org_profiles.*`, `reporting_lines.manage`, `profile_audit.read` | no — profile visibility/editing only |
| `ownershipActions` / `chat.require_family_assigner`, `require_super_admin` | assign or transfer a family's owner: manager or super_admin; deactivate / offboard staff: super_admin | indirectly — the family owner is one of the scope facts above |

**Undefined (product decisions, not invented here):** whether a manager's conversation scope should
narrow to their reports' families; whether a responsibility label (e.g. `message_moderation`,
`family_follow_up`) should grant approval rights or visibility; whether a reporting line should widen
anyone's view; how coverage interacts with teams; whether `super_admin` should ever take part in a
conversation rather than inspect it. Any of these would refine `staffInScope` / `canApprove`, not
replace them.
