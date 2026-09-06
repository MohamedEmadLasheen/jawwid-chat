# Test contract (AI #5)

The invariants this domain claims, where each is enforced, and what already has
coverage. Everything below is executable today.

```bash
scripts/db/integration-db.sh reset
cd apps/api && npm test          # 160 tests: 84 unit, 76 integration
```

Integration tests need the composed migration set (`JAWWID_COMPOSE=1`), because
`20260905093000_chat_communication` depends on `chat.family` / `chat.thread` /
`chat.staff` from `feat/backend-foundation`.

## Invariants

### I-1 · BR-1 — teacher ↔ parent direct communication is impossible

Enforced in four independent places:

| # | Where | Mechanism |
|---|---|---|
| 1 | `AuthorizationService.canOpenDirect()` | the channel is never created |
| 2 | `canSend()` / `canCall()` | refused even if one existed |
| 3 | `chat.enforce_direct_conversation_rules()` | membership row rejected |
| 4 | `chat.enforce_conversation_type_immutable()` | group cannot become a 1:1 (**JC-008**) |

Covered by `br1-conformance.spec.ts` (the matrix QA specified, now executable) and
by `communication-engine.spec.ts`, which attacks the database directly with raw
SQL — bypassing the API entirely — and is still refused.

The permitted case is also asserted: teacher and parent messaging **and calling**
inside the Student Group, and Teacher↔Admin 1:1, which must not be caught by the
rule.

### I-2 · Phone numbers cannot leak

Structural, not filtered: no table in the chat schema has a phone, email or
address column, so no code path can obtain one. Guarded by AI #5's own
`no-contact-channel-columns.spec.ts` tripwire. Additionally asserted for call
history and LiveKit token claims.

### I-3 · Idempotent send

`(conversation_id, author_id, client_message_id)` unique where not null. Verified
for sequential repeats and a 5-way concurrent burst. The pre-check is only an
optimisation; the index plus `P2002` handling is the guarantee.

### I-4 · Deterministic ordering

`seq` assigned under `SELECT … FOR UPDATE`. Verified gap-free `1..10` under ten
concurrent sends. Device clocks are never consulted.

### I-5 · Approval contains a pending message

A pending message: has **no receipts**, emits **no** `message.created`, is
invisible to other group members, is visible to its author and to family-facing
staff, and does not advance `last_customer_message_at`. All five asserted.

Approval is once-only; a rejection requires a reason; the approver cannot edit
(the database refuses).

### I-6 · Notification dedupe

`chat.notification.dedupe_key` is UNIQUE and `schedule()` treats a duplicate as
success. Verified for sequential repeats, a 6-way concurrent burst and a re-run
reminder sweep.

### I-7 · Delivery state is never fabricated

A dispatched push stays `sent` until a client or provider reports otherwise.
Asserted explicitly — a test fails if `delivered` is ever set by dispatch.

### I-8 · Receipts are monotonic

`sent < delivered < read`. A late replayed `delivered` cannot downgrade a `read`.
This is what makes offline replay safe.

### I-9 · Message integrity

`body`, `author`, `conversation_id` and `seq` are immutable after send
(`chat.forbid_message_rewrite`). Moderation decisions and soft deletes remain
possible — see D-4 in [scope-decisions.md](scope-decisions.md) for why the
blanket `message_is_immutable` trigger was narrowed, and the two tests in
`schema-invariants.spec.ts` proving it was narrowed rather than removed.

### I-10 · Call tokens

Issued only after: actor resolves, call is live, actor is a recorded participant,
actor is still a conversation member, and the matrix still permits the call.
Room names are server-minted; a client-supplied room name is never trusted.
Tokens are ≈120 s and scoped to one room, with `roomCreate: false`.

### I-11 · Membership is server-owned

Only family-facing staff may mutate it, always with a `reason` written to
`chat.audit_log`. A parent removing the admin from a group (a BR-1 bypass) is
refused.

## Red-team findings now fixed

Assertions were inverted in place, per the red-team suites' own instruction, so a
regression fails the build.

| ID | Finding | Fix |
|---|---|---|
| RT-002 | authorization keyed on `familyId` alone, no participant set | conversation membership is now the subject of every decision |
| RT-003 | a manager could stamp any `on_behalf_mode`, including OWNER | mode derived from `on_duty()` + family ownership |
| RT-004 | COVERAGE asserted on the internal-note path with no assignment | same derivation; off-duty non-owner is `assist` |
| RT-005 | signed-URL secret defaulted to a value committed to git | no default; startup fails without a ≥32-char secret |
| RT-007 | MIME/size limits enforced only at upload authorization | enforced on the send path every caller takes |
| RT-008 | client could send `type: system` / arbitrary `origin` | both forced server-side for non-system actors |
| JC-008 | group convertible to a 1:1 by UPDATE | `conversation_type_immutable` trigger |

`JC-005` / `JC-006` (assist/escalation bypass) were fixed by QA directly in
`AuthorizationService`; that fail-closed behaviour is kept and is now asserted by
`matrix-and-handling.spec.ts`.

## Gaps worth your attention

1. **Assist/escalation fail closed** and therefore the *permitted* assist case
   has no implementation to test. Needs AI #1's attention engine. This is the
   largest functional gap.
2. **Teacher identity is a stub** — resolved via `chat.learner.teacher_id`. Every
   teacher test depends on it, so it should be re-run when AI #1 lands C-1.
3. **No scheduler.** `OutboxWorker.drain()` and `NotificationService.dispatchDue()`
   are tested by direct invocation; nothing runs them on a timer. Until BullMQ is
   wired, realtime fan-out and push do not happen on their own in a deployed
   system. **Do not pass a release gate that assumes they do.**
4. **No load or latency testing.** The PRD targets (fan-out < 500 ms p95, push
   < 2 s, call setup < 3 s) are unverified. Sends to a single conversation
   serialize on the `seq` row lock by design — that is the thing to measure.
5. **Two idempotency mechanisms coexist** (AI #1's `(thread_id, client_id)` and
   this domain's). Both correct; needs reconciliation with AI #1.
6. **RLS is untested from the app's connection.** Tests connect as `postgres`,
   which bypasses row-level security. AI #1's policies are therefore not
   exercised by this suite.

## Security-sensitive endpoints

Highest value for adversarial testing, in order:

1. `POST /calls/:id/token` — the only endpoint that mints a credential.
2. `POST /conversations/direct` — the BR-1 creation path.
3. `POST /conversations/:id/members` — membership is the BR-1 subject.
4. `POST /approvals/:id/approve|reject` — publishes content to a group.
5. `POST /conversations/:id/messages` — authorization, idempotency, ordering.
6. `conversation.subscribe` over websocket — must match REST authorization
   exactly; a divergence here is a silent read bypass.
