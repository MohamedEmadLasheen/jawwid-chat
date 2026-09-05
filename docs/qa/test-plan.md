# Jawwid Chat — Master Test Plan

Date: 2026-09-05 · Owner: AI #5
Authoritative scope: `docs/qa/authoritative-scope.md` (PRD v0.1).
Status of all suites: **NOT RUN — implementation in progress.**

Every test is asserted **server-side against the API**. Client behaviour is
tested separately and is never accepted as evidence that a rule is enforced.

---

## 1. Invariant register

| ID | Invariant |
|---|---|
| **INV-1** | **BR-1:** no 1:1 conversation or call may exist between a teacher and a parent. Teacher↔Parent communication occurs only in the official Student Group with required admin presence/authorization. Enforced server-side. |
| INV-2 | Exactly one centralized authorization policy governs messaging **and** calling. No controller, gateway, worker or client makes its own decision. |
| INV-3 | Phone numbers never appear in any product surface (§14). |
| INV-4 | Every family has exactly one Primary Owner. **Primary Owner ≠ Current Handler.** |
| INV-5 | Coverage, handoff and workload **never** change Primary Ownership. |
| INV-6 | A family has exactly one current handler at any moment — never two, never zero (Unattended counts as one). |
| INV-7 | Ownership changes only via `transfer_ownership()`, writing `audit_log` in the **same transaction**. |
| INV-8 | Attention and workload are **computed** server-side from `config`; never client-set, never stored as priority, never recomputed by a frontend. |
| INV-9 | A PENDING message is never delivered, pushed, searchable, or emitted on realtime to anyone but its author and an authorized approver. |
| INV-10 | Rejection requires a reason. Self-approval is forbidden. |
| INV-11 | Internal notes (`visibility=internal`) are unreachable by any parent or teacher, through any surface. |
| INV-12 | `message`, `event_log`, `audit_log` are immutable / append-only. `audit_log` is manager-read-only. |
| INV-13 | One logical message per idempotency key — no duplicate customer message under retry, reconnect or double-submit. |
| INV-14 | Server ordering is authoritative; client timestamps are never trusted for ordering. |
| INV-15 | No customer message is lost across restart, reconnect, retry, worker crash or client crash. |
| INV-16 | Jawwid Core is the source of truth for families, parents, learners, teachers, enrolments and subscriptions. Chat never becomes a second source of truth. |
| INV-17 | Realtime subscribers receive only events within their authorization scope. |
| INV-18 | Group membership grants no 1:1 channel and no contact directory. |
| INV-19 | MVP contains no AI scoring, no video calling, no labels, no broadcast, no approval escalation/expiry. |

---

## 2. Test layers

| Layer | Scope | Gating |
|---|---|---|
| L1 Unit | authorization matrix, `on_duty()`, attention, workload, config | blocking |
| L2 DB | constraints, append-only triggers, transactional atomicity, race conditions | blocking |
| L3 API contract | schema, errors, pagination, idempotency, authz per endpoint | blocking |
| L4 Integration | coverage↔inbox↔attention; approval↔delivery; task↔case; Core boundary | blocking |
| L5 Realtime | event scoping, reconnect, ordering, duplicate suppression | blocking |
| L6 Calling | permission, token scope, join/leave, group calls, privacy | blocking |
| L7 Mobile (Parent, Teacher) | offline queue, multi-device, push, deep links | blocking |
| L8 Admin Web | inbox, Family 360, approvals, tasks, dashboard, RTL | blocking |
| L9 Security | IDOR, escalation, session, leakage, uploads, storage | blocking |
| L10 Performance & load | inbox, search, dashboard, realtime fan-out | risk-rated |
| L11 Deployment & observability | migrations, health, logs, alerts, rollback | blocking |
| L12 Regression | one test per fixed defect | blocking |

---

## 3. BR-1 — Teacher ↔ Parent prohibition (highest priority)

Attacked from every surface. A pass requires **every** row to be denied by the
**server**, with an empty body.

