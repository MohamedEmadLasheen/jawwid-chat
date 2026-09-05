# Jawwid Chat — Design System

**Owner:** AI #6 · **Status:** authoritative. Values in §2 are **proposed pending brand sign-off**;
token *names* are final.

Everything is a semantic token. No screen spec, no Flutter widget and no React component may
contain a raw hex value, a raw pixel spacing, or a raw font size. When the brand lands, §2
changes and nothing else does.

---

## 1. Principles

1. **Make the next correct action obvious.** Every screen answers one question for its role.
   If a screen answers two, it is two screens.
2. **Calm by default.** Loudness is a budget, not a style. At most **one** element per viewport
   may use `attention.now`. If everything is urgent, nothing is.
3. **Never colour alone.** Every state carries icon **and** text. Colour is the third signal.
4. **The system holds the memory, not the person.** Owner, history and context are always
   visible; who happens to be on duty is additive information.
5. **Small system, used everywhere.** 3 elevations, 5 radii, 11 spacings, 3 loudness tiers.
   A new component must justify why an existing one cannot be composed.
6. **Arabic is the design language, not a translation target.** Layouts are laid out in RTL
   first and verified in LTR, not the reverse.

---

## 2. Colour

Warm-neutral greys (not blue-grey) keep the product human rather than clinical. A deep teal
primary reads as education and trust in the MENA market and is deliberately **not** WhatsApp
green — this product replaces WhatsApp and must not cosplay as it.

### 2.1 Palette (raw ramps — referenced only by §2.2, never used directly)

```
neutral.0    #FFFFFF     primary.50   #E7F2F1     teal ramp
neutral.25   #FBFAF8     primary.100  #C3DFDC
neutral.50   #F5F3F0     primary.200  #97C6C1
neutral.100  #EBE8E3     primary.300  #66ABA4
neutral.200  #DCD7D0     primary.400  #2F8E85
neutral.300  #C2BBB2     primary.500  #0F7A72   ← brand
neutral.400  #9C948A     primary.600  #0B635C
neutral.500  #776E64     primary.700  #084B46
neutral.600  #5A534B     primary.800  #063733
neutral.700  #423C36
neutral.800  #2B2823     accent.100   #FBEEDC   warm sand — brand warmth only,
neutral.900  #1A1815     accent.500   #C57A1E   never a status colour
                         accent.700   #8A5310

red.100 #FBE9E7  red.500 #C4362C  red.600 #B3261E  red.700 #8C1D17
amber.100 #FCF1DC  amber.600 #9A6100  amber.700 #7A4D00
green.100 #E4F2EA  green.600 #1E7A46  green.700 #176037
blue.100 #E8F2F7  blue.600 #14607F  blue.700 #0F4A62
violet.100 #F2EEFA  violet.600 #6B4FA8  violet.700 #543C85
```

### 2.2 Semantic tokens

```
color.background.page          neutral.25    | dark: neutral.900
color.background.sunken        neutral.50    | dark: #121110
color.surface.default          neutral.0     | dark: neutral.800
color.surface.raised           neutral.0     | dark: neutral.700
color.surface.muted            neutral.50    | dark: #211F1C
color.surface.inverse          neutral.800   | dark: neutral.50

color.text.primary             neutral.900   | dark: #F5F3F0
color.text.secondary           neutral.600   | dark: neutral.300
color.text.muted               neutral.500   | dark: neutral.400
color.text.inverse             neutral.0     | dark: neutral.900
color.text.link                primary.600   | dark: primary.300

color.border.subtle            neutral.100   | dark: #33302B
color.border.default           neutral.200   | dark: #45413A
color.border.strong            neutral.300   | dark: neutral.600
color.border.focus             primary.500   | dark: primary.300

color.brand.primary            primary.500
color.brand.primary.hover      primary.600
color.brand.primary.pressed    primary.700
color.brand.onPrimary          neutral.0
color.brand.subtle             primary.50    | dark: #0B2E2B
color.accent                   accent.500

color.status.success.fg        green.600     color.status.success.bg   green.100
color.status.warning.fg        amber.600     color.status.warning.bg   amber.100
color.status.danger.fg         red.600       color.status.danger.bg    red.100
color.status.info.fg           blue.600      color.status.info.bg      blue.100
color.status.neutral.fg        neutral.600   color.status.neutral.bg   neutral.100
```

