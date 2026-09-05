# Cross-Agent Product Conformance Audit

Date: 2026-09-05 · Auditor: AI #4 (Admin Operations) · Status: **AUDIT COMPLETE — MERGING FROZEN**
Scope: AI #4 Admin Web (full), AI #3 mobile Student Groups / approvals / calling (targeted).

---

## 0. The authority problem, stated before any verdict

**PRD v0.1 is not on disk.** I searched the repository, `~/Downloads`, and the
home directory. The only product documents that exist are:

| Document | Status |
|---|---|
| `docs/JAWWID_CHAT_BRIEF.pdf` | **SUPERSEDED** (per `docs/qa/authoritative-scope.md`) |
| `docs/qa/authoritative-scope.md` §3 | **Operative written record** of PRD v0.1 scope, authored by AI #5 |
| PRD v0.1 itself | **ABSENT** |

The only files named `prd.md` on this machine belong to **Second School**
(`~/Documents/ss-*`, `second-school*`). Per instruction 14 they were not opened
and play no part in any decision here.

**Therefore every "PRD Status" below is graded against `authoritative-scope.md`
§3 — a secondary source — not against the PRD.** This is AI #10's RC-13 and AI
#5's §6, and it is the single largest correctness risk in this audit. I have
marked as `UNVERIFIED` every item that the secondary source does not explicitly
address, rather than inferring intent. **I did not invent a single PRD
requirement.**

**A clean `git merge-tree` is not evidence of compatibility.** I re-ran it:
`feat/infrastructure` merges with `feat/backend-foundation`,
`feat/communication-engine` and `main` with **no textual conflict**. That is the
dangerous case, not the safe one — the stacks do not collide because they write
to different schemas and different vocabularies. See the risk register, RR-02.

---

## 1. Conformance table

Legend for **PRD Status**: `CONFIRMED` (explicit in authoritative-scope §3/§4) ·
`COMPATIBLE` · `SUPERSEDED-DERIVED` · `CONFLICTING` · `DECISION` · `UNVERIFIED`.

