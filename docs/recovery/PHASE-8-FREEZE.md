# Phase 8 — Freeze and Handoff

Date: 2026-09-08 · Branch: `phase7/ai-and-automation` · Frozen at: **`32e0350`**
Verification evidence: [PHASE-8-EXTERNAL-GATE.md](PHASE-8-EXTERNAL-GATE.md) (authoritative for the
readiness verdict) and [PHASE-8-CLOSURE.md](PHASE-8-CLOSURE.md) (the blocker register).

This document exists to do one thing the other two do not: state, without
ambiguity, which items are **COMPLETE**, which are **EXTERNAL BLOCKERS**, and
which are **DEFERRED BY DESIGN** — so that nobody reads a blocker as an
unfinished task, or a deferral as a gap.

> ## ENGINEERING STATUS
> # PRODUCTION CANDIDATE
>
> No engineering blocker is open in the backend or the web application.
>
> **This is not a claim that the system works when deployed.** Nothing has been
> deployed, no CI run has ever executed, and no measurement exists under a real
> topology.

---

## 1. Classification

The three categories are used strictly. An item is **COMPLETE** only when it has
been executed here; an **EXTERNAL BLOCKER** is work that cannot proceed without
something this environment does not have; **DEFERRED BY DESIGN** is a decision
that was taken, not a task that was skipped.

### Monitoring

| Item | Status | Basis |
|---|---|---|
| Structured JSON logging, correlation, redaction | **COMPLETE** | 27 assertions |
| Health checks (`/health/live`, `/health/ready`) | **COMPLETE** | liveness touches no dependency; readiness reports `degraded` |
| **Sentry / error tracking** | **COMPLETE** | Wired in `0054ae9`/`6d70846`. Inert without `SENTRY_DSN`; 5xx and both process handlers reported; `beforeSend` deletes `request`/`user`/`breadcrumbs` and redacts through the same `redact()` the log store uses. 12 assertions |
| **OTLP metrics** | **EXTERNAL BLOCKER** | No endpoint and no hosting decision. `OTEL_*` are `opt` everywhere so the manifest does not demand a credential nothing reads. **Flip them back to `req` in the same commit that wires an exporter, not before** |
| Dashboards / alerts | **EXTERNAL BLOCKER** | Depend on the metrics pipeline above, then on a provisioned backend |

**No error event has been transmitted to a real Sentry project**, because there
is no project. What is verified is what leaves this process, not what arrives
anywhere.

### AI

| Item | Status | Basis |
|---|---|---|
| **Provider abstraction** | **COMPLETE** | `AiProvider` port, Anthropic adapter, `DisabledAiProvider`; graceful degradation, timeouts, bounded retries, input/output ceilings, output validation |
| Adapter parsing and failure classification | **COMPLETE** | 8 assertions: response parsing, schema rejection, refusal, input ceiling, and each SDK error mapped to the failure an operator would act on |
| **Live Anthropic round-trip** | **EXTERNAL BLOCKER** | No credential in this environment. `scripts/qa/ai-live-smoke.sh` is opt-in, unreachable from CI, prints neither key nor model output, and **refuses (exit 2) without a credential** |

**No live provider call has been performed, and none is claimed.**

### Phase 7 Core-fed reminders

| Item | Status | Basis |
|---|---|---|
| `FOLLOW_UP_DUE`, `MESSAGE_UNANSWERED`, `RISK_FLAG_CREATED` | **COMPLETE** | Computed from data this system owns |
| **`CLASS_UPCOMING`, `PAYMENT_DUE`, `RENEWAL_APPROACHING`** | **DORMANT BY ARCHITECTURAL DESIGN** | Implemented, tested, and seeded `enabled = false`. Fed from `chat.core_event`, which has no writer yet. Schedules, payments and renewals belong to Jawwid Core; `chat.subscription` is frozen machinery. **No local billing or schedule mirror exists and none is to be created** — that would put a second source of truth behind the amount a family is asked to pay |

This is a deferral, not a gap. The triggers begin working the day Core delivers
those events, with no deployment.

### Backup

| Item | Status | Basis |
|---|---|---|
| `pg_dump` copies **encrypted at rest** | **COMPLETE** | `7b8851e`. Refused before dumping when `APP_ENV` is staging/production without a passphrase. An `APP_ENV=production` encrypted dump restored into a scratch database passing **6/6** integrity suites |
| Provider-side / PITR backups | **EXTERNAL BLOCKER** | Needs a managed provider |

---

## 2. Verified at the freeze commit

Run in a clean detached worktree at `32e0350`, so every number belongs to
committed code rather than to a tree carrying other agents' edits.

| Gate | Result |
|---|---|
| Migration replay from empty | **52 applied**; re-apply a no-op |
| API typecheck | PASS |
| API build | PASS |
| API unit | **450 passed**, 34 suites |
| API integration | **762 passed**, 42 suites |
| Database integrity suites | **6/6** on a fresh database **and** on a database restored from an encrypted archive |
| Release-gate guards | **9/9** |
| Admin Web typecheck / tests / build | PASS / **111 passed** / PASS |
| Backup refusal (production, no passphrase) | refused, **0 files written** |
| Error tracker without a DSN | inert; SDK not loaded |
| AI live smoke without a credential | refused, exit 2 |

---

## 3. What must not be done next

- Do not add an OTLP exporter until there is an authoritative endpoint and a
  hosting decision. Wiring one with nowhere to export produces code nothing can
  exercise, and `OTEL_*` would have to be lied about again.
- Do not simulate a live provider call. The smoke script exists precisely so
  that the first real call is a real one.
- Do not build a local billing or schedule mirror for Core-owned data.
- Do not revive frozen machinery (`attention_*`, `family_state_cache`,
  `chat.subscription`, `chat.task`).

## 4. Next action

**Phase 8 engineering is frozen. No further Phase 8 implementation is required
until an external blocker becomes actionable.** The first that can move is a git
remote and CI execution (B-1), which unblocks mobile (B-3); hosting (B-2)
unblocks the metrics pipeline, staging verification and provider-side backups.
