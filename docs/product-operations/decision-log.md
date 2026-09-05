# Decision Log

**Owner:** AI #8 · **Date opened:** 2026-09-05

Records decisions that have been **made**. Decisions still open live in
`open-decisions.md`; when one closes, it moves here with its rationale and date.

| # | Date | Decision | Made by | Rationale | Consequences |
|---|---|---|---|---|---|
| DEC-01 | 2026-09-05 | Jawwid Chat is an independent product; Second School is not an authority on any dimension | product owner | stated in every agent's role assignment | `~/Documents/second-school*` and `ss-*` are not precedent |
| DEC-02 | 2026-09-05 | The mobile parent + teacher app is in MVP scope even though it does not appear in the PDF brief | product owner | recorded in project memory and in `docs/qa/authoritative-scope.md` §3 | AI #3's work is in scope; the brief is not the whole product |
| DEC-03 | 2026-09-05 | Teacher↔Parent direct 1:1 messaging **and calling** are forbidden; the official Student Group is the only channel | product owner | BR-1, `authoritative-scope.md` §3 | must be enforced server-side; a UI restriction is not an implementation |
| DEC-04 | 2026-09-05 | Permanent Ownership + Shift Coverage + Workload Monitoring. **Not** a shared queue | product owner (brief §1, carried forward) | *"decided — do not re-litigate"* | no queue table, no routing, no auto-distribution, no workload-driven reassignment |
| DEC-05 | 2026-09-05 | Coverage and handoff never change Primary Ownership | product owner | brief §0/§12 | `owner_id` changes only via `transfer_ownership()` |
| DEC-06 | 2026-09-05 | Attention is rule-based in MVP; AI scoring is Phase 2 | product owner | `authoritative-scope.md` §3 | no text reading, no classification, no drafting in MVP |
| DEC-07 | 2026-09-05 | Approvals in MVP are approve · reject · rejection reason. Escalation, expiry and coverage-aware approval are Phase 2 | product owner | `authoritative-scope.md` §3 | building more is a scope defect |
| DEC-08 | 2026-09-05 | Voice calling (1:1 and group) is MVP; video is Phase 2 | product owner | `authoritative-scope.md` §3 | |
| DEC-09 | 2026-09-05 | Phone numbers never appear in any product surface | product owner | `authoritative-scope.md` §3 | enforced by construction in `Actor`/`Contact`; must extend to call signalling |
| DEC-10 | 2026-09-05 | Every number in the brief is a `config` default and an initial hypothesis, recalibrated from `event_log` after 60–90 days | product owner | brief §12 | no business constant may be hardcoded — currently breached by `AppConfigService` |

---

## Pending closure

These are proposed in `open-decisions.md` and are **not yet decided**. They are listed here
so that a future reader can tell at a glance what this log is still missing:

OD-01 conversation model · OD-02 one database · OD-03 admin presence in Student Groups ·
OD-04 teacher assignment authority · OD-05 `adminDirect` for parents · OD-11 approver when
the owner is off duty · OD-13 class-schedule signal.

Non-blocking and awaiting a decision: OD-06 Super Admin / CRITICAL · OD-07 workload staleness ·
OD-08 shift-boundary inclusivity · OD-09 follow-up ownership · OD-10 overdue follow-ups
during coverage · OD-12 complaint escalation without severity · OD-14 at-risk definition ·
OD-15 response clock while Unattended.

**Convention:** when a decision is made, add a row above with the date and the person who
made it, and strike it from `open-decisions.md`. A decision that is not written here did not
happen — this is the artifact whose absence produced the current divergence.
