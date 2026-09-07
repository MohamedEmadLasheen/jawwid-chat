# Phase 6 — Smart Moderation and the Manager Command Center

**Status: CANONICAL.** What Phase 6 actually built, what it deliberately did
not, the three defects found on the way, and the verification record.

Read with `product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` (what the product is),
`architecture/AUTHORIZATION-MODEL.md` (who may do what) and
`security/RLS-STRATEGY.md` (how RLS engages).

---

## 1. The problem Phase 6 was given

Moderation was one predicate, in `chat.conversation`:

```
group conversation + teacher_requires_approval  -> hold
group conversation + parent_requires_approval   -> hold
```

Nothing looked at what the message *said*. Every teacher message in every
Student Group waited for a supervisor, including *"Assalamu alaikum, Yusuf did
very well today"* — so the queue was mostly noise, and the messages that
genuinely needed a human were buried in it. The PRD calls this the MVP's
"simple policy" and schedules escalation, expiry and coverage-aware approval for
later (`jawwid-chat-prd-v0.1.md` §3b and the 2026-09-05 decision row). **This is
later.**

The second half of the phase is a manager's operational board. The brief-era
CRM dashboard was already dead — unrouted since Phase 0, with every query behind
it calling an endpoint the API does not serve — so there was nothing to repair,
only something to replace.

---

## 2. What was built

### 2.1 Smart moderation

A content scan sits in front of the hold decision, at the one server-side trust
boundary every send passes through (`MessageService.send`):

```
scan the body against the enabled rules
  no match  -> send normally
  match     -> hold, recording WHICH rules matched and how severely
```

| Piece | Where |
|---|---|
| The engine — pure, no I/O, no Nest | `communication/moderation/content-scanner.ts` |
| The rule catalogue and its authorization | `communication/moderation/moderation-rule.service.ts` |
| Scan orchestration and escalation | `communication/moderation/moderation.service.ts` |
| The deadline sweep | `communication/moderation/moderation.sweeper.ts` |

**The scanner never returns a boolean.** It returns matches, categories,
severities and excerpts. A boolean answers "hold this?" and destroys the only
thing the moderator needs: *why*. A message sharing a phone number inside a
cancellation request is two problems, and a card that says "flagged" tells its
reader nothing they can act on.

**Arabic is a first-class input, not an edge case.** Three normalisations, each
of which the detectors are useless without:

- **digits** — Arabic-Indic (`٠١٢…`) and Extended Arabic-Indic fold to ASCII, so
  a number written the normal way in an Arabic-first product is detected;
- **diacritics** — harakat and tatweel are optional in writing, so a word with
  them and one without are the same word;
- **orthography** — `أ إ آ` fold to `ا`, `ة` to `ه`, `ى` to `ي`.

Every folding carries an index map back to the original, so the excerpt a
moderator reads is sliced from **what the sender actually typed**, not from the
folded copy. `\b` is not used for word boundaries: it is ASCII-based and matches
nothing useful in Arabic; lookarounds on `\p{L}\p{N}_` ask the real question.

Phone numbers are additionally matched against a **separator-compacted** view,
so `+20 10 1234 5678` and `010 - 1234 - 5678` are found. That pass runs for
phone rules only.

**Detection categories** (`chat.moderation_rule.category`): `phone_number`,
`email_address`, `url`, `forbidden_word`, `forbidden_phrase`, `cancellation`,
`resignation`, `custom`. Adding a ninth is a migration; adding a *rule* in any of
them is an INSERT a manager makes through the UI.

**What ships enabled, and what does not — this is a deliberate line.**

- **Enabled: the structural detectors.** A phone number, an e-mail address and a
  URL are recognisable from their *shape*. Detecting them is not a business
  policy, and PRD BR-2 says why the academy cares: Jawwid Chat exists because
  *"the relationship, the history and the phone number belong to the employee,
  not to Jawwid"*. A teacher passing a parent their own number is the platform
  being routed around.
