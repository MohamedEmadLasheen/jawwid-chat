# PD-57 closure plan: Report and Block, end to end

**2026-11-06. Owner decisions D-1 to D-6 (below) are binding and amend the roadmap
`google-play-blocker-roadmap-2026-11-03.md` §5 and §6.** Where this file and the roadmap differ,
this file wins. Nothing here is merged or deployed; every PR waits for the owner's merge.

PD-57 is **not complete** until the full lifecycle (report → queue → resolve → reporter answered;
block → enforced everywhere → unblock) works against the real API, proven by integration tests.

## 1. Owner decisions (2026-11-06)

| # | Decision | Replaces |
|---|---|---|
| **D-1** | The report-response SLA is **24 hours**: `due_at = created_at + 24 h`. The responsible managers are alerted at **18 h**; at **24 h** the Super Admin is alerted and the report is marked overdue. | A-1's 48 h, §5.2's 36 h / 48 h |
| **D-2** | The **Super Admin** can access **every** report. | — |
| **D-3** | Every other holder of `moderation.view` / `moderation.act` (managers and moderators) sees **only the reports of their own departments** (§3 below). Anything else reads as not found (404). | §5.4's organization-wide queue |
| **D-4** | **Child-safety reports** have a dedicated escalation path with **restricted access**: only the Super Admin and staff holding the new key **`moderation.child_safety`** (non-delegable, given to no role template) can see or act on them. They are never in a department queue. | §5.2's "every Super Admin" (kept) plus department visibility (removed) |
| **D-5** | Blocking is **enforced on the server** (messages, push, realtime, Notification Center, calls, opening a direct conversation), never only by hiding in the UI. | — |
| **D-6** | The **educational exceptions** stay, as explicit, tested rules (§5 below): lesson calls, lesson cards and system messages, and the academy's administrative channel. | §6.1 rules 3 and 6 (made exact) |

## 2. The work, as reviewable PRs

```
 PR-1 #463  DB fixes ───────────┬──► PR-2 ENG-02 Report API ──┬──► PR-3 ENG-03 Block API + enforcement
 (foundation, blocks all API)   │      (+ scoping, attachments,│
                                │       resolution effects)    └──► PR-4 ENG-04 escalation sweep + notifications
                                │
 PR-5 ENG-07 app Block UI  (stacked on #464; against the §6 contract; parallel)
 PR-6 #461 Admin Web fixes (against the §4 contract; parallel)
 PR-7 #464 revalidation    (after PR-2: contract tests against the real API)
 PR-8 Compliance + child-safety process docs (parallel; docs only)
```

