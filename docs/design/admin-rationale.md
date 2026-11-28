# Admin web: design rationale

**The idea: a quiet desk for a working day.** Staff spend eight hours here answering families, collecting money and keeping two hundred weekly lessons on time. The interface recedes and the work leads: one deep-teal action per screen, a warm white surface for the work, and colour kept for the few things that need a person now. The brand is present the way it is on the academy's own sales page (join.jawwid.com): its teal, its gold, its mist and its two typefaces, never as decoration.

**Why it suits an Arabic academy admin.** Arabic is the first language of the people who use it and of most families they talk to, so type is set one step larger than a Latin product would, both scripts sit in families designed for them, numbers never reorder inside sentences, and everything mirrors with the page. The academy's day is made of lessons in time, so time is the visual backbone: the schedule, the day view on Today, and the "now" line share one language.

## Type
- **Readex Pro** (600/700) for page titles, section titles, navigation and large figures: a modern Arabic sans with a matching Latin, designed for legibility, the sales page's heading face.
- **IBM Plex Sans Arabic** (400/500/600) for reading text, tables, messages and forms: the sales page's body face and the mobile app's face, so a family's message reads the same here as on their phone.
- Scale (Arabic; English one step smaller): 34 page title, 22 section, 18 lead, 16 body, 15 dense lists, 14 metadata, 13 axis labels only. Weights: 400 and 600 for text, 700 for titles and figures. Tabular figures in every column of numbers. No all-caps, no serif, no middle-dot meta strings.

## Colour and depth
- Ground `#FBF8F1` (warm near-white, the sales page's ground made slightly quieter). Work surfaces white `#FFFFFF`. The sidebar is the brand **mist** `#E9F1F1`: clearly not the canvas, not the logo teal.
- Ink `#12333B` for text. Primary action **deep teal** `#1A5866` (hover `#123F4A`): one per screen.
- **Gold** `#DEA854` means *here and now* only: the current-time line, today, the active navigation marker. Never a button, never a status.
- Three status colours and no others: **urgent** red `#B42318` (overdue, unanswered too long, conflict, absent), **waiting** amber `#9A5B00` on `#FDF1DC` (due soon, sent and unpaid), **done** green `#1E6F46`. Information is teal or neutral. Pomegranate and terracotta are not used.
- Depth comes from surfaces, not lines: canvas, white surface, a lifted selection. Borders are few and soft (`#E7E2D6`); shadows only on what floats (menus, the command palette, sheets).

## Spacing, shape, icons
- 4px base: 4, 8, 12, 16, 24, 32, 48. Dense lists use 12px row padding; page sections 32px apart.
- Radius by role: 6 controls and tags, 10 surfaces, 14 floating sheets. Not one radius on everything.
- **Lucide** icons, stroke 1.6, 18px in content and 20px in navigation; each navigation item has its own icon. On desktop the sidebar is a collapsible rail, folded to icons by default with each name in a tooltip, and opened to icon and label by a toggle at its foot (the owner's instruction of 2026-11-27, replacing the earlier "labelled navigation").

## RTL
- Arabic first: logical properties everywhere; the sidebar on the right; directional icons mirror; the schedule's time axis runs right to left with the page (and left to right in English); clock times, phones, amounts and ids are isolated (`<bdi>`/`dir="ltr"`); user-entered names take their own direction but align with their column. Western digits, Arabic month names.

## What makes it authored
- Every screen answers one question first (Who needs a reply? Who needs your intervention? What breaks today?) and orders its content by need, with the reason written as a sentence on each row.
- Colour is rationed to meaning, so a red value is always worth looking at.
- The time language (lanes, the gold now line, shapes for lesson states: tint and edge for scheduled, dashed for trial, hatched for leave, struck for cancelled) is specific to this academy's work and recurs across Today, the Schedule and the teacher pages.
- Rows end in one action; the rest is in "⋯". Empty states say what will appear and offer the one next step.
