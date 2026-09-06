# DESIGN PACK COMPLETE — AWAITING SYSTEM INTEGRATION

**Owner:** AI #6 (Product UX/UI Architect) · **Frozen:** 2026-09-06
**Consumer:** Agent #10 (System Integration) · **Standing:** stable design contract.

`docs/design/` is a **design / UX conformance artifact**, subordinate to the approved
**Jawwid Chat PRD v0.1** (`scope-authority.md`). It defines no product scope, no data model, no
authorization, and no architecture.

**Frozen** means: no further design decisions will be made in this directory without a request.
Corrections for PRD conformance, defects, and answers to §2 remain welcome and expected.

---

## 1. Final — safe to build against

These are settled at the interface layer and will not move.

| Area | Where |
|---|---|
| Visual language, semantic colour tokens, dark values | `design-system.md` §2 |
| Arabic-first typography, 12px floor, per-locale line heights | `design-system.md` §3 |
| Spacing, radius, elevation, motion | `design-system.md` §4–§5 |
| Icon set and the **RTL mirroring rule set** | `design-system.md` §6, `cross-platform.md` §4 |
| Component inventory and required states | `design-system.md` §7–§8 |
| Responsive behaviour, admin and mobile breakpoints | `design-system.md` §9 |
| Accessibility minimums | `design-system.md` §10 |
| Bilingual UI terminology — **Primary Owner / Current Handler** per PRD | `terminology.md` |
| Message state machine, realtime behaviour, cross-platform concept register | `cross-platform.md` §1–§3 |
| Information hierarchy for 18 screens | `screens/` |
| 18 UX decisions with rationale and reversal conditions | `decisions.md` |
| Design QA checklist, 10 blocking gates | `design-qa.md` |

**The four rules everything derives from:** make the next correct action obvious · the Primary
Owner is permanent and always visible while the Current Handler is additive · attention is a
sentence, never a number · internal content is unmistakable and never reaches a family.

## 2. Intentionally left open — product / architecture, not design

**This pack proposes no answer to any of these.** Each states only what the interface requires
of whatever answer is chosen.

| # | Question | Register | Owner |
|---|---|---|---|
| **OQ-1** | Who is the **authorized approver**, and how does a pending message reach them? | new | product owner → AI #1 / AI #2 |
| **OQ-2** | What entity is a **teacher**, and how do they authenticate? | **C-1**, **OD-04** | AI #1 + product owner |
| **OQ-3** | **Conversation model** shape, and how Student Groups sit in it | **C-2**, **OD-01** | product owner → AI #1 / AI #2 |
| **OQ-4** | **Implementation status and sequencing** for voice calling (scope is settled — it is MVP) | JC-001 | integration / release authority |
| **OQ-5** | Preset ↔ capability-flag mapping | AI #5 §2 | product owner |
| **OQ-6** | Gendered Arabic role nouns | new | product owner |
| **OQ-8** | What "**required admin presence**" in a Student Group means | **OD-03** | product owner |
| **OQ-9** | Does a parent have **one** channel to Jawwid, or two? | **OD-05** | product owner → AI #3 |

Three recommendations from the first revision were **withdrawn** as outside design authority:
an `on_duty()`-derived approver (DD-15 — it would also have pulled Phase 2 coverage-aware
approval into MVP), a Student Group data shape (OQ-3), and treating calling as droppable
(DD-16). Details in `discovery.md` §6.

**Only OQ-7** (Western numerals, `decisions.md` DD-09) is decided here, because it is a pure
UX decision. It carries its own reversal condition.

## 3. Backend contracts required by the design

Requirements, not designs. Full tables at each reference.