| ID | Attack | Expected |
|---|---|---|
| BR1-01 | Teacher creates 1:1 conversation with a parent via API | DENY |
| BR1-02 | Parent creates 1:1 conversation with a teacher via API | DENY |
| BR1-03 | Teacher sends a message to a parent-owned 1:1 thread id | DENY |
| BR1-04 | Teacher places a 1:1 voice call to a parent | DENY |
| BR1-05 | Parent places a 1:1 voice call to a teacher | DENY |
| BR1-06 | Teacher and parent are co-members of a group; either opens a 1:1 with the other | DENY (INV-18) |
| BR1-07 | Add a **parent** to an existing Teacher↔Admin 1:1 conversation | DENY |
| BR1-08 | Add a **teacher** to an existing Parent↔Admin 1:1 conversation | DENY |
| BR1-09 | Remove the admin from a Student Group, leaving teacher+parent alone | DENY (or group auto-invalidated — must be specified, AMB-9) |
| BR1-10 | Convert / "promote" a Student Group into a 1:1 by removing members | DENY |
| BR1-11 | Teacher subscribes to a parent's 1:1 realtime channel | DENY, no events delivered |
| BR1-12 | Teacher searches for a parent and retrieves contact details | DENY |
| BR1-13 | Teacher joins a call room belonging to a Parent↔Admin call | DENY at token issuance **and** at room join |
| BR1-14 | Teacher requests a call token for an arbitrary room id | DENY |
| BR1-15 | Direct websocket frame bypassing REST | DENY |
| BR1-16 | Replay a valid admin-issued request with a teacher session | DENY |
| BR1-17 | Deep link `…/conversation/<parent_1to1_id>` opened by teacher | DENY server-side; client route param never trusted |
| BR1-18 | Push notification for a parent 1:1 delivered to a teacher device | never emitted |
| BR1-19 | Teacher mobile client with policy patched out (simulated hostile client) | server still denies **every** BR1 row |
| BR1-20 | Teacher↔Parent conversation created directly in the database | detected by an invariant check; no API surfaces it |

**BR1-19 is the acceptance test for the whole rule.** It is run with client-side
policy disabled. If any row passes, BR-1 is not implemented.

---

## 4. Student Groups

| ID | Case | Expected |
|---|---|---|
| SG-01 | Group exists for each learner per Jawwid Core relationships | membership derived from Core, not hand-entered |
| SG-02 | Membership: parents of the learner, assigned teacher, admin presence | exact set asserted |
| SG-03 | Non-member reads group | DENY |
| SG-04 | Non-member posts / joins group call | DENY |
| SG-05 | Member self-adds another user | DENY |
| SG-06 | Parent/teacher removes a member | DENY |
| SG-07 | Teacher reassigned in Core | old teacher loses access; new teacher gains it; history preserved |
| SG-08 | Learner leaves / family churns | group archived; access revoked; history retained |
| SG-09 | Archived group | read-only per policy; no new messages or calls |
| SG-10 | Group is not a directory | no member contact details exposed (INV-18, INV-3) |
| SG-11 | Message ordering and pagination in a large group | server order authoritative |
| SG-12 | Required admin presence | defined predicate enforced at post **and** call time (AMB-9) |

## 5. Approvals (MVP: approve · reject · reason)

| ID | Case | Expected |
|---|---|---|
| AP-01 | Teacher posts where `teacherRequiresApproval` | message enters PENDING, is not delivered |
| AP-02 | Parent posts where `parentRequiresApproval` | same |
| AP-03 | Approver approves | message becomes published exactly once; delivered; realtime emitted; push sent |
| AP-04 | Approver rejects **with** reason | stays rejected; author informed; never delivered |
| AP-05 | Reject **without** reason | DENY (INV-10) |
| AP-06 | Author approves own message | DENY (INV-10) |
| AP-07 | Parent/teacher attempts approve or reject | DENY |
| AP-08 | Admin not on_duty attempts approve | DENY |
| AP-09 | **PENDING privacy** — recipient, other parents, other teachers, non-approver admins, search, realtime, push, exports | never visible (INV-9) |
| AP-10 | **Race:** two approvers approve simultaneously | one final state; delivered **once** |
| AP-11 | **Race:** approve and reject simultaneously | one final state; deterministic; audited |
| AP-12 | Approve an already-rejected message (and vice versa) | DENY — terminal states |
| AP-13 | Edit a pending message | DENY |
| AP-14 | Approval escalation / expiry present | **FAIL — Phase 2 (INV-19)** |
| AP-15 | Every approval decision audited with actor, timestamp, reason | audit entry exists |

## 6. Calling (voice; 1:1 and group)