| Feature | Agent | Source Used | PRD Status | Implementation Status | Conflict | Action |
|---------|-------|-------------|------------|-----------------------|---------|--------|
| **Ownership model** (Primary Owner ≠ Current Handler; `transfer_ownership()` only; reason + audit; manager-only; coverage & handoff never change ownership) | #4 | Brief §3/§12 + scope §3 | **CONFIRMED** — scope §3 states all five rules verbatim | Built, 8 tests | None | **PRESERVE AS-IS** |
| **Coverage model** (shifts, rules, absences, `on_duty()`, gaps, one-click backup, never auto-activate) | #4 | Brief §4 + scope §4 | **CONFIRMED** — scope §4 carries `shift`/`coverage_rule`/`absence`/`on_duty()` | Built, untested UI | None | **PRESERVE**; blocked on AMB-3/4/5 for correctness of what it renders |
| **Family model** (family, contact + 6 capability flags, learner, subscription, family_note) | #4 | Brief §3 + scope §4 | **CONFIRMED** — scope §4 lists each table | Built | None | **PRESERVE**; preset→flag mapping is AMB-10 |
| **Workload model** (server-computed score + level, rendered never recomputed, families never a unit) | #4 | Brief §7 + scope §3/§4 | **CONFIRMED** — "Workload Monitoring", "computed workload", "does not automatically reassign" | Built | Level vocabulary (`LOW/MEDIUM/HIGH`) is brief-derived; scope §3 does not enumerate levels | **PRESERVE** — values are server-supplied, so vocabulary follows the backend at zero cost |
| **Attention model — concept** (rule-based, server-computed, rendered as text reason, no score/P1-P2-P3 shown) | #4 | Brief §6 + scope §3 | **CONFIRMED** — "rule-based Attention states"; Phase 2 = AI scoring | Built, 7 tests | None | **PRESERVE** — the "no AI scoring in MVP" boundary is respected |
| **Attention model — bucket vocabulary** (`NOW / TODAY / WAITING ON FAMILY / QUIET`) | #4 | Brief §6 only | **SUPERSEDED-DERIVED** | Built | Scope §3 says "Attention states" but never enumerates them | **DECISION** — confirm or replace the four buckets. Cheap: they are `t()` keys + a union type. AMB-2/AMB-7 also open |
| **Tasks & follow-ups** (types, assignee, due, overdue, department scoping) | #4 | Brief §8 + scope §3/§4 | **CONFIRMED** — "Tasks & Follow-ups"; scope §4 carries `tasks` | Built | None | **PRESERVE AS-IS** |
| **Manager dashboard** (unattended, team-now, needs-action, this-week, drill-down) | #4 | Brief §8 + scope §3/§4 | **CONFIRMED** — "Manager Dashboard"; scope §4 carries it and the Unattended list | Built | None | **PRESERVE AS-IS** |
| **Internal notes** (`visibility: customer\|internal`, visually + semantically distinct, never customer-reachable) | #4 | Brief §3/§16 | **COMPATIBLE** — not named in scope §3, but `family_note` is carried in §4 and JC-006 presupposes internal-note authorization | Built, 5 tests | None | **PRESERVE** — this is a privacy control, not a feature |
| **Phone privacy** (no phone field in the domain model at all; guard test) | #4 | Brief §62 + scope §3 | **CONFIRMED** — scope §3 makes it a gate | Built, 1 guard test | None | **PRESERVE** — strongest control in the app |
| **Case model** (`support_case`: type, severity, `is_blocking`, status, `owner_locked`, escalation) | #4 | Brief §3 | **UNVERIFIED** | Built, 5 tests | Scope §3 **does not mention cases at all**; §4 does not carry `case` forward | **DECISION** — does PRD v0.1 retain cases? Do not rework until answered; do not assume retention either |
| **Response-target model** ("SLA remaining/at-risk/breached" rendered from server) | #4 | Brief §6 | **UNVERIFIED** | Built (badge only) | Scope §3 never mentions SLA or response targets | **DECISION** — low rework cost (one badge component); do not delete pending answer |
| **Role model** (`admin·coverage·manager·finance·technical·academic·system`; no `super_admin`) | #4 | Brief §2 + AI #5 rbac-matrix | **CONFLICTING (by omission)** | Built, 6 tests | **C-1**: PRD requires Teacher as a first-class authenticated actor. My `StaffRole` has no teacher, and Admin Web cannot render a Teacher↔Admin conversation or a teacher group member | **REWORK (narrow)** — add a teacher *actor/participant* kind. The staff-role union itself is correct and stays; teacher is not CS staff |
| **Thread / conversation model** (`thread.family_id UNIQUE`, one continuous thread, cases layered, "cases never create a second thread") | #4 | Brief §3/§12 | **CONFLICTING (P0)** | Built and load-bearing: `domain.ts`, `FamilyWorkspace`, `Thread`, `Composer`, `useFamilyMessages`, `qk.familyMessages` | **C-2**: PRD requires ≥3 concurrent conversation kinds (Parent↔Admin, Teacher↔Admin, Student Group) with per-conversation participant sets. A unique thread per family cannot represent them, and BR-1 cannot be enforced against them | **REWORK (P0)** — replace family-keyed messaging with conversation-keyed messaging carrying `kind` + participants. See §3 for the preservation plan |
| **Admin navigation** (Inbox · Families · Tasks · Coverage · Dashboard) | #4 | Brief §8 + 2026-09-05 scope decision | **CONFLICTING (by omission)** | Built, reserved seams for `/approvals` + `/calls` | Scope §3 puts **approvals, Student Groups, calling and push notifications in MVP**. My nav has no entry for any of them. The earlier product decision that excluded them was taken on the superseded premise | **REWORK (additive)** — register the reserved seams. No refactor: nav is a data-driven registry and the routes are already reserved |
| **Inbox buckets / sections** (`now·today·covering·waiting_family·quiet` + away-summary + shift banner + calibration) | #4 | Brief §4/§6/§8 | **PARTIAL** — "Admin Inbox" CONFIRMED; section vocabulary SUPERSEDED-DERIVED | Built | Inherits the attention-vocabulary decision above | **PRESERVE structure, DECISION on vocabulary** |
| **Auth scheme** (cookie session, `credentials:'include'`) | #4 | Self-authored contract | **DECISION** | Built | **RC-03**: admin=cookie, mobile=Bearer+refresh, backend=neither | **UNIFY** — one scheme, then adapt. ~1 file for me (`client.ts`) |
| **Realtime contract** (namespace `/staff`, 11 snake_case events) | #4 | Self-authored contract | **CONFLICTING** | Built, 5 tests | **RC-04**: AI #2 emits 11 dot-named events with camelCase payloads on the default namespace. Only `message.created`, `presence.changed`, `handoff.created` overlap by name, and payloads differ (`{family_id,message}` vs `{threadId,messageId,seq}`). **8 of my 11 events have no producer at all** | **UNIFY** — AI #2's `contracts/events.ts` already states clients generate from it. I regenerate; my invalidation map survives |
| **API endpoint contract** (34+ endpoints, `/api/v1`) | #4 | Self-authored, marked "awaiting sign-off" | **UNVERIFIED** | Client-side only; **0 implemented** | RC-05 | **UNIFY** — contract was always a proposal; adapter layer is thin |
| — | | | | | | |
| **BR-1 client policy** (`CommunicationPolicy`, total function, both directions, calling ≤ messaging, group membership grants no 1:1) | #3 | Scope §3 BR-1 | **CONFIRMED** | Built + tested | None. Correctly self-describes as defence-in-depth with the backend authoritative | **PRESERVE AS-IS** — exemplary |
| **Conversation kinds** (`jawwidSupport · studentGroup · adminDirect`; forbidden channel unrepresentable in the type system) | #3 | Scope §3 | **CONFIRMED** | Built | None — this is **what C-2 asks for**, and is ahead of AI #4 | **PRESERVE — and adopt as the reference model for Admin Web** |
| **Approval model** (`notRequired·pending·approved·rejected` + `rejectionReason`; `requiresApproval` is backend-supplied per conversation) | #3 | Scope §3 | **CONFIRMED** | Models + rendering; no backend | None. Matches the MVP boundary exactly: approve · reject · reason. **No escalation, no expiry, no coverage-aware approver** → no Phase 2 leakage | **PRESERVE**, marked `CONFORMANCE PENDING` |
| **AMB-9 handling** | #3 | — | **CORRECTLY DEFERRED** | n/a | **None — verified.** `requiresApproval` is backend policy; `CommunicationPolicy` contains no admin-presence predicate; no membership/online/on-duty condition is expressed anywhere in `lib/` | **NO ACTION — do not let anyone add one.** See §4 |
| **Calling** | #3 | — | **NOT IMPLEMENTED** | No call source in `lib/`; Prisma models are `/// DESIGN-ONLY` | JC-001 | **HOLD** until conversation model + AMB-9 settle |
| **Student Group UI** | #3 | — | **NOT IMPLEMENTED** | `studentGroup` kind + `LearnerRef` exist; no group screens | JC-001 | **HOLD** |

