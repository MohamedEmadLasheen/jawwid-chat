# Jawwid Chat — Cross-Platform Consistency Contract

**Owner:** AI #6 · **Audience:** AI #3 (Flutter) and AI #4 (Admin Web).

Two teams, two languages, two frameworks, one product. This file defines every concept that
appears on **both** platforms exactly once. If Flutter and React disagree about what a concept
looks like or is called, this file is the tiebreak.

---

## 1. Concept register

For each concept: the one word, the one icon, the one visual treatment, and where it appears.

| Concept | Word (en / ar) | Icon | Visual treatment | Parent | Teacher | Admin |
|---|---|---|---|---|---|---|
| Unread | Unread / غير مقروء | — | `UnreadBadge` count pill, `brand.primary`; row name goes weight 600 | ✓ | ✓ | ✓ |
| Attention NOW | Now / الآن | — | Section heading + `AttentionDot` red.500 | — | — | ✓ |
| Attention TODAY | Today / اليوم | — | Section heading + dot amber.600 | — | — | ✓ |
| Waiting on family | Waiting on family / بانتظار الأسرة | `clock-arrow` | Section heading + dot blue.400; collapsed | — | — | ✓ |
| Quiet | Quiet / هادئ | — | Section heading + dot neutral.300 | — | — | ✓ |
| `top_reason` | *(the sentence)* | — | `type.caption`, `text.secondary`, always the second line of the row | — | — | ✓ |
| Owner | Owner / المسؤول الأساسي | `shield-user` | Header line 1, always present, `type.label` + name | ✓ (as "your Jawwid contact") | — | ✓ |
| On duty | On duty / المناوب الآن | `user-clock` | Header line 2, **only when ≠ owner** | — | — | ✓ |
| Covering | Covering / تغطية | `users-arrow` | `ModeBadge` on message + header | — | — | ✓ |
| Assist | Assist / مساندة | `hand-helping` | `ModeBadge` on message, always with reason | — | — | ✓ |
| Escalated | Escalated / تصعيد | `arrow-up-double` | `ModeBadge` + case badge | — | — | ✓ |
| Keeping this | I'll keep this / سأتابعها بنفسي | `pin` | `ModeBadge`, expires | — | — | ✓ |
| Unattended | Unattended / بدون مناوب | `user-slash` | `status.danger` banner, manager only | — | — | ✓ (manager) |
| Case (staff) | Case / حالة | `folder-open` | `StatusBadge`, colour per `case.status` | — | — | ✓ |
| Topic (family) | Topic / موضوع | `folder-open` | Plain-language status chip, no internal labels | ✓ | — | — |
| Task | Task / مهمة | `check-square` | `TaskCard`; overdue = danger fg + icon + the word "Overdue" | — | — | ✓ |
| Follow-up | Follow-up / متابعة | `calendar-clock` | `FollowUpCard`, same overdue rule | — | — | ✓ |
| Handover | Handover / تسليم | `arrow-right-left` | `HandoffCard` + `SystemCard` in thread | — | — | ✓ |
| Internal note | Internal note / ملاحظة داخلية | `lock` | **Violet block, 3px leading edge, explicit label. Never a bubble.** | ✗ never | ✗ never | ✓ |
| Response target running out | Reply time running out / يقترب وقت الرد | `clock-alert` | `status.warning` text, no timer | — | — | ✓ |
| Response target breached | Reply overdue / تأخر الرد | `clock-alert` | `status.danger` text, no timer | — | — | ✓ |
| Workload | Light/Steady/Heavy · خفيف/متوسط/مرتفع | `gauge` | `WorkloadBadge`, always beside its breakdown | — | — | ✓ (manager) |
| Message queued | Queued / في الانتظار | `clock` | Muted bubble + clock glyph | ✓ | ✓ | ✓ |
| Message sending | — | `circle-dots` | Bubble at 60% opacity | ✓ | ✓ | ✓ |
| Message sent | — | `check` | Single tick | ✓ | ✓ | ✓ |
| Message delivered | — | `check-double` | Double tick, `text.muted` | ✓ | ✓ | ✓ |
| Message read | — | `check-double` | Double tick, `brand.primary` | ✓ | ✓ | ✓ |
| Message failed | Not sent / لم تُرسل | `alert-circle` | Red border + inline **Retry** | ✓ | ✓ | ✓ |
| Pending approval *(OQ-1)* | Waiting for approval / بانتظار الاعتماد | `hourglass` | `message.pending.bg`, **sender only** | ✓ | ✓ | ✓ (queue) |
| Rejected *(OQ-1)* | Not sent / لم تُرسل | `x-circle` | Muted block + reason, sender only | ✓ | ✓ | ✓ |
| Call *(OQ-4)* | Call / مكالمة | `phone` | `CallButton`; history entries are `SystemCard`s | ✓ | ✓ | ✓ |
| Offline | You're offline / أنت غير متصل | `wifi-off` | In-flow warning banner | ✓ | ✓ | ✓ |
| Reconnecting | Reconnecting… / جارٍ إعادة الاتصال… | `refresh` | In-flow warning banner | ✓ | ✓ | ✓ |

**Anything not in this table is single-platform** and its owning agent decides it.

---

## 2. Message state machine — identical on both platforms

```
composed ──► queued ──► sending ──► sent ──► delivered ──► read
                │          │
                │          └──► failed ──(retry)──► sending
                └──(offline)── stays queued until connectivity returns

with approvals (OQ-1), a staff/teacher/parent message in a Student Group:
composed ──► queued ──► sending ──► pending ──► approved ──► sent ──► delivered ──► read
                                        └────► rejected (terminal, sender-only, carries a reason)
```

