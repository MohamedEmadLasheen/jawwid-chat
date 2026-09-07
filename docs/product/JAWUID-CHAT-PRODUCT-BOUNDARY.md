# Jawwid Chat — Product Boundary

Status: **CANONICAL** · Locked in Phase 0 (2026-09-07)
Authority order: this document → `jawwid-chat-prd-v0.1.md` (product requirements) → everything else.
Supersedes as product direction: `docs/JAWWID_CHAT_BRIEF.{pdf,txt}` (Customer Success brief — **HISTORICAL**),
`docs/architecture/decisions.md` ADR-001 ("build the brief" — **SUPERSEDED**),
`docs/admin/backend-contract-required.md` (brief-derived — **HISTORICAL**).

This document exists because the repository was built by parallel agents against
two product directions at once: a *Customer Success operating system* (the PDF
brief: threads, cases, tasks, renewals, workload scoring) and a *communication
platform* (the PRD: parents, teachers, supervisors, conversations, groups,
approvals, calls). Phase 0 locks the second. No future agent may reintroduce the
first without an explicit product decision recorded here.

---

## 1. What Jawwid Chat is

> Jawwid Chat lets **parents, teachers, supervisors (admins) and managers
> communicate safely around families and learners**, while the platform
> enforces ownership, permissions, moderation, privacy, realtime delivery,
> notifications and auditability.

It is a communication platform first. Operations tooling exists only to make
communication safe and answerable, never as a general workflow system.

### 1.1 Jawwid Chat IS

| Capability | Scope today | Where it lives |
|---|---|---|
| **Family communication** — one persistent direct conversation per family with Jawwid, routed to the family's assigned supervisor | MVP | `chat.conversation` type `direct`, `family_id` |
| **Conversations** — typed, multi-party, explicit participant set: `direct`, `student_group`, `class_group`, `official` | MVP (class groups Phase 2, type present from day one) | `chat.conversation`, `chat.conversation_member` |
| **Messaging** — text, media, voice notes, replies, reactions, receipts, typing, delete-for-me / delete-for-everyone, per-user archive/mute/pin | MVP | `apps/api/src/communication/messages` |
| **Teacher ↔ Admin communication** — one persistent direct conversation per (teacher, admin) pair; never family-scoped | MVP (decision C-2) | `direct` with `family_id = null` |
| **Supervisor communication and coverage** — the assigned supervisor answers; a covering admin may act with the same permissions inside a coverage window | MVP; coverage *windows* pending product confirmation (see §4) | `AuthorizationService`, `SUPERVISOR-OWNERSHIP.md` |
| **Realtime** — delivery, receipts, typing, presence, approvals and call signalling over Socket.IO with Redis fan-out | MVP | `RealtimeGateway`, outbox worker |
| **Notifications** — push with priority, quiet hours, templates, dedupe, delivery/open tracking, automated reminders | MVP (dispatch pipeline to be completed) | `apps/api/src/communication/notifications` |
| **Moderation** — group messages from teachers and parents are held for the supervisor's approval; approve / reject with reason; audit | MVP | `chat.message_approval` |
| **Calls** — 1:1 voice and Student-Group voice calls, LiveKit media grants minted server-side, BR-1 applied to calls | MVP | `apps/api/src/communication/calls` |
| **Attachments** — signed upload/download URLs, validated MIME/size, object storage | MVP | `apps/api/src/communication/attachments` |
| **Labels** | Phase 2 | not built |
| **Broadcast** — official messages from Jawwid to many families | Phase 2 | `official` type present; sending not built |
| **Stories / Status** | Deferred (not in the PRD) | not built |
| **Audit** — append-only event log and audit log, reasons mandatory for sensitive actions | MVP | `chat.event_log`, `chat.audit_log` |
| **Access control** — one server-side `AuthorizationService`, BR-1 enforced in the API and in the database | MVP | `apps/api/src/platform/authorization.service.ts`, `093000`/`093300`/`094000` |
| **Supervisor ownership** — every family has exactly one current supervisor; reassignment by a manager with a reason; history | MVP | `SUPERVISOR-OWNERSHIP.md` |
| **CRM integration boundary** — Jawwid Core is the source of truth for students, parents, teachers, schedules and payments; Chat mirrors what it needs through an API/webhook boundary, never SQL | MVP boundary; ingestion to be re-implemented on the canonical schema | `chat.core_event`, `chat.sync_state`, `core-integration-contract.md` (reference) |

### 1.2 Jawwid Chat IS NOT

| Not this | Why | What happens to the existing code |
|---|---|---|
| A generic CRM | The PRD centres the product on families and conversations, not accounts and pipelines | CRM-shaped machinery is **deprecated and frozen** (§3) |
| A customer-success operating system | The brief that described one is superseded (`docs/qa/authoritative-scope.md`) | `attention`/`workload` engines and the "team now / this week" dashboard are deprecated |
| A case-management system | Product decision C-3 (2026-09-06): there is **no Case entity** | `chat.support_case` removed by OD-01; Admin Web `CaseCards` deprecated |
| A generic task-management system | Tasks routed to departments are CRM tooling; a *conversation-scoped follow-up* may return later as a communication feature | `chat.task` frozen; Admin Web `features/tasks` deprecated |
| A renewal / subscription management platform | Renewals live in Jawwid Core | `chat.subscription` mirror and renewal config deprecated |
| A workload / coverage CRM | Coverage exists only so a family is never unanswered | coverage *engine* retained until the ownership model replaces its routing role; shift/absence UI deprecated |
| A WhatsApp Business layer or a WhatsApp clone | PRD §1 | — |
| An AI product | AI intent classification is Phase 2 and suggestion-only; no AI in Phase 0/1 | — |

