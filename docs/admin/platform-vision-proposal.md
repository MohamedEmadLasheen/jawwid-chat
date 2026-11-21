# Jawwid Academy operating platform: architecture and product recommendation (v2)

Status: **RECOMMENDATION for the owner's decision. Nothing here is implemented, merged, deployed or migrated.** v2, 2026-11-21.
v1 was a starting point; v2 is the result of a red-team review of v1, an external benchmark, a billing source-of-truth investigation,
a simulated merge of every open PR, and individual reviews of every proposed migration. **Strategic boundary (owner, 2026-11-21): APPROVED.**
Jawwid Chat Admin Web evolves into the unified Academy Operating and Management Platform. Jawwid Core and Second School were not read or touched.
Claims marked **(unverified)** could not be confirmed from the repository.

---

## 0. What changed from v1, and why (the challenge log)

An independent red-team verified v1's facts (39 feature folders, 2 navigation trees, 9 placeholder sections, a three-value `department.kind`
check, the permission guard in shadow mode, 87 keys, ~150 models: all CONFIRMED; two small count corrections) and then attacked the design.
I accepted most objections. The result is a **smaller, staged and evidence-gated** architecture.

| v1 proposal | Objection (evidence) | v2 decision |
|---|---|---|
| A relation table + Resource Access Layer over every entity | A rewrite presented as a refactor: ~150 models, 106+ RLS policies, 17 policy files, per-kind SQL predicates; two truths (TypeScript vs SQL); sync/drift triggers; dual-run on ~6 supervisors rarely converges | **Deferred.** Start with an **entity-scope registry + CI guard + per-entity cross-surface tests** (cheap, kills the defect class). Reopen the relation table only if the registry proves insufficient |
| "Today" as one merged Queue | `work_task`, `supervision_case`, moderation, approvals and unreplied conversations differ in state machine, assignee model, SLA clock, realtime and permissions; merged priority is meaningless; a union costs 5+ queries on a pool of 7 | **Changed:** Today is a page of **sectioned feeds**, each backed by its own endpoint and scope, with per-source counts, fed by one read-side `/me/work` projection |
| Universal Record view with a facet engine | Teacher, student and family records differ in privacy law (BR-1, phone confinement), lifecycle and facets; consolidation should be by task, not by entity | **Changed:** a shared **layout kit** (header, timeline, tabs), separate record pages per entity |
| Generic Pipeline, Ledger, Scorecard, Approval primitives | Premature: no second consumer; trial pipeline is transactional, a candidate pipeline is not; money is the worst place to abstract | **Deferred** until a second concrete consumer is built |
| Navigation as a generated projection, hard cap of six items | Support, training and bookmarks differ per person; a mis-granted capability hides work silently; the existing probe-based areas are the root of the Forbidden-frame defects (#623, #633) | **Changed:** one **server-provided `/me/navigation` contract**, a stable functional information architecture, one tree (the owner is a scope, not a second app) |
| Data-driven departments first | Not required for the stated goal; moves business logic into configuration that then needs testing, versioning and audit | **Staged:** additive department kinds and positions behind one helper now; fully data-driven later if needed |
| Phases 3 and 4 circular (records need the access layer which lands later) | Correct | **Reordered** (section 8) |
| Missing: job analysis, success metrics, coexistence plan, data quality, capacity, build-vs-buy, sequencing with open PRs | Correct | Added (sections 3, 7, 8, 9) |

The external benchmark supports the direction: a central policy function that returns a query filter (not a full relationship engine at
this scale), shadow-mode migration, state machines per pipeline kept as data, a six-to-eight KPI executive strip with comparisons and an
exceptions list, and the warning that detail pages must be list queries by id so views cannot disagree. Source quality is mostly vendor
blogs; sourced and inferred statements are labelled in the digest.

---

## 1. What we found (diagnosis, unchanged and re-verified)

| Finding | Evidence |
|---|---|
| 39 feature folders, each its own page-set, list, filter, detail and "no access" pattern; no shared Table, Drawer, Tabs, Pagination (34 files hand-roll `<table>`) | `apps/admin-web/src/features/*`, `shared/components` |
| Two navigation trees (operator, `/admin/*`) duplicating dashboard, tasks, parents, payments, instalments, teams/organization, teacher stats, teacher files, stories, calls, conversations/users | `navigation.ts` (`adminDestinations` vs `operatorDestinations`), `AppRoutes.tsx` |
| Navigation is hand-assembled: static role-to-area lists plus ~17 areas filtered by probe endpoints; "department" is inferred | `core/permissions/capabilities.ts` |
| Nine "in development" sections visible in the owner's rail, no backend | `features/admin/sections.ts` |
| Department is a three-value CHECK; ~60 files name a kind; closed role enum; a new department needs schema and many code sites | `department.kind CHECK`, `legacy_permission_bundle`, `DEPARTMENT_KINDS` in `tasks/task.service.ts` |
| 87 permission keys are advisory (guard in `shadow`); real access lives in 17 policy files and SQL functions | `permission.guard.ts:20` |
| **The "list scoped, siblings not" defect class recurs**: PD-59 produced F7 and five siblings in a week (#627-#632) | the PRs |
| A real work kernel exists (PD-47 `work_task`, system tasks, handovers, append-only events; notification items with task columns) shown as five unrelated pages | `apps/api/src/tasks`, `notification-pipeline.service.ts` |
| Business functions with no or partial support: Marketing, Recruitment/HR, Quality, Executive KPIs, finance beyond payments | workflow study |

---

## 2. Principles (the design in six sentences)

1. **Design around work, not departments or pages.** The unit of design is *a person doing a job with a record at a moment*.
2. **Enforce visibility once per entity**, declared in a registry and proven by tests, so a list, its detail, counts, search, cards, tasks, payments, realtime and exports cannot disagree.
3. **One navigation contract from the server**; one tree; the owner is a scope, not a second application.
4. **Shared where the work is shared** (calendar, conversations, tasks, people directory, money), **separate where the domain differs** (teacher vs student vs family records, trial vs candidate pipelines).
5. **Grow by evidence**: build an abstraction only when a second concrete consumer exists; buy or integrate commodity functions (BI, HR/ATS, marketing tools) rather than becoming a generic CRM/HR/BI product.
6. **Every change is additive, flagged, reversible and measurable**; the existing 800+ integration tests and the "no URL lost" tests are the safety net.

---

## 3. How the academy actually works: the work model (hypotheses to validate)

Derived from the product docs, PD registry and code; **it must be validated with 6-8 short staff interviews (no engineering cost) before any
screen is designed.** For each role: the decisions it makes, the data it needs, and today's friction.

| Role | Core decisions | Needs to see | Friction today (from the code and visual review) |
|---|---|---|---|
| Sales representative | whom to contact next; book/skip a trial; record the outcome; subscribe | my leads and follow-ups due, my trials, trial results | leads vs trials vs new-students in separate pages; conversion hand-over invisible until Convert |
| Sales manager | reassign leads; grant exceptions; spot stalled leads | team pipeline, unassigned leads, conversion by rep | no team view of stalls; hand-over gaps |
| Operations supervisor | enrol a new family; assign supervisor/teacher; chase missing contact; handle excuses/make-ups | my families and children, new students awaiting assignment, lessons needing action | same child in four places; hand-over blockers visible only to Sales manager (fixed in #628) |
| Operations manager | assign children to supervisors; activate backups; escalations | unassigned children, supervisor load, cases | no load view |
| Teacher supervisor / Teachers manager | evaluate teachers; leave, discipline, complaints; reassign teachers | my teachers' reports due, attendance, complaints, trials awaiting outcome | teacher work spread over eleven features |
| Quality reviewer (new) | sample lessons; score; improvement plans | sampled lessons, rubric, trends | evaluations exist, no QA workflow |
| Recruiter / HR (new) | source, interview, onboard teachers and staff | candidate pipeline, onboarding checklist | nothing before the teacher record (PD-43 starts at "add teacher") |
| Finance officer | verify receipts, chase instalments, refunds, payroll | receipts to review, overdue instalments, payments | no accountant role; non-delegable finance keys |
| Marketer (new) | which channels bring paying students | lead source, campaign, cost per acquisition | no lead source field |
| Executive | is the academy healthy; where to intervene | 6-8 KPIs with comparisons and exceptions | counts-only dashboard; one super admin per organisation |

**Success criteria (measurable, to be baselined):** seconds/clicks to answer "what do I do next?" per role; time to first contact of a new lead;
trial show-up and trial-to-enrolment rate; hand-over age (lead subscribed to family linked); unreplied-conversation SLA breach rate;
**unscoped-surface defects per quarter** (the access-layer KPI); support questions per week about "where is X"; usability-test task success.

---

## 4. Architecture (v2)

### 4.1 Information architecture

| Destination | Purpose | Notes |
|---|---|---|
| **Today** | sectioned feeds of what needs me: My tasks, Cases awaiting me, Moderation, Conversations awaiting reply, Receipts to review, Approvals (later); manager Team toggle and organisation toggle on the same page | each section keeps its own endpoint, scope and count; one read-side `/me/work`; replaces Dashboard-as-counts, standalone Tasks and Cases tabs |
| **Conversations** | chat and calls | unchanged (the product's core); the owner's read-only "All conversations" becomes a scope toggle |
| **People** | one directory: Families, Students, Teachers, Leads, Staff (candidates later) | type tabs and one search; each type opens its own record page; names only, never phone numbers (G-07); Arabic-aware search |
| **Schedule** | the calendar (academy, teacher, student views as filters) | one page, not three |
| **Your workspace** | a department's lens: its pipeline or queues, saved lists, KPIs | a *composition* of existing modules per department (Sales, Operations, Teachers, Finance, Quality, Marketing, HR), defined in code first, data later |
| **Money** | payments, instalments, receipts, invoices, payroll | unchanged model; one place |
| **Insights** | KPI catalogue and reports | see 4.5 |
| **Admin** | organisation, roles, settings, integrations, audit | shown only to those with the capability |

The server returns a **single `/me/navigation` contract** (destinations, entries, badges) computed from the same facts the pages use. Admin Web,
the Sales app and teacher web read it. It replaces the hand-written role lists and probe endpoints. No hard item cap: stable IA per function,
two or three workspaces per person at most. All existing URLs remain redirects (the 45-URL test stays).

### 4.2 The visibility defect class (the first priority)

**Entity-scope registry.** For each entity (family, learner, prospect/lead, trial, teacher, payment, task, conversation/card, document...)
one module declares its scope (the existing SQL functions and TypeScript policies are the implementation) and the **surfaces** that must use it:
list, detail, count/tile, search, export, notification, realtime, chat card, task, payment, report.
**CI guard:** a test fails if an entity's model/table is queried outside a file that imports its scope, with a named owner for each allowlisted
exception. **Cross-surface tests:** per entity, one test asks every surface the same question for two actors and asserts agreement (the pattern #624, #627, #632 already established).
This gives most of the benefit of a unified access layer for a fraction of the cost and without a relation table. The enforcement switch for
permission keys follows department by department after the readiness audit and shadow-comparison.

### 4.3 Organisation, roles and permissions: staged

| Stage | Change | Trigger |
|---|---|---|
| A (now) | add department kinds additively (Marketing, Quality, Recruitment, Finance as needed) and positions; one generic helper replaces the per-kind predicates **as each is touched**; role templates for specialist-style accounts | first new department |
| B | ownership vocabulary (`own, assigned, team, department, organisation`) used by the registry; reporting lines resolve `team` | registry covers the entities |
| C (only if needed) | data-driven kinds and a relation table | A and B prove insufficient |

Constraints discovered and to design around: one department per person, one super admin per organisation (decision needed for an executive role),
non-delegable finance keys (a finance officer needs a defined path), covers/backups are Operations-only by trigger text, `specialist` accounts are not family-facing.
Executives get **organisation scope as a toggle on every list and report**, read-only by default, with audited write actions.

### 4.4 Shared capabilities and handovers

Keep the PD-47 engine (solid: system tasks, append-only history, sweeps, withdrawal). Document every handover as a table now
(*from stage, to role, task template, deadline, notification, audit*), enforce it with tests, and lift to data only when a department other than the current three needs one.
The PD-59 lesson stands: a task must follow the record's current owner (#629).

```
STUDENT   Lead -> Trial booked -> Trial held -> Outcome -> Enrol (Operations) -> Parent signed up -> Active
          -> Billing/instalments -> Renewal -> (Left / Paused)
TEACHER   Candidate -> Interview -> Onboard -> Trial group -> Assigned -> Supervised -> Evaluated -> (Leave / Discipline) -> Offboard
```

### 4.5 New functions: build, integrate or buy

| Function | Recommendation |
|---|---|
| Marketing | add lead source and campaign to the lead (small, owned); attribution reports in Insights; use existing marketing tools for campaigns |
| Recruitment/HR | a minimal candidate record and onboarding checklist in Chat (PD-43 continues it); integrate or buy an ATS/HRIS for sourcing and payroll-adjacent HR; decision needed |
| Quality | scorecards, risk-weighted sampling, improvement plans (evaluations already exist); built in Chat (it needs lesson data) |
| Finance | keep the Chat ledger; add receivables views; accounting/GL in an external system; **billing truth first (section 6)** |
| Executive/Insights | a KPI catalogue with named owners and fixed denominators; a 6-8 KPI strip with comparison and status, an exceptions list, drill-down to the same scoped list; implement on a reporting schema/read replica with an embedded BI tool (build vs buy: owner decision) |

Candidate KPI catalogue (definitions are proposals): lead response time; lead-to-trial; trial show-up rate; trial-to-enrolment within N days; hand-over age; renewal rate and churn; teacher utilisation; cancel/reschedule rate; QA observations vs target and mean score; complaints; overdue instalments; time to fill; teacher attrition; satisfaction after trial and after N lessons.

### 4.6 UI kit and experience

Extract DataList (filters, saved views, pagination), Drawer, Tabs and the three states (loading, empty, forbidden) **opportunistically** from the two or three most duplicated screens, then migrate others as they are touched; do not rewrite 34 table files at once.
One glossary in Arabic and English owned centrally; RTL conventions decided once (mirror layout and chart axes, never numerals; one numeral-style setting); Arabic search normalisation for names.
Retire the nine placeholders from the rail until built; unify "no access" (the visual review found two renderings).

---

## 5. Relationship between the open PRs and the long-term architecture

| PR | What it is | Architectural role |
|---|---|---|
| #623 | pipeline route gated on the server's answer | an early instance of "the server decides what is shown" (becomes `/me/navigation`) |
| #624, #627 | cross-representative tests; F7 | the first entity-scope registry entries (trial, prospect) and the cross-surface test pattern |
| #628 | Needs hand-over (manager and Operations views) | first handover queue; the minimised projection is the pattern for cross-department read-only views |
| #629 | task follows the lead's owner | handover correctness: tasks follow the record's owner |
| #630 | Sales no longer administers family logins | capability trimming ahead of enforcement |
| #631 | `sales_prospect_ids` owner-aware | DB layer agreeing with the app scope (registry for teacher-records) |
| #632 | trial cards filtered | registry entry for chat cards; realtime/notification fan-out scoped |
| #633 | owner redirect | removes a duplicate-tree artefact |
| #625, #626 | stabilisation docs; visual review | evidence base; staging runbook; findings feed phases 2-3 |

None is discarded; each is either a registry entry, a handover, or evidence. Do not merge them in a different order than section 7.

### 5.1 Merge plan (verified by simulation; nothing merged)

Simulated sequentially in a scratch worktree from `main` `615e56db`, then typechecked as one tree (API and Admin Web: clean).
**Order:** #623, #624, #627, #628, #629, #630, #631, #632, #633, #625, #626. Stacked PRs (#627 on #624; #628-#632 on #627) must be **retargeted to `main`** after their base merges.
**One real conflict:** #623 and #628 both add `usePipelineAccess()` in `SalesPipelinePage.tsx`. Resolution (verified; typecheck and 73 sales-pipeline/navigation tests pass):
keep #623's `const access = usePipelineAccess()`, delete #628's `handOverAccess` line, read `access.data?.standing` in the `mayReconcile` line; merge the import lines.
**Migration slots (apply order is by filename):** `20261121110000` (#629), `115000` (#632), `120000` (#631), `140000` (#630) all depend only on the merged `20261121100000`; verified independent of each other in slot order and two shuffled orders (byte-identical schema).
No migration is executed without your approval, individually (section 7).

---

## 6. Billing: verified findings and remaining uncertainty (no redesign)

**Verified in code (Chat):** one-off Stripe Checkout only (`mode: 'payment'`, `stripe.gateway.ts:257`); no subscription, invoice, saved-card or off-session call anywhere; Chat owns the lesson ledger (`chat.learner_subscription`) and lock; webhook handles checkout/payment-intent/refund/dispute events and **records `invoice.*`, `customer.subscription.*` as `ignored_not_chat`**; a foreign charge never credits lessons; the reconciler only checks Chat's own checkouts and never lists Stripe charges (a foreign charge is never discovered); the lock is computed only from Chat's ledger and instalments; enforcement is off by default in production (`SUBSCRIPTION_LOCK_ENFORCED`).
**Verified in history:** card payments were deployed paused (production deploy 2026-11-17, seed `billing.card_paused = true`; whether resumed since is unknown); the runbook records the owner decision that Chat uses the same live Stripe credential as Core.
**Documentation contradictions:** the Boundary and core-integration-contract still say Core is authoritative for subscriptions and payments; PD-17/PD-27 and the code say Chat. The Terms say no automatic renewal; an open legal question asks whether Core renews.
**Not verified (hearsay):** "live monthly auto-charges run in Core" rests on the owner's 2026-11-07 statement and a sandbox-only inspection (0 subscriptions, 0 webhooks); its plan document exists only on branch `claude/stripe-jawwid-chat-integration-f3e06a`. **Nobody has seen live subscriptions.**
**Settled only by the operator/owner (read-only):** the live Stripe Dashboard Subscriptions list and Webhook endpoints; the read-only counts of ignored/unknown payment events in `chat.stripe_event` (SQL in the investigation); `chat.config billing.card_paused`; Core's maintainer on how it treats events for objects it did not create.
**Impact if Core also bills the same parents (scenario B):** Chat's ledger, invoices and lesson balances miss every renewal; with the lock on, paying children would be locked; instalment reminders could chase parents who paid Core; no double counting of refunds; possible double charge. **Safe interim controls with no model change:** keep the lock off in production, keep cards paused until the owner decides, watch ignored/unknown payment events weekly, never write to a subscription Chat did not create.
**Decision on the Finance design is blocked on this verification.**

---

## 7. Migrations: individual review status

Each proposed migration was reviewed independently on throwaway databases (locks measured, idempotent three times, rollback fidelity compared, slot-order and shuffled-order apply, `integration-db.sh verify`).

| Slot | PR | Verdict | Key facts |
|---|---|---|---|
| `20261121110000` task follows owner | #629 | **Approve with one operational change** | ~20 ms, `SHARE ROW EXCLUSIVE` on `chat.trial_prospect` only (no rewrite); run with a lock timeout (queue-behind-DDL stall measured at 6 s without one); no backfill: nothing re-routes at apply; trigger adds ~0.4-0.5 ms per changed row (10 ms per lead; +23 s for a 42,000-lead mass reassign; no such tool exists); rollback restores the original body byte-for-byte; requires the merged `20261121100000` |
| `20261121140000` Sales no `accounts.administer` | #630 | **Approve as-is** | two row deletes, ~3 ms, `ROW EXCLUSIVE`; exactly 53 of 532 seeded staff change and each loses only that key; rollback identical |
| `20261121115000` `message_card.trial_id` generated column | #632 | **Approve with changes (operational); the riskiest** | rewrites `chat.message_card`: `ACCESS EXCLUSIVE` for the whole rewrite, measured ~5 s per 1M cards (5M cards: 25-35 s, ~2 GB WAL, +table size of free disk) and it freezes **every chat read and every message send**; a lock timeout bounds only the wait for the lock, not the rewrite; semantics fail closed on 18 odd payloads; the column gives no query speed-up (the filter does not use it in a WHERE), it only lets Prisma express the relation. **GO only at <= ~200k cards (~1 s); NO-GO above ~300k** unless switched to the proven no-outage alternative (plain nullable column filled by the card guard + batched backfill: `ADD COLUMN` ~3 ms, no stall). **Deploy order:** migration first, then API (API-first breaks every card read); rollback: API first. Required changes (in progress): `set local lock_timeout` inside the file, deploy/rollback order and the row-count gate in the slot doc. **The production `message_card` count is needed before any apply.** |
| `20261121120000` `sales_prospect_ids` owner-aware | #631 | **Approve with changes (performance); fix in progress** | semantics exactly as intended (manager unchanged; a representative with 5,000 owned prospects drops from 33,801 visible to 845; non-Sales roles unchanged; every pair a representative owns stays true; 85 foreign pairs flip to false, none to true); catalog-only lock, ~0.1 s, byte-faithful rollback; **as first written it was ~16x slower** at 33.8k trial lessons in the window (140 ms to 2.4 s per call, called by every teacher-records insert guard) because the basis function is evaluated per lesson row; a proven rewrite (UNION by basis) returns identical sets for all 47 staff and runs in 5-220 ms; negligible at realistic volumes (hundreds of lessons). Rewrite and re-verification in progress |

Operational note: `APPLY_LOCK_TIMEOUT` exists only on #625's branch (`apply.sh`), not on `main`; until #625 merges, the migrations carry their own `set local lock_timeout` (a session pooler drops `PGOPTIONS`: ADR-014). Slot-order and shuffled-order application of all four on a fresh and on a main-chain database gave byte-identical schemas and a passing `integration-db.sh verify`.

---

## 8. Roadmap (reordered; every phase flagged, additive, reversible)

| Phase | Goal | Contents | Exit criteria |
|---|---|---|---|
| **0. Decide and stabilise** (in parallel, no engineering) | close PD-59; decide the open items; interviews | merge plan of section 5.1 on your approval; approve or reject each migration individually; billing verification by the operator; production permission-readiness audit; 6-8 role interviews; record the new PD that supersedes the Boundary's "communication first / no generic CRM" statements; success baselines | decisions recorded; no known unscoped surface for existing entities |
| **1. Visibility foundation** | kill the defect class | entity-scope registry for the existing entities; CI guard; cross-surface tests; data-quality cleanup (unowned prospects, families without owner, teachers without supervisor) | every existing entity covered; guard green |
| **2. One navigation** | one tree, one contract | `/me/navigation`; merge the two trees (owner as scope); hide placeholders; unified forbidden/empty states; first shared DataList/Drawer/Tabs extractions | navigation and "no URL lost" tests green; visual review (desktop, phone, Arabic, English) clean |
| **3. Today** | what needs me | `/me/work` projection and sectioned feeds; per-role usability test against the success criteria | every existing queue reachable and counted identically per source |
| **4. New functions, one at a time** | from the job analysis | candidates (Quality, Recruitment, Marketing source) as small owned modules; Insights on a reporting schema with the KPI catalogue; Finance per the verified billing truth | each function has an owner, KPIs and an exit review |
| **5. Reconsider the heavy ideas** | only if proven necessary | relation table, data-driven departments, workspace definitions as data | the registry is demonstrably insufficient |

Capacity and sequencing: store launch and Stripe go-live compete for the same people; phases 0-1 need almost no new surface and should start immediately. **Sizing is unverified**; the owner should supply team capacity.

## 9. Verification strategy and risks

**Verification.** Golden-master authorisation matrix (role x entity x action x record) generated from today's behaviour must stay identical through every refactor; the cross-surface tests; shadow-mode comparison of old and new permission decisions with alerting on any DENY-to-ALLOW change before enforcing; the 45-URL test and the navigation test for every role; visual review at desktop, tablet, phone, Arabic and English per phase; usability sessions per role; performance budgets (API pool of 7 connections per replica; Today and search must be indexed and paginated; counts may be 60 s stale); additive migrations with rollbacks and throwaway rehearsals; Flutter apps and teacher web share the API, so every new endpoint is additive and version-safe.
**Risks.** Boundary conflict (mitigated by the explicit PD); enforcing permissions locks someone out (audit, shadow, per-department); privacy regression (BR-1/BR-2/G-07 stay as database constraints with structural tests); scope creep (phase gates); over-generalisation (second-consumer rule); mixed retention rules in unified timelines (timeline entries keep their source's retention; not merged); adoption (redirects, role-by-role rollout, flag per user, rollback of Today).

## 10. Decisions for the owner

1. **Approve the phase 0 plan** and the merge order of section 5.1 (no merge happens without your explicit instruction).
2. **Each migration individually** (section 7), after the last two dossiers.
3. **Billing verification:** authorise the operator to run the read-only Dashboard and SQL checks of section 6; hold the Finance design until the result.
4. **Build vs buy** for BI/Insights, HR/ATS and marketing attribution.
5. **First new function** after phases 1-3: Quality, Recruitment, Marketing, Finance or Executive Insights.
6. **Executive role:** a second organisation-wide role in addition to the single super admin?
7. **Capacity:** who staffs this alongside the store launch and Stripe go-live?
8. **Finance path:** how a finance officer is granted non-delegable finance capabilities.
