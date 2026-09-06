# Design Handoff — AI #5 (QA / Security / Release)

**From:** AI #6 · **Date:** 2026-09-05

What must be tested visually and behaviourally, and which of it should block a release.
`design-qa.md` is the full checklist; this document tells you which parts are gates, how to
produce the states, and where the design is most likely to fail.

---

## 1. Ten design gates I would block a release on

These map to `design-qa.md` §A. Each is objectively pass/fail.

| Gate | Assertion | How to produce the state |
|---|---|---|
| **DQ-01** | No attention score, bucket number, or priority label is rendered anywhere | grep for numeric attention bindings; screenshot every admin screen at 3 data volumes; the **only** legal number is the manager dashboard's workload score beside its breakdown |
| **DQ-02** | The **Primary Owner** is visible on every family surface and is never replaced by the **Current Handler** | fixture the same family under coverage, assist, escalation and stickiness — the Primary Owner line is present in all four |
| **DQ-03** | No internal note, case type, severity, or staff identity beyond the owner reaches a parent or teacher surface | fixture a family with internal notes, an `at_risk` state and an escalated case; sweep every mobile screen **and** assert at the API |
| **DQ-04** | No phone number in any screen, payload, notification, call log, search result or export | server-side response filter test + visual sweep. You already flagged this; it is worth one dedicated test |
| **DQ-05** | A queued or pending message never looks delivered | airplane mode, send, screenshot beside a delivered message |
| **DQ-06** | Workload has three levels; "Critical" exists in neither codebase | grep |
| **DQ-07** | The string "SLA" appears in no user-facing copy, in either language | grep both codebases and both locale files |
| **DQ-08** | A family is in exactly one inbox section at a time | drive a bucket change via realtime while the list is open |
| **DQ-09** | Every destructive action collects a reason before confirm is possible | change owner, reject approval, offboard, activate backup |
| **DQ-10** | No real employee name from the brief in seed data, fixtures, examples or design docs | grep the six names across the repo — this is your own G-16, and it now covers `docs/design/` too |

## 2. Where I expect the design to fail first

Ordered by my estimate of likelihood × cost. Test these before the easy ones.

1. **Coverage rendering as ownership.** The moment someone "simplifies" the two-line header into
   one line, the product's core promise inverts and nobody notices for a month. Assert both lines
   independently (DQ-02).
2. **An attention number leaking.** A debug badge, a tooltip, a `title` attribute, an
   `aria-label`. Check the accessible names too, not just the pixels.
3. **Internal notes on a customer surface.** Backend visibility rules will hold; the risk is a
   *timeline* or *search* path that forgets the filter. Test search and timeline specifically.
4. **RTL: the wrongly-mirrored icon.** Voice-note waveforms, play buttons, delivery ticks and
   time axes are the four that get mirrored by accident. A mirrored play button looks broken in a
   way an unmirrored chevron does not.
5. **Arabic plurals.** Six forms. Any string with a count. Test 1, 2, 3, 11, 100 — the dual (2)
   and the 3–10 form are what break.
6. **The composer jumping on keyboard open.** Test on a real low-end Android device, not an emulator.
7. **Text scaling at 200%.** Dense admin rows and mobile bubbles both clip.
8. **`config` literals hardcoded.** grep for `60`, `25`, `8`, `15` near threshold logic in both
   clients. Brief §12 makes this a non-negotiable; it is trivially violated during a hurry.

## 3. State matrix — every screen, every state

For each file in `docs/design/screens/`, the spec lists its loading, empty, error, offline,
permission-denied and success states. Each is a test.

Two are worth calling out because they are easy to get subtly wrong:

- **Permission denied** must be *exactly* `"You don't have permission to access this family."`
  and nothing more. **No owner name, no rule name, no entity id** (role brief §53). A helpful
  error here is an information leak.
- **Session expired** must be distinguishable from **account disabled** and from **bad
  credentials** (`screens/auth.md` §3), and **the composer draft must survive it**. Three
  different backend codes, three different user experiences.

