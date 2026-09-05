# Admin Operations (AI #4) — Repository Discovery Report

Date: 2026-09-05
Agent: AI #4 — Admin Operations Engineer
Scope inspected: `/Users/mohamedlasheen/Documents/jawwid chat`

## 1. Repository state

The working directory is **completely empty**. Not a placeholder, not a partial
scaffold — zero files, zero directories, no `.git`.

| Discovery item | Finding |
|---|---|
| Git repository | Absent (`fatal: not a git repository`) |
| Frontend architecture | None |
| React / TypeScript / Vite setup | None |
| Routing | None |
| State management | None |
| Design system | None |
| API client | None |
| Authentication | None |
| RBAC | None |
| Admin pages / Inbox / Family views | None |
| Task system | None |
| Dashboard | None |
| Realtime / WebSocket | None |
| Tests | None |
| Localization / RTL | None |
| AI #1 backend contracts (`docs/architecture/backend-contract.md`) | **Does not exist** |
| AI #2 communication contracts (`docs/communication/admin-contract.md`) | **Does not exist** |
| AI #3 Flutter mobile code | **Does not exist** |

Neighbouring directories under `~/Documents` belong to an unrelated project
(`second-school` / `ss-*`). They were not modified and are out of scope.

## 2. The only source of truth found

`~/Downloads/JAWWID_CHAT_BRIEF.pdf` — "Jawwid Chat — Project Brief for
Implementation", 8 pages. It states explicitly:

> "Full design doc (v3) exists separately; this brief is the contract for what to build."

This brief is therefore treated as **authoritative** over any second-hand
feature description, per engineering rule 99 (do not guess; inspect the PRD).

## 3. What can be reused

Nothing. There is no prior work to preserve, extend, or avoid duplicating.
Every non-negotiable in the brief's §12 checklist is currently unimplemented.

## 4. Contract mismatches — role brief vs. authoritative PRD

These are material. Each one represents work that the role brief instructed me
to build but that **does not exist anywhere in the PRD's data model or MVP scope**.

| # | Role-brief instruction | PRD (authoritative) | Resolution |
|---|---|---|---|
| M1 | Build an **Approval Queue** (Student Group message approve/reject + reason) | No `approval` entity, no student groups, no approval flow anywhere in the data model or MVP scope (§3, §10) | Out of MVP unless product overrides |
| M2 | Build **Calls** UI, call history, call metrics, calls in timeline | Calls are not mentioned once in the brief | Out of MVP unless product overrides |
| M3 | **Multiple conversations** per family | `thread` has `family_id UNIQUE`; §12: "cases never create a second thread". One continuous thread; `case` is layered on it | PRD wins — single thread + cases |
| M4 | Conversation states `OPEN / WAITING_ON_CUSTOMER / WAITING_ON_JAWWID / RESOLVED` | State lives on `case`: `open / waiting_customer / waiting_internal / scheduled / resolved / closed` | PRD wins |
| M5 | Attention states "now / soon / normal" | Buckets: `NOW / TODAY / WAITING ON FAMILY / QUIET`, from a computed score; show `top_reason` as text, **never a number or label** | PRD wins |
| M6 | Workload levels `LOW/MEDIUM/HIGH/CRITICAL` | `LOW < 8 · MEDIUM < 15 · HIGH >= 15`. No CRITICAL level exists | PRD wins |
| M7 | "SLA" terminology and SLA engine | PRD uses **response targets** (10/15/20 min etc.), config-driven | PRD wins — surface as response target |
| M8 | Handoff "does not change ownership" | Consistent with PRD (`transfer_ownership()` is the only owner mutation) | No conflict |
| M9 | `SUPER_ADMIN` role | Roles are `admin / coverage / manager / finance / technical / academic` | PRD wins |

Additionally, the PRD requires several admin surfaces the role brief omitted:

- **Unattended list** (manager) — the `on_duty()` function returning NONE. A
  hard invariant: a family is never silently assigned.
- **"What happened while you were away"** — owner's morning handoff digest.
- **End-of-shift banner** (N minutes before shift end, with snooze).
- **Stickiness** (`sticky_handler_id` / `sticky_until`) surfaced as "I'll keep this".
- **"Reply as assist"** with its three preconditions.
- **"This order is wrong"** inbox button — calibration logging, MVP-required.
- **Tasks screen for finance / technical / academic** departments (they see only
  their own tasks and can never message families).
- **Absence auto-detect** → manager warning with one-click "activate backup"
  (suggest only; never auto-activate in MVP).
- **One-click admin offboarding** with family redistribution.

## 5. Blocking dependency

The Admin Web application is a pure consumer of AI #1 (family, ownership,
coverage, RBAC, audit) and AI #2 (thread, message, case, task, handoff,
realtime). **Neither exists.** Per rules 71 and 86, I will not fabricate a
backend, embed business logic, or ship fake-data-powered features.

The `on_duty(family, now)`, `attention(family)` and `workload(admin, now)`
functions are explicitly backend-owned (PRD §4, §6, §7) and all their constants
live in the `config` table. The admin UI must render their output and never
recompute them.
