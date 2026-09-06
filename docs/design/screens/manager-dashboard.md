# Screen: Manager Dashboard

**Priority:** P1 (the Unattended header is **P0**) · **Platform:** Admin Web · **Owner:** AI #4

---

## 1. Role and purpose

**Role:** manager only.

**Purpose:** *"where is the operation at risk right now?"*

**Every number on this screen is a link.** A number that cannot be drilled into is a vanity
metric, and the role brief rejects them outright (§39). If a metric has no filtered list behind
it, it does not go on this screen.

**Entry points:** rail → Team · sign-in for a manager lands here, not on the inbox · escalation
notifications.

**Primary action:** open the thing that is at risk.
**Secondary:** activate a backup · change an owner · edit coverage · edit config · read the audit log.

## 2. Layout — ordered by urgency, top to bottom

```
┌────────────────────────────────────────────────────────────┐
│ 1  Unattended  0     Open escalations  2                   │  ← header, always
├────────────────────────────────────────────────────────────┤
│ 2  Needs your action                                    (3)│
├────────────────────────────────────────────────────────────┤
│ 3  Team now                                                │
├────────────────────────────────────────────────────────────┤
│ 4  Coverage — tonight · next Friday · gaps (7 days)        │
├────────────────────────────────────────────────────────────┤
│ 5  This week                                               │
└────────────────────────────────────────────────────────────┘
```

## 3. Header

Two figures, nothing else.

**Unattended — target 0.** At zero it renders in `status.success` with a check and the word
*"None"*. Above zero it is `status.danger`, states the count, and links to the list. This is the
brief's hardest invariant made visible: a family is never silently assigned, so somebody must be
looking at the families nobody is on duty for.

**Open escalations** — count, links to the escalation list.

## 4. Needs your action

The only section with a call to action on every row. Each row: what happened, which family or
person, when, and one action.

| Trigger `[BE]` | Row | Action |
|---|---|---|
| Manual escalation | "Admin A escalated Al-Farsi — {reason}" | Open |
| Auto-detected absence | "Admin A: in shift, no activity 45 min, 3 families waiting" | **Activate backup** |
| Heavy admin received a NOW item | "Admin A is Heavy and just received an urgent family" | Open her inbox |
| Unattended family | "Al-Farsi has no one on duty" | Open |
| Response target fully breached, never opened | "Al-Farsi waited 90 minutes with no reply" | Open |
| High-severity complaint | "Complaint opened for Al-Farsi" | Open |
| Third repeat of a case type in 30 days | "Al-Farsi: third billing topic in 30 days" | Open |
| Friday coverage over the workload threshold | "Coverage B is Heavy on Friday cover" | Open |

**Every row carries the reason it fired.** A manager acting on an alert they cannot explain is
a manager who will start ignoring alerts.

## 5. Team now

One row per staff member: presence · NOW count · TODAY count · late replies ·
**`WorkloadBadge` + score + breakdown** · inactivity warning.

**The workload badge is never shown alone** (role brief §40):

```
Admin A   ● online   Now 3   Today 7   Late 1
          Heavy · 16.4
          7 needs reply · 3 waiting · 4 follow-ups · 1 reply overdue · 1 complaint
```

The breakdown *is* the badge's justification. "Heavy" without it is an accusation; with it, it
is a description a manager can act on. The score is the one number in the product allowed to be
visible, and only here, and only beside its components — because a manager tuning `config`
weights needs to see what the weights produced.

**Three levels only: Light · Steady · Heavy.** There is no Critical (DD-06 / `discovery.md` §5).
**Family count is never a workload input** and is not displayed as one (brief §7).

Clicking a badge opens that admin's inbox filtered to the units driving the load.
Clicking a count opens the matching filtered list.

## 6. Coverage

Three compact blocks — **Tonight** (who → whom, right now), **Next Friday**, **Gaps in 7 days**
(count + the first two, linking to `screens/coverage.md`). Read-only here; editing happens there.

## 7. This week

Four blocks, each drillable: **Renewals** (due / renewed / no reply / refused) ·
**At risk** (by reason) · **Response-target compliance** (% met, and the count missed) ·
**Median first reply by shift** (day / night / Friday).

Charts are sparklines and simple bars. No pie charts, no gauges, no dials. A time axis
**does not flip in RTL** (`cross-platform.md` §4) — flipping it makes every reader misread the
trend.

## 8. States

- **Loading** — skeleton cards per section, in order.
- **Empty "Needs your action"** — *"Nothing needs you right now."* in a calm success treatment.
  The most important empty state in the product: it is the manager's definition of a good day.
- **Empty team** (nobody on shift) — *"No one is on duty right now."* + the next shift time.
  If any family is waiting, this pairs with a non-zero Unattended header.
- **Error** — per-section, with Retry. One failing section never blanks the dashboard.
- **Offline** — banner; last values shown with an explicit *"as of 14:22"* stamp. Stale
  operational numbers presented as live are worse than no numbers.
- **Realtime** — counts update in place. **No animation on a number.** A counting-up animation
  on an unattended family is a toy.

## 9. Permissions *(UX affordances only)*

Manager only; the rail item does not render for anyone else. Audit log access lives here and
is manager-only (AI #5's matrix).

## 10. Responsive · RTL

≥ 1440 two-column below the header · 1024–1439 single column · < 1024 stacked cards, the header
sticky. **RTL:** section order and card flow mirror; sparkline time axes do not; numbers stay
LTR; the drill-through chevron mirrors.

## 11. Edge cases

- **A staff member with no shift today** — shown, greyed, with *"Not on shift"*, never hidden.
  A manager needs to see who is *not* available.
- **An admin who is Heavy but has nothing overdue** — Heavy is not a failure state; the copy
  never says "problem", it says what the load is made of.
- **Unattended > 0 and no coverage rule exists** — the header links to the gap, not to the
  family list, because the fix is upstream.
- **Config change while the dashboard is open** — thresholds re-read from `config`; badges may
  re-level. A toast says *"Thresholds updated"* so a manager is not confused by a level that
  moved without the work moving.
- **A score visible in a screenshot** — the *workload* score is legal here and on
  `screens/workload.md`, always beside its breakdown. An **attention** score is legal nowhere,
  in any surface, ever (DQ-01). The two are different numbers and only one of them is forbidden.

## 12. Backend dependencies

`GET /dashboard/header | /team-now | /unattended | /needs-action | /this-week` · `GET /config` ·
`POST /absences/:id/activate-backup` · `GET /audit` · realtime `unattended.changed`,
`escalation.created`, `presence.changed`, `family.updated`.
All scores and levels are **computed server-side** and rendered verbatim (brief §7, §12).