- **Disabled: the policy categories.** Which words the academy forbids, and what
  counts as a cancellation or a resignation, are business decisions this
  repository does not hold. They ship as visible, editable, **disabled** starter
  rules. Shipping a guessed word list *enabled* would be presenting a guess as
  the academy's policy.

**URL is `medium`, not `high`, and it is a rule.** A teacher linking a recitation
is doing their job. The message is held for a look, not refused — and the academy
can disable the rule, narrow it to an allow-list with a custom regex, or raise
it. That is what "the URL policy is configurable" has to mean to be worth
anything.

### 2.2 Regex safety

Patterns are validated when a rule is **written**, where a human is present to be
told what is wrong — not when it is applied, where the only available response
would be to fail a teacher's message for something they did not do.

Four defences, in order of what actually works:

1. the scanned body is bounded (`communication.message_max_length`, 4000), which
   bounds the base of the exponent;
2. the pattern is bounded (512 characters, enforced by a database CHECK);
3. the **shape check** refuses nested quantifiers — `(a+)+`, `(a*)*`, `(x|x)*`,
   `(\d{1,10})+` — the constructions that backtrack catastrophically;
4. only manager and super_admin may write a rule at all.

This is **not presented as a proof of termination**. JavaScript cannot interrupt
a running regex, so the scan's time budget (`moderation.scan_budget_ms`) is
checked *between* rules and bounds a slow rule *set*, not a single pathological
rule.

**Failure is closed, and visible.** A rule that will not compile, or a scan that
exceeds its budget, does **not** produce `safe`. A moderation control that did
not finish has decided nothing, and reporting "safe" would be reporting our own
optimism. The scan returns FLAGGED with an explicit synthetic match at
`critical`, so the message waits for a human and the queue says why.

### 2.3 The moderation queue

`ApprovalService` was **extended, not replaced**. It already owned the decision,
the authorization, the audit and the realtime wiring, and its queue was already
scoped by construction (red-team A-2). Phase 6 enriched it and added two
actions.

Each card carries: sender **by name**, the group, the reason (one badge per
matched rule, plus the matched excerpt), the timestamp, how long it has waited,
and **the original submitted content in full** — never truncated, never
collapsed. You cannot approve what you cannot read.

Four decisions:

| Action | What it does | What survives |
|---|---|---|
| **Approve** | publishes unchanged, through the normal delivery path | — |
| **Edit then send** | writes the original to revision 1, replaces the body, publishes | original, edited text, moderator, timestamp, and the flags |
| **Reject** | never sends it; reason reaches the sender verbatim | the body is untouched, so the original *is* the row |
| **Delete** | rejects AND soft-deletes through the existing architecture | approval, flags and body all remain |

**Ordering is by TIME, not severity.** Somebody is waiting on every one of these,
and sorting by severity buries the low-severity item that has waited since this
morning under every new critical one. Severity is a badge and a **filter**.
Escalated items sort first — an escalated item is by definition one the ordering
already failed.

### 2.4 Edit then send — a deliberate supersession

`ApprovalService` used to say: *"The approver decides; the approver never edits…
the database refuses such an update outright."* That was the MVP policy and it
was reasonable. Phase 6 supersedes it, because the common case is a message that
is fine except for the phone number in it, and rejecting costs the teacher a
rewrite and the family a delay to remove eleven digits.

**No backstop was weakened to allow it.** `chat.forbid_message_rewrite` still
refuses any body change that is not a *stamped* edit — Phase 2 had already
narrowed it to admit exactly one, and built `chat.message_revision`, whose
revision 1 is "the body the message was SENT with", append-only, protected by its
own trigger. A moderator's edit uses that same mechanism. The trigger is
*satisfied*, not worked around, and a raw `UPDATE … SET body` is still refused
(asserted in `phase6-moderation.spec.ts`).

**The edited body is scanned again.** An approver who removed one of two phone
numbers has not fixed the message, and this is the one path that could otherwise
put unscanned content in front of a family. A still-flagged edit is *refused*,
not held: the approver is present and can fix it now.

