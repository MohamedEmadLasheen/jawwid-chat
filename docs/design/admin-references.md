# Admin redesign: reference study

**Date:** 2026-11-27 · **Scope:** principles for the Arabic-first operations admin (inbox, payments and
instalments, requests, teacher schedule, teacher statistics). **Status:** research input, not a decision.
Decisions it leads to go in `docs/design/admin-decisions.md`.

## Method and limits

- Public material only. I did not log in to any product. For each one I read help-centre articles,
  design write-ups and changelogs, then downloaded the screenshots those pages publish and looked at them
  directly. "Saw" below means a published screenshot. "Read" means text only.
- I estimated sizes and weights from screenshots; they are not measured CSS. I sampled hex values from
  screenshot pixels only where I say so.
- Unreachable sources: Foodics and Deputy help centres (Cloudflare challenge), Qoyod knowledge base
  (403 to scripts; text read through a fetcher, no screenshots), Moyasar help (DNS blocked from this
  machine), Rewaa help (empty responses). Foodics, Moyasar and Rewaa are not covered. Qoyod and
  Deputy appear only as text notes.
- This document collects principles. It does not copy layouts, and no pixels were reused.

---

## 0. Jawwid's own brand (the "spirit of the sales page")

There are two public faces. They differ, and the sales page is the one to follow.

### 0.1 The sales landing page: join.jawwid.com (live; source in `~/dev/jawwid-sales-landing`)

Read: live `https://join.jawwid.com/styles.css`. Saw: a headless-Chrome render of the live page at
1440 px.

| Token (live CSS) | Hex | Role on the page |
|---|---|---|
| `--morning` | `#FFFBF3` | page ground (warm near-white) |
| hero gradient | `#FBEBCB` → `#FDF3E1` → `#FFFBF3` | warm honey glow at the top of the page only |
| `--wash` | `#FCEFD6` | warm wash |
| `--mist` / `--teal-tint` | `#E6F1F2` / `#E3EFF1` | cool teal-tinted section band (alternates with the warm ground) |
| `--ink` | `#12333B` | headlines and body text (a teal-black, not pure black) |
| `--ink-soft` | `#4A6169` | secondary text |
| `--teal` | `#1A5866` | brand teal: Quran programme card, icon discs, focus ring |
| `--gold` | `#DEA854` | primary CTA pill fill, short section rule above headings, step numbers |
| `--gold-ink` | `#8A5A12` | gold used as text (contrast-safe) |
| `--honey` / `--hl` | `#F1C76F` / `#F2C879` | highlight |
| `--pom` | `#A8442F` | pomegranate: Islamic Studies programme colour |
| `--gold-tint` / `--pom-tint` | `#FBEFD7` / `#F9E5DE` | tints |
| `--line` | `rgba(18,51,59,.13)` | hairline |
| `--shadow` | `rgba(26,88,102,.30)` | teal-tinted shadow, used long and soft: `0 34px 60px -34px` |

- **Type:** Readex Pro (variable 300–700) for headings, used at **600**. IBM Plex Sans Arabic 400/600 for
  body text, at **17 px with 1.8 line height** (the adult page uses 18/1.9). The h1 is
  `clamp(38px, 3.2vw, 52px)` with line height 1.55. Both fonts are OFL and self-hosted.
- **Shape:** pill buttons (`999px`), cards at 12–14 px radius, and one "notebook" card shape
  (`8px 8px 32px 32px`). Soft teal-tinted drop shadows instead of borders.
- **Feel:** warm, generous and reassuring. Headlines are big, dark teal-ink and semibold. Gold is a
  warm action colour. Each of the three programmes owns a colour block (teal, gold, pomegranate). A
  faint dot-grid "whiteboard" texture (`radial-gradient` dots every 22 px) appears inside product
  mock-ups. Step numbers "01 02 03" are set in gold Latin digits.
- **Brand marks:** the logo is a Latin "JAWWID" lockup with an open-book mark. The landing team sampled
  the logo pixels as teal ≈ `#185A66` and gold ≈ `#DEA854`. No vector logo and no Arabic lockup exist.
  The Arabic name «أكاديمية جَوِّد» is set as plain text beside the logo.
- The README of `jawwid-sales-landing` still describes the palette as "porcelain / deep forest / jade /
  sage / copper". That is stale. The live tokens are the ones above.

### 0.2 The legacy site: jawwid.com (WordPress + Elementor)

Read: page HTML and the Litespeed CSS bundle.

- Global colours: `#1C5766` (teal) and `#DFAB58` (gold). These are the same pair as the sales page.
  Pricing uses `#FFD67C` and `#89AA25`. Fonts are Poppins and Montserrat (Latin only). The page is
  English, and its tone is template-like.
- **Security note for the owner (not design):** the About and Service Areas sections of jawwid.com
  contain links to unrelated casino pages (for example `/21-bit-casino-canada-review-…`,
  `/casinos-zonder-account/`). This looks like injected SEO spam on the WordPress site and should be
  checked by whoever owns that site.