**Contrast:** every `*.fg` token above is ≥ 4.5:1 on its paired `*.bg` and on
`surface.default`. `brand.onPrimary` on `brand.primary` is 5.19:1. Verified as a QA gate, not
by eye.

### 2.3 Attention tokens — the four buckets

Attention is a **section**, never a badge on a row (brief §6: never a number, never a label).
These tokens colour section headings, the row's leading dot, and nothing else.

```
color.attention.now.fg         red.600      .bg  red.100      .dot  red.500
color.attention.today.fg       amber.600    .bg  amber.100    .dot  amber.600
color.attention.waiting.fg     blue.600     .bg  blue.100     .dot  blue.400 (#5B9BB8)
color.attention.quiet.fg       neutral.500  .bg  neutral.50   .dot  neutral.300
```

`now` is a deep brick red, not a fire-engine red — obvious without alarming (role brief §28).
`quiet` is genuinely quiet: a grey dot on a grey heading.

### 2.4 Workload tokens — three levels, no fourth

```
color.workload.low.fg      green.600    .bg green.100     Light
color.workload.medium.fg   amber.600    .bg amber.100     Steady
color.workload.high.fg     red.600      .bg red.100       Heavy
```

There is no `critical`. `LOW < 8 · MEDIUM < 15 · HIGH ≥ 15` and the boundaries come from
`config`, never from the client.

### 2.5 Case status tokens

```
color.case.open.fg              primary.600   .bg primary.50
color.case.waiting_customer.fg  blue.600      .bg blue.100
color.case.waiting_internal.fg  violet.600    .bg violet.100
color.case.scheduled.fg         neutral.600   .bg neutral.100
color.case.resolved.fg          green.600     .bg green.100
color.case.closed.fg            neutral.500   .bg neutral.50
```

### 2.6 Message and internal-note tokens

```
color.message.incoming.bg      neutral.0       (surface, 1px border.subtle)
color.message.incoming.text    text.primary
color.message.outgoing.bg      primary.50
color.message.outgoing.text    #06322E
color.message.internal.bg      violet.100
color.message.internal.border  violet.600      (3px leading edge)
color.message.internal.text    violet.700
color.message.system.bg        neutral.50
color.message.system.text      text.secondary
color.message.pending.bg       neutral.50      (approval pending — muted, never outgoing colour)
color.message.failed.border    red.600
```

The violet family exists **only** for internal content. Nothing else in the product is violet.
That exclusivity is the safety mechanism: an internal note cannot be confused with any other
surface because no other surface shares its hue (risk R3).

### 2.7 Dark mode

Admin Web: light only in MVP (staff work in daylight offices; dark mode doubles the contrast
QA surface for no operational gain). **Mobile: both**, because parents use it at night —
Flutter must honour the system setting. Every token above has a dark value; nothing is
defined only inside a dark block.

---

## 3. Typography

### 3.1 Family

```
font.family.base   "IBM Plex Sans Arabic", "IBM Plex Sans", -apple-system,
                   "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif
font.family.mono   "IBM Plex Mono", ui-monospace, Menlo, monospace
```

IBM Plex Sans Arabic is chosen because it is one open-licence family with genuinely matched
Arabic and Latin designs — mixed «الدرس يبدأ 3:00 PM» sits on one baseline with one colour of
ink. Two unrelated families for the two scripts is the most common Arabic-first mistake and it
is visible in every mixed string. Mono is used only for IDs in the audit log.

**Fallbacks are mandatory** — Arabic must render correctly before the web font loads.
Emoji fall through to the platform emoji font; never restyle them.

### 3.2 Scale

Sizes in px. Arabic needs more leading than Latin at the same size: the `lh.ar` column is the
line-height the app must use when the locale is Arabic.