---

## 2. Correction to the premise of this audit

> *"AI #3 is independently implementing Student Groups, approvals, and calling."*

**Verified against the tree: only partly true, and the part that is true is
sound.** What exists in `lib/` is a `studentGroup` conversation kind, a
`LearnerRef`, an `ApprovalState` enum with a rejection reason, and a
`requiresApproval` flag that is **explicitly backend-supplied**. There are no
group screens, no approval queue, and no calling code. Prisma marks all three
`/// DESIGN-ONLY. Not implemented.` (JC-001).

This is materially better news than the premise implies: **AMB-9 has not been
invented anywhere in the codebase, by anyone.** There is still a clean window to
resolve it before implementation exists. That window closes the moment someone
writes the first `isAdminPresent()` predicate.

I also correct a stale line in AI #10's reconnaissance: *"Admin Web tests — NOT
TESTED — no test files exist."* True when written; **74 tests across 11 files
now exist and pass.** Typecheck and production build are clean.

---

## 3. AI #4 thread-model rework — preservation plan

C-2 invalidates the *addressing* of messages, not the workspace built on top.
Roughly **85% of the Admin Web is untouched** by it.

| Layer | Fate |
|---|---|
| `qk.familyMessages(familyId)` → `qk.conversationMessages(conversationId)` | Re-key |
| `familyApi.messages/sendMessage` | Re-target to `/conversations/:id/messages` |
| `FamilyWorkspace` | Gains a conversation switcher (support · teacher↔admin · student groups) |
| `Thread`, `Composer`, `CaseCards`, `FamilyActions` | **Unchanged** — they take messages and capabilities, not a family key |
| `FamilyPanel` (Family 360) | **Unchanged** |
| Inbox, tasks, coverage, dashboard, ownership, i18n, permissions, error model, design system | **Unchanged** |
| 74 tests | ~6 re-point at a conversation id; the rest unchanged |