### 2.5 Escalation

```
flagged -> pending -> moderation.escalation_hours -> escalated to a manager
```

**What escalation is:** a change of accountability and visibility. **What it is
not:** a send, a rejection, or an expiry. `20260905093000` says a pending message
stays pending until a human decides, and that stays true — escalation changes
*which human is being waited on*.

This closes finding **ES-1** in `product-operations/escalation-model.md` for the
moderation case: *"an escalation that nobody receives is worse than none, because
the escalating admin believes they have handed the problem over."* The row names
a manager (a CHECK refuses an escalation with no target), the outbox carries it,
and the Command Center counts it.

It runs in the **existing** worker loop beside the Phase 5 missed-call, retention
and story-expiry sweeps — no new scheduler. The claim is a conditional UPDATE
guarded on `escalated_at is null`, so two workers, a restart, or a sweep
overlapping its own previous run all converge.

**The threshold is `moderation.escalation_hours = 3`, a config row.** The figure
is the Phase 6 brief's own stated range ("3–4 hours"); the PRD lists escalation as
post-MVP and states no duration, so there was no existing policy to reconcile
against. It is a row precisely so the academy can set the real one without a
deploy — the same treatment `recording.retention_days` received in Phase 5.

### 2.6 Per-conversation policy: a mode, not a boolean

`off` / `smart` / `all`, per role, per conversation.

`all` is the pre-Phase-6 behaviour and is **retained deliberately**: a group under
review, a teacher on probation — "hold everything from this role here" is a real
operational need and Phase 6 must not remove the only control that expressed it.

`teacher_requires_approval` and `parent_requires_approval` are **kept as a
trigger-maintained mirror**, reconciling in both directions
(`chat.sync_conversation_moderation`). They are a PRD requirement (approvals A2:
*"a per-conversation approval policy, server-supplied"*) and the DTO, Prisma,
Admin Web and the Flutter client all read them. **No client needed a change.**
This is the technique Phase 3 used for `chat.learner.teacher_id`.

**The migration backfills every moderating conversation to `smart`, not `all`.**
That is the objective of the phase, and it is written in SQL rather than in a
service so that the state of the system after this migration is a fact about the
database.

### 2.7 The Manager Command Center

A new routed area. The frozen `/dashboard` page is **not** revived and **not**
deleted — its removal is scheduled to a later migration by Phase 0, and that is
not this phase's business.

Eight KPIs, each a count of rows that exist:

| KPI | Source |
|---|---|
| Unanswered | `last_customer_message_at > last_staff_message_at` — `needsReply()` in `contracts/dto.ts`, the console's own definition |
| Pending approvals | `chat.message_approval`, `decision = 'pending'` |
| Escalated | the subset with `escalated_at is not null` |
| Overloaded supervisors | computed from live assignments against config thresholds |
| Open / Closed conversations | `resolved_at` / `archived_at`, **not** the legacy `state` column nothing maintains |
| Active families | `chat.family_state_is_active()` — **THE** definition, called rather than restated |
| Calls / Missed class calls | `chat.call`, `type = 'class' AND outcome = 'missed'`, within `command_center.window_hours` |

**Overload is not the frozen workload engine with a nicer name.** `workload_*`
and `attention_*` are deprecated machinery (PD-3, Phase 0) and no new code may
depend on them. Overload is derived from two live axes — conversations awaiting a
reply, and items awaiting a moderation decision — either of which is sufficient
on its own, plus escalation as an absolute trigger. Thresholds are config rows
and are **initial hypotheses**, stated as such: neither the PRD nor any audit
states a supervisor's capacity.

**Family count is reported but is not a load input.** A supervisor with 200 quiet
families is not overloaded; one with 20 noisy ones may be. The frozen engine's own
rule, and still correct.

**The badge is never shown alone.** Every level carries the reasons that produced
it. "Overloaded" without a breakdown is an accusation; with one it is a
description a manager can act on.

