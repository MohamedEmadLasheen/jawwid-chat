# Jawwid Chat — Design QA Checklist

**Owner:** AI #6 · **Consumer:** AI #5 (QA), plus AI #3 and AI #4 as a self-check before handing
anything over.

A design defect is a defect. These are pass/fail, not opinions. Gates marked **P0** block release.

---

## A. Invariant gates — the ones that cannot be negotiated

| # | Gate | How to verify |
|---|---|---|
| **DQ-01** **P0** | **No attention score, bucket number, or internal priority label is rendered anywhere.** | grep both codebases for a numeric attention binding; walk every admin screen at 3 data volumes. Brief §6/§12. |
| **DQ-02** **P0** | **Owner is visible on every family surface, and is never replaced by the on-duty person.** | Open a family under coverage, under assist, under escalation, under stickiness. Owner line present in all four. |
| **DQ-03** **P0** | **No internal note, internal event, case type, or staff identity beyond the owner's name reaches a parent or teacher surface.** | API-level, per AI #5's matrix, plus a visual sweep of every mobile screen with an internal-note-bearing fixture. |
| **DQ-04** **P0** | **No phone number appears in any screen, payload, notification, call log, search result, or export.** | Response filter test + visual sweep. |
| **DQ-05** **P0** | **A queued or pending message never looks delivered.** | Airplane mode; send; compare against a delivered message side by side. |
| **DQ-06** **P0** | **Workload has exactly three levels.** No "Critical" string exists in either codebase. | grep. |
| **DQ-07** **P0** | **The string "SLA" appears in no user-facing copy in either language.** | grep both codebases and both locale files. |
| **DQ-08** **P0** | **A family appears in exactly one inbox section at a time.** | Drive a bucket change with a realtime event while the list is open. |
| **DQ-09** **P0** | **Every destructive action collects a reason before it is possible to confirm.** | Change owner, reject approval, offboard, activate backup. |
| **DQ-10** **P0** | **No real employee name from the brief appears in seed data, fixtures, examples, or design docs.** | grep for the six names across the repo. AI #5's G-16. |

## B. Localisation

- [ ] **P0** Every screen renders in Arabic with no untranslated string, no `key.not.found`.
- [ ] **P0** Every screen renders in English.
- [ ] Mixed Arabic/English message bodies render with correct base direction per paragraph.
- [ ] Numbers, times, durations, IDs and URLs render as LTR runs inside Arabic sentences.
- [ ] Counts use ICU plurals; Arabic dual and the 3–10 form are exercised (1, 2, 3, 11, 100).
- [ ] No string is composed by concatenating fragments.
- [ ] Dates: Gregorian, `ص/م` in Arabic, Africa/Cairo, relative under 24h then absolute.
- [ ] Western numerals in both locales (DD-09).
- [ ] Server-originated strings (`top_reason`, system messages, rejection reasons) are localised.

## C. RTL / LTR

- [ ] **P0** Every screen laid out in RTL; nothing overlaps, nothing is clipped, nothing scrolls sideways.
- [ ] Every screen laid out in LTR.
- [ ] Back/forward chevrons, reply and send arrows, drawer direction and swipe actions mirror.
- [ ] **Media transport controls and voice-note waveforms do NOT mirror.**
- [ ] Checkmarks, delivery ticks, clocks, calendars, microphone, camera, paperclip, handset do not mirror.
- [ ] Time-axis charts do not flip.
- [ ] Own-message bubbles sit on the correct edge in both directions, with the tail radius on the right corner.
- [ ] Tables: headers, sort arrows, numeric alignment and pagination all correct in RTL.
- [ ] Focus order follows visual order in both directions.
- [ ] No `left`/`right` physical property in either codebase (lint rule).

## D. States — for every screen in `screens/`

- [ ] Loading is a **shape-matched skeleton**, not a spinner or a blank screen.
- [ ] Empty state is calm, one sentence, and offers an action only if one genuinely exists.
- [ ] Error state says what happened **and** what to do, and has a Retry.
- [ ] Offline: banner, UI stays interactive, sends queue.
- [ ] Reconnecting: banner, resync on recovery, no full refetch.
- [ ] Permission denied: *"You don't have permission to access this family."* and nothing more —
      **no owner name, no rule name, no entity id** (role brief §53).
- [ ] Session expired is distinguishable from account disabled and from bad credentials, and
      **the composer draft survives it**.
- [ ] Unread: divider persists until the user leaves the conversation.
- [ ] Selected row is distinguishable from hovered and from unread.

## E. Operational concepts