| Token | Size | Weight | lh.latin | lh.ar | Use |
|---|---|---|---|---|---|
| `type.display` | 28 | 700 | 36 | 40 | Dashboard headline numbers, empty-state titles |
| `type.h1` | 22 | 700 | 30 | 34 | Screen titles |
| `type.h2` | 18 | 600 | 26 | 30 | Section headings, family name in header |
| `type.h3` | 16 | 600 | 24 | 28 | Card titles, inbox section headings |
| `type.bodyLg` | 17 | 400 | 26 | 30 | **Mobile message text** |
| `type.body` | 15 | 400 | 24 | 28 | Default body, admin message text |
| `type.bodySm` | 13 | 400 | 20 | 24 | **Admin dense rows**, table cells |
| `type.label` | 13 | 600 | 18 | 22 | Field labels, badge text |
| `type.caption` | 12 | 500 | 18 | 20 | Timestamps, metadata, `top_reason` secondary line |
| `type.button` | 15 | 600 | 20 | 24 | All buttons |
| `type.buttonSm` | 13 | 600 | 18 | 22 | Dense admin toolbars |

**12px is the floor.** Nothing smaller exists in the system, including in the densest admin
table. Text scaling up to **200%** must not clip: every text container grows, none is a fixed
height (role brief §56).

### 3.3 Hierarchy rules

- One `h1` per screen.
- A conversation-list row has exactly **one** primary-weight line (the family name) and at most
  **two** secondary lines. A third line means the row is doing too much (role brief §22).
- `top_reason` renders at `type.caption` in `text.secondary` — readable, not shouted. It is the
  most-read string in the product and it earns its place by being *always in the same position*,
  not by being loud.

---

## 4. Spacing, grid, radius, elevation

```
space.0   0     space.1   2     space.2   4     space.3   8
space.4  12     space.5  16     space.6  20     space.7  24
space.8  32     space.9  40     space.10 48     space.11 64
```

4px base grid; `space.1` (2px) exists only for optical badge padding.

```
radius.sm    6    inputs, chips, badges
radius.md   10    cards, buttons
radius.lg   14    message bubbles, sheets, dialogs
radius.xl   20    bottom-sheet top edge
radius.full 999   avatars, dots, pills
radius.bubbleTail 4   the one corner of a bubble nearest its author
```

```
elevation.0  none                                          flat surfaces, list rows
elevation.1  0 1px 2px rgba(26,24,21,.06), 0 1px 3px rgba(26,24,21,.08)   cards, raised rows
elevation.2  0 4px 12px rgba(26,24,21,.10)                 popovers, dropdowns, sheets
elevation.3  0 12px 32px rgba(26,24,21,.16)                dialogs only
```

Three levels. No blur, no glass, no gradient surfaces — all three are expensive on the low-end
Android devices that dominate the parent audience (risk R7).

**Admin grid:** 12 columns, `space.6` (20px) gutters, `space.7` (24px) page padding.
**Mobile grid:** 4 columns, `space.5` (16px) gutters and page padding.

---

## 5. Motion

```
motion.instant   0ms      state changes on list rows — never animate a list
motion.fast      120ms    hover, focus, press, checkbox
motion.base      200ms    sheets, dialogs, drawers, tab changes
motion.slow      280ms    page transitions (mobile only)
motion.easing.standard   cubic-bezier(.2,0,0,1)
motion.easing.exit       cubic-bezier(.4,0,1,1)
```

**Rules.** Inbox rows never animate into or out of a section — a realtime re-bucket is an
instant swap, because an admin scanning a list must not have to wait for it to settle
(role brief §48). No parallax, no hero transitions, no confetti. All motion respects
`prefers-reduced-motion` and collapses to `motion.instant`.

---

## 6. Iconography

Outline set, 1.5px stroke, 20px default (24px mobile touch targets, 16px in dense admin rows).
One icon per concept, product-wide — the mapping lives in `cross-platform.md` §2 and is the
single source both platforms implement.

**Mirroring rule for RTL** — the test is *"does this icon describe a direction in the reading
flow, or a direction in the physical world?"*