**Every number that has a list behind it is a button, and the ones that do not
are not.** Open, closed and active families render as plain figures rather than
as dead-end cards pretending to be actionable. The drill-down goes
supervisor → unanswered conversations → **the actual conversation**, longest wait
first.

Aggregation is three SQL functions, each one pass. Nothing is counted in the
browser.

---

## 3. Database changes

**Migrations**

| File | Adds |
|---|---|
| `20260907170000_chat_phase6_moderation.sql` | `chat.moderation_rule`, `chat.message_moderation_flag`, six columns on `chat.message_approval`, the per-role moderation mode + mirror trigger, the `moderation_rules.manage` permission, RLS, event vocabulary, five config rows, nine built-in rules |
| `20260907170100_chat_phase6_command_center.sql` | three indexes, five config rows, three aggregation functions |

**Tables**

- `chat.moderation_rule` — the catalogue. Unique on `(organization_id, lower(name))`.
  Built-ins may be disabled and retuned, never deleted.
- `chat.message_moderation_flag` — one row per `(message, rule)` match, carrying
  the rule's name, category and severity **as they were at scan time**. Retuning a
  rule never rewrites the reason an earlier message was held. **Append-only**,
  trigger-enforced, like `chat.message_revision`, `chat.event_log` and
  `chat.audit_log`.

**Columns**

- `chat.message_approval`: `trigger_source`, `highest_severity`, `escalated_at`,
  `escalated_to`, `edited_at`, `edited_by`, with CHECKs pairing each stamp.
- `chat.conversation`: `teacher_moderation`, `parent_moderation`.

There is deliberately **no column for the original body**: `chat.message_revision`
revision 1 already is it, and a second copy would be a second answer to "what did
the teacher actually write".

**Functions** — `chat.sync_conversation_moderation()`,
`chat.forbid_moderation_flag_rewrite()`, `chat.enabled_moderation_rules(uuid)`,
`chat.command_center_kpis(uuid, integer, timestamptz)`,
`chat.command_center_supervisors(uuid, timestamptz)`,
`chat.command_center_attention(uuid, uuid, integer, timestamptz)`.