The reason the blast radius is small is that the composer and thread were built
to take a message list and a server-supplied capability object rather than to
know how messages are addressed. That was not foresight about C-2 — it came from
the rule that the client owns no business truth — but it pays for itself here.

**Adopt AI #3's `ConversationKind` as the shared vocabulary** rather than
inventing a second one. That is the whole lesson of this audit.

---

## 4. AMB-9 — explicitly UNRESOLVED

> **AMB-9:** *"Required admin presence/authorization" in a Student Group is
> undefined. Must an admin be a **member**? **online**? **on-duty**? Does a group
> become **invalid** if the admin is removed or offboarded?*

**Status: OPEN. No agent may resolve it in code.** It is the load-bearing
condition of BR-1's permitted case, so guessing it means guessing the product's
central safety rule.

Concretely forbidden until product answers, in **any** layer:

- any `isAdminPresent()` / `hasRequiredAdmin()` predicate;
- gating group posting or group calling on admin **online** status or on
  `on_duty()`, or on bare **membership**, without a written decision;
- any auto-invalidate / auto-archive of a group when its admin is removed or
  offboarded;
- an Admin Web "approve" control whose enablement encodes a presence rule.

The four candidate readings produce four different products, and two of them
(online, on-duty) make a group's usability depend on a shift calendar. AI #4
will not encode any of them. `BR1-09` and `SG-12` remain unwritable.

---

## 5. Verification performed

| Check | Result |
|---|---|
| PRD v0.1 located? | **No** — absent from repo, Downloads and home |
| Second School consulted? | **No** — excluded per instruction 14 |
| Admin Web typecheck / build / tests | PASS / PASS / **74 passed** |
| `git merge-tree` vs 3 branches | **No textual conflict — and that is the finding** |
| AMB-9 invented anywhere? | **No** — grepped `lib/`, `apps/`, all branches |
| Phase 2 leakage in Admin Web | **None** (`videoCall`, `aiScore`, `broadcastToAll` … → 0 hits) |
| Real employee names outside `docs/` | **None** |

### Defect found in my own work during this audit

**AI4-D1 — the Coverage feature was never committed.** My `.gitignore` carried a
generic `coverage/` rule which silently matched
`apps/admin-web/src/features/coverage/`. Commit `cac9dac` claims coverage
shipped; it did not. The local build passed because Vite reads from disk, so a
fresh clone of `cac9dac..df528ee` **could not build** — `AppRoutes` imports
`CoveragePage` and the dashboard imports `useCoverageMutation`.

Fixed and committed during this audit. Reported because a passing local build
concealed it for four commits, which is precisely the failure mode this exercise
exists to catch.