- [ ] NOW / TODAY / WAITING ON FAMILY / QUIET render as **sections**, with `top_reason` as the row's second line.
- [ ] `top_reason` is always in the same position on every row.
- [ ] "This order is wrong" is reachable from the inbox and its copy states that the order will not change today.
- [ ] Coverage: header shows both owner and on-duty; covering replies carry the **Covering** badge.
- [ ] Stickiness shows the expiry, and expiry produces a toast, not a surprise.
- [ ] Assist is visible-and-disabled with an honest reason until all three preconditions hold.
- [ ] `owner_locked` actions are disabled with "Leave for the owner", never hidden, never a 403 after typing.
- [ ] Unattended is manager-only and appears nowhere else.
- [ ] Handover cards carry last 3 messages, open cases, owner note, subscription, next class.
- [ ] "What happened while you were away" appears on the owner's first load after a gap.
- [ ] End-of-shift banner appears N minutes before shift end and can snooze.
- [ ] Response target shows nothing before 70%, then "Reply time running out", then "Reply overdue". **No countdown.**
- [ ] Workload badge is never shown without its breakdown.
- [ ] Every dashboard number drills through to the filtered list behind it.
- [ ] Follow-up creation is three fields; everything else is behind "More".
- [ ] Department staff see only their own tasks and **have no message affordance at all**.
- [ ] Ownership change collects a reason, shows an impact preview, and writes a timeline event.
- [ ] Approvals *(OQ-1)*: sender sees pending; others see nothing; rejection always carries a reason.
- [ ] Calls *(OQ-4)*: no recording UI, no phone numbers, call ends produce a timeline entry.

## F. Accessibility

- [ ] **P0** Contrast: 4.5:1 body text, 3:1 large text and UI boundaries, in every state.
- [ ] **P0** No status conveyed by colour alone — every one has an icon and a word.
- [ ] Touch targets ≥ 44×44 mobile, ≥ 32×32 admin with 8px separation.
- [ ] Full keyboard operation of the admin app; documented shortcuts work; focus is never trapped
      outside a dialog and never lost after a dialog closes.
- [ ] `focus-visible` ring on every interactive element, never removed.
- [ ] Screen reader: every icon-only control labelled; new-message live region polite;
      disconnection assertive; unread divider announced.
- [ ] 200% text scaling with no clipping and no horizontal page scroll.
- [ ] `prefers-reduced-motion` collapses all motion.
- [ ] Form errors are associated with their field and announced.

## G. Responsive

- [ ] Admin at 1920 / 1440 / 1280 / 1024 / 768 — each renders the layout specified in
      `design-system.md` §9.1, and the three-pane layout is never forced below 1024.
- [ ] Family panel collapses to a drawer below 1280 and its open/closed state persists.
- [ ] Mobile at 320 / 360 / 390 / 430 wide.
- [ ] Tablet: mobile layout, not a stretched phone layout.
- [ ] Wide tables scroll inside their own container; the page body never scrolls horizontally.
- [ ] Safe areas honoured; the composer clears the gesture bar.

## H. Content resilience

- [ ] Very long family name (60+ chars) truncates without breaking the row.
- [ ] Very long single-word token in a message wraps mid-word rather than widening the bubble.
- [ ] A 4000-character message renders and scrolls.
- [ ] Message containing **only** emoji renders at a larger size and is not restyled.
- [ ] Emoji inside Arabic text does not break direction.
- [ ] A family with 6 contacts and 4 students fits Family 360 without becoming a scroll maze.
- [ ] Zero students, zero subscription, zero cases — the panel degrades gracefully.
- [ ] 20 attachments in one thread; failed uploads keep their row with a Retry.
- [ ] Unread count > 99 renders as `99+`.
- [ ] 500-family inbox scrolls at 60fps on the low-end target device.

## I. Low-end mobile

- [ ] Cold start to first meaningful paint on the target device is measured and recorded.
- [ ] No blur, no gradient surfaces, no shadow-heavy lists.
- [ ] Inbox and message lists are virtualised.
- [ ] Thumbnails and voice-note durations come from the server; the client decodes nothing to render a list.
- [ ] Scroll stays smooth while a realtime event arrives.
- [ ] The app is usable on a slow 3G profile: skeletons appear immediately, nothing blocks on a spinner.

## J. Consistency sweep — run once, near release

- [ ] Every string in the product exists in `terminology.md`, in both languages.
- [ ] Every colour comes from a semantic token; no hex outside the two token files.
- [ ] Every icon matches the one mapping in `cross-platform.md` §1.
- [ ] The same concept looks the same on Flutter and on Admin Web.
- [ ] At most one `attention.now` element per viewport (DD-06).
- [ ] At most one primary button per view.
- [ ] Violet appears **only** on internal content.