### 0.3 What this means for the admin

- The brand pair is teal **`#1A5866` / `#123F4A`** with gold **`#DEA854`** (ink gold `#8A5A12`) on a
  warm near-white. The admin's current `primary.500 #0F7A72` (in `docs/design/design-system.md`) is a
  greener, lighter teal than the brand. It should move toward `#1A5866`.
- The sales page warmth comes from big semibold headings, warm ground, generous line height and
  soft tinted shadows. Serif display, terracotta and hairline rules play no part in it.
- **Pomegranate `#A8442F` is a programme colour on the sales page. It must not become an admin accent.**
  It is close to the terracotta the owner rejected, and close to the admin's "urgent" red, which would
  make red ambiguous.

---

## 1. Intercom: Help Desk inbox (required)

**Studied:** the inbox, its SLA states and its navigation.
Read and saw:
- https://www.intercom.com/help/en/articles/6258745-the-inbox-explained (screenshots dated 2024-11)
- https://www.intercom.com/help/en/articles/6546152-hit-your-response-time-targets-with-sla-rules
  (screenshots dated 2024-11 and 2026-06)

Read:
- https://www.intercom.com/blog/redesigning-product-navigation/
- https://www.intercom.com/blog/designing-for-clarity-restructuring-intercoms-information-architecture

**What I saw**
- **Layout:** three panes. An icon-only primary rail, a labelled inbox column, and the conversation.
- **Inbox column:** headed "Inbox", with a "Create new" button and search. Items: "Your inbox 2,
  Mentions 0, Created by you 0, All 356, Unassigned 113, Dashboard". Below them are collapsible groups
  ("Team inboxes", "Teammates", "Views", "Fin AI Agent") and "Manage" at the foot. Counts are plain grey
  numerals, right-aligned, not pills. The selected item has a soft grey fill.
- **Conversation list:** the header reads "353 Open ▾" and "Newest ▾". The sort menu is worded by need:
  "Oldest, Newest, Started first, Started last, **Waiting longest**, **Next SLA target**, Priority
  first".
- **Rows:** an initial avatar, name in semibold, a one-line grey preview, and relative age ("4d", "2mo").
  Priority is a small yellow star.
- **Depth:** the list sits on a light grey canvas, and **the selected row is a white card with a soft
  shadow, lifted off it**. The conversation pane is white.
- **Header actions:** square icon buttons with grey fills. The one primary action (close) is solid black.
- **SLA colours:** grey for "more than 5 minutes left", orange for "less than 5 minutes left", red for
  "Overdue". The badge shows a paused state while snoozed or waiting on the customer, and a conversation
  that breaches while snoozed is automatically unsnoozed.
- **Reports:** a KPI trio ("Hit rate 42.4%", "33", "Misses 19") with large regular-weight numbers and a
  small green or red delta line under each. The empty state is an outline icon with "No data to display"
  and "Filter by an SLA to see data", so it says what to do next.
- **Navigation write-ups:** the principles are "Obvious over pretty or clever" and "Pass the squint
  test", and the active item uses a filled icon. The 2025 restructure added "a label overview" because
  **cryptic icons caused hover delays**. Features were grouped "by how users think and work rather than
  how they were built".

**Borrow in principle**
- **Sorts named by need:** "Waiting longest" and "Next SLA target" are the sorts this inbox needs
  (time since the parent last wrote, time to the reply target).
- **Time-to-breach as the urgency signal:** grey, then amber in the final window, then red when overdue,
  plus an explicit paused state.
- **Counts next to labelled views:** plain numerals with no coloured bubbles.
- **Depth by surface:** a grey canvas, a white working surface, and a lifted selected row. Depth comes
  from surfaces, not lines.
- **Empty states that give the next step**, not a decorative illustration.

**Do not take**
- **The icon-only primary rail.** Intercom itself had to add labels. The owner wants labelled navigation.
- **AI surfaces threaded through every pane** (Fin): not this product.
- **The near-monochrome grey with black primary buttons and pastel random avatar colours.** It is
  neutral to the point of anonymity and would read generic.
- **The ~13–14 px Latin UI type** (estimated). It is too small for eight hours of Arabic reading.

---

## 2. Attio: record page and table (required)

**Studied:** the record page and the object table.
Read and saw:
- https://attio.com/help/reference/managing-your-data/records/create-and-view-records
- https://attio.com/help/reference/managing-your-data/records/configure-record-pages