| ID | Case | Expected |
|---|---|---|
| CL-01 | Admin↔Parent, Admin↔Teacher 1:1 voice | ALLOW |
| CL-02 | Teacher↔Parent 1:1 voice | **DENY** (BR1-04/05) |
| CL-03 | Group voice call inside a Student Group | ALLOW for members only |
| CL-04 | Non-member joins group call | DENY |
| CL-05 | Call token is **server-generated**, short-lived, scoped to one room and identity | asserted |
| CL-06 | Client forges or reuses a token / requests an arbitrary room | DENY |
| CL-07 | Token remains valid after permission revoked mid-call | must terminate access |
| CL-08 | Call authorization uses the **same** policy as messaging | INV-2 — no second matrix |
| CL-09 | Call lifecycle: initiate, ring, join, leave, end, missed, reconnect | states correct |
| CL-10 | Call history: participants, type, start, duration, outcome | correct |
| CL-11 | **No phone number** in call setup, signalling, metadata, history or push | INV-3 |
| CL-12 | Video call available | **FAIL — Phase 2 (INV-19)** |
| CL-13 | Recording present | FAIL unless explicitly approved |
| CL-14 | Background / terminated app receives call push and joins correctly | Parent + Teacher apps |

## 7. Notifications, reminders, push

| ID | Case | Expected |
|---|---|---|
| NT-01 | Message, approval, call, reminder, operational events | delivered to authorized recipients only |
| NT-02 | Deterministic dedupe | one event ⇒ one notification |
| NT-03 | Status lifecycle: scheduled → sent → delivered → opened / failed | tracked |
| NT-04 | Quiet hours honoured; urgent overrides per backend policy; timezone boundaries | no invented behaviour |
| NT-05 | Reminder scheduling, dedupe, retry, cancellation, rescheduling | correct |
| NT-06 | Arabic and English templates; variable substitution | correct, no leakage |
| NT-07 | **Payload privacy** — no phone number, no internal note, no pending message body | INV-3, INV-9, INV-11 |
| NT-08 | Deep link opens the correct conversation/group/call/task, and **never** unauthorized content | server re-authorizes on open |
| NT-09 | Invalid / expired / dead device token; provider failure | retry, then prune; **no notification storm** |
| NT-10 | Multi-device fan-out and read-state suppression | consistent |

## 8. Ownership vs Coverage

| ID | Case | Expected |
|---|---|---|
| OC-01 | Every family has exactly one Primary Owner | INV-4 |
| OC-02 | Owner off-shift, coverage active, parent messages | coverage handles; **owner unchanged** (INV-5) |
| OC-03 | Handoff occurs | owner unchanged; handoff recorded with reason |
| OC-04 | Workload reaches maximum | **no automatic reassignment** (INV-5) |
| OC-05 | Manager transfers ownership | audit written in same transaction; history preserved (INV-7) |
| OC-06 | Non-manager transfers ownership | DENY |
| OC-07 | Ownership changed by direct UPDATE outside `transfer_ownership()` | impossible via API; DB guard recommended |
| OC-08 | Concurrent transfers on one family | serialized; one wins; both audited |
| OC-09 | Coverage transitions: before / at start / during / at end / after shift | exactly one handler throughout (INV-6) |
| OC-10 | Overlapping coverage rules | deterministic (AMB-3) |
| OC-11 | Friday coverage | correct handler |
| OC-12 | Absence with backup / backup out of shift / backup also absent | chain resolves per spec |
| OC-13 | Nobody on duty | Unattended + manager alert; **never silently assigned** |
| OC-14 | Cairo timezone incl. DST transition | no coverage gap (AMB-4) |
| OC-15 | Owner ≠ current handler rendered correctly everywhere | Family 360, inbox, dashboard |

## 9. Workload & attention

| ID | Case | Expected |
|---|---|---|
| WA-01 | Attention computed from rule-based signals only | **no AI scoring** (INV-19) |
| WA-02 | All weights/thresholds read from `config`, never literals | INV-8 |
| WA-03 | Client submits an attention/priority/workload value | rejected (INV-8) |
| WA-04 | Frontend implements its own workload/attention calculation | **FAIL** — single backend source |
| WA-05 | Workload states and thresholds | per PRD; asserted at each boundary |
| WA-06 | Workload escalation LOW→…→highest | visible to admin and manager; **no ownership change** |
| WA-07 | Attention states drive inbox ordering; reason shown as readable text | correct |
| WA-08 | Complaint does not auto-become top priority unless backend rules say so | asserted |
| WA-09 | Family count contributes zero to workload | asserted |
| WA-10 | Tasks and follow-ups included in workload where backend defines them | consistent |

## 10. Tasks & follow-ups

TF-01 create · TF-02 assign · TF-03 edit · TF-04 complete · TF-05 reopen ·
TF-06 due date · TF-07 overdue surfacing · TF-08 follow-up appears in task list ·
TF-09 internal staff see **only** their own tasks and can never message families ·
TF-10 task completion transitions the case correctly · TF-11 permissions per §4 ·
TF-12 concurrent completion of the last open task fires the transition **once**.

