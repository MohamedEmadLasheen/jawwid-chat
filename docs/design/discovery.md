# Jawwid Chat — Design Discovery Report

**Author:** AI #6 — Product UX/UI Architect · **Date:** 2026-09-05
**Status:** Complete, and **corrected on review** against `docs/qa/authoritative-scope.md`.

> **Read `scope-authority.md` first.** This report was originally written on the premise that
> the PDF brief was authoritative. **That premise is withdrawn.** The approved **Jawwid Chat
> PRD v0.1** governs product scope and behaviour; this pack is a design/UX conformance artifact
> subordinate to it. Sections corrected on review are marked inline.

---

## 1. What I inspected

| Source | State |
|---|---|
| `docs/JAWWID_CHAT_BRIEF.pdf` / `.txt` (8 pp) | **Read in full.** Self-declared: *"this brief is the contract for what to build."* |
| Design doc v3 (cited by the brief) | **Not found anywhere on this machine.** Searched repo + `~/Documents` + `~/Downloads`. |
| `docs/mobile/discovery-report.md` (AI #3) | Read |
| `docs/mobile/decisions.md` (AI #3) | Read — contains the binding scope decision **D1** |
| `docs/mobile/backend-dependencies.md` (AI #3) | Read |
| `docs/admin/discovery-report.md` (AI #4) | Read |
| `docs/admin/backend-contract-required.md` (AI #4) | Read |
| `docs/qa/system-inventory.md`, `docs/qa/rbac-matrix.md` (AI #5) | Read |
| `docs/architecture/` (AI #1) | **Empty directory** |
| `docs/communication/` (AI #2) | **Does not exist** |
| `supabase/migrations/*.sql` | 3 migrations, 384 lines: `chat.config`, `chat.staff`, `chat.shift`, `chat.coverage_rule`, `chat.absence` |
| `apps/admin-web/` | Scaffold only — `package.json` (React 18 + Vite + TS + React Query + Zustand + React Router + socket.io-client), **`src/` is empty** |
| `apps/api/` | Scaffold only — NestJS 11 + Prisma 6 + Socket.IO + BullMQ, **`src/` is empty** |
| Flutter app | **Does not exist in this repository.** AI #3 pinned Flutter 3.47.2 / Dart 3.13.2 (decision D2). |
| Brand assets — logo, palette, typography, photography | **None exist.** Not in the repo, not referenced by any document. |
| Any existing design system, tokens, or component library | **None.** |

**Net:** zero UI code exists. The design system is being defined from nothing, which is the
best possible position — nothing has to be unwound.

## 2. What already exists as design-relevant decision

These were made by other agents and I am **not** re-litigating them:

| # | Decision | Owner | Where |
|---|---|---|---|
| E1 | Backend is Supabase/PostgreSQL, `chat` schema inside Jawwid Core; Core read-only via `chat.core_*` views | AI #1 | migrations |
| E2 | Transport is REST + Socket.IO | AI #2 / AI #4 | `docs/admin/backend-contract-required.md` |
| E3 | Admin Web is React 18 + TS + Vite + React Query + Zustand | AI #4 | `apps/admin-web/package.json` |
| E4 | Mobile is Flutter 3.47.2 stable | AI #3 | `decisions.md` D2 |
| E5 | Roles are `admin · coverage · manager · finance · technical · academic · system`. **No `super_admin`.** | AI #5 | `docs/qa/rbac-matrix.md` |
| E6 | All thresholds/weights live in `config`; the client reads them, never hardcodes them | brief §12 | — |
| E7 | Attention and workload are **computed server-side**; the client renders, never derives | brief §12 | — |
| E8 | ~~The mobile role assignment governs the family/teacher side; the brief governs the staff side~~ | ~~product owner~~ | ~~`docs/mobile/decisions.md` D1~~ |
| **E8′** | **The approved PRD v0.1 governs product scope. The PDF brief is superseded — its communication chapter is void; its operating-model chapter is carried forward.** | product owner | `docs/qa/authoritative-scope.md` |

Two rows above are contested by decisions this pack does not own, and are recorded here only so
nobody mistakes them for settled: **E1** is **OD-02** (one database or two — BLOCKING), and
**E5** omits a teacher actor, which is correction **C-1**, owned by AI #1.

> **Corrected on review.** E8 was this pack's original premise and it is **withdrawn**. It is
> one of two competing written records of the same product-owner decision of 2026-09-05, and
> the conflict between them is registered as **OD-01 (BLOCKING)** in
> `docs/product-operations/open-decisions.md`, owned by the product owner and AI #1.
>
> **This pack does not choose between them.** It is written to the PRD scope as recorded in
> `docs/qa/authoritative-scope.md` §3, and where a screen's behaviour would differ between the
> two reconciliations the spec states the requirement rather than the resolution.

## 3. What is missing and blocks nothing

Design can proceed without these, but they are named so no one thinks they were forgotten:

- **Brand identity.** No logo, colours, or type licence exists. §6 of `design-system.md`
  therefore defines a **proposed** palette and type stack, explicitly marked as awaiting brand
  sign-off. Because everything is expressed as semantic tokens, a brand swap is a values change
  in one file, not a redesign.
- **AI #1 auth contract.** Affects the auth screen's error taxonomy, not its layout.
- **AI #2 communication contract.** Affects payload shapes, not information hierarchy.
- **Design doc v3.** Likely home for the answers to the open questions in §6.

## 4. The cross-agent contradiction — resolved by the PRD, not by this pack

The original version of this report escalated a live contradiction: AI #3 was building Student
Groups, approvals and calling; AI #4 was explicitly not building their admin counterparts; and
none of the three had a backend entity.

**That is now resolved, and it was not this pack's to resolve.**
`docs/qa/authoritative-scope.md` §3 places **Student Groups, the message approval workflow, and
in-app voice calling (1:1 and group)** inside **PRD MVP scope**. AI #5 has since raised the
implementation gap as a P0 defect — `docs/qa/defects.md` **JC-001** (*"Student Groups, Approvals
and Calling are implemented as DESIGN-ONLY, not in MVP"*) and **JC-002** (BR-1 enforced by
making Student Groups unrepresentable).

What remains for this pack is therefore **not** whether these capabilities exist — they do —
but that the interface for each is specified so the workflow is operable end to end with no
dead ends. That is what `screens/approvals.md`, `screens/student-group.md` and `screens/call.md`
provide. Their **scope** is settled by the PRD; their **implementation status** is unresolved
and owned by others.

Two PRD rules constrain every one of those screens and are gates rather than guidance:

- **BR-1 — Teacher ↔ Parent direct 1:1 communication is FORBIDDEN**, messaging and calling
  alike. It happens **only** through the official Student Group with the required admin
  presence/authorization, and it must be **enforced server-side**. This pack's contribution is
  that the interface never *suggests* the forbidden path — member profiles carry no message and
  no call affordance at all (`screens/student-group.md` §1). That is a cosmetic layer on top of
  the real control, never a substitute for it.
- **Phone privacy** — phone numbers never appear in product communication or calling flows,
  including call setup, call metadata, push payloads, realtime events, search results and error
  messages.

## 5. Vocabulary reconciliation — my role brief vs. the PRD

My own role assignment uses terminology that does not match the PRD. Where they collide, **the
PRD wins**, matching AI #4's M1–M9 resolutions. This table is the authority; it is restated in
`terminology.md` and every screen spec uses the right-hand column only.

| My role brief says | PRD says | Ruling |
|---|---|---|
| SLA, SLA at risk, countdown | **Response target** — 70% elapsed / breached, config-driven | PRD. The string "SLA" appears in no UI. |
| Attention: `now / soon / normal` | Buckets **NOW · TODAY · WAITING ON FAMILY · QUIET**, computed; show `top_reason` **as text, never a number or label** | PRD. Buckets are inbox *sections*, not badges on a row. |
| Workload `LOW/MEDIUM/HIGH/CRITICAL` | `LOW < 8 · MEDIUM < 15 · HIGH ≥ 15` | PRD. **There is no CRITICAL.** |
| Conversation states `open / waiting_customer / waiting_jawwid / resolved` | Status lives on **`case`**: `open · waiting_customer · waiting_internal · scheduled · resolved · closed` | PRD. A *thread* has no status; a *case* does. |
| Multiple conversations per family | **PRD requires at least three concurrent conversation kinds** (parent↔admin, teacher↔admin, Student Group) and one Student Group **per student** | **Ruling reversed on review.** The original ruling here cited `thread.family_id UNIQUE` from the **superseded** brief. The data shape is correction **C-2** / **OD-01** and is not this pack's. See §6.1. |
| "Primary Owner" vs "Current Handler" | `family.owner_id` vs `on_duty(family, now)` + `message.on_behalf_mode` | **PRD terms kept verbatim: Primary Owner and Current Handler.** An earlier revision of this pack renamed them to "Owner" / "On duty" from the superseded brief; that was an override of PRD language and is withdrawn. |
| `SUPER_ADMIN` role | Not a role | PRD (and AI #5's matrix). |
| "Conversation is resolved" | Cases resolve. Threads persist forever. | PRD. |
| Admin "Inbox" of conversations | Inbox of **families**, "not tickets" (§8) | PRD. The row is a family. |

Two of my role brief's instructions **survive intact** and are worth stating positively, because
the PRD implies them without naming them: *"make the next correct action obvious"*, and
*"never rely on colour alone"*.

## 6. Open questions this pack depends on

**Corrected on review.** The original version of this section carried a *"Recommendation"*
column in which this pack proposed answers to authorization, identity and data-model questions.
**Those recommendations are withdrawn.** They were outside design authority, and one of them
(an `on_duty()`-derived approver) would have built an explicitly Phase 2 capability —
coverage-aware approval — into MVP.

What follows is what the **design requires** from each decision, and who owns it. No option is
preferred here. Where AI #8 has already registered the same question, the OD number is
authoritative and this row is a cross-reference, not a second register.

| # | Question | Register | Owner | What the design requires of any answer |
|---|---|---|---|---|
| **OQ-1** | Who is the **authorized approver**, and how does a pending message reach them? | new | product owner → AI #1 (authz) / AI #2 (routing) | **No dead-end pending state.** Every pending message reaches an authorized approver and reaches a terminal outcome (published or rejected-with-reason) that its sender can see. The queue is written approver-agnostic; naming the approver changes no pixel. MVP stays *approve · reject · reason* — escalation, expiry and coverage-aware approval are Phase 2. |
| **OQ-2** | What entity is a **teacher**, and how does one authenticate? | **C-1**, **OD-04** | AI #1 + product owner | **BLOCKING** for the whole teacher experience. The design's requirements are enumerated in `screens/teacher-home.md` §8 — this pack does not propose a model. |
| **OQ-3** | How is the **conversation model** shaped, and how do Student Groups sit in it? | **C-2**, **OD-01** | product owner → AI #1 / AI #2 | The interface must be able to render **one official Student Group per student**, so a family with several students has **several** groups, concurrently with the parent↔admin and teacher↔admin channels. See §6.1. |
| **OQ-4** | **Implementation status and sequencing** for voice calling. | `docs/qa/defects.md` JC-001 | integration / release authority | Calling is **PRD MVP scope** — this is not a question about whether it exists. The UX states and the contract the interface needs are in `screens/call.md`. |
| **OQ-5** | The **preset ↔ capability-flag** mapping for family contacts | AI #5 §2 | product owner | Presets are display sugar over the six flags. Until published, every surface renders from server-supplied flags and never derives them from a preset name. |
| **OQ-6** | Are **gendered Arabic role nouns** acceptable? | new | product owner | A pure localisation question. `terminology.md` §8 states the working rule (prefer the person's name; neutral nominal constructions otherwise) and flags it as unconfirmed. |
| **OQ-7** | **Numerals** — Western `0-9` or Eastern Arabic `٠-٩`? | new | product owner | A UX decision this pack *does* own; recorded as `decisions.md` DD-09 with its rationale and its reversal condition. |
| **OQ-8** | What does **"required admin presence"** in a Student Group mean? | **OD-03** | product owner | Determines whether `screens/student-group.md` renders an admin in the header and member list **always** or **conditionally**. The spec currently renders conditionally and marks the line as open. |
| **OQ-9** | Does a parent have **one** channel to Jawwid, or two? | **OD-05** | product owner → AI #3 | `screens/parent-home.md` and `screens/parent-chat.md` are drawn for **one**. If the answer is two, both need a conversation-list surface they do not currently have. |

### 6.1 Family · Student · Student Group — the cardinality the interface must support

This is a **restatement of PRD scope**, not a design decision, and it is written down because
three artifacts in this repository have collapsed these three things into one.

| Concept | Is | Cardinality |
|---|---|---|
| **Family** | the customer / account context — the unit of **ownership**, of the admin inbox row, and of Family 360 | 1 |
| **Student** (`learner`) | the learner within a family | **1..n per family** |
| **Student Group** | the **official communication channel for that student** — the only permitted Teacher↔Parent path (BR-1) | **exactly 1 per student**, therefore **1..n per family** |

**A family with two students has two Student Groups.** They are distinct channels with distinct
membership — different teachers, potentially different authorised contacts — and neither is a
view of the other.

**"One family, one Primary Owner" does not imply "one conversation per family."** Ownership
cardinality and conversation cardinality are different axes, and conflating them is what
produced `thread.family_id UNIQUE` (correction **C-2**, defect **JC-002**).

The interface consequences, which hold under **any** resolution of OD-01:

- A parent with several children sees **several groups**, grouped or labelled by child. The
  child's name is the group's identity (`screens/student-group.md` §2).
- The staff inbox row stays **one row per family** regardless of how many groups that family
  has (`decisions.md` DD-01).
- Family 360 must be able to show several students, each with their own teacher and group.
- Unread, attention and notification routing must be attributable to the **right group**, not
  to the family as an undifferentiated whole.

**This pack does not modify any schema and proposes none.** The data shape is C-2 / OD-01.

## 7. Risks I am designing around

| # | Risk | Mitigation in the design |
|---|---|---|
| R1 | **Attention leaks as a number.** The brief forbids showing a score; scores are seductive to display. | No token, no component, and no screen spec has a slot for a numeric attention value. `top_reason` is the only attention output that reaches a pixel. Enforced as a QA gate. |
| R2 | **Coverage reads as ownership transfer.** The product's core promise is that ownership is permanent. | Owner and On-duty have *different* visual treatments and are never rendered by the same component. `FamilyHeader` always shows the owner; the coverage line is additive, never a replacement. |
| R3 | **Internal notes leak to families.** | Internal content has its own colour family, its own surface, its own icon and an explicit label — it cannot be mistaken for a bubble. Visibility is a backend guarantee; the design makes a leak *visible* rather than silent. |
| R4 | **Everything looks urgent.** Four attention buckets, three workload levels and six case statuses could each shout. | Tiers of loudness are budgeted: exactly one thing on a screen may use `attention.now`. QUIET is the default and is genuinely quiet. |
| R5 | **Two platforms drift.** AI #3 and AI #4 build the same concepts independently. | `cross-platform.md` defines every shared concept once, with a single vocabulary and a single visual treatment. |
| R6 | **Real employee names leak into design examples.** AI #5 raised this as a P2 privacy finding. | Every example in every design doc uses synthetic names (`Admin A`, `Coverage B`, `Manager C`, family "Al-Farsi"). The brief's real names appear nowhere in `docs/design/`. |
| R7 | **Low-end Android.** Parents are the largest audience and the least controlled device population. | No blur, no shadow-heavy surfaces, no list-item animation, skeletons over spinners, server-provided thumbnails and durations. |

## 8. Where design authority stops

I specify **what the user should experience**. I do not specify:

- endpoint shapes, payloads or event names (AI #1 / AI #2 / AI #4's contract doc),
- how `on_duty()`, `attention()` or `workload()` compute (backend, by invariant),
- authorization (backend, by invariant — every affordance in these specs is UX only).

Wherever a screen depends on something the backend must supply, the spec marks it
**`Backend dependency`** inline rather than inventing behaviour.