| Mirror in RTL | Do **not** mirror in RTL |
|---|---|
| Back / forward chevrons | Play, pause, skip, seek (media transport is physical) |
| Reply arrow | Clock, calendar, timer |
| Send arrow *(points toward the reading edge)* | Checkmarks, delivery ticks |
| List indent / hierarchy | Microphone, camera, paperclip, phone handset |
| Trend arrows tied to a timeline axis | Trend arrows meaning up/down (magnitude) |
| Progress bars, sliders, steppers | Avatars, logos, flags |
| Drawer / panel open-close chevrons | Numerals inside icons |

Ambiguous cases resolve to **do not mirror** — an unmirrored icon looks slightly odd; a
wrongly-mirrored play button looks broken.

---

## 7. Components

Every component lists the states it must implement. A state marked — does not apply.
`focus-visible` is mandatory on every interactive component: 2px `border.focus` ring, 2px
offset, never removed.

### 7.1 Buttons

Variants: `primary` (filled brand) · `secondary` (surface + border.default) ·
`ghost` (text only) · `danger` (filled red.600) · `link`.
Sizes: `sm` 32px · `md` 40px · `lg` 48px. Mobile primary actions are `lg`.
States: default · hover · pressed · focus-visible · disabled · loading (spinner replaces the
label, width is preserved so the layout does not jump).

Rules: exactly **one** `primary` per view. `danger` is reserved for irreversible actions and
always sits inside a confirmation, never on a list row.
Minimum touch target **44×44** on mobile even when the visual button is smaller.

### 7.2 Inputs, forms

Text field, textarea, select, combobox, date-time picker, checkbox, radio, switch, search.
Height `md` 40px / `lg` 48px, `radius.sm`, 1px `border.default`, focus → 2px `border.focus`.
States: default · hover · focus · filled · disabled · readonly · **error** · loading.

Rules: labels are always **visible and above** the field — placeholder-as-label fails in Arabic
and fails for screen readers. Errors appear below the field, in `status.danger.fg`, prefixed
with an alert icon, and describe the fix ("Choose a date in the future"), not the violation
("Invalid"). Required fields are marked on the *optional* ones instead where a form is
mostly-required.

### 7.3 Cards, lists, tables

`Card` — `surface.default`, `radius.md`, `elevation.1`, `space.5` padding.
`ListRow` — 1px bottom `border.subtle`, no elevation, hover `surface.muted`,
selected `brand.subtle` + 3px leading `brand.primary` edge.
`Table` — sticky header, `type.bodySm`, 40px rows, right-aligned numerals in **both** locales
(numbers are LTR runs even inside RTL text), zebra off, column dividers off.

Wide tables scroll inside their own container. The page body never scrolls horizontally.

### 7.4 Badges and chips

`Badge` — 20px, `radius.full`, `type.label`, icon + text. Never text-free, never colour-only.
Variants map 1:1 to §2.5/§2.4 tokens.

- `StatusBadge` — case status. Icon + label.
- `WorkloadBadge` — Light / Steady / Heavy. Manager surfaces only.
- `ModeBadge` — Covering / Assist / Escalated / Keeping this. Never rendered for `owner` mode.
- `UnreadBadge` — count pill, `brand.primary`, caps at `99+`.
- `AttentionDot` — 8px `radius.full`. **The only attention affordance on a row.** It is paired
  with the section it sits in and with `top_reason`; alone it means nothing and that is fine.

`Chip` — filter chips, 32px, selectable, dismissible. Selected = `brand.subtle` + brand border.

### 7.5 Navigation

`AppShell` — mobile: bottom tab bar (3–5 items, 56px + safe area, icon + label always, never
icon-only). Admin: 64px left rail with labels, collapses to icon-only < 1280px.
`TopBar` — mobile 56px: leading back/menu, centred title, trailing max **2** actions.
`Tabs` — underline indicator, `type.label`, scrollable when overflowing.
`Breadcrumb` — admin only, chevrons mirror in RTL.

### 7.6 Overlays