| Area | Contract | Where | Owner |
|---|---|---|---|
| **Teacher identity** | T1–T8: stable identity · authentication with distinguishable failures · server-asserted authorization role · Jawwid Core relationship and sync direction · student assignment authority · group membership **derived from** that assignment · teacher-change/offboard behaviour · BR-1 enforced server-side | `screens/teacher-home.md` §8 | AI #1 |
| **Student Groups** | G1–G8: one group **per student** · membership following the teacher assignment · BR-1 on a single *(actor, conversation, channel)* path covering messaging **and** calling · no phone numbers in member payloads | `screens/student-group.md` §9 | AI #1 / AI #2 |
| **Approvals** | A1–A6: approval state + rejection reason · per-conversation policy · routing to an authorized approver with defined behaviour when it yields nobody · pending invisible to non-senders · realtime events · workload-unit decision | `screens/approvals.md` §9 | AI #1 / AI #2 |
| **Calling** | K1–K6: call session with no phone number anywhere · per-conversation authorization returning a short-lived token · group call authorization · **same authorization path as messaging** · push payloads carrying only id/type/target | `screens/call.md` §8 | AI #1 / AI #2 |
| **Messaging** | Cursor pagination with a server-authoritative ordering key · `client_message_id` idempotency · resumable realtime cursor · server-set `on_behalf_mode` · localised or key+params server strings | `screens/parent-chat.md` §10, `cross-platform.md` §2 | AI #2 |
| **Staff surfaces** | `capabilities.*_blocked_reason` for every disabled action · `GET /config` as the only source of thresholds · server-computed attention buckets, `top_reason`, workload score **and its per-unit breakdown** | `screens/admin-inbox.md` §13, `screens/workload.md` §9 | AI #1 / AI #2 / AI #4 |
| **Auth** | Distinguishable codes for bad credentials · account disabled · session revoked · session expired · rate limited | `screens/auth.md` §8 | AI #1 |

## 4. Admin Web reconciliation required

`token-reconciliation.md`. **Mobile tokens are the design reference**; `lib/design/tokens.dart`
implements the pack verbatim. Admin Web predates the pack and diverges in values and names, not
intent. **No code was changed by this pack and no rewrite is requested** — R-1…R-7 are values
and identifiers in one file.

**If only two are done: R-1 brand accent** (`#1f6feb` blue → `#0F7A72` teal — the two apps are
currently different brands) and **R-2 the 12px font floor** (`--fs-xs: 11px`).

One divergence runs the other way: Admin Web has implemented dark mode, which `decisions.md`
DD-13 excluded. The implementation is correct and the exclusion was a QA-cost judgement.
**Recommendation: accept it and amend DD-13.** AI #4 + AI #5's call.

## 5. Blockers belonging to other agents

| # | Blocker | Blocks | Owner |
|---|---|---|---|
| **B-1** | **PRD v0.1 is not in the repository** (`docs/qa/authoritative-scope.md` §6, RC-13). This pack was conformed against AI #5's written record of PRD scope, not the PRD. **A conformance re-check is required once the document is on disk** — this agent cannot close it | every scope gate; final sign-off on this pack | product owner |
| **B-2** | **OD-01** — two competing written records of the same product-owner decision govern the conversation model | `screens/student-group.md`, `screens/parent-chat.md`, `screens/admin-conversation.md`, mobile chat list, every BR-1 test | product owner → AI #1 |
| **B-3** | **C-1 / OD-04** — no teacher principal exists | the entire teacher experience: `screens/teacher-home.md`, `screens/teacher-chat.md`, Student Group membership | AI #1 |
| **B-4** | **JC-001** — Student Groups, approvals and calling are DESIGN-ONLY in the backend while being PRD MVP | `screens/student-group.md`, `screens/approvals.md`, `screens/call.md` | AI #1 / AI #2 |
| **B-5** | **JC-002** — BR-1 is enforced by making Student Groups unrepresentable; the permitted case cannot be expressed | the one channel Teacher↔Parent communication is *required* to flow through | AI #1 |
| **B-6** | **OD-03** — "required admin presence" is undefined | whether `screens/student-group.md` renders an admin conditionally or always | product owner |
| **B-7** | **OD-02** — one database or two | not a design blocker; noted because `discovery.md` E1 records the contested premise | product owner + AI #1 + AI #7 |

None of B-1…B-7 is a design question, and none is this agent's to close.

## 6. Privacy — final scan

Scanned across all of `docs/design/` on 2026-09-06: real employee names · phone numbers ·
emails · credentials and secrets · UUIDs and internal identifiers · URLs and connection strings
· copied production or customer data.

**Result: clean.** Every person and family in every example is synthetic — `Admin A`,
`Admin D`, `Coverage B`, `Manager C`, `Teacher T`, `Teacher R`, `Finance C`, family *Al-Farsi*,
students *Yusuf*, *Layla*, *Sara*, and `نور` in one Arabic grammar example.

One real employee name from the brief was found and removed during review
(`decisions.md` DD-18, AI #5's gate G-16). **Note for AI #5:** an earlier revision of
`terminology.md` containing that name was swept into another agent's commit before the fix
landed, so it is present in git history. Working tree is clean.

## 7. Deliverable

31 files, ~4,700 lines. Nothing outside `docs/design/` was modified except one row added to the
root `README.md` layout table.

**No backend, database, routing, authorization, or business logic was implemented or specified
by this agent.**