| PR | Branch | Depends on | Risk | Merge order |
|---|---|---|---|---|
| PR-1 | `claude/pd57-moderation-model` (#463) | — | High (migration, RLS) | 1 |
| PR-2 | `claude/pd57-report-api` | PR-1 | High (authorization) | 2 |
| PR-3 | `claude/pd57-block-api` | PR-2 | High (authorization, realtime, calls) | 3 |
| PR-4 | `claude/pd57-report-escalation` | PR-2 | Medium | 3 |
| PR-5 | `claude/pd57-app-block-ui` | #464 | Medium | after PR-3 |
| PR-6 | `claude/pd57-admin-moderation-queue` (#461) | contract only | Medium | after PR-2 |
| PR-7 | `claude/pd57-app-report-sheet` (#464) | PR-2 | Low | after PR-2 |
| PR-8 | `claude/pd57-compliance-docs` | — | Low (docs) | any |

#462 (PD-58 terms model) changes only a header comment of `20261102210000_chat_account_erasure.sql`,
not the body of `chat.erase_account`, so it does not conflict with PR-1's redefinition. **Rule:** any
PR that redefines `chat.erase_account` after PR-1 starts from PR-1's text, and every PR's erasure
regression test (PD-56 5/5 and PD-57) must pass on the merged result.

## 3. Moderation access (D-2, D-3, D-4)

**A report's departments** are worked out by the server **when the report is filed** and stored in
`chat.content_report.department_ids` (set once; never changed by later reassignments, so a report
cannot fall out of its queue):
- subject is **staff**: the departments they manage or belong to (`department.manager_id`, `department_member`);
- subject is a **teacher**: the departments of the teacher's supervisors (PD-35), else the `teachers` department;
- subject is a **contact (parent)**: the departments of the supervisors of the family's children
  (`learner_supervision`, §6.3), else the `operations` department;
- for a **block's case** (`reason = blocked`), the blocker's side is added (§6.3 managers' departments),
  so the managers told of the block can open its case.

**Who sees a report** (one rule, applied to the queue, the detail, take, resolve and attachments):
- the **Super Admin**: every report;
- `reason = child_safety`: **only** the Super Admin and holders of `moderation.child_safety`;
- anyone else with `moderation.view`: a report whose `department_ids` include a department they
  **manage or belong to**;
- **never** the report's own subject (a manager reported by a parent cannot see or resolve it);
- otherwise **404** `COMM.REPORT_NOT_FOUND` (never 403, which would confirm the report exists).

An empty `department_ids` (no supervisor, no department) is visible to the Super Admin only, and the
18 h alert goes to the Super Admin.

## 4. API contract amendments (ENG-02)

Additive to roadmap §5.4.

- `POST /reports` → `201 {id, status, dueAt}` (dueAt = +24 h). Unchanged otherwise.
- `GET /me/reports` → unchanged: `[{id, targetKind, reason, status, createdAt, answer?: {text, at}}]`.
- `GET /moderation/reports` rows: `{id, targetKind, reason, priority, status, createdAt, dueAt, overdueAt?, takenBy?, reporterAnsweredAt?, subject: {kind, id, name}}`.
- `GET /moderation/reports/:id` adds:
  - `subject: {kind: 'contact'|'teacher'|'staff', id, name}` for **every** report (person and message);
  - `evidence.attachments: [{index, kind, mime, name, size}]`: never an object key;
  - `canAct: boolean` (holds `moderation.act` for this report).
- **New** `POST /moderation/reports/:id/attachments/:index/url` (`moderation.view`, same visibility
  rule) → `200 {url, expiresAt}`: a signed GET valid **5 minutes**, minted for this staff member;
  audited `report.attachment_viewed` (no content). Kept after the message was deleted for everyone
  (the evidence outlives it). Refused for a support session.
- `POST /moderation/reports/:id/resolve` `{resolution, note?, answer}`: `note` is **required** for
  `reassigned` and `account_suspended`.

**What each resolution does** (in the transaction that closes the report; every one is audited,
names the report, and sends `report_answered` to the reporter):

| Resolution | Status | Effect |
|---|---|---|
| `no_action` | dismissed | nothing else |
| `message_removed` | actioned | the message is deleted for everyone through `MessageService.removeForModeration` (message reports only; 400 otherwise) |
| `warned` | actioned | the subject receives a `conduct_warning` notification: a fixed bilingual Code of Conduct reminder that **never** mentions a report, a reporter or a message; audit `report.subject_warned` |
| `account_suspended` | actioned | the subject's account is suspended through PD-21 (`AccountAdminService.suspend`); the caller must also hold `accounts.administer`, and PD-21's own rules apply |
| `reassigned` | actioned | a PD-47 work task `report_reassignment` is raised for the managers of the report's departments (the Super Admin if none), linked to the report, carrying the note; the reassignment itself is done in the existing supervision tools |

## 5. Block contract (ENG-03, ENG-07)

Unchanged from roadmap §6.2 (`POST /me/blocks`, `GET /me/blocks`, `DELETE /me/blocks/:id`), plus:
- `POST /me/blocks` → `201 {id, subject: {kind, id, name}, createdAt}`; blocking someone already blocked → `200` with the existing block;
- 429 `COMMON.RATE_LIMITED` past **`block.limit.per_blocker_day`** (default 20 blocks per rolling 24 h);
- the protected targets (403 `COMM.BLOCK_NOT_ALLOWED`, `reason` in the error details): yourself, the
  official account, any department manager, the Super Admin; and any caller who is staff;
- message DTOs gain `hiddenByBlock: true` with body, attachments and preview removed, for the blocker only;
- **manager notices:** one per (case report, manager). Blocking again while the block's case is still
  open re-uses the case and **tells nobody again**; the database enforces it
  (unique `(case_report_id, manager_staff_id)`).

**The educational exceptions (D-6), exactly:**
1. A **lesson call** rings even when the callee blocked the caller: a call whose lesson's learner is in
   the callee's family (or is the callee's learner) and whose teacher is the caller.
2. **`system` and `card` messages** (lesson cards, schedule, cancellations) are never hidden.
3. Lesson reminders, schedule changes and cancellations (the Notification Center's lesson, schedule
   and administrative kinds) are never suppressed.
4. **The administrative channel:** the official account, every department manager and the Super Admin
   cannot be blocked; the family's direct conversation with the academy stays open; if the blocked
   person is the family's supervisor, staff covering that conversation are delivered.
5. Nobody leaves a group because of a block.

## 6. Abuse and bypass rules

- Reports: 10 per reporter per rolling hour; one open report per reporter and target; a report about a
  message requires that the reporter could read it (API: `readableNow`; database: the reporter was a
  member of the conversation when the message was sent, for parents and teachers).
- Blocks: 20 per blocker per rolling 24 h; block/unblock cycles never re-notify managers while the
  case is open; staff can never block; protected targets can never be blocked.
- Bypass: a blocked person cannot open a new direct conversation with the blocker, cannot ring them
  (except a lesson call), and their messages in shared groups are hidden on the server for the blocker.
- Support and impersonation sessions can neither file, block, view evidence nor resolve.

## 7. Stage reports

Every PR's description reports: what was implemented, the exact test commands and counts (passed and
failed), remaining risks, and whether it is ready for review.