`Dialog` — centred, max 480px, `radius.lg`, `elevation.3`, scrim `rgba(26,24,21,.48)`.
Focus is trapped; Esc closes unless the dialog is a destructive confirmation with typed input.
`BottomSheet` — mobile, `radius.xl` top, drag handle, snap points, backdrop dismiss.
`Popover` / `Menu` — `elevation.2`, arrow-key navigable, Esc closes, returns focus to trigger.
`Toast` — bottom-centre mobile / bottom-start admin, 4s, one at a time, queued not stacked,
`radius.md`, includes an Undo action where an undo genuinely exists.
`Banner` — full-width, in-flow (never floating), dismissible only when non-critical.
Used for: offline, realtime disconnected, end-of-shift, unattended count.

### 7.7 Conversation components

`ConversationHeader` — family name (`type.h2`), then a **two-line responsibility block**:
line 1 `Owner · {name}`, line 2 `On duty · {name}` **only when it differs from the owner**.
This is the component that carries risk R2; the owner line is never replaced, only joined.

`MessageBubble` — max width 78% (mobile) / 620px (admin). `radius.lg` with `radius.bubbleTail`
on the corner nearest the author. States: sending · sent · delivered · read · failed ·
queued (offline) · pending approval · rejected · deleted.
Composition: optional reply-quote → body → attachment → footer (time · mode badge · state icon).
Long text wraps; a single unbroken 200-character token wraps mid-word rather than widening the bubble.
**Mixed-script bodies use `unicode-bidi: plaintext`** so an Arabic message containing an English
phone-shaped string or URL does not scramble.

`InternalNote` — **not a bubble.** Full-width `message.internal.bg` block, 3px leading violet
edge, an explicit "Internal note · {author}" label row, `radius.md`. Cannot be reached by any
customer-facing render path.

`SystemCard` — full-width, centred, `message.system.bg`, `type.caption`, an icon, no avatar and
no author. Used for: payment failed, class started, handover, task completed, owner changed.

`MessageComposer` — see §7.9.
`AttachmentPreview` — thumbnail 56px + filename + size + progress; failed uploads keep the row
with a Retry action, never disappear.
`VoiceMessage` — play/pause, waveform (server-provided peaks), duration, 1×/1.5×/2× speed.
The **waveform does not mirror in RTL** — it is a timeline of physical sound; only the position
of the play button flips.
`TypingIndicator` — three dots, `text.muted`, at the bottom of the list, never in the header.
`UnreadDivider` — a full-width rule labelled "Unread" that persists until the user leaves.

### 7.8 Operational components

`ConversationListItem` — the most important component in the product. Spec in
`screens/admin-inbox.md` §4.
`FamilyHeader` · `FamilyPanel` — spec in `screens/family-360.md`.
`Timeline` / `TimelineEvent` — a discriminated union open to `message · call · task ·
follow_up · ownership · coverage · handoff · approval · payment · renewal · schedule ·
system · note`. Customer-facing events sit on the left rail with a filled marker; internal
events sit on the same rail with a **hollow** marker and violet text (risk R3).
`TaskCard` · `FollowUpCard` — title, family, due date (overdue in `status.danger.fg` **with**
an icon and the word "Overdue"), assignee, status, one primary action.
`HandoffCard` — the shift-end artefact: last 3 messages, open cases, owner note, subscription,
next class, and a single "Acknowledge" action.
`ApprovalCard` *(conditional, OQ-1)* — sender, student, family, full message body, time pending,
Approve / Reject.
`CallButton` · `CallControls` *(conditional, OQ-4)*.
`SearchInput` · `FilterBar` — see `screens/admin-inbox.md` §6.
`ConfirmDialog` — title as a question, body naming the consequence, a **reason field where the
backend requires one**, cancel + destructive action.

### 7.9 Composer

Default state shows exactly three affordances: **attach**, the text field, and **send**.
Everything else lives behind one `+` (mobile) or a single overflow menu (admin):
internal note, new case, follow-up, task, escalate, keep this, leave for owner, reply as assist,
canned replies, call.

