# Admin Web — Work Classification

Date: 2026-09-06 · Owner: AI #4 · Status: **FEATURE WORK STOPPED — reconciliation gate**

Classification: `KEEP` · `REWORK` · `BLOCKED BY PRD` · `BLOCKED BY DOMAIN` · `BLOCKED BY BACKEND`.
Nothing here is discarded.

## Summary

| Class | Share | Meaning |
|---|---|---|
| **KEEP** | ~70% | Conformant and independently useful. Do not touch. |
| **REWORK** | ~10% | Known shape of change; blocked on the domain decision |
| **BLOCKED BY DOMAIN** | ~8% | Waiting on the conversation model |
| **BLOCKED BY PRD** | ~7% | Waiting on Phase 1 |
| **BLOCKED BY BACKEND** | ~5% | Written; nothing to talk to |

## 1. KEEP — no change required

| Area | Files | Why |
|---|---|---|
| Ownership UI | `TransferOwnershipDialog`, `FamilyActions`, 8 tests | PRD-confirmed; owner≠on-duty holds (`domain-reconciliation` §3D) |
| Coverage UI | `features/coverage/*` | Confirmed; renders server config, hardcodes nothing |
| Family 360 | `FamilyPanel` | Confirmed; **no phone field** |
| Tasks | `features/tasks/*` | Confirmed |
| Manager dashboard | `features/dashboard/*` | Confirmed; drill-down intact |
| Attention rendering | `Badge`, `InboxRowItem`, 7 tests | Rule-based, server-computed, no score shown, no AI scoring |
| Internal-note distinction | `Thread`, 5 tests | Privacy control; matches worker's staff-only routing |
| i18n / RTL | `core/i18n/*`, 6 tests | ar/en parity, real RTL |
| Permissions (UX-only) | `core/permissions/*`, 6 tests | Correctly not a security boundary; no `super_admin` |
| Error model | `core/api/errors.ts`, `States`, 12 tests | ar/en, 403 offers no retry |
| Design system | `core/theme/*` | Logical properties throughout |

**These 74 tests stay green and must not be weakened during rework.**

## 2. REWORK — shape known, blocked on the domain decision

| Item | Change | Blocked by |
|---|---|---|
| `thread.family_id UNIQUE` model | Adopt `conversation` + `conversation_member`; re-key `qk.familyMessages` → `qk.conversationMessages`; re-target 2 endpoints | **BLOCKED BY DOMAIN** |
| `FamilyWorkspace` | Add conversation switcher (support · teacher↔admin · student groups) | same |
| `StaffRole` | Add teacher **actor/participant** kind — **not** a staff role | **BLOCKED BY DOMAIN** (§3C) |
| Realtime client | Regenerate from the reconciled contract; keep the invalidation map | **BLOCKED BY BACKEND** |
| `client.ts` auth | Adopt the single agreed scheme (~1 file) | decision pending |

`Thread`, `Composer`, `CaseCards`, `FamilyActions`, `FamilyPanel` are **unchanged**
by all of the above — they take a message list and a server capability object,
not a family key. ~6 of 74 tests re-point.

## 3. BLOCKED BY PRD

| Item | Question |
|---|---|
| Attention buckets `NOW/TODAY/WAITING/QUIET` | vocabulary unconfirmed |
| Case model UI | do cases survive in PRD v0.1? |
| Response-target badge | does the concept survive? |
| Approval UI enablement rule | **AMB-9 — must not be encoded** |

## 4. BLOCKED BY DOMAIN — missing product surfaces

**Student Groups · Approvals · Calling.** Backend now exists for all three
(`conversation.service.ts`, `approval.service.ts`, `call.service.ts`) — Admin Web
has none.

Per instruction: **do not implement these yet.** Reserved seams remain: nav is a
data-driven registry, `/approvals` and `/calls` are reserved routes, the message
model is an open union. When contracts are reconciled these are additive.

⚠️ `approval.requested` is already produced and fanned out to deciding staff —
**there is a live event with no consumer.** That is a real product gap, not a
cosmetic one, and it is the first thing to build once contracts settle.

## 5. BLOCKED BY BACKEND

All 34+ endpoints (0 implemented, no `/api/v1` prefix); the entire realtime layer
(RTC-1 CORS blocks the socket outright); login (no auth scheme).

## 6. Standing constraints on future admin work

1. No new client-side contract invention — unify first.
2. No AMB-9 encoding, including via a disabled/enabled approve button.
3. No attention/workload recomputation client-side.
4. No phone number in any surface.
5. Keep all 74 tests green; do not weaken an assertion to make a refactor pass.
