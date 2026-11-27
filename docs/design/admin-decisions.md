# Admin web: design decisions

One line each: what was decided, and why. Newest at the end of each section.

## Tools
- The `frontend-design` plugin could not be installed (the session's permission system refused `claude plugin install`); its skill text was read from the local marketplace cache and followed as guidance.
- The advisor (`/advisor`) is a slash command only the owner can type; it was not available to this session. A fresh-context "design critic" sub-agent did its job at each checkpoint.
- Screenshots: Playwright with the installed Chrome, against a local API seeded with synthetic data.

## Type and icons
- Interface face: **Readex Pro** (OFL), self-hosted from `@fontsource/readex-pro` 5.3.0. Tested against IBM Plex Sans Arabic, Noto Sans Arabic, Alexandria, Rubik, Cairo, Tajawal and Almarai on real admin strings; Readex sets the largest and clearest at 13-15px in both scripts, its figures are steady in tables, and it was designed for long-session legibility. Alexandria was too loud for an 8-hour tool; Plex sets visibly smaller.
- IBM Plex Sans Arabic stays for one job only: the teacher-board viewer redraws a board in the mobile app's own typeface.
- No display serif anywhere (the serif + cream + terracotta trio is the commonest tell of a generated page).
- Icons: **Lucide** (`lucide-react` 1.70.0, ISC), one family, stroke 1.6 at 18px and up (heavier only when drawn small so it keeps its weight).

## Teacher statistics (prototypes A/B/C, critic round 0)
- Chosen: **A, a ranked table in bands**, with C's inspector opening as a side sheet on row click. B hid teachers 5-11 behind four identical cards; C's 400px list wrapped reasons onto orphan lines.
- The sort is named ("by priority") and each row's reason line says what the columns do not (a teacher no-show, a low on-time rate), never repeats them.
- Red only on a value that breaches a threshold; no red row stripe, no red reason text, the band label in ink with a small red dot.
- The reports cell carries two facts: the count of unreported lessons (large) and the on-time report rate under it (red only when low).
- Row action appears on hover and focus as a quiet control; the real primary action is in the side sheet.
- Numbers are end-aligned with tabular figures; lessons read "73 / 74" in one weight; no decorative attendance bar.
- Rows 52-56px; the KPI strip becomes filters (needs action, late reports, low attendance, teacher no-shows); no vanity total.
- When most teachers are flagged, severity splits in two: **urgent** (resolvable now: lessons unreported past the threshold, a teacher no-show) and **watch** (trends: low attendance, low on-time rate); thresholds are visible and live in one named constant.

## Schedule (prototypes A/B/C, critic round 0)
- Chosen: **day view = A** (teachers as rows, hours across, flowing right to left in Arabic); **week view = B reworked** (teachers × days, each cell shows load against working hours and an issue mark only where one exists, a click drills into that day); **month view** follows B's language. C (days as columns, hours down) was dropped: with more than a handful of teachers it becomes unreadable confetti.
- The time range is derived from the earliest working-hour start to the latest end plus padding, so the axis never clips; the hour header is sticky.
- A conflict draws the two clashing lessons in half-height sub-lanes with a red outline; no third "conflict" chip.
- An absent teacher's lane is hatched and keeps the lessons that need a substitute visible, each offering "substitute".
- Lessons outside a teacher's working hours get their own state.
- The attention rail drops the vanity "lessons today" number and the legend panel (legend becomes a help popover); hovering or choosing an attention item highlights its row and lesson on the grid.
- Week starts on Saturday by default, as a setting (`SCHEDULE_WEEK_START`).

## Colour rules (critic round 0)
- The primary action is always deep teal. Gold has **one** meaning: *now* (the current-time line and the current item). Red appears only on a breached value or a problem state, never across a whole row. Count badges in navigation are neutral, not red.
- No meta strings joined with middle dots; use commas or separate lines.
- Type floor: 14px for content, 13px for metadata, 12px only for axis labels.
- Avatars: one neutral tint and one letter (two joined Arabic letters form words), or the person's photo.

## Shell (critic round 0)
- No top bar: search and the command palette (Ctrl/Cmd+K) sit at the top of the sidebar; the page header owns the first row (title at the start, controls at the end).
- The sidebar is a clearly different surface from the canvas (not the logo teal), with the real logo, short labels that fit one line, "Today" first as home, and the account block (person, language, notifications, sign out) at its foot.
