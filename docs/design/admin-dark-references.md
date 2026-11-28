# Dark theme: reference study (2026-11-28)

What makes the best dark SaaS admin screens feel premium. These are principles, not values: no product's palette is copied.

## What the references do
- **Linear** rebuilt its themes on LCH, so that steps of lightness look even across hues. Light and dark come from three inputs: base, accent and contrast. Its elevation levels (background, panels, dialogs, modals) are generated from the base. Result: surfaces feel like one material at different heights, not a stack of unrelated greys. ([Linear: how we redesigned the Linear UI](https://linear.app/blog/how-we-redesigned-the-linear-ui))
- **Material Design**:
  - It shows depth in dark by making higher surfaces lighter, because shadows barely read on dark.
  - It recommends a dark grey base, not black.
  - Its text emphasis levels are about 87% (high), 60% (medium) and 38% (disabled).
  - It asks for desaturated, lighter tones of colour, because saturated colours "vibrate" on dark.
  ([Material: dark theme](https://m2.material.io/design/color/dark-theme))
- **Vercel Geist** separates the default, hover and active fills of a component, and the default, hover and active borders, into explicit steps. Its borders are low-alpha white, so they sit on any surface. ([Geist colours](https://vercel.com/geist/colors))
- **Stripe, Notion and Attio** have the same traits: a calm near-black tinted toward the brand, never pure black; one restrained accent; status colour mostly as tinted pills with soft text, rarely as solid fills; small text never dimmer than about 60% of white.

## What this means for Jawwid
1. **Base.** A deep base tinted from the brand teal, not black, so the dark theme is still Jawwid.
2. **Elevation.** Four levels you can tell apart: the page; the sidebar (recessed, a step darker); cards (a step lighter than the page, with a hairline border and a soft shadow); raised panels such as menus, search and dialogs (lighter again, with a stronger shadow).
3. **Borders and fills.** Low-alpha light borders, a few percent of white, so they hold on every level. Hover and selected fills are steps on the same scale.
4. **Text.** Three readable tiers (primary, secondary, tertiary), all above 4.5:1 on cards. Secondary text is a little larger in dark, because light text on dark reads thinner.
5. **Status colour.** Late, waiting, done and info are softened and desaturated, and shown mostly as tinted pills; solid fills only where a count must be seen. Gold stays the one warm accent for "here and now".
6. **One system.** Rows, hover and selected states, inputs, tabs, badges, charts, schedule cells, dialogs and menus all draw from these tokens. Nothing keeps a light-theme colour.

## Directions tried (shown on the live app, critiqued side by side with light)
| | Base and level steps | Verdict |
|---|---|---|
| Current (before) | page #0f191b, card #152225: about 1.1:1 apart, solid white-on-red counts | Flat; cards vanish; red glares. Rejected. |
| A, Lagoon | teal-tinted near-black page, cards one step up, recessed sidebar | Right family. Cards still close to the page; secondary text still dim. Refined. |
| B, Graphite | neutral grey, alpha-white borders | Clean but generic: loses Jawwid's teal, reads like any SaaS. Rejected. |
| C, Deep sea | saturated teal everywhere, teal sidebar | Most "brand", but heavy and tiring over a day; teal fights the teal accent. Rejected. |
| A2 | A with a bigger page–card step, softer status | Better depth; inset strips (table heads, day strips) blended with the cards. |
| **A3, chosen** | A2 with the inset level recessed below the card | Four clear levels; quiet, warm and readable; still Jawwid. |

**The chosen levels** (all teal-tinted):
- Sidebar (recessed): #0a1416
- Page: #0e1a1d
- Inset strip (table heads, day strips): #122226
- Card: #17282c
- Hover: #1f3439
- Raised (menus, search, dialogs, tooltips): #253e44

Borders are low-alpha light teal (6%, 9% and 18%). Cards get a soft shadow and a faint top light; raised panels get a deeper shadow.

**Text** (on the card):
- Primary #e6eeee, 13.9:1
- Secondary #c7d4d5, 10.6:1
- Tertiary #a6b7b9, 7.5:1

The two small sizes are half a step larger in dark (14 and 14.5px; Arabic 14.5 and 15px), because light text on dark reads thinner.

**Status colours** (softened, mostly as tinted pills):
- Late #e8968b
- Waiting #e5a56e
- Done #88c9a4
- Info, the teal #86c7cf

Gold #d8ab5e stays the one warm "now" accent. Counts inside the page are tinted pills. Only the alert badges on the rail and the bell stay solid, in a muted red (#a5504a) with white text (5.9:1).

## Critic round on the chosen direction, all fixed
- **Inset level.** It is clearly recessed (#0f1d20); table heads, day strips and dashboard section bands have hairline edges.
- **Schedule.**
  - Off-shift cells read recessed against working cells.
  - The month heat starts visible (#27444a) and steps to #2f7f8b, where white reads.
  - The schedule's small labels follow the dark size step (at least 13px).
- **Waiting.** It moved to orange (#ea9356) so it no longer reads as the gold "now".
- **Raised panels.** Dialog and menu inputs sit on the panel rather than looking like holes.
- **Large late figures.** They read warm red (#ef8b7b), not pink.
- **Logo plate.** It is toned to #ece6d8, so it no longer glares; the logo itself is unchanged.
- **Bugs fixed:**
  - A transparent toolbar no longer casts a card shadow (the dark band on Stories).
  - An open row menu now sits above the next row's controls. This was a bug in both themes.
- **Keeping the two dark forms in step.** Every dark rule exists twice: once for the device setting and once for the switch. `core/theme/darkTwins.test.ts` fails if they ever differ.