Three rules both platforms must honour, from AI #3's D3 and the brief's §12:

1. **The client may only ever author `queued`, `sending`, and `failed`.** `sent`, `delivered`,
   `read`, `pending`, `approved` and `rejected` come from the server and are never guessed.
2. **A queued message must never look delivered.** Different opacity, different glyph, and it
   sits below the last server-confirmed message.
3. **A pending message is invisible to everyone except its sender.** Not greyed out for others —
   absent.

Idempotency: one `client_message_id` per *composed* message, reused across every retry.
**Backend dependency** — requested by AI #3 (C6); the brief's `message` entity has no such column.

---

## 3. Realtime behaviour — identical on both platforms

| Event | Behaviour | Never |
|---|---|---|
| New message, user at bottom | Append, scroll | — |
| New message, user scrolled up | Append + "New messages ↓" pill | Never auto-scroll |
| New message, user is composing | Append silently | Never steal focus or move the composer |
| Inbox row changes bucket | Instant swap, no animation | Never animate; never move the **selected** row |
| Read receipt / typing | Update in place | Never reflow the list |
| Ownership changed | Refresh family, insert a `SystemCard` in the thread | Never silently change the header |
| Coverage changed | Refresh duty + affected sections; banner if it affects *you* | Never move a family without a `SystemCard` |
| Approval resolved | Update the sender's message; publish to others | Never notify non-senders about a pending message |
| Disconnected | `ReconnectingBanner`; queue outbound; keep UI interactive | Never blank the screen, never modal-block |
| Reconnected | Resync from cursor, reconcile, dismiss banner | Never full-refetch the world |

Events are **signals, not state**: on receipt, invalidate and refetch the affected query rather
than patching a local value. This is what keeps *"attention and workload are computed, never
user-entered"* true on the client (AI #4's §8; AI #3's D3).

---

## 4. RTL / LTR — one rule set

**Default is Arabic RTL.** Both apps build RTL first and verify LTR.

**Mirrors:** page direction · navigation and reading order · back/forward chevrons · reply and
send arrows · list indentation · drawer open/close direction · progress bars, sliders and
steppers · tab order · message bubble side (own messages sit on the *reading-start-opposite*
edge, i.e. left in RTL, right in LTR) · avatar position · badge position · swipe-action
direction · breadcrumbs · pagination.

**Does not mirror:** media transport controls (play/pause/skip/seek) · **voice-note waveforms**
(a timeline of physical sound) · clocks, calendars, timers · checkmarks and delivery ticks ·
microphone, camera, paperclip, phone handset · numerals and the digits inside a time
(`3:00 PM` stays `3:00 PM`) · logos · magnitude arrows (up = more) · charts whose x-axis is time
*(axis labels localise; the axis does not flip — flipping a time axis makes the past appear on
the right and every reader misreads the trend)*.

**Text-level rules.**
- Message bodies render with `unicode-bidi: plaintext` so a mixed Arabic/English message
  resolves its own base direction per paragraph.
- Numbers, times, durations, IDs, URLs and file names are **LTR runs** wherever they appear,
  including inside Arabic sentences.
- Never concatenate a localised string from fragments — Arabic word order differs and the
  fragments will read backwards. Use full ICU messages with named parameters.
- Punctuation follows the base direction: `؟` and `،` in Arabic.
- Truncation happens at the *logical* end, and an ellipsis must not be applied to a bidi run
  boundary — truncate whole runs.

**Layout rules.** Only logical properties: `padding-inline-start`, `margin-inline-end`,
`inset-inline-start`, `text-align: start`. In Flutter: `EdgeInsetsDirectional`,
`AlignmentDirectional`, `PositionedDirectional`. `left`/`right` must not appear in either
codebase; a lint rule is cheaper than a QA pass.

---

## 5. Shared token contract

`design-system.md` §2–§5 is the source. Each platform materialises it once:

- **Flutter:** `lib/design/tokens.dart` — a `ThemeExtension` carrying the semantic names
  verbatim (`colorAttentionNowFg`, `spacing5`, `radiusLg`). No `Color(0x...)` outside that file.
- **Admin Web:** `src/styles/tokens.css` — CSS custom properties named
  `--color-attention-now-fg`, `--space-5`, `--radius-lg`. No hex outside that file.

Names are identical modulo casing convention, so a token can be grepped across both repos.
When brand sign-off lands, exactly two files change.

---

## 6. What must never differ

1. The **words** in `terminology.md`. A concept named differently on two platforms is two
   concepts to a user who uses both.
2. The **message state machine** (§2).
3. **Attention never rendering as a number**, on any platform, in any context.
4. **Owner never being replaced by on-duty** in any header, on any platform.
5. **Internal notes never leaving the violet treatment**, and never rendering on a
   customer-facing surface at all.
6. **No phone number** in any screen, payload, notification, call log or search result.
7. The **RTL mirroring rule set** (§4).

---

## 7. Known cross-platform gap — approvals and calls

`discovery.md` §4 records it in full. In short: mobile builds Student Groups, approvals and
calling; admin has reserved seams but builds none of them. Until **OQ-1** and **OQ-4** are
decided:

- `screens/approvals.md` and `screens/call.md` are marked **conditional** and are not counted
  in P0 delivery.
- The concept register above marks their rows `(OQ-1)` / `(OQ-4)`.
- Neither platform should ship a *half* of either feature. A teacher whose message enters
  `pending` with no approver anywhere is worse than a teacher whose message simply sends.
