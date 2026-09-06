# Jawwid Chat — Design Decision Log

**Owner:** AI #6. Append-only. Each entry: the decision, why, what it costs, and what would
reverse it.

> **Scope of these decisions.** Every entry here is a **UX-layer** decision, subordinate to the
> approved **Jawwid Chat PRD v0.1** (`scope-authority.md`). None of them decides product scope,
> the data model, authorization, or identity. Where an entry appears to, it is a defect —
> DD-01 and DD-15 were both corrected on review for exactly that reason.
>
> Entries marked **[PRD]** restate a PRD requirement rather than deciding anything; they are
> here so the interface has a single place to point at. Entries marked **[OPEN]** were
> withdrawn on review and are now product decisions, not design ones.

---

### DD-01 — The inbox row is a **family**, not a ticket
**Decision.** Every operational list in the **staff** product is a list of families.
**Why.** The operating model is *one family → one Primary Owner*, and the invariant *"a family
appears in exactly one inbox at any moment — never two, never zero"* is carried forward by the
PRD (`docs/qa/authoritative-scope.md` §4). A ticket list would let the same family appear twice.
**Cost.** An admin cannot triage two unrelated topics for the same family separately; cases
inside the family screen do that instead.

> **Corrected on review.** The original entry justified this with
> `thread.family_id UNIQUE` and *"cases never create a second thread."* That is the
> **superseded** brief's communication chapter, and asserting it here was this pack straying
> into the data model. **Withdrawn.** The conversation model is **OD-01 / correction C-2**,
> owned by the product owner, AI #1 and AI #2.
>
> This decision does **not** depend on how that is resolved. An inbox row is a family because
> that is the unit of *ownership*; how many conversations a family has is a separate question
> and the row is unaffected by its answer. A family with two students and therefore two Student
> Groups is still **one** inbox row.

**Reverses if.** The PRD ever makes something other than the family the unit of ownership.

### DD-02 — **Primary Owner** and **Current Handler** are two different visual objects
**[PRD]** The PRD states *"Primary Owner ≠ Current Handler"*, that coverage does not change
Primary Ownership, and that handoff does not either. This entry is how that is rendered.
**Decision.** The family header renders the **Primary Owner** permanently on line 1; the
**Current Handler** appears on line 2 *only when different*. They never share a component, a
colour, or a slot.
**Why.** The product's entire promise is that ownership survives shift changes and staff
turnover. If coverage visually replaces the owner, the UI teaches the opposite of the model,
and an admin acting under coverage will believe the family moved to them (risk R2).
**Cost.** Two lines of vertical space in the most valuable region of the screen.
**Reverses if.** Never, while permanent ownership is the operating model.

### DD-03 — Attention is a **section**, never a badge, and never a number
**Decision.** NOW / TODAY / WAITING ON FAMILY / QUIET are inbox section headings. A row carries
an `AttentionDot` and the `top_reason` sentence. No score, no bucket name, no priority label,
no countdown appears on a row.
**Why.** Brief §6 is explicit: *"Show `top_reason` as text, never a number/label."* A visible
score invites admins to argue with the score instead of reading the reason, and it makes
recalibration in Phase 2 a UI-visible event rather than a silent improvement.
**Cost.** An admin cannot sort by a number. The server's ordering is the ordering; the
"this order is wrong" button is the intended pressure valve and it is calibration data.
**Reverses if.** Never — it is a §12 non-negotiable.

### DD-04 — Countdown timers are banned; response targets appear as **two thresholds**
**Decision.** The UI shows nothing at all until 70% elapsed, then "Reply time running out",
then "Reply overdue". No live-ticking clocks anywhere.
**Why.** Role brief §29 asks to avoid giant countdowns; the brief's model is threshold-based.
A ticking timer on 40 rows is 40 re-renders a second on hardware that cannot afford it, and it
converts a calm inbox into a casino.
**Cost.** An admin cannot see "3 minutes left" precisely. Wait time is shown instead, which is
what they actually act on.