## 11. Manager Dashboard

MD-01 team workload · MD-02 attention/backlog · MD-03 Unattended count ·
MD-04 escalations · MD-05 coverage tonight / next Friday / 7-day gaps ·
MD-06 ownership management · MD-07 approvals oversight · MD-08 operational
metrics · MD-09 **ordinary admin and coverage cannot reach any manager-only
control or endpoint** · MD-10 one-click offboarding: deactivate, redistribute,
flag orphaned coverage rules, notify, audit · MD-11 dashboard figures reconcile
with backend engines (no second calculation).

## 12. Jawwid Core integration boundary

| ID | Case | Expected |
|---|---|---|
| JC-01 | Families, parents, learners, teachers, enrolments, subscriptions sync from Core | Core authoritative (INV-16) |
| JC-02 | `chat.core_*` boundary views are **read-only** | writes rejected |
| JC-03 | No `chat.*` table duplicates a Core-owned entity as a second source of truth | schema review + test |
| JC-04 | Teacher reassignment, learner change, family change in Core | propagates to groups, ownership context, Family 360 |
| JC-05 | Core unavailable | Chat degrades safely; failure visible; retry where required; **no fabricated Core data** |
| JC-06 | Partial sync failure | no corrupted state; reconciliation possible |
| JC-07 | Core↔Chat identity mapping | stable across reconnects and renames |

## 13. Realtime authorization

RT-01 subscriber receives only in-scope events (INV-17) · RT-02 teacher never
receives parent 1:1 events · RT-03 parent never receives internal-visibility
content · RT-04 non-member never receives group events · RT-05 event types
covered: message, typing, presence, read receipt, approval, task, coverage,
ownership, call · RT-06 authorization re-evaluated on **reconnect** and on
permission change mid-session · RT-07 disconnect, server restart, network drop →
client reconciles server state · RT-08 duplicate and out-of-order events
suppressed · RT-09 stale connection after logout or offboarding delivers nothing.

## 14. Phone privacy

PP-01 API responses · PP-02 realtime events · PP-03 push payloads ·
PP-04 **call setup, signalling, metadata and history** · PP-05 search results ·
PP-06 deep links · PP-07 error messages · PP-08 server and client logs ·
PP-09 client caches and mobile local storage · PP-10 exports and reports ·
PP-11 admin surfaces · PP-12 devtools network payloads.

Current control is structural — no phone column exists on the communication
path (`defects.md` PF-1). **PP-13:** assert this structurally in CI — a schema
test that fails if a phone/mobile/msisdn column is added to any actor or
communication entity without an accompanying privacy review.

## 15. IDOR & privilege escalation

| ID | Case | Expected |
|---|---|---|
| ID-01 | Manipulate every id: family, conversation, group, message, approval, task, call, learner, contact, staff | 403/404, empty body |
| ID-02 | Horizontal: parent→another family; teacher→another learner's group; admin→another admin's family beyond read policy; coverage→non-covered family | DENY |
| ID-03 | Vertical: admin→manager action; coverage→ownership transfer; teacher→admin endpoint; parent→admin endpoint; internal staff→messaging | DENY |
| ID-04 | Mass assignment: client sets `owner_id`, `on_behalf_mode`, `visibility`, `approval_state`, attention, workload, group membership | ignored/rejected |
| ID-05 | Session: expired, revoked, role-changed, offboarded, logged-out, stolen token | rejected |
| ID-06 | Auth: correct/incorrect password, disabled user, rate limiting, lockout | per policy; **no OTP introduced** |
| ID-07 | Enumeration via error-message differences | uniform responses |

## 16. Offline, reconnect, multi-device

OF-01 compose offline → reconnect → delivered **exactly once** (INV-13) ·
OF-02 multiple queued messages preserve order · OF-03 same idempotency key on
retry/double-tap/timeout ⇒ one logical message · OF-04 server ordering wins over
client timestamps (INV-14) · OF-05 reconnect mid-send at the worst moment ·
OF-06 device A and device B: messages, read receipts, conversation state,
approval state converge · OF-07 authorization identical across devices ·
OF-08 logout on one device does not leak state to another · OF-09 message
survives server restart, worker restart, client crash (INV-15) ·
OF-10 mobile local storage holds no plaintext credentials, and clears sensitive
cache on logout.

## 17. Data integrity & concurrency

