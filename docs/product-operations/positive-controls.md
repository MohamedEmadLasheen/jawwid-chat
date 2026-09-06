# Positive Controls — Do Not Lose in Reconciliation

**Owner:** AI #8 · **Date:** 2026-09-05
**Purpose:** reconciliation destroys things silently. This is the list of controls that must
still be present and provably working **after** AI #10 merges. Each has a verification
command so its survival is a fact, not an assumption.

A control that disappears during a merge fails silently — nobody gets an error when a
protection stops existing. That is why this list exists separately from the findings.

---

## PC-1 · Phone privacy by construction
**What.** The `Actor` type carries no phone, email or address; `chat.contact` has no phone
column. The communication engine has **no code path that can obtain a phone number**, so one
cannot leak through a message, thread payload, realtime event, push payload, call setup or
error message. This is stronger than a redaction filter: there is nothing to redact.
**Owner.** AI #1 · **Gate.** release-gate G-07 · **Also credited.** AI #5 PF-1
**Verify.** `grep -rin "phone\|msisdn\|mobile_number" apps/api/src supabase/migrations` returns
nothing that stores or transports a number. `apps/api/src/platform/types.ts` — the `Actor`
interface field list.
**Risk in reconciliation.** A Core-integration boundary that mirrors a parent record could
introduce a phone column by default. **Extend this control to the Core boundary and to call
signalling.**

## PC-2 · One centralized server-side authorization service
**What.** A single `AuthorizationService` with an explicit contract: *"No controller, gateway,
or worker is permitted to make its own access decision."* Exactly the right shape, and the
prerequisite for release-gate G-04 (one policy for messaging **and** calling).
**Owner.** AI #1 · **Gate.** G-04 · **Also credited.** AI #5 PF-2
**Verify.** `apps/api/src/platform/authorization.service.ts` exists and is the only module
deciding access; no second matrix appears for groups or calls.
**Risk.** Implementing Student Groups or calling with their own checks (DB-M7).

## PC-3 · BR-1 enforced in the database, not only in the API
**What.** `chat.enforce_direct_conversation_rules()` fires on insert **and update** of
`chat.conversation_member` and raises if a live `direct` conversation would contain both a
`teacher` and a `contact`. Its own comment: *"Even a compromised API or a manual SQL session
cannot create a teacher↔parent 1:1 channel."* It also caps a direct conversation at two live
participants, closing the add-member escalation path.
**Owner.** AI #1 · **Gate.** G-01, G-02 · **Landed.** `20260905093000_chat_communication.sql`
**Verify.** the trigger `conversation_member_br1` exists after migration.
**Risk.** Losing it if the SQL series is rebuilt or if Prisma becomes the schema authority.
**Note.** This is a backstop. It does not replace the API-side policy (PC-2), and BR-1 at
group→direct promotion is still **UNVERIFIED**.

## PC-4 · One official Student Group per learner
**What.** `create unique index conversation_one_group_per_learner on chat.conversation
(learner_id) where type = 'student_group' and archived_at is null`. Correctly scoped to live
groups, so archiving frees the learner.
**Owner.** AI #1 · **Fixes.** CF-03 / X-06 / FS-05
**Verify.** the partial unique index exists; a family with three learners can hold three live
groups.
**Risk.** `Thread @@unique([familyId, kind])` surviving in Prisma re-breaks it (DB-M2).

## PC-5 · Ownership permanence
**What.** `chat.family.owner_id uuid not null references chat.staff (id) on delete restrict`.
One family, one owner, always; an owner cannot be deleted out from under a family. No code
path anywhere writes `owner_id` as a side effect of coverage, handoff, workload or escalation.
**Owner.** AI #1 · **Gates.** G-12, G-13
**Verify.** the NOT NULL and `on delete restrict` survive; `grep -rn "owner_id\s*="` finds no
assignment outside a transfer path.
**Gap that does not diminish the control.** `transfer_ownership()` and its trigger still do
not exist (OW-1/OW-2) — the *permanence* holds; the *audited change path* is missing.

