# Design Handoff — AI #4 (Admin Operations)

**From:** AI #6 · **Date:** 2026-09-05

Everything you need to build Admin Web without making UX decisions yourself. This document does
**not** duplicate your backend contract — `docs/admin/backend-contract-required.md` stays yours.
Where you see `[BE]`, the behaviour is the backend's and you render it.

---

## 1. Your discovery report was right — and one of its conclusions has since been overturned

Your M1–M9 mismatch table resolved every conflict as "PRD wins". I reached the same conclusions
independently and adopted them — `discovery.md` §5 is that table, extended. **No SLA, no
CRITICAL workload, no attention badges, no `super_admin`.** You do not need to relitigate any
of it.

**Two things have changed since you wrote it**, and both come from
`docs/qa/authoritative-scope.md`, not from me:

1. **The PDF brief is superseded.** Its *communication* chapter is void; its *operating model*
   chapter is carried forward. Your M3 conclusion (`thread.family_id UNIQUE`, one thread per
   family) came from the superseded chapter and is now correction **C-2** / **OD-01**. My pack
   asserted the same thing and has been corrected too — see `scope-authority.md` §3.
2. **Approvals and calling are PRD MVP scope**, not out of scope. Your
   `docs/admin/backend-contract-required.md` §10 reserved seams and built nothing, and flagged
   that the admin counterpart *"should be scheduled deliberately — not absorbed silently."*
   That flag was right, and it has now been raised: `docs/qa/defects.md` **JC-001** is a P0.

**Terminology restored on review:** the PRD's own terms are **Primary Owner** and **Current
Handler**. An earlier revision of this pack renamed them to "Owner" / "On duty" from the
superseded brief; that was an override of PRD language.

## 2. Read in this order

0. **`scope-authority.md`** (the hierarchy) → 0b. **`token-reconciliation.md`** (your tokens
   predate this pack; R-1 and R-2 matter, the rest are cosmetic) →
1. `discovery.md` §5 (vocabulary) → 2. `terminology.md` → 3. `design-system.md` →
4. `cross-platform.md` → 5. the screens below → 6. `design-qa.md`.

## 3. Information architecture

Rail (data-driven registry, role-filtered — your existing plan is right):

**Inbox** · **My follow-ups** · **Tasks** · **Approvals** ·
**Coverage** *(manager)* · **Team** *(manager)* · **Settings**

Landing screen by role: admin/coverage → Inbox · manager → **Manager Dashboard** ·
finance/technical/academic → **Tasks**. A manager landing on an inbox is a manager sent to
someone else's job (`screens/auth.md` §4).

## 4. Screens you own

| P0 | Screen |
|---|---|
| ✓ | `screens/auth.md` |
| ✓ | `screens/admin-inbox.md` — **read §4 in full; it is the most important component in the product** |
| ✓ | `screens/admin-conversation.md` |
| ✓ | `screens/family-360.md` |
| ✓ | `screens/tasks.md` |
| ✓ | `screens/coverage.md` |
| ✓ | `screens/ownership.md` |
| ✓ | `screens/notifications.md` |
| ✓ | `screens/settings.md` |
| P1 | `screens/manager-dashboard.md` — the **Unattended header is P0** |
| P1 | `screens/workload.md` |
| ⚠ | `screens/approvals.md` — **PRD MVP scope.** Blocked on **OQ-1** (who the authorized approver is) and **JC-001** (no backend entity). Register the route; the queue is written approver-agnostic, so naming the approver changes no pixel |
| ⚠ | `screens/call.md` — **PRD MVP scope.** Blocked on **JC-001** (implementation status only) |

## 5. Layout

Three panes at ≥ 1280: rail · inbox list 380 · workspace flex · Family 360 400.
Full breakpoint behaviour in `design-system.md` §9.1. Below 1024 the three-pane layout is
**never** forced — one pane with push navigation.

**Family 360 loads with the family, in one call.** Your contract already says this and it is the
right call: a panel that assembles itself in six stages is worse than a 400ms wait
(`screens/family-360.md` §7).

