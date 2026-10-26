# PD-29 seed: the academy's 83 existing lessons

`jawwid-lessons-manifest.csv` is the Materials library's first content: the 83
lessons of the academy's lessons site. Generated from the read-only
inventory of 2026-10-24 (the department head's notes, `materials-inventory-table.md`);
nothing was fetched from or built out of the lessons repository.

| Subject | Lessons | Path |
|---|---|---|
| Quran | 38 | `/lessons/quran/surah-N` (Al-Fatihah, and 78-114, Juz' Amma) |
| Arabic language | 10 | `/lessons/arabic/lesson-N` |
| Islamic studies | 35 | `/lessons/islamic/lesson-N` |

## BLOCKED on shared and deployed environments

**Do not import this manifest on staging, production or any shared
environment until the department head lifts the block.** The lessons site's
repository was found compromised (security review, 2026-10-24). Its live build
was verified clean, but the review's conditions apply first (B1: a pinned
snapshot origin, or at least a monitor on the live build). Local development
only until then.

## What a row is

- `path`: the lesson's path on the lessons site. **The site's base URL is not
  in the manifest.** It is configuration (`MATERIALS_SITE_BASE_URL`, joined to
  the path when an item is opened), so the library can move to a pinned,
  Chat-controlled snapshot origin by changing one variable, with no migration
  and no re-import.
- `ref` = the path, so importing the manifest again updates the same 83 items
  instead of adding new ones.
- `kind` `activity_link`. The lesson is framed from its own origin with sandbox
  `allow-scripts allow-same-origin allow-forms`; the site's origin is always on
  the frame allowlist. Admin Web's `frame-src` must list it too
  (`MATERIALS_FRAME_ORIGINS`).
- `age_groups` empty = suits every age. Nothing in the lessons states an age.
  Staff tag bands later, or the owner supplies a mapping (a re-import with the
  `age_groups` column filled updates the same rows).
- `surah` on each Quran lesson, so it appears with that surah in the teacher's
  picker.
- **Row order is the library's order** (PD-29 amendment 2026-10-26): an
  import stores each new item's row number as its `sort_order` (a
  `sort_order` column overrides it), and a re-import keeps it through `ref`.
  Quran is listed by surah regardless -- Al-Fatihah first, then 114 down to 78.
  Arabic and Islamic studies keep the order of this file.
- `status` `draft`. Nothing reaches families until a manager publishes it:
  per item on the Materials page, or by re-importing with `published`.

## How to import (local development only, until unblocked)

1. Set `MATERIALS_SITE_BASE_URL` on the API (and `MATERIALS_FRAME_ORIGINS` on
   Admin Web) to the lessons site's origin.
2. Admin Web -> Materials -> Import. Choose this CSV. No files are needed.
3. **Check**. Expect 83 new rows and no errors. Then **Import**.

It is an admin import step, not a migration seed, so staff can edit, retire
or re-tag any item afterwards, and the block above stays enforceable.
