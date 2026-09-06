# Design Token Reconciliation — Admin Web ↔ Mobile

**Owner:** AI #6 · **Status:** reconciliation request to AI #4 · **No code was changed by this note.**

---

## 1. Position

**The Mobile tokens are the current design reference.**

`lib/design/tokens.dart` implements `design-system.md` §2–§5 verbatim — the full neutral and
primary ramps, the semantic names, the 4px grid, the radii — and it improves on the spec in one
way worth keeping: it **deliberately omits the attention, workload and case-status token
families** from the mobile theme, so "no attention model on a parent or teacher surface" is
structural rather than a convention someone has to remember. There is no token to reach for.

`apps/admin-web/src/core/theme/tokens.css` was written **before** this design pack existed and
converged independently on the same *ideas* — only NOW is loud, internal content owns violet,
logical properties throughout, non-colour meaning exposed to assistive tech via `.sr-only`,
a separate Arabic font stack with increased leading. That is a good file. It diverges on
**values and names**, not on intent.

**Nothing here asks for a rewrite.** These are values and identifiers, and the whole point of a
token layer is that changing them touches one file.

## 2. Target token contract

Both platforms materialise `design-system.md` §2–§5 **once**, under the same semantic names
modulo casing, so a token can be grepped across both repositories:

| | Mobile | Admin Web |
|---|---|---|
| File | `lib/design/tokens.dart` (`ThemeExtension`) | `apps/admin-web/src/core/theme/tokens.css` |
| Naming | `colorAttentionNowFg`, `spacing5`, `radiusLg` | `--color-attention-now-fg`, `--space-5`, `--radius-lg` |
| Rule | no `Color(0x…)` outside that file | no hex outside that file |

## 3. Divergences — what Admin Web must align

Ordered by cost of leaving them. **R-1 and R-2 are the ones that matter.**

| # | Area | Admin Web today | Target | Why |
|---|---|---|---|---|
| **R-1** | **Brand accent** | `--accent: #1f6feb` (blue) | `#0F7A72` (teal) — `brand.primary`, `design-system.md` §2.1 | **The two apps are currently different brands.** Staff and parents see different products. Teal is also deliberately not WhatsApp green, for a product that replaces WhatsApp. This is the one divergence a user could notice. |
| **R-2** | **Minimum font size** | `--fs-xs: 11px` | **12px floor**, `design-system.md` §3.2 — nothing smaller exists, including in the densest table | 11px in a dense operational table at 200% scaling is where clipping and misreads start. The floor is an accessibility commitment, not a taste. |
| **R-3** | **Token names** | `--now`, `--today`, `--waiting`, `--quiet`, `--internal`, `--ok` | `--color-attention-now-fg`, `--color-attention-today-fg`, … `--color-message-internal-*`, `--color-status-success-*` | Cross-platform greppability (`cross-platform.md` §5). Mechanical rename; no visual change. |
| **R-4** | **Spacing scale** | `--space-1: 4px` … `--space-6: 32px` (6 steps, offset by one) | `--space-0: 0` … `--space-11: 64px` (`design-system.md` §4), where **`--space-2` is 4px** | Same 4px grid, different indices. `--space-4` currently means 16px on web and 12px on mobile — a silent mismatch every time a value is copied between the two. |
| **R-5** | **Type stack** | `'Segoe UI'` + `'Noto Naskh Arabic'` — two unrelated families across scripts | One family covering both scripts (`design-system.md` §3.1, `decisions.md` DD-07) | Mixed Arabic/English strings are the normal case here, and two families show mismatched weight and baseline in every one of them. **Partly mitigated already** — the `html[lang='ar']` line-height bump is the right instinct. Lowest urgency of the five; costs a font decision, not a refactor. |
| **R-6** | **Radii** | `4 / 8 / 12` | `6 / 10 / 14` (`design-system.md` §4) | Cosmetic consistency only. |
| **R-7** | **Panel widths** | `--rail-w: 200px`, `--panel-w: 340px` | `240px` / `400px` at ≥ 1280 (`design-system.md` §9.1) | Family 360 at 340px pushes the responsibility block and the students section into a scroll it was specified to avoid. |

## 4. One divergence where the design pack should probably yield

**Dark mode on Admin Web.** `decisions.md` **DD-13** says admin is light-only; `tokens.css`
implements a full dark palette under `prefers-color-scheme`, and does it correctly — tokens
redefined, `color-scheme` set, no colour defined only inside the dark block.

DD-13's rationale was QA surface cost, not a product requirement. The work is already done and
it is good. **Recommendation: accept it and amend DD-13**, rather than remove working code to
match a document. That is AI #4's and AI #5's call, not this pack's — flagged, not decided.

## 5. What this note does not ask for

No component rewrite, no layout change, no restructuring of `tokens.css`, and no change to the
dark-mode implementation. R-1 through R-7 are values and identifiers in a single file.

The sequencing is AI #4's. If only two are done, do **R-1** and **R-2**.
