# Admin web: design decisions

One line each: what was decided, and why. Newest at the end of each section.

## Tools
- The `frontend-design` plugin could not be installed (the session's permission system refused `claude plugin install`); its skill text was read from the local marketplace cache and followed as guidance.
- The advisor (`/advisor`) is a slash command only the owner can type; it was not available to this session. A fresh-context "design critic" sub-agent did its job at each checkpoint.
- Screenshots: Playwright with the installed Chrome, against a local API seeded with synthetic data.

## Type and icons
- Type: **Readex Pro** (600/700) for titles, navigation and figures, **IBM Plex Sans Arabic** (400/500/600) for reading text. Tested against Noto Sans Arabic, Alexandria, Rubik, Cairo, Tajawal and Almarai on real admin strings: Readex sets the clearest large figures and headings, Plex reads best in long text and is the mobile app's face. The pair is the academy's own sales-page pair (join.jawwid.com), so the admin and the brand speak with one voice. Both OFL, self-hosted (`@fontsource/readex-pro` 5.3.0; Plex was already bundled).
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

## Palette (reference study)
- The brand palette is read from the sales page's CSS: ground `#FFFBF3`, ink `#12333B`, teal `#1A5866`, deep teal `#123F4A`, gold `#DEA854`, mist `#E9F1F1`. The admin uses the same values; the previous admin teal (`#0F7A72`) was off-brand.
- The sidebar is the brand mist, not the logo teal (owner's guidance overrides the references, several of which put brand colour in the navigation).
- The sales page's pomegranate (`#A8442F`) is not used: it sits too close to the urgent red and to the rejected terracotta.
- Ranking teachers against each other is an HR question; the statistics page orders by *need for intervention*, not by performance, and says so.

## Shell (critic round 0)
- No top bar: search and the command palette (Ctrl/Cmd+K) sit at the top of the sidebar; the page header owns the first row (title at the start, controls at the end).
- The sidebar is a clearly different surface from the canvas (not the logo teal), with the real logo, short labels that fit one line, "Today" first as home, and the account block (person, language, notifications, sign out) at its foot.

## Shell and Today (critic rounds 1-3)
- Today is a work queue only: the figure strip repeated its own sections and was removed; the first item of the first group is the page's one primary action.
- Today uses the Conversations page's reply target (`REPLY_WAIT` in `features/chat/queue.ts`: amber after 60 min, red after 120) and its wait words, so one wait reads the same everywhere.
- An instalment's age is amber until `INSTALMENT_LATE_RED_DAYS` (7, `features/today/TodayPage.tsx`) and red after: when every late row was red, red stopped meaning anything. Owner may change the number.
- Today rows keep one stated action and no "⋯": nothing else is done from Today; the action opens the place where everything else is.
- One "you are here" in the sidebar: the open page carries the pill and the gold mark; its place keeps weight only.
- A place's flyout moves up just enough to stay inside the window; a group of one page has no heading.
- On phones the account lives behind the face in the top bar (its menu says who you are); the drawer folds one place at a time; More is current for pages without a tab. The drawer has no second account block (two account menus on one screen).
- A super admin on an operator page (`/tasks`, `/payments`) sees its place marked: the place is matched under its `/admin/…` name too.
- Sign-in: the form alone on phones; the drawing of the academy's day only on wide screens; the reset link is one action under one question.
- Search marks the matched letters with a teal tint (gold is "now" only).
- People & Organization is shortened to "People" on the sidebar; its full name stays the accessible name and the flyout title.

## Collapsible rail (owner's instruction, 2026-11-27)
This replaces the earlier "labelled navigation" instruction.
- On desktop (1024px and wider) the sidebar is folded to icons by default (60px). The toggle at its foot (Lucide panel icon, mirrored for Arabic) opens it to icon and label (260px) and closes it again. The choice is kept per device in `localStorage` under `jawwid.sidebar.expanded` (`RAIL_EXPANDED_KEY` in `app/AppShell.tsx`). It is read before the first paint, so a page never loads in one state and jumps to the other.
- **Width.** It animates over 200ms. The page column is the grid's second track and follows the same transition, so content flows with it rather than jumping, and the icons do not move (each sits at the same inline offset in both states). Under `prefers-reduced-motion` the change is instant.
- **Folded rail.**
  - Every control keeps its word as visually hidden text, so its accessible name is unchanged. A tooltip names it on hover and on keyboard focus (`:focus-visible`), beside the rail at the inline end (left in Arabic). The tooltip takes over a native `title` while shown, so two never stack, and it hides for an open place menu.
  - Counts sit on the icon's corner. The current place carries the pill and gold mark itself (its pages are not listed under it), and its pages still open in the flyout beside the rail.
  - The account shows only the avatar. Its menu opens beside the rail and starts with the person's name and role.
- **Logo.** The lockup has no separate mark, so the folded rail crops to its middle (the W under the open book). A proper square mark is an open item for the owner.
- **Phones and tablets (under 1024px)** are unchanged: a top bar, a drawer and the bottom tab bar. A drawer is opened on purpose, so it shows labels.
- **Main content.** There is no overlay mode. The content reflows with the rail so nothing is hidden behind it, and an opened rail is a lasting choice, not a peek.

### Rail critic round 1 (2026-11-27)
- **Fit.** On a laptop 768px tall the folded and opened rails now keep every place in view:
  - The rows and gaps tighten under 820px of height.
  - Under the place you are in, only your page's group is listed (only your page on a short window); the rest stay one click away in the place's menu and the page's tabs.
  - While more lies below, the list fades at its end; folded, its thin scrollbar shows.
- **Toggle.** It uses double chevrons, because pages use the panel icon for their own side panels.
- **Gold mark.** Its rounding uses logical radii, so it faces the page in Arabic too.
- **Counts on icons.** The rail keeps the counts it already carried: unread conversations on Conversations, and unread notifications on the bell. Overdue counts on Finance or the Dashboard would make the shell fetch on every page; the shell deliberately adds no request of its own, and Today and the Dashboard already lead with what is overdue. This is logged for the owner as an option.
- **Dashboard.** The calm column's 380px cap is kept: a name stays within reach of its figure.
- **Room set by the container.** Figures, instalment rows, the payments ledger, the teacher statistics list and the chat reply queue now size by their own width (container queries), not the window's. A 1024px window with the rail open gives a page about 764px, and several pages had assumed more.
  - At that width: amounts collided on Instalments, names were cut to two letters, the ledger squeezed names to 2px, statistics wrapped a name one word per line, and the leave table ran past its sheet. All are fixed.
  - The screenshot check now also flags content cut off by a box that hides overflow, not only content spilling past the page.

### Rail critic round 2 (2026-11-27)
- **Fit by measurement.** The open rail measures its own overflow (`data-tight` in `RailNav`) instead of using a fixed window height. On a 900px laptop the current place's four pages had pushed Admin & Settings out of view.
- **One-page places.** A place whose list would be its one page carries the pill itself, so no repeated name is listed. Long page names end in an ellipsis inside their highlight.
- **Thresholds.** They are set by each component's own width:
  - figure strips step down below 940px;
  - the payments ledger stacks below 960px;
  - the week board narrows its teacher column (150px) and days (62px minimum) below 780px.
  The folded rail at 1024 (about 890px of page) and the open rail at 1024 (about 690px) both hold.
- **Latin names in the reply queue.** They take their own direction (`dir="auto"`, aligned with the column), so an overlong name is cut at its end.
- **Kept as they are:**
  - The 1280px content cap. A folded rail at 1440 centres the content, so the side margin reads 50px instead of 36px. The content flows; it does not jump.
  - "Dashboard" under Dashboard. That place has two pages, Dashboard and Tasks.

## Lead decisions while integrating
- Shared fixes the builders reported went into `system.css` (outline tags without dashes, table row headers, neutral dots visible on white, stacked-sheet spacing, Arabic count size, switch buttons, one-letter Arabic avatars, a neutral note under an urgent figure); the teachers stylesheet's global `.sheet + .sheet` rule moved into the system.
- "Teacher profiles" in Arabic reads "مؤهلات المعلمين" (credentials review): it shared its name with Teacher files.
- Builders' tests changed only in wording (middle dots to commas, renamed actions, figures that became tabs), never in what they assert about data or permissions; each change is listed in the PR body.