**What I saw**
- **Record page, left column (about one third):** the name and logo, one primary button ("Add to
  list"), then a row of icon buttons. A collapsible "Company details" section lists attributes as rows:
  a muted label with a small icon on the start side and a near-black value on the end side.
- **Empty values and chips:** empty values are written as words ("No values", "No contact").
  Multi-select values are tinted chips with a "+3" overflow.
- **"Lists" section:** small bordered cards with a stage shown as a coloured dot and its name
  ("● Lead – Triage Bot", "● No Stage").
- **Record page, right side:** tabs with counts ("Overview, Activity, Emails 12, Notes 4, Tasks 6,
  Files, Calls 6").
- **"Highlights":** up to **six** tiles. Each has a small grey label with an icon at the top and a larger
  value below. One tile reads "Next due task: Proposal Review… **Tomorrow**", with only the word
  "Tomorrow" in orange.
- **Activity, Emails and Notes:** compact rows inside one bordered container. Names are semibold,
  previews grey, and relative times sit at the end ("6 hours ago", "Yesterday").
- **Record summaries:** an AI summary at the top, on by default for Deals.
- **Table, toolbar:** a "Sort" control and an "Advanced filter **10**" chip that shows the count of
  active filters.
- **Table, status cells:** status is a **small coloured dot plus a word** ("● Very weak" red, "● Good"
  blue, "● No communication" grey). Colour lives only in the dot.
- **Table, selection and footer:** selected rows get a pale blue tint. A **floating bulk-action bar**
  ("2 selected · Add to List · Send email · Run workflow · More ▾ · ×") appears at the bottom. Column
  footers carry "262 count" and "Add calculation".
- **Depth:** 1 px light borders and very light grey containers. Shadows appear only on floating
  things (the bulk bar, menus).
- **Type:** an Inter-like sans. An unofficial summary says Inter at 14/1.5; Attio does not publish this.

**Borrow in principle**
- **Record anatomy:** facts on one side, history as tabs with counts on the other. This fits a parent or
  student record (details | conversation, payments, lessons, requests, notes).
- **A fixed, small set of "highlights" per record type** that answers "what matters now" (next
  instalment due, last contact, current teacher, open request), with at most six.
- **Urgency on the word, not the block:** only "Tomorrow" or "Overdue" carries colour.
- **Status as dot plus word in tables.** Empty values written as words, never a dash.
- **The floating bulk-action bar** and **column-footer totals** (the sum of a column of instalments).

**Do not take**
- **User-configurable widgets, tabs and sections.** Academy staff need one opinionated layout, not a
  CRM toolkit.
- **Rainbow multi-colour tag chips:** they add colour noise.
- **Emoji list icons and logo-heavy rows.**
- **13–14 px type and CRM jargon.**

---

## 3. Linear: inbox, triage, Insights and the redesign write-ups (required)

**Studied:** the inbox, triage and Insights screens, plus the design write-ups.
Read:
- https://linear.app/now/how-we-redesigned-the-linear-ui (2024)
- https://linear.app/now/behind-the-latest-design-refresh (2026-03-12)
- https://linear.app/changelog/2024-12-18-personalized-sidebar

Read and saw:
- https://linear.app/docs/inbox
- https://linear.app/docs/triage
- https://linear.app/docs/insights

**What I saw and read**
- **Inbox:** a segmented "Priority 4 / Other 12" control. Each row has an avatar with a small badge for
  the event type, a title, and **a second line that says why the item is there**: "Didier assigned the
  issue to you", "Project update is overdue", "Lena mentioned you in a comment".
- **Unread and read rows:** unread is a small blue dot before the title. Read rows are dimmed. A status
  icon and the age ("1h", "13h") sit at the end of the row.
- **Triage:** a title, then a source line ("Intercom", "Sentry", a person) and "6m ago" at the end.
- **Insights, panel:** the total "1,665 issues" sits at the top, with selects for Measure, Dimension and
  Segment.
- **Insights, chart:** a **bar chart sorted descending, with people's avatars as the x-axis labels**.
- **Insights, table:** the table below the chart uses status icons in its column headers. Hovering a row
  highlights its bar, and selecting a cell filters the issue view.
- **2024 write-up:** themes are generated in LCH from **three inputs: base colour, accent colour,
  contrast**, down from 98 variables. They "limited how much of the accent feeds into" calculations.
  Text was made darker in light mode for contrast. Headings use Inter Display and body text uses Inter.
- **2026 write-up:** elements "that support orientation and navigation should recede". The sidebar is
  "a few notches dimmer" so content "takes precedence". The palette moved from "a cool, blue-ish hue"
  to "a warmer gray", with the warning "Go too warm, though, and the interface risks looking muddy".
  Borders had "quietly proliferated", so separators were reduced and softened. Icon use was reduced and
  coloured team-icon backgrounds were removed.
- **Sidebar setting:** the user chooses whether unread shows as a count or a dot.

**Borrow in principle**
- **Three theme inputs (base, accent, contrast), with contrast as a real setting.** This suits staff on
  eight-hour shifts and older eyes.
- **Navigation recedes and content leads.** The rail is quieter than the working surface.
- **A warm grey neutral, tuned until it stops short of muddy.** This is the right cue for "cream"
  without paper texture.
- **Inbox rows that state the reason in words** ("payment link opened, not paid", "parent replied 2h
  ago").
- **Priority versus other as a two-way split** before any filters.
- **Insights pattern:** one total, a chosen measure, bars sorted descending, and a table underneath that
  is linked to the chart by hover.
- **Fewer borders.** Keep the dividers that remain soft.

**Do not take**
- **The dark-first, purple-accented look.**
- **Dense 13 px type and keyboard-only discoverability.**
- **Stacked bars carrying six or seven status colours** (Insights segments by status). That is far more
  colour than this admin should allow.
- **Issue-ID culture** ("ENG-619") in visible UI.

---

## 4. Notion Calendar: week grid and time zones (required)

**Studied:** the week grid and time-zone columns.
Read and saw:
- https://www.notion.com/product/calendar
- https://www.notion.com/help/time-zones

Read:
- https://www.notion.com/help/notion-calendar-settings

**What I saw**
- **Mini-month sidebar:** today is a small red filled square.
- **Header and toolbar:** the header reads "January 2024", with the month bold and the year light. The
  toolbar has "Week ▾", "Today" and arrows.
- **Day headers:** "Mon 15 … Fri 19". **Today, "Wed 17", has a red pill on the number**, and a red line
  marks the current time.
- **Time zones:** **several labelled time-zone columns** (GMT, EST, PST) sit on the start side, with the
  primary zone darker. They can be dragged to reorder, and `Z` switches zone temporarily.
- **Events:** a **pale tint of the calendar colour plus a solid 3 px start-edge bar**. The title is in
  the strong colour and the time on a lighter second line.
- **Event states without new colours:**
  - Unanswered or tentative: a **dashed outline** with a white fill.
  - Declined: **struck through**.
  - Busy or out of office: **diagonal hatching**.
  - All-day items sit in a strip above the grid.
- **Right panel:** "No upcoming meeting" (empty state as a plain sentence), "Scheduling snippet · Share
  availability **S**" and "Quick meeting · Meet with… **F**", with the shortcut letters shown in place.
- **Settings:** change the number of days shown (±), "Zoom Hours In/Out" to change grid density, show
  or hide weekends and declined events, and set the start day of the week.

**Borrow in principle**
- **Express event state through fill, outline, strike and hatch**, not extra hues:
  - Scheduled lesson: solid tint plus edge bar.
  - Pending or trial: dashed outline.
  - Cancelled: struck through.
  - Teacher unavailable or on leave: hatched.
- **Today and now are the only red (in our case: gold) marks** on the grid.
- **Two labelled time scales:** academy time (Cairo) and the family's time. This matters for UK, US
  and Gulf families.
- **A days-shown control and hour zoom** instead of fixed density.
- **Shortcut letters shown in context.**

**Do not take**
- **One colour per calendar.** In the admin, colour should mean state, not which teacher.
- **About 11 px event text inside week cells** (estimated). Arabic needs more.
- **The hand-drawn illustration style.**

---

## 5. Salla: Salla 4.0 merchant dashboard (required; Arabic)

**Studied:** navigation and the orders list.
Read and saw:
- https://help.salla.sa/en/article/salla-4-0-new-platform/sv8h94gami0nwmahx50iawf7 and its Arabic twin
- https://help.salla.sa/article/ix4gbqo2r370slys3y5qqexs/ix4gbqo2r370slys3y5qqexs (orders)

**What I saw**
- **Top bar:** deep teal, pixel-sampled **`#0A3C48`**. Every top-level item is **icon plus Arabic word**:
  الكل، الرئيسية، الطلبات، المنتجات، التسويق، المتجر وقنوات البيع، التقارير.
- **Active item:** a **mint pill (`#73FCD8`, sampled) with dark text**.
- **«الكل» ("All")** opens an index of every page in the product. Columns are grouped under bold
  section headings with icons (الطلبات، المنتجات، التسويق، المتجر الإلكتروني، قنوات البيع، العملاء،
  الموظفون، التقارير). Small promotional tags appear in it ("الأكثر زيارة", "تجريبي", "كاشير مجاني").
- **Second level:** a white bar of text tabs, a "مساعدة" (help) button, and a breadcrumb
  («المنتجات › الاستيراد والتصدير»).
- **Orders management, three columns in RTL:**
  - **Start (right) side: a status rail that is also the filter.** «كل الطلبات 49», then each status
    with a coloured dot, its name and a count (بانتظار الدفع 0، بانتظار المراجعة 23، قيد التنفيذ 2، …).
    «تخصيص الحالات» sits at the bottom.
  - **Middle: the list, grouped under date headers** («الإثنين 20 أبريل 2026»). Each item has a
    checkbox, «رقم – حالة ●», the customer name in bold, the amount in bold with the Riyal symbol, and an
    age («منذ 15 أيام»). Selected items get a mint tint (`#F0FFFB`) with a mint edge.
  - **A pale amber strip** (`#FFF6EB`): «حدّث 15 من العناصر · تحديث الكل».
  - **End (left) side: bulk actions in grouped sections** (حالة الطلب as chips, الشحن، فاتورة الطلب،
    المدفوعات، تصدير، أخرى). The primary action is «تنفيذ الإجراءات» (mint fill); the destructive one is
    «حذف الطلبات» (red outline).
- **Ground and depth:** a light grey ground (`#F7F7F7`) with white panels at roughly 12–16 px radius.
  Depth comes from surfaces; there are almost no shadows.
- **Numerals and dates:** Western digits everywhere, and Arabic month names.
- **Names:** Latin-script names ("Lamis Alsaedi", "wejdan saad") appear as typed, in the same weight as
  Arabic names in the same list.
- **Help text:** ten base statuses that can be renamed, given colours and icons, and extended with
  sub-statuses. A status history log. Internal comments with @mention.

**Borrow in principle**
- **Labelled top-level navigation: icon plus Arabic word, always visible.**
- **An "All pages" index.** One place where every screen is listed and named, for discoverability
  without a crowded rail.
- **The status rail with counts is the filter.** This fits requests and payments.
- **Date-group headers inside long lists.**
- **Bulk actions grouped by purpose**, with one primary action and the destructive one set apart.
- **Proof that deep teal chrome over a light working ground reads as premium Arabic SaaS.** Salla's
  `#0A3C48` sits close to Jawwid's `#123F4A`, so the admin can own this register in its own teal and gold.

**Do not take**
- **The electric mint accent (`#73FCD8`).** It is not calm, and our accent is gold.
- **A horizontal top bar with seven items and a mega-menu.** A side rail is calmer and scales better
  for 8–10 staff sections.
- **Promotional badges inside navigation.**
- **List items packing five facts at small size.**
- **Statuses customised into a rainbow.** Salla lets merchants colour each status.

---

## 6. Zid: merchant dashboard (Arabic)

**Studied:** the order details page (2026) and the analytics page (2024).
Read and saw:
- https://help.zid.sa/ar/orders/order-details (2026 screenshots)
- https://intercom.help/zid/ar/articles/7883051-تحليلات-زد (analytics, 2024)
- https://intercom.help/zid/ar/articles/7883073-تذاكر-الدعم

**What I saw**
- **Sidebar:** on the right (the RTL start side), white, **icon plus label** for every item: لوحة
  التحكم، الطلبات (expanded to كل الطلبات، الطلبات اليدوية، السلات المتروكة…)، المنتجات، العملاء…
  Fifteen items in total. The active item has a grey fill. Purple dots mark new items, plus
  "جديد 🔥" pills.
- **Order detail, header:**
  - The title «تفاصيل الطلب #68143473» is about 24 px bold.
  - **Status pills sit right beside the title:** «جاهز» (purple tint) and «مدفوع» (green tint).
  - A subtitle gives the date and «من سارة العتيبي».
  - **Previous and next arrows step through records.** "More options" is a single menu, and «تعديل
    الطلب» is shown disabled rather than hidden.
- **State callout:** a full-width pale callout with an info icon reads «أرسل رابط الدفع – بانتظار
  السداد» and «أرسل رابط دفع مخصص للعميل لهذا الطلب، ولم يكتمل الدفع بعد.» It has **one button, «عرض
  التفاصيل».** That is one sentence of state and one action.
- **Two separate statuses:** a side card holds two labelled selects, **«حالة الطلب» and «حالة الدفع»**
  (order status and payment status). Key–value rows have light dividers. Dates are written
  «2026-04-15 02:00 م».
- **Timeline («تحركات الطلب»):** the comment box comes first, then date headers («15 يونيو 2026»).
  Entries read «صُدّر الطلب بواسطة: فيصل» with **absolute and relative time together** («15 يونيو 2026 -
  08:15 م | منذ 3 أشهر»). A «جديد» pill marks unseen entries.
- **Analytics (2024):**
  - KPI cards put the unit as a word after the number («233 زيارة»، «20 طلب»، «4,731.61 ر.س»).
  - **A freshness stamp** reads «آخر تحديث في أربعاء، مايو 8، 2024 10:00 ص».
  - Charts are purple, with the time axis running left to right.
  - **Slips:** the 2024 chart uses English axis labels ("May 02"), and a 2026 summary shows the percent
    as «%0.2», a bidi slip.

**Borrow in principle**
- **Order status and payment status as two named fields.** For Jawwid: lesson or request status
  alongside payment status.
- **One state callout with one action** at the top of a record (for example "payment link sent, not
  paid").
- **Status pills beside the record title.**
- **Previous and next to walk a queue.**
- **Absolute plus relative time.**
- **A freshness stamp on every statistics page.**
- **Units as Arabic words after numbers.**
- **A "new" marker on unseen timeline entries.**

**Do not take**
- **The purple brand.**
- **Emoji and "new" upsell pills in navigation.**
- **A 15-item rail mixing operations with growth upsells.**
- **English axis labels inside Arabic charts.**
- **Unisolated percentages that reorder** («%0.2»).

---

## 7. Tabby: instalments (Arabic)

**Studied:** the instalment and amount screens, and the merchant dashboard (text only).
Saw:
- product images on https://tabby.ai/ar-SA: the Arabic checkout sheet and the Tabby Cash screen

Read:
- https://tabby.ai/ar-SA/help-business/using-tabby/using-md (merchant dashboard)
- https://docs.tabby.ai/pay-in-4-custom-integration/payment-statuses

**What I saw and read**
- **Checkout sheet, top:** «اختر كيف تدفع», then the total **"1,600.00" as the largest element**, in
  heavy Latin digits.
- **Choice of instalment count:** «عدد الدفعات» with options 3, 4, 6, 8, 12. The selected option is a
  black filled pill.
- **Per-instalment line:** **"400.00 /شهر"** in bold, then the reassurance line «بدون رسوم. بدون
  فوائد.» in grey. All of it sits on one white card over a light grey ground.
- **Tabby Cash:** a label («المتوفر») above a very large amount. The new dirham symbol is set to the
  visual left of the digits, and percentages are written «%20».
- **Merchant dashboard sections (text):** الطلبات، التحليلات، الخلافات، العوائد، الكتالوج، المتاجر.
- **Statuses:** the dashboard shows NEW, CAPTURED, CANCELLED, REFUNDED and PARTIALLY REFUNDED.
  **Rejected and expired payments are not shown on the dashboard.** Merchants are alerted to new
  disputes. I could not see dashboard screenshots.

**Borrow in principle**
- **Instalment reading order: total, then number of instalments, then amount per period, then next due
  date and a reassurance line.** The amount is the largest type in its card, with a small label above it.
- **Heavy Western digits inside Arabic UI.**
- **Show only the states staff can act on.** Fold dead states (expired, rejected) into history, not
  the working list.

**Do not take**
- **Neon green, mascots and consumer-scale type everywhere.**
- **English upper-case status codes** in an Arabic merchant UI.

---

## 8. Schedule reference: Google Calendar side-by-side Day view, with a Deputy note

**Studied:** Google Calendar's side-by-side Day view (text only).
Read:
- https://support.google.com/calendar/answer/37189
- https://workspace.google.com/blog/product-announcements/time-refresh-introducing-new-look-and-features-google-calendar-web
- https://www.usecarly.com/blog/google-calendar-side-by-side-view/ (third party)

I did not see a screenshot. Notion Calendar (section 4) is the visual schedule reference.

**What I read**
- **Views:** Day, Week, Month, Year, Schedule and 4 days. "After you choose a new view, it becomes your
  default view until you change it."
- **Side by side:** calendars of other people, rooms or groups appear in **separate columns, in Day view
  only**: "The side-by-side calendars won't work for the week or month view". The blog frames this for
  assistants who schedule for several people. The third-party write-up adds that your own calendars
  share one column, told apart only by colour.
- **Deputy (text only; the help centre is Cloudflare-blocked):**
  - Views are switched "by Area or by Team members".
  - Schedule status markers include empty shifts, unpublished, published, requires confirmation, open
    shifts, warnings, leave and availability.

**Borrow in principle**
- **People as columns (or rows) only in the one-day view.** The week view shows one teacher at a time.
  A multi-teacher week becomes a matrix nobody can read.
- **The chosen view persists.**
- **A Schedule (agenda) view for scanning a day as a list.**
- **Deputy's status vocabulary** suggests the schedule needs these states: open slot, scheduled,
  awaiting confirmation, warning, and on leave or unavailable. Express them through the
  fill/outline/strike/hatch grammar from Notion Calendar.

**Do not take**
- **Google's 11-colour event palette and Material defaults.**

---

## 9. Analytics and leaderboard reference: Vercel Web Analytics, with a Stripe note

**Studied:** the KPI strip and ranked panels.
Read and saw:
- https://vercel.com/docs/analytics
- https://vercel.com/docs/analytics/using-web-analytics

**What I saw**
- **Header:** "Web Analytics", with the site name and **"● 457 online"** as a live freshness indicator.
  Filters at the end read "Production ▾" and "Last 7 Days ▾".
- **KPI strip as tabs:** each tab has a small grey label, a large number of about 36 px in semibold, and
  a delta chip. **The selected tab is underlined and drives the chart below.**
- **Delta colour means good or bad, not up or down.** "+12%" visitors is green; "+1%" bounce rate is red.
- **Chart:** a single blue area. **The incomplete last period is dashed.**
- **Panels are leaderboards:**
  - Tabs switch the dimension (Pages/Routes/Hostnames) and a small header names the measure.
  - **Each row has a neutral grey bar behind its label, with length proportional to the value.**
  - The value is bold and aligned to the end.
  - Six rows show, the seventh fades, and "View All ↗" plus a "…" menu follow.
  - The bars carry no colour.

**Read (Stripe badge vocabulary):**
https://docs.stripe.com/stripe-apps/components/badge.md?app-sdk-version=9 defines six badge types:
- **Neutral:** "no action required, everything is working as expected".
- **Info:** "an important attribute or a key state".
- **Positive:** a good outcome, "no action required".
- **Negative:** a bad outcome, "no action required".
- **Warning:** "Needs immediate action, optional to resolve".
- **Urgent:** "Needs immediate action, strong requirement to resolve".

**Read (Qoyod's overdue definition):**
https://www.qoyod.com/en/releases/overdue-status-filter-documents-index/ and the knowledge base define
"Overdue" as a subset of "pending": the due date has passed by at least one day, and the invoice is
approved or partially paid.

**Borrow in principle**
- **A ranking is a list with an in-row proportional bar.** The value is aligned to the end, the bar is
  neutral, and the list shows the top N with "view all". It is not a podium and not a chart of avatars.
- **KPI tabs that switch the chart.**
- **Delta colour encodes good or bad.**
- **A dashed line for an incomplete period.**
- **A live or freshness indicator.**
- **Stripe's split** between "bad outcome, nothing to do" (negative), "act, optional" (warning) and
  "act, required" (urgent). This separates *failed* from *overdue* from *due soon*.
- **Qoyod's rule:** overdue is a derived view of an unpaid instalment one day past its due date. It is
  not a separate stored status.

**Do not take**
- **All-caps column labels ("VISITORS").** The owner rejected all-caps eyebrows, and Arabic has no case.
- **"207K" abbreviations.** Academy numbers are small; write them in full.
- **Default blue.**
- **Gamified leaderboards (Duolingo-style promotion and demotion zones).** Ranking teachers publicly
  for an audience is a product and HR decision, not a design default.

---

## Synthesis (one page)

### Principles for the Jawwid admin

1. **Brand sits in the chrome and one accent, not on every surface.**
   - The navigation rail and top band are deep teal (`#123F4A` / `#1A5866`). Salla shows this works in
     Arabic SaaS.
   - The page ground is a warm near-white (`#FBF7EE`–`#FFFBF3`) with no texture and no hairline rules.
   - Work happens on white surfaces. The selected row is lifted with a soft teal-tinted shadow
     (Intercom; the sales page shadow).
   - Gold (`#DEA854`, text `#8A5A12`) marks "here and now" only: the active navigation item, today, and
     the current-time line. It is never a status colour (Notion Calendar's single red mark).
2. **Colour means state, and only three states get colour.**
   - **Act now** (urgent red): overdue, breached reply time.
   - **Act soon or waiting** (amber): due within the window, link sent and unpaid.
   - **Done** (green).
   - Everything else is neutral or teal for information. Follow Stripe's split: a *failed* payment
     (negative, nothing to do) looks different from *overdue* (urgent).
   - No colour per teacher, programme or tag (Attio's rainbow chips and Notion's per-calendar colours
     stay out). Pomegranate is not used in the admin.
3. **Status is a small, solid tag with a word.**
   - In lists: a dot plus a word (Attio, Salla).
   - On a record: a tinted pill beside the title (Zid).
   - Never colour alone; urgency colours the word ("Overdue"), not the block (Attio's "Tomorrow").
   - Empty values are words («لا يوجد»), not dashes.
4. **Separate the dimensions of state.**
   - A request or lesson has its own status and its payment has its own (Zid's two fields).
   - An instalment reads in this order: total, then count, then amount per instalment, then next due
     date (Tabby).
   - "Overdue" is derived: unpaid and at least one day past due (Qoyod). Dead states (expired,
     cancelled links) leave the working list (Tabby).
5. **Every queue row says why it is there, in words.** The second line is a sentence: «ولي الأمر ردّ
   منذ ساعتين»، «أُرسل رابط الدفع ولم يُدفع» (Linear inbox). Sorts are named by need: «الأطول انتظاراً»،
   «الأقرب استحقاقاً» (Intercom).
6. **Time to breach is the urgency signal.** It runs grey, then amber in the last window, then red when
   overdue, with an explicit "paused" state (Intercom SLA). Times show absolute and relative together:
   «15 يونيو 2026 · 08:15 م (منذ 3 ساعات)» (Zid).
7. **Navigation is labelled, grouped by how staff think, and it recedes.**
   - A side rail with an icon and an Arabic word on every item, always visible. Intercom had to retrofit
     labels.
   - Counts are plain numerals at the end of the item (Intercom).
   - The rail is a few notches quieter than the content (Linear).
   - One «كل الصفحات» index lists every screen (Salla).
   - No upsell badges in navigation (Zid, Salla).
8. **Depth comes from surfaces, not lines.**
   - A canvas, a white working surface, a lifted selection.
   - Few dividers, and soft ones (Linear removed proliferating borders).
   - Shadows only on things that float: the bulk-action bar, menus, a sheet (Attio).
   - Cards differ by role (KPI tile, list panel, state callout, highlights tile) instead of one
     identical card repeated.
9. **Record pages have one fixed anatomy.**
   - Facts on one side; activity tabs with counts on the other (Attio).
   - At most six "highlights" chosen per record type: next instalment, last contact, teacher, open
     request (Attio).
   - One state callout with one action at the top (Zid).
   - Previous and next arrows walk the queue (Zid).
   - Staff cannot rearrange the layout.
10. **The schedule shows people side by side only in Day view.**
    - Week and month views show one teacher (Google Calendar).
    - Lesson state uses shape, not hue: scheduled is tint plus edge bar; trial or awaiting confirmation
      is dashed; cancelled is struck through; leave or unavailable is hatched (Notion Calendar, Deputy).
    - Two labelled time scales: academy time and the family's time (Notion Calendar).
    - The chosen view is remembered.
11. **Statistics lead with one number and one chart.**
    - A KPI strip whose selected tab drives the chart; a delta coloured by good or bad; a dashed line for
      the incomplete period; a freshness stamp (Vercel, Zid).
    - Rankings are lists with neutral in-row bars and the value at the end: top N, then «عرض الكل»
      (Vercel).
    - One chosen measure is sorted descending, with the table below linked to the chart by hover (Linear
      Insights).
12. **Type: one Arabic-first sans family, set large, with two weights.**
    - Use the sales-page pair: Readex Pro 600 for headings and big numbers, IBM Plex Sans Arabic 400/600
      for text. Both are OFL and already self-hosted on the sales page.
    - Body 16 px with line height about 1.6 in the UI (the sales page uses 17/1.8). Lists no smaller than
      15 px.
    - Hierarchy comes from size and weight only. No serif display, no all-caps, no middle-dot meta
      strings; meta is a labelled pair or a sentence.
    - Theme generated from base, accent and contrast, with a contrast setting (Linear).

### How the Arabic products handle RTL type, numerals and mixed names

- **Size (estimated from screenshots):** dense list text in Salla and Zid is about 14 px with titles at
  22–24 px bold. That is workable for a merchant but tight for an eight-hour Arabic workday. Jawwid's own
  sales page sets Arabic body at 17–18 px with line height 1.8–1.9. Arabic needs roughly one step more
  size than Latin for the same legibility, so the admin should sit between the two: 16 px body, 15 px
  minimum.
- **Numerals:** Salla, Zid and Tabby all use **Western digits (0–9)** for counts, amounts, order numbers
  and dates, with **Arabic month names** («20 أبريل 2026»). Zid's record fields use a numeric form
  («2026-04-15 02:00 م»).
  - Amounts are the heaviest element in a card (Tabby). Use tabular figures in columns.
  - Currency symbols (Riyal, dirham) sit beside the digits. Percentages read «%20».
  - Zid's «%0.2» shows what happens without isolation. **Wrap every number, amount, phone and ID in
    a bidi isolate** (`<bdi>` or `unicode-bidi: isolate`, with `dir="ltr"` for phones and IDs). Put
    units as words after numbers («3 حصص»).
- **Mixed Arabic and Latin names:** Salla shows Latin-script customer names exactly as typed («Lamis
  Alsaedi», «wejdan saad»), in the same weight and alignment as Arabic names («طارق الزهراني»), with no
  transliteration. Zid's «Copy of جبة» shows how unisolated mixed text reorders.
  - Render user-entered names and message previews with `dir="auto"` / `unicode-bidi: plaintext`.
  - Use one family that covers both scripts (IBM Plex Sans Arabic does), so a Latin name does not switch
    typeface mid-row.
- **Direction:**
  - Navigation and the status or filter rail sit on the right (the RTL start side); bulk actions and
    secondary panels sit on the left (Salla, Zid).
  - **Chart time axes still run left to right** in both Zid screenshots.
  - Chart labels must be Arabic (Zid's English axis labels are a slip).

### How the best schedule and leaderboard references make the few important things lead

- **Notion Calendar:** everything is a pale tint except two marks, the red "today" and the red
  current-time line. State is carried by outline, strike and hatch, so colour stays scarce. Time-zone
  columns are labelled and the primary zone is darker. Density is a user control (days shown, hour zoom),
  not a fixed squeeze.
- **Google Calendar:** comparing people is a separate, deliberate mode, available only in Day view, so
  the week view stays readable.
- **Vercel Web Analytics:** one big number per KPI, and only the selected one drives the chart. Deltas
  are the only colour, and they mean good or bad. Rankings are grey proportional bars with the value at
  the end, cut at the top six with a fade and "View All". The incomplete period is dashed so nobody
  misreads a partial day as a drop.
- **Linear Insights:** one total at the top of the panel, one chosen measure, bars sorted descending,
  and a table that answers "who and how many" under the chart, linked to it by hover.
- **For Jawwid's teacher statistics:** a strip of three or four KPIs (lessons delivered, attendance,
  cancellations, response time). The selected KPI drives one chart. Below it is a ranked list per
  measure with neutral bars, and gold marks only the period selector or "today". Whether teachers are
  ranked publicly against each other is a product and HR decision to confirm, not a design default.
