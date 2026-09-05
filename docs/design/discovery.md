# Jawwid Chat — Design Discovery Report

**Author:** AI #6 — Product UX/UI Architect · **Date:** 2026-09-05
**Status:** Complete. Design work proceeds on the reconciliations in §5.

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
| `docs/qa/system-inventory.md`, `rbac-matrix.md` (AI #5) | Read |
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
| E2 | Transport is REST + Socket.IO | AI #2 / AI #4 | `backend-contract-required.md` |
| E3 | Admin Web is React 18 + TS + Vite + React Query + Zustand | AI #4 | `apps/admin-web/package.json` |
| E4 | Mobile is Flutter 3.47.2 stable | AI #3 | `decisions.md` D2 |
| E5 | Roles are `admin · coverage · manager · finance · technical · academic · system`. **No `super_admin`.** | AI #5 | `rbac-matrix.md` |
| E6 | All thresholds/weights live in `config`; the client reads them, never hardcodes them | brief §12 | — |
| E7 | Attention and workload are **computed server-side**; the client renders, never derives | brief §12 | — |
| E8 | The mobile role assignment governs the **family/teacher** side; the brief governs the **staff** side | product owner | `decisions.md` **D1** |

**E8 is the single most important input to this design.** It is the resolution of the scope
conflict that AI #3, AI #4 and AI #5 each independently escalated. Everything below assumes it.

## 3. What is missing and blocks nothing

Design can proceed without these, but they are named so no one thinks they were forgotten:

- **Brand identity.** No logo, colours, or type licence exists. §6 of `design-system.md`
  therefore defines a **proposed** palette and type stack, explicitly marked as awaiting brand
  sign-off. Because everything is expressed as semantic tokens, a brand swap is a values change
  in one file, not a redesign.
- **AI #1 auth contract.** Affects the auth screen's error taxonomy, not its layout.
- **AI #2 communication contract.** Affects payload shapes, not information hierarchy.
- **Design doc v3.** Likely home for the answers to the open questions in §6.

## 4. The one live cross-agent contradiction

This is the finding that most needs a decision, and it is not a misreading — it is two agents
correctly following two different instructions.

> **AI #3 is building Student Groups, message approvals and calling on mobile**
> (`decisions.md` D1, accepted by the product owner).
> **AI #4 is explicitly not building their admin counterparts**
> (`backend-contract-required.md` §10: *"they are not built"*, seams reserved).

Both cite a product decision. Both are internally consistent. Together they produce a product
where a teacher's message enters a `pending` state on mobile and **no human being anywhere has
a surface on which to approve it.** The approval queue does not exist on the only platform
whose users are staff.

AI #4 flagged exactly this risk in its own §10 — *"the admin-side counterpart becomes real work
and should be scheduled deliberately — not absorbed silently."* This report is that flag being
raised to a product decision. See §6, **OQ-1**.

I have designed the admin approval surface (`screens/approvals.md`) so the decision has
something concrete to be made against, and marked the whole screen **conditional**. If the
answer is "no approvals", one file is deleted and nothing else changes.

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
| Multiple conversations per family | `thread.family_id` is **UNIQUE**; "cases never create a second thread" | PRD. One continuous thread, cases layered on it. |
| "Primary Owner" vs "Current Handler" | `family.owner_id` vs `on_duty(family, now)` + `message.on_behalf_mode` | Concept survives, names change: **Owner** and **On duty**. |
| `SUPER_ADMIN` role | Not a role | PRD (and AI #5's matrix). |
| "Conversation is resolved" | Cases resolve. Threads persist forever. | PRD. |
| Admin "Inbox" of conversations | Inbox of **families**, "not tickets" (§8) | PRD. The row is a family. |

Two of my role brief's instructions **survive intact** and are worth stating positively, because
the PRD implies them without naming them: *"make the next correct action obvious"*, and
*"never rely on colour alone"*.

## 6. Open product decisions

Each is a real decision I cannot infer safely. Smallest viable option set given, with a
recommendation. None of them block the rest of the design.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **OQ-1** | Does the **approval** workflow exist, and if so who approves? | (a) No approvals — mobile drops the feature; (b) the family's **on-duty admin** approves; (c) a named academic supervisor approves | **(b)** — it is the only option that adds no new routing concept. `on_duty()` already answers "who is responsible for this family right now"; approvals inherit it and the brief's "one function decides" invariant holds. |
| **OQ-2** | How does a **teacher** authenticate, and what entity is a teacher? | (a) `staff.role='academic'` extended to message families; (b) a new `teacher` principal | Product/AI #1 call. UX is identical either way; flagged because the whole teacher experience hangs on it. |
| **OQ-3** | How do per-learner **Student Groups** coexist with `thread.family_id UNIQUE`? | (a) Groups are a separate entity beside `thread`, never merged; (b) groups are cases on the family thread | **(a)** — (b) would put teacher-visible content on the staff thread, which breaks the internal/customer visibility boundary. |
| **OQ-4** | Is **calling** in scope for MVP? | (a) yes; (b) defer to Phase 2 | Product call. It is the largest, riskiest mobile workstream and it appears nowhere in the brief. Designed (`screens/call.md`) and marked conditional so the decision is cheap either way. |
| **OQ-5** | Preset ↔ capability-flag mapping for family contacts | brief lists 6 flags + 4 preset names, not the mapping | Needed before the settings screen can show presets honestly. AI #5 raised the same gap. |
| **OQ-6** | Are gendered Arabic role nouns acceptable? The initial roster is all women; standard Arabic UI convention defaults masculine. | (a) masculine generic; (b) neutral phrasing + always show the person's *name* instead of a role noun | **(b)** — `terminology.md` §4 specifies neutral constructions. Cheap now, expensive later. |
| **OQ-7** | Numerals: Western (`0-9`) or Eastern Arabic (`٠-٩`)? | — | **Western in all contexts, both locales.** Rationale in `decisions.md` DD-09. |

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