DI-01 message/event_log/audit_log immutability (INV-12) · DI-02 audit readable
only by manager · DI-03 audit written in same transaction as the sensitive
action; rollback leaves no orphan change · DI-04 exactly one Primary Owner
constraint · DI-05 group membership integrity · DI-06 approval state machine
transitions only along legal edges · DI-07 concurrent: ownership transfer,
approval, message create, task completion, coverage activation, notification
dedupe · DI-08 no queue/round-robin/auto-distribution table or code path.

## 18. Performance (targets from PRD; local numbers are not evidence)

PF-01 inbox initial load at realistic family/message volume · PF-02 message send
latency · PF-03 realtime delivery latency · PF-04 large Student Group fan-out ·
PF-05 many concurrent websocket connections · PF-06 dashboard aggregates ·
PF-07 search · PF-08 pagination over long histories · PF-09 notification bursts ·
PF-10 call signalling under concurrency · PF-11 queue/job throughput, retry,
dead-letter, worker and Redis restart · PF-12 identify CPU/memory/DB/Redis
bottlenecks under load.

## 19. Deployment & observability

DP-01 migrations apply forward cleanly; rollback strategy defined and tested ·
DP-02 Docker/build reproducible · DP-03 environment separation; no production
credentials or debug mode outside production · DP-04 no secrets in source or git
history · DP-05 health vs readiness checks distinguish DB, Redis, storage, Core,
queue · DP-06 structured logs, metrics, traces, error monitoring ·
DP-07 **log/monitoring redaction**: no tokens, credentials, phone numbers,
internal notes or message bodies · DP-08 graceful startup/shutdown/restart with
no message loss · DP-09 backup and restore documented **and rehearsed**;
RPO/RTO stated · DP-10 disaster behaviour: DB, Redis, storage, push provider,
call provider, Core, worker, websocket server each unavailable · DP-11 CI runs
lint, typecheck, unit, integration, security and migration validation.

## 20. End-to-end suite (`tests/e2e/`)

| ID | Flow |
|---|---|
| E2E-001 | Parent ↔ Admin conversation |
| E2E-002 | Teacher ↔ Admin conversation |
| E2E-003 | **Teacher ↔ Parent direct rejection — every surface (§3)** |
| E2E-004 | Student Group messaging |
| E2E-005 | Approval: submit → pending → approve → delivered; and → reject with reason |
| E2E-006 | Ownership + coverage: owner off shift → coverage handles → **owner unchanged** |
| E2E-007 | Workload escalation with **no** automatic reassignment |
| E2E-008 | Task / follow-up lifecycle into the task list |
| E2E-009 | Notifications and reminders incl. quiet hours |
| E2E-010 | Voice calling: Admin↔Parent, Admin↔Teacher, group call, Teacher↔Parent denied |
| E2E-011 | Family 360 with Owner ≠ Current Handler |
| E2E-012 | Conversation lifecycle incl. resolve and reopen |
| E2E-013 | Multi-device convergence |
| E2E-014 | Offline compose → reconnect → delivered exactly once |
| E2E-015 | Jawwid Core sync: teacher change, learner change, family change |
| E2E-016 | Manager dashboard + one-click offboarding |
| E2E-017 | Admin Inbox full loop: parent message → correct owner → coverage if off-shift → reply → follow-up → resolve → reopen |

## 21. Open specification ambiguities

Each would yield two defensible implementations. **AMB-9 blocks BR-1 testing.**

| ID | Ambiguity | Impact |
|---|---|---|
| **AMB-9** | **"Required admin presence/authorization" in a Student Group is undefined.** Must an admin be a member? online? on-duty? Does a group become invalid if the admin is removed or offboarded? | BR1-09 and SG-12 are unwritable until answered. This is the load-bearing condition of BR-1's *permitted* case. |
| AMB-10 | Preset→capability-flag defaults for the four contact presets are unpublished | seeding unverifiable |
| AMB-3 | No tie-break for equal-priority coverage rules | non-deterministic handler ⇒ INV-6 breach |
| AMB-4 | Shift windows carry no timezone; Egypt observes DST | silent coverage gap ⇒ INV-6 breach |
| AMB-5 | Shift boundary inclusive or exclusive | one-minute zero-handler window |
| AMB-11 | Approval scope: which message types/groups require approval, and who the authorized approver is when the owner is off-duty | AP-08 expectation unconfirmed |
| AMB-12 | Whether an archived group is readable or fully revoked | SG-09 expectation unconfirmed |
| AMB-2 | Attention bucket precedence when a high score coincides with "waiting on family" | inbox ordering differs between implementations |
| AMB-7 | Attention recompute cadence vs. continuously-changing signals | displayed state can disagree with true state at thresholds |