Two send variants exist as split-button options on admin only: **Reply + snooze** and
**Reply + resolve** (brief §8).

An action the user may not perform is **disabled with an honest reason on hover/long-press**
("The on-duty admin has this open"), never hidden — a hidden action is indistinguishable from
a bug. Actions the user's *role* can never perform are hidden entirely.
**Backend dependency:** the reason string comes from `capabilities.*_blocked_reason`.

The composer is anchored to the keyboard on mobile and never jumps: the message list resizes,
the composer does not translate (role brief §45).

### 7.10 Feedback and state components

`LoadingSkeleton` — shape-matched to the content it replaces, `surface.muted`, a 1.2s shimmer
that respects `prefers-reduced-motion`. Used for: inbox list, family panel, message list,
dashboard cards, task list. **A spinner is only acceptable inside a button.**
`EmptyState` — icon (48px, `text.muted`), title (`type.h3`), one sentence, and an action
*only if there is genuinely something to do*. Calm, never illustrated with a mascot.
`ErrorState` — what happened, then what to do, then a Retry. Never a code, never a stack.
`OfflineBanner` · `ReconnectingBanner` — in-flow, `status.warning`, auto-dismiss on recovery.

---

## 8. States every component must define

| State | Applies to |
|---|---|
| default · hover · pressed · focus-visible · disabled | all interactive |
| loading | anything that fetches or submits |
| error | inputs, lists, screens |
| empty | lists, panels, screens |
| selected · unread | rows, tabs, list items |
| offline / queued / failed | message, composer, attachment |
| pending approval | message *(conditional, OQ-1)* |

---

## 9. Responsive

### 9.1 Admin (desktop-first)

| Width | Layout |
|---|---|
| **≥ 1920** | Three panes; content max-width 1800px, centred. Family panel 420px. |
| **1440–1919** | Three panes. Rail 240px · list 380px · workspace flex · family panel 400px. |
| **1280–1439** | Three panes. Rail collapses to 64px icons+tooltips. Family panel 360px. |
| **1024–1279** | **Two panes.** Family panel becomes a right drawer, toggled from the header; its state persists per user. |
| **< 1024** | **One pane**, list ↔ workspace push navigation. Rail becomes a drawer. Admin is not designed for phones, but it must not be broken on a tablet in a car park. |

The three-pane desktop layout is never forced below 1024px (role brief §59).

### 9.2 Mobile

Design target 360×640 (the low-end Android floor), verified at 320px and at 200% text scale.
Safe areas honoured top and bottom; the composer sits above the gesture bar. Primary actions
live in the bottom half of the screen. Nothing important is reachable only by a hover.

---

## 10. Accessibility

- **Contrast** — 4.5:1 body, 3:1 large text and UI boundaries. Verified by gate, not by eye.
- **Never colour alone** — every status is icon + text + colour (role brief §56).
- **Touch targets** — 44×44 minimum on mobile, 32×32 minimum in dense admin rows with 8px
  of spacing between adjacent targets.
- **Keyboard** — the entire admin app is operable without a mouse. Documented shortcuts:
  `j`/`k` move between inbox rows, `Enter` opens, `r` focuses the composer, `n` internal note,
  `/` search, `Esc` closes. Focus order follows the visual order in both directions.
- **Screen readers** — every icon-only control has a label. Live regions: new message
  (polite), realtime disconnection (assertive). The unread divider is announced.
- **Text scaling** — 200% without clipping or horizontal scroll.
- **Motion** — `prefers-reduced-motion` collapses all motion to instant.
- **RTL** — see `cross-platform.md` §4. Logical properties (`start`/`end`) only; the tokens
  `padding-left` and `margin-right` do not appear in either codebase.

---

## 11. What this system deliberately does not have

Dark mode on admin · illustrations and mascots · gradients · glassmorphism · custom scrollbars ·
animated list reordering · a fourth workload level · a numeric attention display · a colour-only
status anywhere · icon-only bottom navigation · placeholder-as-label · more than one primary
button per view.

Each absence is a decision, and each is recorded in `decisions.md`.