## PC-6 · Primary Owner and Current Handler are distinct concepts
**What.** `on_behalf_mode` is **derived** from `on_duty()` + ownership and never trusted from
the client for OWNER vs COVERAGE. The UI vocabulary reinforces it: *"Covering for {name}"*,
never *"assigned to"*; *transfer* is reserved for ownership alone.
**Owner.** AI #1 (derivation) + AI #6 (vocabulary) · **Also credited.** AI #5 PF-4
**Verify.** `authorization.service.ts::deriveMode()`; `docs/design/terminology.md` §1, §5.
**Known exception, tracked.** The MANAGER branch still accepts a client-supplied mode
(FS-12). Fixing that strengthens this control; it does not invalidate it.

## PC-7 · Internal-note privacy and legitimate on-duty access
**What.** Contacts can never read `visibility=internal` messages and can never write them;
`canReadInternal()` is restricted to family-facing staff. Separately, the model deliberately
permits *"any admin may open any family and write internal notes any time"* — legitimate
access is preserved rather than over-restricted.
**Owner.** AI #1 · **Gate.** G-08
**Verify.** the visibility filter in the message read path excludes INTERNAL for non-staff.
**Risk.** A teacher actor kind now exists. **Teachers must be excluded from internal notes on
the same terms as contacts** — verify explicitly after reconciliation; this was written before
`ActorKind.TEACHER` existed.

## PC-8 · Idempotency, ordering and no-loss delivery
**What.** Per-conversation monotonic `seq` assigned under a row lock (`SELECT … FOR UPDATE`),
so ordering never depends on a device clock; `client_message_id` idempotency with a unique
constraint **and** a P2002 recovery path, so a retry after a timeout produces exactly one
message; a transactional outbox, so a committed message always produces its realtime and
notification effects; monotonic receipts (SENT < DELIVERED < READ) that make reconnect replay
safe.
**Owner.** AI #2 · **Gates.** G-15, G-16 · **Baseline.** FS-23, FS-24 verified correct by design
**Verify.** the unique indexes `message_conversation_seq` and `message_idempotency` in
`20260905093000_chat_communication.sql`; the outbox table and the `FOR UPDATE` lock.
**Risk.** These are algorithms living in the Node layer that currently does not compile
(NF-01). **They must be carried across the refactor, not rewritten.**

## PC-9 · Existing authorization regression tests
**What.** `apps/api/test/unit/red-team/authz-attacks.spec.ts` and
`storage-and-integrity-attacks.spec.ts`, plus AI #4's 74 tests across RBAC, composer authority,
realtime and i18n/RTL, and AI #5's BR-1 matrix as pending specs.
**Owner.** AI #5 (+ AI #4) · **Gates.** G-36, G-38
**Verify.** the suites exist and execute in CI after reconciliation.
**Risk.** Tests referencing deleted modules (`thread.service.ts`) get deleted rather than
ported. **A red-team test deleted during a refactor removes a control without any signal.**

## PC-10 · Structural absences that are themselves controls
**What.** No queue table. No round-robin. No "least loaded". No stored `priority` column. No
customer-facing AI. No AI-initiated state changes. Each of these is a design constraint the
brief called non-negotiable, and each has been respected under pressure.
**Owner.** all · **Gates.** G-23, G-31, G-35
**Verify.** `grep -rin "round.robin\|least.loaded\|priority\b" ` finds no assignment mechanism;
attention and workload remain computed, never stored or user-entered.
**Risk.** The highest-risk moment for these is exactly a reconciliation under schedule
pressure, when "just add an assignment table" looks like the quick fix.

---

## Post-reconciliation checklist

AI #10 should be able to tick all ten before declaring reconciliation complete:

- [ ] PC-1 no phone field reachable, including through the new Core boundary
- [ ] PC-2 exactly one authorization service; no second matrix for groups or calls
- [ ] PC-3 `conversation_member_br1` trigger present and firing
- [ ] PC-4 `conversation_one_group_per_learner` present; no Prisma constraint contradicts it
- [ ] PC-5 `owner_id` NOT NULL + `on delete restrict`; no side-effect writes
- [ ] PC-6 `on_behalf_mode` derived, not client-supplied (manager branch included)
- [ ] PC-7 internal notes unreachable by contacts **and teachers**
- [ ] PC-8 seq lock, idempotency unique + recovery, outbox, monotonic receipts all carried over
- [ ] PC-9 every red-team and RBAC suite ported and executing in CI
- [ ] PC-10 no queue, no routing, no stored priority, no customer-facing AI
