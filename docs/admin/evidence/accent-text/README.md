# Text never in --accent: before and after

The follow-up to `../cases-tabs/`. These are the six non-tab rules that drew text
in `--accent`: the staff name link (`.sp-row__link`), avatar initials (`.sp-avatar`),
the Staff accounts name (`.sa-name`), the active Schedule filter (`.sc-filter--on`),
and the selected story type and story button (`.type-card.is-selected`,
`.cta-choice.is-selected`). Each is rendered with Admin Web's real stylesheets
(`tokens`, `app`, `design-system`, `portal`, `profile`, `staff-accounts`,
`schedule`, `stories`): "before" from `origin/main`, "after" from this branch.
Light and dark come from the browser's `prefers-color-scheme`; Arabic sets
`lang="ar" dir="rtl"`. Synthetic data only.

In light, `--accent` and `--text-link` are both `--brand-700`, so light is
unchanged on purpose. The fix shows in dark: `#1b7f93` (3.7:1 on a surface,
2.9:1 on `--accent-soft`) becomes `#6cc3d3` (8.4:1 and 6.8:1).

| | English | Arabic |
|---|---|---|
| Dark, before | `01-before-dark-en.jpg` | `03-before-dark-ar.jpg` |
| Dark, after | `02-after-dark-en.jpg` | `04-after-dark-ar.jpg` |
| Light, before | `05-before-light-en.jpg` | `07-before-light-ar.jpg` |
| Light, after | `06-after-light-en.jpg` | `08-after-light-ar.jpg` |

## The two icons

The no-access icon (`.state--forbidden … .state__icon`, on `ForbiddenPage`) and
the Stories upload icon (`.dropzone__icon`, shown with the dropzone hovered)
drew `--accent` on `--accent-soft`: 2.95:1 in dark, under the 3:1 an icon
needs. They now use `--text-link` (6.8:1). Light is unchanged.

| | |
|---|---|
| Dark, before (EN) | `09-icons-before-dark-en.jpg` |
| Dark, after (EN) | `10-icons-after-dark-en.jpg` |
| Dark, after (AR) | `11-icons-after-dark-ar.jpg` |
| Light, after (EN) | `12-icons-after-light-en.jpg` |
