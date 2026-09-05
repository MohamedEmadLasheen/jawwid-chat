# Screen: Workload detail

**Priority:** P1 · **Platform:** Admin Web · **Owner:** AI #4

---

## 1. Role and purpose

**Roles:** manager (any staff member) · admin (their own only).

**Purpose:** *"why is this person's load what it is, and what would I change?"*

The dashboard says **Heavy**. This screen says **why**. It exists because a workload level with
no explanation produces two bad outcomes: managers who ignore it, and managers who reassign
families on a hunch.

**Entry points:** the dashboard's `WorkloadBadge` or score · a "Heavy admin received a NOW item"
alert · an admin's own settings → My workload.

**Primary action:** open the work that is driving the load.
**Secondary:** change an owner *(manager)* · adjust coverage *(manager)* · adjust `config`
weights *(manager)*.

## 2. Layout

```
┌──────────────────────────────────────────────────────┐
│  Admin A            Heavy · 16.4      ● online       │
│  Sat–Thu 09:00–17:00 · on shift until 17:00          │
├──────────────────────────────────────────────────────┤
│  What makes this load                                │
│  ┌────────────────────────────────────────────────┐  │
│  │ Needs reply         7 × 1.0   =  7.0    ▸      │  │
│  │ Active topics       3 × 1.0   =  3.0    ▸      │  │
│  │ Follow-ups today    4 × 0.7   =  2.8    ▸      │  │
│  │ Reply overdue       1 × 1.5   =  1.5    ▸      │  │
│  │ Complaint open      1 × 1.5   =  1.5    ▸      │  │
│  │ At-risk families    1 × 0.8   =  0.8    ▸      │  │
│  │                       Total   = 16.4           │  │
│  └────────────────────────────────────────────────┘  │
│  Heavy starts at 15.0   ·  weights from config       │
├──────────────────────────────────────────────────────┤
│  Families driving this load        (list, drillable) │
└──────────────────────────────────────────────────────┘
```

**Every row drills into the families behind it.** "7 needs reply" is a list, one click away.

**Every weight and threshold is labelled as coming from `config`** and is shown, not hidden.
The brief calls every one of these numbers an *"initial hypothesis"* to be recalibrated from
real data after 60–90 days; a manager who can see the arithmetic can tell the difference between
"this person is overloaded" and "this weight is wrong".

## 3. What this screen must not do

- **Not suggest a reassignment.** No "move 3 families to Admin D" button. Automatic or
  semi-automatic ownership movement is explicitly out of MVP (role brief §67, brief §10).
  The manager decides; the screen informs.
- **Not rank staff against each other.** No leaderboard, no percentile, no "most loaded".
  This screen is about one person's work, not a comparison — comparison lives on the dashboard
  where it is factual, not competitive.
- **Not count families.** Family count is never a workload input (brief §7) and does not appear
  as a metric here, only as context in the drill-through list.
- **Not invent a fourth level.** Light · Steady · Heavy (DD-06).

## 4. Levels

| Level | Rule `[BE]` | Treatment |
|---|---|---|
| **Light** | score < `config.workload.low_max` | `workload.low`, calm |
| **Steady** | < `config.workload.medium_max` | `workload.medium` |
| **Heavy** | ≥ `config.workload.medium_max`, **or** `needs_reply_count ≥ config.reply_burst` | `workload.high` |

When Heavy was triggered by the reply burst rather than the score, the screen says so —
*"Heavy because 12 families are waiting for a reply"* — because those two Heavies need different
responses from a manager.

Boundaries are read from `config`; the numbers `8` and `15` appear nowhere in the client.

## 5. States

- **Loading** — skeleton header, skeleton breakdown rows.
- **Empty** (a staff member with no load) — *"Nothing on Admin A's plate right now."* Light.
- **Off shift** — the whole screen renders with *"Not on shift — this is what would be theirs"*,
  because coverage means an off-shift admin's load is genuinely not theirs at this moment.
- **Error** — *"We couldn't load this breakdown."* + Retry.
- **Realtime** — rows update in place; no animation on numbers.
- **Config changed while open** — thresholds re-read, a toast *"Thresholds updated"*, the level
  may move without the work moving. Saying so prevents a manager from mis-attributing the change.

## 6. Permissions *(UX affordances only)*

Manager: anyone. Admin/coverage: **themselves only** — the RBAC matrix denies team workload to
non-managers, and the rail item for other people's workload does not render.
Department staff: no access.

## 7. Responsive · RTL

≥ 1024 two columns (breakdown / families) · < 1024 stacked.
**RTL:** the breakdown table mirrors, numbers and the `n × w = total` expression stay LTR as a
single run (a mirrored equation is unreadable), and the drill chevron mirrors.

## 8. Edge cases

- **Score exactly on a boundary** — the server decides the level; the client never compares.
- **A covering admin during her window** — covered families count **fully** on her (brief §7),
  and the screen says *"including 6 families you're covering"* so the number is not a mystery.
- **A staff member offboarded mid-view** — the screen switches to a read-only historical state
  rather than erroring.
- **Zero weights configured** — the breakdown renders with a warning that weights are unset,
  rather than a confident total of 0.

## 9. Backend dependencies

`GET /dashboard/team-now` and a per-staff workload breakdown endpoint returning **unit, count,
weight, subtotal** — not just a total, or this screen cannot exist · `GET /config` for weights
and thresholds · drill-through filters (`?owner_id=&bucket=&overdue=`) · realtime
`family.updated`. Score and level are computed server-side and rendered verbatim.