## 4. RBAC — where your matrix meets the UI

Your `docs/qa/rbac-matrix.md` is the authority and every DENY must be asserted at the API. The design
adds a **UI-side** assertion for each one, because the role brief also requires that the
interface not *suggest* prohibited actions:

| Your DENY | Additional UI assertion |
|---|---|
| coverage closes an `owner_locked` case | The control is **visible and disabled** with "Leave for the owner — {name}'s next shift, {when}", not hidden and not a 403 after typing |
| non-manager transfers ownership | The owner row is **plain text with no affordance at all** — not a disabled button |
| department staff message a family | **No composer, no reply affordance, no link into the thread** exists on the tasks screen |
| non-manager views team workload / unattended | The rail item does not render; the unattended row does not render in Family 360 |
| assist without its three preconditions | Visible, disabled, with the precondition stated as the reason |

**A UI-only restriction is a defect, not a control** — your words, and this design agrees. The
UI assertions above are *additional*, never a substitute for the API test.

## 5. How to produce the hard fixtures

- **Coverage** — move the fixture clock past the owner's shift end; do not edit assignment state.
  There is no assignment state (your INV-3).
- **Stickiness** — reply, then move the clock past shift end but within the grace window.
- **Assist** — family in NOW, past 50% of the response target, on-duty admin has not opened it.
- **Unattended** — an absence with no backup and no covering rule for that window.
- **Away summary** — an owner whose last activity precedes a handover.
- **Approval** *(OQ-1)* — three fixtures: pending (assert **invisible to non-senders**),
  approved, rejected with a reason.
- **Workload Heavy by reply burst** rather than by score — the UI must say which, and the two
  produce different manager copy (`screens/workload.md` §4).

Use synthetic staff (`admin_a`, `coverage_b`, `manager_c`) and synthetic schedules throughout.

## 6. Accessibility gates

Contrast 4.5:1 body / 3:1 large and UI boundaries, **in every state including hover, disabled
and selected** · no status by colour alone · 44×44 mobile targets, 32×32 admin with 8px
separation · full keyboard operation of admin including the documented shortcuts · focus never
lost after a dialog closes · 200% text scaling · `prefers-reduced-motion`.

Screen reader specifics: new message announced politely, realtime disconnection assertively,
the unread divider announced, every icon-only control labelled.

## 7. Performance gates (low-end Android)

Cold start to first meaningful paint, measured and recorded on the target device · 60fps
scrolling on a 500-row inbox and a 2000-message thread · scroll stays smooth while a realtime
event arrives · usable on a slow-3G profile with skeletons appearing immediately · no blur, no
gradient surfaces, no shadow-heavy lists.

## 8. Content resilience

`design-qa.md` §H is the list. The five that break layouts most often: a 60-character family
name · an unbroken 200-character token in a message · a 4000-character message · an emoji-only
message inside an RTL thread · a family with 6 contacts and 4 students.

## 9. Two things I need from you

**First — your `authoritative-scope.md` corrected this pack.** It was originally written on the
premise that the PDF brief governed, and it has been re-conformed against your §3. Three of its
conclusions were withdrawn (the conversation model, the approver, and treating calling as
droppable). `scope-authority.md` records the corrections. If you find more, they are defects in
my work, not decisions to route around.

**Second — one gate I would add, and one history note.**

**The gate: no dead-end pending state.** `screens/approvals.md` §1 requires that every pending
message reaches an authorized approver and a terminal outcome. It is testable independently of
**OQ-1**: whatever routing rule is chosen, assert that it can never yield "nobody", or that it
has an explicit fallback in the way `on_duty()` returning NONE yields the Unattended list rather
than silence. A teacher whose message sits in `pending` with no approver anywhere is worse than
no approval workflow.

**The history note, for G-16.** One real employee name from the brief reached
`docs/design/terminology.md` and was removed during review. Before the fix landed, that revision
was swept into another agent's commit, so **the name is present in git history**. The working
tree is clean and the scan in `FREEZE.md` §6 confirms it. Whether history needs remediation is
your call, not mine.
