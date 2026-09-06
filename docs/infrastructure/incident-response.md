# Incident Response

Owner: AI #7 · Date: 2026-09-05

## Severity

| | Meaning | Examples | Response | Update cadence |
|---|---|---|---|---|
| **SEV-1** | Product unusable, or customer data exposed | API down, database down, message loss, unauthorized data access, **Teacher↔Parent channel opened (BR-1)**, phone number exposed | immediate, all hands | 30 min |
| **SEV-2** | Major feature broken or badly degraded | messages not delivering, queue stalled, realtime down, calling down for everyone | within 1 h, business hours | 2 h |
| **SEV-3** | Minor or partial degradation | push delayed, Core sync failing, one attachment type failing | next business day | daily |
| **SEV-4** | Cosmetic or internal | dashboard wrong, noisy alert | backlog | — |

Two rules that override the table:

- **Any suspected exposure of customer data or a phone number is SEV-1**, even
  if it affects one family. Privacy is a product guarantee, not a feature.
- **Any BR-1 violation is SEV-1.** A Teacher↔Parent 1:1 channel existing at all
  is a correctness failure of the core product rule, not a bug to triage later.

## Lifecycle

**Detect** — alert, smoke test, or a person. Anyone may declare an incident;
over-declaring is cheap, under-declaring is not.

**Triage** — assign an incident lead (coordinates, does not debug), set
severity, open a channel, start a timeline. Record in the timeline: what was
observed, what changed recently, what you did, what happened next. Write it as
you go; nobody reconstructs it accurately afterwards.

**Contain** — stop the bleeding before understanding it.

| Situation | Containment |
|---|---|
| Started after a deploy | Roll back first, diagnose after (`production-runbook.md` §3). |
| Data being corrupted | Stop writes to the affected path. |
| Credential leaked | Revoke at the provider **first** (`secrets.md` §5). |
| One dependency failing | Confirm it degrades rather than cascading; readiness should already be draining bad instances. |

**Communicate** — the incident lead sends updates on cadence, in plain language:
what is broken from a user's point of view, what is being done, when the next
update comes. Never speculate about cause in an external update. For a data
incident, involve whoever owns customer communication before saying anything
externally — and never publish customer data in an incident channel while
investigating.

**Recover** — restore service, verify with `/health/ready` and
`scripts/infra/smoke.sh`, watch for 30 minutes before declaring resolution.
Confirm the *user-visible* symptom is gone, not just that the graph recovered.

**Postmortem** — within 5 working days for SEV-1 and SEV-2. Blameless.
Timeline, impact (who, how many, how long), root cause, what went well, what did
not, and action items with owners and dates. An action item without an owner is
a wish.

## Playbooks

### Complete outage
`/health/live` from outside → if unreachable, platform status and recent
deploys; if reachable but `/health/ready` fails, the named dependency is the
incident. Roll back if a deploy preceded it. `production-runbook.md` §8.

### Message delivery degraded
The message is persisted before it is delivered — establish first whether this
is a **write** failure (SEV-1: data loss) or a **delivery** failure (SEV-2:
delayed). Queue depth, oldest-job age, worker heartbeat, Redis, push errors.

### Data access incident
Treat as SEV-1 from the moment it is suspected. Preserve logs before changing
anything. Establish what was reachable, by whom, for how long. Revoke and
rotate. Do not delete evidence to "clean up". Notification obligations are a
product and legal decision, not an engineering one.

### Notification failure
Usually a provider or configuration problem, not a code one. Check
`APNS_PRODUCTION` first for iOS, invalid-token rates, and provider status. Push
is a best-effort channel; messages remain readable in-app, so this is rarely
SEV-1.

### Calling failure
LiveKit status, token minting, server clock skew (300s TTL). Isolated to
calling; do not roll back messaging for it.

### Core sync failure
Chat must remain operational. Verify degradation is visible, retries are
bounded, and no Chat state was corrupted by partial Core data. Escalate to the
Core team; SEV-3 unless Chat itself is misbehaving.

### Backup or restore failure
Discovered during a drill: SEV-3, fix before the next deploy. Discovered during
a real recovery: SEV-1, and escalate immediately — you are now recovering
without a net. Note that a `chat`-only restore fails by design
(`backup-recovery.md` §4); confirm the procedure was followed before concluding
the backup is bad.

## Gaps

- **No on-call rotation, no escalation path, no contact list.** Detection today
  depends on someone noticing.
- No status page or customer communication template.
- No alerting backend (BLOCKER-3), so "detect" currently means "a person
  reports it".
