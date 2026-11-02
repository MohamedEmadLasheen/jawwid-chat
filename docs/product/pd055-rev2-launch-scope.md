# PD-55 revision 2 · The whiteboard's Phase 1 launch scope

**A record, not a proposal.** The owner reviewed the whiteboard on an iPhone
(2026-11-02) and asked for a much bigger writing area, a child-friendly look,
proper sounds, emojis and stickers, handwriting turned into neat text, and
parent review. The owner then set **Phase 1 = the whole system app, fully
tested, published to the App Store and Google Play**. Learning materials are
Phase 2 and frozen. The owner delegated every Phase 1 decision to the
department head, who set the whiteboard's launch scope the same day. This file
records that scope.

Plan it revises: [pd055-whiteboard-teaching-and-rewards-plan.md](pd055-whiteboard-teaching-and-rewards-plan.md).
Merged so far: PR-1 #384 (inline text), PR-2 #385 (pen and lasso), PR-3 #387
(laser and backgrounds). Open: PR-4 #392 (rewards), PR-5 #393 (star tally).
The plan's PR-6 ("polish") is **replaced** by the PRs below.

## Why the writing area comes first

The board's 16:9 page fits under the editor's chrome (app bar 56 pt, tool panel
56 pt, page bar 96 pt). What that leaves to write on today:

| Device, orientation | Page today | Share of screen | Full-screen, floating toolbar |
|---|---|---|---|
| iPhone 17, portrait | 386 × 217 pt | ~24% | a tall page, ~394 × 700 pt (3.3×) |
| iPhone 17, landscape | 391 × 220 pt | ~25% | ~664 × 373 pt (2.9×) |
| iPad, portrait | 726 × 408 pt | ~31% | about 2× |
| iPad, landscape | 1065 × 599 pt | ~66% | ~1156 × 650 pt (~78%) |

A child writes large. On a phone in portrait, a quarter of the screen is not
enough, and that is the first thing the owner saw.

## Phase 1: build now, in this order

| # | What | Scope (kept small on purpose) | Effort |
|---|---|---|---|
| 0 | **#392 review fixes, then #393 strict scope** | Owner-only rewards table; idempotent give and undo under a race; 404 after a teacher transfer; 409 for a reused `clientEventId`; no celebration over the app lock; staff read a lesson's rewards strictly, whatever `TEACHER_SUPERVISOR_STRICT_SCOPE` says. | done (heads in the PRs) |
| 1 | **A bigger writing area** | A full-screen board mode: the chrome hides and the tools become a floating toolbar that collapses to one button. Larger pages with pan and two-finger zoom (the page keeps its stored coordinates; only the view changes). Landscape on phone and iPad. Undo, autosave and the three no-text-lost guarantees from #384 keep holding in and out of full screen. | ~3–4 days, 1 PR |
| 2 | **A child-friendly refresh of the existing tools** | Big rounded buttons (at least 48 pt), a friendly colour palette from the design tokens, rounded icons, light micro-animations (off with "reduce motion"). The tool set stays the same; no new tools. | ~2–3 days, 1 PR |
| 3 | **Rewards finished and ON in systest** | #392 and #393 merge with `rewards.enabled` **off**. After review, the department head turns it on **in systest only**. The generated three-sine chime is replaced by a small CC0 set: applause, celebration, encouragement. Each file's source and licence is recorded in the repo next to it. Silent mode (the platform's ringer switch) and the parent's mute in Settings both keep working. | ~1–2 days, 1 PR |
| 4 | **An emoji picker and a small sticker set** | Teachers place emoji on the board. Stickers are drawn from icons: no faces of people, and generic encouragement only (stars, medals, rockets, thumbs-up and so on). Nothing religious, and no text that needs review. On the web the emoji font is bundled (Noto Emoji, OFL) so every device draws the same glyph. | ~2 days, 1 PR |

Each is its own PR, built and reviewed one at a time. Rewards stay off in
production until the department head turns them on.

## After launch (Phase 1.1)

| What | Why it waits | Effort (rough) |
|---|---|---|
| **Handwriting to neat text** | The riskiest item. On a phone it would use ML Kit Digital Ink (Arabic supported, offline, ~20 MB per language downloaded on first use). The Flutter plugin is MIT-licensed but iOS and Android only; the teacher web portal has no equivalent. Arabic accuracy for children's handwriting is unmeasured. A real design keeps the ink (undo, convert back) and never auto-converts Quranic text. It needs a field test before it is promised. | ~2 weeks, after a spike |
| **A full academy sticker pack** | Commissioned art. Anything with religious content needs the qualified review the owner reserves. | design-led |
| **Parent review surfaces beyond PD-54** | PD-54 (#361, approved) already gives the family the student's own boards and history. Anything more (a parent "review this lesson's board" flow, comments) builds on PD-54 once it lands. | after PD-54 |

## Rules carried over

- **Rewards:** off by default; teacher-only; one star per reward; undo within 2
  minutes; no comparisons between children. They merge only with the switch
  off.
- **Quran:** never auto-converted, re-rendered or re-typeset by any whiteboard
  feature.
- **Sounds and art:** only material that is licence-clean (CC0, OFL, or our own
  commission), with the licence in the repo.
- **Migration slots:** a PR that needs one asks the department head first. The
  next free slot at the time of writing is `20261102190000`.