---

## 2. Domain layering

```
┌─────────────────────────────────────────────────────────────────────┐
│ CORE CHAT DOMAIN                                                    │
│  Family · Learner · Contact · Teacher · Staff · Organization        │
│  Conversation · Participant · Message · Attachment · Reaction       │
│  Receipt · Approval · Call · Supervisor Assignment                  │
├─────────────────────────────────────────────────────────────────────┤
│ SUPPORTING PLATFORM SERVICES                                        │
│  Identity & Sessions · Authorization · Realtime · Notifications     │
│  Storage · Audit / Event log · Outbox & Workers · Config            │
│  Coverage windows (pending decision, see §4)                        │
├─────────────────────────────────────────────────────────────────────┤
│ EXTERNAL INTEGRATIONS                                               │
│  Jawwid Core (identity provisioning, learners, enrolments,          │
│  schedules, payments) · Push providers (FCM/APNs) · LiveKit ·       │
│  Object storage                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Rules:

* Core Chat Domain objects are the only ones a client may name. A client that
  needs a supporting-service concept (e.g. a session) gets it through an API
  resource, never by reaching into the service.
* Supporting services never make product decisions; they execute decisions
  the domain layer already took (e.g. the outbox delivers what a service
  committed).
* External integrations are **boundaries**: data crosses them through a
  contract with `external_id` + `synced_at`, and conflicts resolve in favour of
  the external system for the facts it owns (PRD §12.4).

---

## 3. Deprecated machinery (frozen, not deleted)

The following exists in the schema and, partly, in Admin Web. It is **frozen**:
no new code may depend on it; it is removed by a later, numbered migration once
the product owner confirms; it is never edited in place.

| Machinery | Objects | Status |
|---|---|---|
| Cases | `chat.support_case` (dropped by OD-01), Admin Web `CaseCards`, `/cases/*` endpoints | removed in DB · deprecated in Admin Web |
| Tasks | `chat.task`, Admin Web `features/tasks`, `/tasks` | frozen |
| Shifts / absences / coverage rules | `chat.shift`, `chat.coverage_rule`, `chat.absence`, `chat.handoff`, Admin Web `features/coverage` | frozen pending §4 decision |
| Workload scoring | `workload_*` functions, `WorkloadBadge`, team-now table | frozen |
| Attention scoring | `attention_*` functions, `family_state_cache`, attention buckets | frozen; the *idea* (needs-reply queue) returns as a conversation section in the console |
| Renewals / at-risk | `chat.subscription` mirror, renewal config keys, dashboard "this week" | frozen |

Full object-level classification: `docs/recovery/PHASE-0-DATABASE-RECONCILIATION.md`;
Admin Web: `docs/recovery/PHASE-0-ADMIN-WEB-RECONCILIATION.md`.

---

## 4. Open product decisions (recorded, not assumed)

| ID | Question | Why it matters | Default until decided |
|---|---|---|---|
| PD-1 | Are coverage admins permanent silent members of Student Groups, or joined for the window only? (PRD §15.2 Q4) | membership model, C-4 admin presence | not implemented either way |
| PD-2 | May parents initiate group calls? (PRD §15.2 Q5) | `canCall` policy | parents cannot initiate group calls |
| PD-3 | Do coverage *windows* (shift schedule → on-duty admin) survive as a communication feature, or is coverage reduced to explicit temporary assignment? | decides whether the coverage engine is KEEP or REMOVE LATER | engine retained, UI deprecated, no new code |
| PD-4 | PRD §7.5 "conversations created automatically by the system (onboarding, renewal, payment, schedule change, follow-up)" has no representable type after C-1 + C-3 (`od-01-migration-impact.md` §17) | notification/reminder pipeline target | system events post into the family's existing `direct` conversation as `system` messages; no new conversation type |
| PD-5 | Does `super_admin` exist as a role from day one? PRD §3 says yes; Admin Web asserts no | role model | **yes** (PRD governs); see `AUTHORIZATION-MODEL.md` |

---

## 5. Phase map

| Phase | Delivers | Explicitly excluded |
|---|---|---|
| **0 — Reconciliation** (this) | one integration line, one architecture, one contract, deprecations, security containment | any new feature |
| **1 — Identity, Authentication & Authorization** | accounts, credentials, sessions, devices, teacher identity, role/permission model, supervisor assignment, RLS engagement | messaging features |
| 2 — Console & clients on the canonical contract | Admin Web rework, Flutter realtime client, notification dispatch, storage serving | broadcast, labels |
| 3 — Communication features | broadcast, labels, class groups, search across chats | AI, video |
| Later | AI suggestions, video, stories/status, multi-tenant SaaS | — |
