# Coverage Audit

**Owner:** AI #8 · **Date:** 2026-09-05

## 1. Status

The four input tables exist (`chat.staff`, `shift`, `coverage_rule`, `absence`, branch
`feat/backend-foundation`) and are well modelled: `window_mode` renamed off the SQL reserved
word, `covered_id NULL` = all owners, `absence.activated_by` recording the human who
activated a backup, and an explicit comment that nothing auto-activates.

**`on_duty()` itself does not exist.** The only implementation is
`ReferenceCoverageService`, which returns the family's owner if active and `null` otherwise,
and which says so honestly in its own doc comment. Everything below is therefore an audit of
the *specification plus the stub*, not of a running engine.

## 2. Scenario walk-through

| # | Scenario | Expected | Today |
|---|---|---|---|
| A | Owner in shift | owner handles | owner returned ✅ (accidentally correct) |
| B | Owner off shift | coverage handles, `on_behalf_mode=COVERAGE`, handoff card | owner returned ❌ — the stub ignores shifts entirely |
| C | Owner unexpectedly unavailable | manager warned after `absence.auto_detect_minutes`, one-click activate | no detection, no alert |
| D | Owner overloaded | manager sees it; **no** reassignment | no workload engine |
| E | Coverage admin also overloaded | manager sees both; Friday-coverage-over-threshold escalates | unbuilt |
| F | Several owners unavailable at once | chain resolves per family; gaps show as Unattended | unbuilt |
| G | Friday | Mariam covers ALL owners (`covered_id IS NULL`, priority 1) | table supports it; no engine |
| H | Boundary crossed mid-conversation | stickiness bridges *if the replier is online* | `stickyUntil` only — presence ignored (FS-03) |
| I | Customer replies exactly at the transition | exactly one handler | ambiguous — AMB-5/OD-08 |
| J | Waiting-for-customer at the transition | quiet families do not move | no mover |
| K | Follow-up due while owner is away | visible to the handler, accountable to the owner | no follow-ups (OD-09) |
| L | Urgent message while owner is off shift | coverage acts on the transactional part; never closes an `owner_locked` case | no cases; **and** the covering admin is not even notified (FS-01) |
| M | Coverage handled it, owner returns | *"What happened while you were away"* | `AwaySummary.tsx` exists; nothing writes `Handoff` |

## 3. Findings

| # | Finding | Sev |
|---|---|---|
| **CV-1** | The covering admin is not in the message audience — coverage is invisible at exactly the moment it matters (`identity.service.ts`) | **P0** |
| **CV-2** | Stickiness ignores `staff.presence`, so a logged-off admin holds families for the grace window | **P0** |
| **CV-3** | Stickiness is set for `ASSIST` and `ESCALATION`, converting a one-off intervention into handler capture | **P0** |
| **CV-4** | No handoff record is ever written, so the away summary and the manager's audit trail have no source | **P1** |
| **CV-5** | No tie-break for equal-priority coverage rules → non-deterministic handler (AMB-3) | **P1** |
| **CV-6** | `on_duty()` must skip inactive staff at **every** link, not only the owner | **P1** |
| **CV-7** | The Unattended path terminates in a `null` nobody consumes: no list, no manager alert, no honest auto-reply, no deferred response clock | **P0** |

## 4. Acceptance criteria

1. `on_duty(family, now)` implements the brief's chain exactly, in SQL, reading only
   `staff`/`shift`/`coverage_rule`/`absence` and `schedule.timezone`; returns `NULL` for
   Unattended.
2. Deterministic ordering: `(priority ASC, valid_from DESC, id)`.
3. Half-open shift windows `[starts, ends)`; one test crossing an Egyptian DST boundary.
4. `current_handler()` = sticky **and online** → `on_duty()` → NULL.
5. Message audience = contacts + Primary Owner + Current Handler (+ staff with open tasks).
6. A shift-end job writes a `Handoff` row per `needs_reply` family, with the card payload.
7. Unattended is a manager surface with a count, an age, and one-click activate-backup.
8. Property test: for 10 000 random `(family, instant)` pairs, `current_handler()` returns
   exactly one staff id or an explicit Unattended — never two, never an accidental `null`
   (release-gate G-14).