**Indexes** — six, each supporting a query the engine actually issues; none
speculative. Three are partial, with the predicate *being* the definition
(the escalation sweep's, the escalated view's, the unanswered KPI's).

**RLS** — both new tables: restrictive organization isolation, plus narrow
`to authenticated` policies. Reading the *rules* needs `messages.moderate` or
`moderation_rules.manage`; writing needs `moderation_rules.manage`. Reading a
*flag* follows the message, not the rule. `chat_app` holds no DELETE on either
table. **The blanket `for all to chat_app using (true)` form is not used
anywhere**, and a test asserts structurally that no such policy exists.

**Permission** — `moderation_rules.manage`, manager and super_admin. Deliberately
separate from `messages.moderate`: deciding one message and rewriting the rules
that decide every message are different powers, and a rule applies to every
conversation in the organization.

---

## 4. The three defects found on the way

### P6-1 · The scanner could not read its own rules (fail-OPEN) — **fixed**

The rule table's read policy is correctly moderator-only. But the scan runs
inside the **sender's** request, and the sender is usually a teacher or a
parent — exactly the actors that policy refuses. Under RLS the scanner loaded
**zero rules**, matched nothing, and reported every message **safe**.

Moderation would have silently stopped working in production, and *nothing would
have failed*: messages would simply have flowed. Every service-layer suite passed,
because they run as the database owner, which bypasses RLS.

Caught by `phase6-runtime-rls.spec.ts`, which sends a teacher's flagged message
through the `chat_app` connection and asserts it is held. It was not.

**Fix:** `chat.enabled_moderation_rules(uuid)`, SECURITY DEFINER, granted to
`chat_app` and not to `authenticated`. Scanning is a *system act performed during
a user's request*, and is now expressed as one. The client-facing rule list still
reads the table under RLS, because that read is a user's read.

### P6-2 · The G-07 privacy tripwire fired on a category name — **narrowed, and the tripwire is now itself tested**

`no-contact-channel-columns.spec.ts` greps migrations for contact-channel
identifiers. Phase 6's moderation *category* is called `phone_number` — the
machinery that stops phone numbers being shared — and the guard flagged it.

The tempting fix was an `ALLOWED` entry, which matches by substring and would
have exempted every line containing `phone_number`, **including a real
`phone_number text` column**. That is how a tripwire quietly stops working.

**Fix:** quoted string *literals* are blanked before matching. A column is never
written inside quotes; a value always is, so the distinction is total and cannot
hide a declaration. `ALLOWED` stays empty, as designed. Two new assertions prove
the narrowing still catches a declaration in all six shapes it could arrive in,
and the JC-011 floor was raised from 4 to 6 to lock that in.

### P6-3 · The test harness leaked moderation rules between suites — **fixed**

`truncate()` did not reset `chat.moderation_rule`, which is seed data rather than
fixture data. A corrupt rule inserted by the fail-closed test persisted and
flagged **every message in every suite that ran after it**, and the failures
surfaced somewhere unrelated.

**Fix:** `truncate()` now restores the catalogue to the migration's seeded state —
non-built-ins removed, built-ins re-enabled for the structural detectors and
disabled for the unconfirmed policy categories.

---

## 5. Reconciliation with Phases 1–5

Nothing was rewritten. Every extension point already existed:

| Phase 6 needed | Reused |
|---|---|
| a place to hold a message | `chat.message.moderation`, `chat.message_approval` (Phase 2) |
| the original text, preserved | `chat.message_revision` revision 1 (Phase 2) |
| a lawful body change | the narrowed `chat.forbid_message_rewrite` (Phase 2) |
| an audit trail | `chat.audit_log` / `chat.event_log` (Phase 1) |
| realtime | the outbox and `RelayRealtimePublisher` (Phase 4) |
| a scheduler | the `worker.ts` sweep loop (Phase 5) |
| who supervises whom | `chat.family_assignment` via `ScopeService` (Phase 1/3) |
| "an active family" | `chat.family_state_is_active()` (Phase 3) |
| call data | `chat.call` (Phase 5) |

Four existing suites needed their fixtures reconciled, because a group no longer
holds a benign message. Each was updated to keep testing exactly what it tested
before — `groups-approval-calls.spec.ts` now sets the group to `all` (the
behaviour it was always asserting), and the three protected suites send flagged
content instead of inert content. **No assertion was removed or weakened**; the
JC-011 guard passes.

---

## 6. Verification record

Run against an isolated database (`jawwid-phase6`, port 55447) rebuilt from
empty, because the shared integration database is truncated by other agents
mid-run.

| Check | Command | Result |
|---|---|---|
| API typecheck | `npm run typecheck` (apps/api) | **pass**, clean |
| API unit | `npm run test:unit` | **pass** — 375/375, 26 suites |
| API integration | `npm run test:int` | 723/737 — see below |
| Phase 6 suites | `--testPathPattern phase6` | **pass** — 96/96, 3 suites |
| Admin Web typecheck | `npm run typecheck` | **pass**, clean |
| Admin Web tests | `npm test` | **pass** — 111/111, 15 files |
| Admin Web build | `npm run build` | **pass** — 157 modules, 363.70 kB |
| Migrations apply from empty | `scripts/db/apply.sh` | **pass** |
| G-19 re-apply is a no-op | re-run | **pass** — idempotent |
| G-19 schema acceptance | `db/tests/schema_acceptance.sql` | **pass** |
| G-01 BR-1 invariants | `db/tests/br1_invariants.sql` | **pass** |
| JC-011 protected tests | `scripts/qa/check-protected-tests.sh` | **pass** |
| G-20 employee names | CI grep | **pass** |
| G-31..G-35 Phase 2 scan | CI grep | **pass** |

There is **no `lint` script** in either package; `typecheck` plus
`flutter analyze` are this repository's lint. No Dart file was changed in this
phase, and none needed to be — the mirror columns mean the mobile client's
pending/rejected rendering is untouched.

### The 14 integration failures, and why none is Phase 6

- **12 — `schema-invariants.spec.ts`: `spawnSync psql ENOENT`.** The suite shells
  out to `psql`, which is not installed on this machine. Environmental, present
  before Phase 6, and it passes in CI, which installs `postgresql-client`. The
  same assertions were exercised directly against the database via
  `db/tests/schema_acceptance.sql` and `db/tests/br1_invariants.sql`, both of
  which pass.
- **2 — `tenant-and-rbac.spec.ts`: `automation.manage` is in the database but not
  in the TypeScript mirror.** That permission belongs to a **peer's in-flight
  Phase 7 work** (migration `20260907180500_chat_phase7_automation.sql`, committed;
  the mirror entry was still uncommitted in the shared tree at the time of
  writing). Phase 6's own `moderation_rules.manage` is present on **both** sides
  and does not appear in the diff. Not fixed here: it is another agent's file
  and another phase's change.

Both were re-confirmed from a **detached worktree checked out at the Phase 6
commit**, so they are properties of the committed tree and not of a dirty shared
working directory.

---

## 6a. Provenance, and one thing this phase does not own

This repository is worked by several agents in ONE shared working tree, and that
had two consequences worth recording rather than hiding:

1. **`apps/api/src/worker.ts` is not in the Phase 6 commit.** The three-line
   change that drives `ModerationSweeper` from the existing worker loop was swept
   into a peer's Phase 7 commit (`86b43a8`) by an over-broad `git add` before
   Phase 6 was committed. The code is correct and present; its provenance is
   simply wrong. It was left there rather than extracted, because rewriting
   another agent's commit is the destructive act this project's shared-tree
   protocol forbids.

2. **Everything else was verified out of the index, not off disk.** The peer's
   uncommitted `AUTOMATION_MANAGE` line lives in `permissions.ts` beside Phase
   6's own addition. It was excluded from the commit by staging a version built
   from `HEAD` plus only the Phase 6 hunks, and then restoring the peer's line to
   the working tree. `git show --name-only` on the Phase 6 commit contains no
   Phase 7, AI, automation, knowledge, suggestion or summary file.

---

## 7. What Phase 6 deliberately did not do

- **It did not invent the academy's word lists.** The cancellation, resignation,
  forbidden-word and forbidden-phrase categories ship **disabled**, with starter
  patterns labelled as starter patterns. Somebody who knows the business enables
  them.
- **It did not set a real escalation policy.** 3 hours is the brief's figure in a
  config row, not the academy's stated policy.
- **It did not set real overload thresholds.** They are initial hypotheses in
  config rows, and the Command Center says so.
- **It did not delete the frozen CRM dashboard.** Removal is scheduled to a later
  migration by Phase 0.
- **It did not revive the workload or attention engines.** They stay frozen.
- **It did not change the mobile client.** The mirror columns made that
  unnecessary, which was the point of building them.
- **It did not add per-group rule overrides.** Every rule is organization-wide;
  the per-*conversation* control is the mode, not the rule set.
- **It did not implement Arabic stemming.** Folding covers diacritics and
  orthographic variants; a rule still matches the word forms it was written for.
- **It did not translate the two new pages into Arabic beyond their nav
  entries.** The rail is bilingual; the page bodies are English. That is a real
  gap for an Arabic-first operations team and is the first thing to close.

---

## 8. Deployment notes

- **Nothing new to deploy.** No new process, no new service, no new dependency.
  The escalation sweep runs in the worker that already runs.
- **`chat_app` needs the new grants**, which the migration issues. No manual
  privilege step.
- **Before go-live, operations should decide three things**, all config rows and
  none requiring a deploy: the escalation threshold, the overload thresholds, and
  which policy-category rules to enable.