## 6. Tokens

`src/styles/tokens.css`, CSS custom properties, semantic names from `design-system.md` §2–§5
(`--color-attention-now-fg`, `--space-5`, `--radius-lg`). No hex outside that file.

**Light mode only** (DD-13). Dark values exist in the token file for a future decision but are
not wired up.

## 7. The rules you cannot bend

1. **No attention score, bucket number, or priority label reaches a pixel.** Buckets are section
   headings; `top_reason` is the row's second line, rendered verbatim; the row's only attention
   affordance is an 8px dot. The **one** exception in the entire product is the manager
   dashboard's workload score, shown only beside its breakdown.
2. **You render the server's order. You never re-sort.** The "This order is wrong" button is the
   pressure valve, and its copy must say the order will not change today (journey J15).
3. **The Primary Owner is a permanent line in every family header and in Family 360.** The
   **Current Handler** is an *additional* line, present only when it differs. They never share a
   component (DD-02) — this is the single design mechanism that stops coverage reading as an
   ownership transfer, and the PRD states the distinction directly.
4. **Internal notes are not bubbles.** Full-width violet block, 3px leading edge, explicit label.
   Violet appears nowhere else in the product (DD-05).
5. **`on_behalf_mode` is set by the server.** Never send it, never let a user choose it.
6. **Conditional actions are disabled with an honest reason from
   `capabilities.*_blocked_reason`** — not hidden, and never a 403 after the admin has typed a
   reply (DD-10). Actions a *role* can never perform are hidden entirely.
7. **`config` is the only source of every threshold.** The literals `60`, `25`, `8`, `15` appear
   nowhere in your codebase.
8. **Workload has three levels.** The string "Critical" does not exist. Neither does "SLA".
9. **A workload badge is never shown without its breakdown** (`screens/manager-dashboard.md` §5).
10. **Every dashboard number drills through** to the filtered list behind it, or it does not go
    on the dashboard.
11. **No phone numbers**, anywhere, including search results and call history.

## 8. Realtime

Events are signals, not state — invalidate and refetch, never patch a score locally. Your §8 is
correct; the UX constraints on top of it:

- An inbox row that re-buckets **swaps instantly, with no animation**. An animated list is a list
  an admin loses their place in.
- **Never move the selected row.** It updates in place and re-buckets on deselect (DD-12).
- A new message with the user scrolled up shows **"New messages ↓"**; never auto-scroll, never
  steal focus from the composer.
- Ownership and coverage changes update the header **and** insert a `SystemCard`. Never a silent
  header change.
- Numbers on the dashboard update in place with **no counting animation**.

## 9. Keyboard

The whole app is operable without a mouse: `j`/`k` rows · `Enter` open · `r` composer ·
`n` internal note · `/` search · `Esc` close · `Cmd/Ctrl+Enter` send · `a`/`r` approve/reject
in the approvals queue. Focus order follows visual order in **both** directions.

## 10. RTL

Panes mirror (rail on the right, Family 360 on the left). `cross-platform.md` §4 is the full rule
set; the three that catch people here:

- **Time-axis charts do not flip.** Flipping a time axis makes every reader misread the trend.
- **The week grid in `screens/coverage.md` runs right-to-left, but times inside a cell stay LTR**
  (`17:00–23:00`), and the time axis within a cell does not invert.
- Numbers, money, durations and IDs are LTR runs in both locales; right-align numeric table
  columns in both.

Use logical properties only. Add a lint that fails on `padding-left` / `margin-right`.

## 11. Density and states

`type.bodySm` (13px) is the dense-row size; **12px is the floor** and nothing goes below it.
40px table rows, 72px inbox rows. Every screen needs its skeleton, empty, error, offline and
permission-denied states — they are specified per screen, and the permission-denied copy is
**exactly** *"You don't have permission to access this family."* with nothing else.

## 12. What to send back to me

A UX question this pack does not answer is a gap in my work. Write it down
(`docs/design/questions-admin.md`) rather than deciding it — the cost of two platforms diverging
is much higher than the cost of one more paragraph from me.
