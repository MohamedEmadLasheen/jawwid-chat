# Teacher + parent UX fixes: evidence (2026-10-24/26)

Local QA stack, synthetic data, iPhone 17 Pro simulator, light theme. The "before"
of each item is the owner's own screenshots from the system-test server (2026-10-24).

| # | Owner problem | After |
|---|---|---|
| 1 | "+" listed "I can't teach" for every lesson, no report | 05 (teacher "+": one report, the most recent unreported, + "Other unreported lessons (1)"), 06-09 (Schedule: owed lessons on top, filter, a tap opens the lesson's action), 16-17 (parent "+": the next lesson's apology, the rest under "Other lessons") |
| 2 | Status pills unreadable | 01 before / 02 after (theme gallery, light and dark), 08 (Schedule pills) |
| 3 | Two profile screens, photo not shown | 10, 12 (teacher: one row, one "My profile"), 18, 19 (parent), 15 (parent sees the teacher's photo), 20, 21 (teacher sees the parent's and the child's) |
| 4 | Language / Appearance as long radio lists | 10, 11, 18 |
| 5 | Tapping a group opened Group Info | 03 -> 04 (avatar tap opens the chat), 13 (header opens Group Info) |

The photos are synthetic test patterns: checkerboard = teacher, blue stripes = parent,
red/yellow stripes = child.