### DD-05 — Internal content owns an **exclusive hue**
**Decision.** Violet is used for internal notes and internal timeline events and for nothing
else in the product.
**Why.** The single worst failure this product can have is an internal note reaching a family.
Backend visibility rules prevent it; exclusivity of hue means a leak is *instantly obvious* to
any staff member looking at any screen instead of blending in.
**Cost.** One hue permanently spent.

### DD-06 — Loudness is a budget: **one `attention.now` element per viewport**
**Decision.** At most one element on screen may use the NOW colour family.
**Why.** Role brief §28 — "do not make every conversation look urgent". With four buckets,
three workload levels, six case statuses and a response-target state all competing, an
unbudgeted system saturates within a week of real data.
**Cost.** Design review has to arbitrate. That is the point.

### DD-07 — Arabic-first, one type family for both scripts
**Decision.** IBM Plex Sans Arabic for Arabic *and* Latin. RTL is the layout that gets built
first and LTR is verified against it.
**Why.** Mixed Arabic/English strings are the normal case in this product, not an edge case
(«الدرس يبدأ 3:00 PM»). Two unrelated families produce visibly mismatched weight and baseline
in every such string.
**Cost.** Locked to one family's aesthetic; a brand font change must supply both scripts.

### DD-08 — Mobile and admin have **different navigation**, deliberately
**Decision.** Parent gets a 4-tab bottom bar; Teacher gets a 3-tab bottom bar; Admin gets a
left rail. Parent and Teacher do not share a shell.
**Why.** Their primary questions are different ("what do I need to know?" vs "where do I send
this?" vs "who needs me now?"). A shared shell would force the union of both navigations onto
both roles, which is how a parent ends up with a tab they must learn to ignore.
**Cost.** Two shells to build and test on mobile.

### DD-09 — **Western numerals (0–9) in both locales**
**Decision.** `٠١٢٣` are not used anywhere, including Arabic UI.
**Why.** The staff surfaces are dense with times, counts, durations, money and IDs that are
cross-checked against a Latin-numeral backend and against Jawwid Core. Mixed numeral systems
across a screen are a transcription-error source in operational work. Egyptian digital
convention already leans Western.
**Cost.** Slightly less "native" feel to some Arabic readers.
**Reverses if.** Product research with real families says otherwise for the *parent* app
specifically — in which case it becomes a locale setting for customer surfaces only, never
for staff surfaces.

### DD-10 — Disabled-with-a-reason beats hidden, for **conditional** actions
**Decision.** An action the user's role can never perform is hidden. An action they normally
can perform but cannot *right now* is shown disabled, with the reason on hover or long-press.
**Why.** "Reply as assist" has three preconditions; hiding it makes the product look broken and
teaches nothing. Showing a 403 after the admin has typed a reply is worse.
**Cost.** Requires `capabilities.*_blocked_reason` from the backend (**dependency**, already
requested by AI #4 §3).

### DD-11 — Skeletons, not spinners
**Decision.** Every list, panel and dashboard loads as a shape-matched skeleton. Spinners exist
only inside buttons.
**Why.** Perceived performance on low-end Android, and layout stability — a skeleton reserves
the space its content will occupy, so nothing jumps when data lands.

### DD-12 — Realtime updates **never move what you are looking at**
**Decision.** A new message appends and shows a "New messages ↓" affordance if the user is
scrolled up. An inbox row that changes bucket swaps instantly with no animation, and never
while it is the selected row — a selected row updates in place and re-buckets when deselected.
**Why.** Role brief §48. An admin mid-reply whose row vanishes from under them loses their place
and their trust in the list.
**Cost.** A brief inconsistency between the selected row's section and its true bucket, which
is strictly better than the alternative.

### DD-13 — Admin Web is **light mode only**; mobile supports both
**Decision.** As stated.
**Why.** Staff work in daylight offices on managed screens; dark mode doubles the contrast QA
surface for no operational gain. Parents use the app at night, in bed, one-handed.
**Reverses if.** Staff ask for it. It is a token-values change, and all dark values are already
defined in `design-system.md` §2, so the cost of reversing is small and deliberately kept so.

### DD-14 — "Topic" for families, "Case" for staff
**Decision.** The same record has two vocabularies, split at the customer boundary.
**Why.** Brief §8: the customer screen shows *"their open topics in plain status"* and
*"no internal labels"*. `at_risk`, `complaint`, `owner_locked` and `escalated` must never
surface in a family's language.
**Cost.** A translation layer in every customer-facing render path. **Backend dependency:** the
customer-safe status string should be server-supplied rather than mapped client-side, so the
mapping cannot drift between Flutter and any future customer web surface.

### DD-15 — The approval queue is designed; **the approver is not this pack's to choose** [OPEN]
**[PRD]** The message approval workflow is **MVP scope**: approve · reject · **rejection
reason**, intentionally simple. Escalation, expiry and **coverage-aware approval** are Phase 2
(`docs/qa/authoritative-scope.md` §3).
**Decision.** `screens/approvals.md` specifies the queue and the sender-side states so the
workflow is operable end to end. It is written **approver-agnostic**: every surface refers to
*"the authorized approver"*, and no screen assumes who that is.

> **Corrected on review.** The original entry recommended `on_duty(family, now)` as the
> approver. That is **withdrawn** on two grounds: it is an authorization decision, which this
> pack does not make; and `on_duty()` is coverage-derived, so tying approval to it would have
> built **coverage-aware approval** — an explicitly Phase 2 capability — into MVP.

**Open:** who the authorized approver is, and how a pending message reaches them, is **OQ-1**,
an integration/product decision. **Owner:** product owner → AI #1 (authorization) / AI #2
(routing).
**Constraint the design imposes on any answer:** there must be **no dead-end pending state** —
every pending message must reach an authorized approver and reach a terminal outcome. See
`screens/approvals.md` §1.
**Consequence to decide with it:** whether approval work counts as a workload unit. If it does
not, an approver's load silently under-reports.

### DD-16 — Calling is **in MVP scope**; only its implementation status is unresolved
**[PRD]** **In-app voice calling — 1:1 and group, in Student Groups — is MVP scope.** Video is
Phase 2 (`docs/qa/authoritative-scope.md` §3).
**Decision.** `screens/call.md` specifies the UX states and the contract the interface needs.
No recording UI in MVP. **No phone number in any screen, payload, call log, push or realtime
event** — phone privacy is a PRD gate, not a design preference.

> **Corrected on review.** The original entry described calling as *"conditional"* and said the
> file could be deleted if the answer were no. That framing came from the superseded brief, in
> which calling does not appear, and it risked reading as a design decision to drop a PRD
> capability. **Withdrawn.** Calling is in scope. **OQ-4** is now narrowed to *implementation
> status and sequencing*, owned by the integration/release authority — not to whether the
> capability exists.

### DD-17 — Every affordance in these specs is **UX only**
**Decision.** No screen spec claims to enforce a permission. Hidden and disabled controls are
described as affordances; the backend is the authority.
**Why.** Brief §12 and AI #5's RBAC matrix: *"a UI-only restriction is a defect, not a control."*
The UI's job is to avoid *suggesting* prohibited actions (role brief §18), not to prevent them.

### DD-18 — Synthetic names in every design artefact
**Decision.** `Admin A`, `Coverage B`, `Manager C`, family `Al-Farsi`, student `Yusuf`.
The brief's six real employees and their shift times appear nowhere in `docs/design/`.
**Why.** AI #5's P2 privacy finding. Design docs are the most-copied artefacts in a project;
a real name pasted into an example becomes a real name in seed data within a week.
