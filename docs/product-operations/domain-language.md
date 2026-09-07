> **STATUS: REFERENCE** (Phase 0, 2026-09-07). Superseded as the vocabulary of record by `docs/contracts/DOMAIN-VOCABULARY.md`; its teacher/coverage findings are incorporated.
> Canonical index: `docs/README.md`.

# Domain Language Audit

**Owner:** AI #8 · **Date:** 2026-09-05
**Authority:** `docs/design/terminology.md` (AI #6) is authoritative for **UI strings**.
This document audits the *internal* vocabulary — schema, code and contracts — for the same
one-concept-one-word discipline.

## 1. Terms that mean two things

| Term | Meaning A | Meaning B | Sev | Resolution |
|---|---|---|---|---|
| **owner** | `family.owner_id` — the permanent Primary Owner | `task.owner_id` — the person a task is assigned to | **P2** | rename the task column to `assignee_id`. "Owner" must mean exactly one thing in a system whose one rule is about ownership |
| **resolved** | `case.status='resolved'` — a topic is finished | `thread.resolvedAt` — a conversation is closed (AI #2) | **P1** | X-04: conversations are never resolved; keep resolution on the case |
| **handler** | `case.handler_id` — who is working the case | `thread.sticky_handler_id` — temporary thread retention | **P2** | rename the thread field `retained_by`, matching the UI's *"I'll keep this"* |
| **userId** | `Staff.id` or `Contact.id` (`Message.authorId`) | `Staff.id` or `Contact.appUserId` (`ThreadParticipantState.userId`) | **P1** | X-13: one canonical actor id; `IdentityService` is the sole translator |
| **coverage** | `staff.role='coverage'` — a job title | `on_behalf_mode='coverage'` — an act | **P3** | acceptable; document that the role label and the mode are independent (an `admin` covering acts in `coverage` mode) |
| **window** | `coverage_rule.window_mode` | `attention.*_window_days`, `reopen.window_hours` | **P3** | fine — different namespaces |
| **teacher** | `staff.role='academic'` — back-office academic staff | `UserRole.teacher` — the mobile app user | **P0** | X-08 / JC-003: these are **two different populations** and conflating them is the root of the BR-1 defect |

The last row is the most consequential entry in this document. `types.ts` states the
conflation explicitly — *"ACADEMIC (teaching) staff are excluded here, so a teacher cannot
message a family through any channel"* — treating the brief's back-office academic staff and
the PRD's classroom teacher as one role.

## 2. Terms used by one layer and unknown to another

| Term | Known to | Unknown to |
|---|---|---|
| Student Group | AI #3, AI #5, AI #6, PRD | AI #2 (design-only), AI #1 (no table), AI #4 (no UI) |
| Approval | AI #3, AI #5, AI #6 | AI #2 (design-only), AI #1 |
| Current Handler | this document, AI #6 (*"On duty"*) | not a named concept in any schema |
| Super Admin | this agent's role brief | explicitly rejected by `domain.ts` and `terminology.md` |
| CRITICAL workload | this agent's role brief | explicitly rejected by `domain.ts` |
| Needs Attention Now/Soon/Normal | this agent's role brief | the system uses NOW / TODAY / WAITING ON FAMILY / QUIET |
| SLA | this agent's role brief, `config` scope name | forbidden in UI (`terminology.md` §1) |

**Finding DL-1 (P2):** the role assignments circulating to agents use a vocabulary that the
built system deliberately rejects. Each divergence is individually harmless and collectively
corrosive — it is how "owner" starts meaning "handler" in one module. Recorded as OD-06 and
X-10/X-11; the implemented vocabulary should win.

## 3. Canonical glossary (internal)

| Concept | Canonical term | Never call it |
|---|---|---|
| Unit of ownership and of the inbox | **Family** | customer, account, client |
| Person within a family | **Contact** | user, parent record |
| Child | **Learner** (schema) / **Student** (UI) | kid, pupil |
| Permanently responsible staff member | **Primary Owner** | assignee, account manager |
| Staff member responsible right now | **Current Handler** | assigned admin, agent |
| Covering staff member | **Coverage Admin** | backup owner, temporary owner |
| Persistent family conversation | **Family conversation** | ticket, chat session |
| Topic layered on a conversation | **Case** (staff) / **Topic** (family) | ticket, issue |
| Dated obligation on a case | **Follow-up** | reminder (that is a notification) |
| Work item for a department | **Task** | ticket |
| Computed urgency | **Attention** | priority, P1/P2/P3, score |
| Computed pressure on a person | **Workload** | capacity, utilisation |
| Change of permanent owner | **Transfer** | assign, reassign, route |
| Temporary change of handler | **Handover** | transfer |
| No one on duty | **Unattended** | unassigned, orphaned |

## 4. Acceptance criteria

- `task.owner_id` → `assignee_id` before the task table is created (free now).
- Thread-level `resolvedAt` removed or renamed and bound to case state.
- One canonical actor id documented in `types.ts`, with a test that receipts, read cursors
  and device tokens all key on it.
- `teacher` and `academic` are separate populations in the schema, never one role.
- This glossary is linked from the README so new agents read it before naming anything.
